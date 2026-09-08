import { Vector3 } from "@babylonjs/core";
import { MAX_REPLAY_FRAMES, type RouteReplay } from "../core/Save";
import { sampleReplay, type GhostPose } from "../fx/RouteGhost";
import type { MarkerEntry } from "../fx/Markers";
import {
  formatTime,
  type Activity,
  type ActivityResult,
  type ActivityStatus,
  type ActivityWorld,
} from "./Activity";

/**
 * Checkpoint runs.
 *
 * Three hand-authored routes plus generated courier chains all share this
 * object. Gates can carry a minimum speed, which is what turns a route from
 * "drive between dots" into a line you have to hold your pace through.
 */

export interface RouteGate {
  position: Vector3;
  /** Metres per second the player must be doing to bank the gate. */
  minSpeed?: number;
  radius?: number;
}

export interface RouteDefinition {
  id: string;
  name: string;
  summary: string;
  gates: RouteGate[];
  /** Optional par time; beating it is the "gold" line. */
  par?: number;
  /** Campaign deliveries do not consume the free-roam record/ghost budget. */
  recordBest?: boolean;
}

export class RouteRun implements Activity {
  readonly id: string;
  readonly name: string;
  readonly summary: string;

  private index = 0;
  private elapsed = 0;
  private best: number | null = null;
  private finishedIn = 0;
  private missedGate = false;
  private readonly previous = Vector3.Zero();
  private readonly frames: RouteReplay["frames"] = [];
  private recordingValid = true;
  private recovered = false;
  private nextSample = 0;
  private replay: RouteReplay | null = null;
  private readonly ghost: GhostPose = [0, 0, 0, 0];
  private ghostVisible = false;

  replayPose(): GhostPose | null { return this.ghostVisible ? this.ghost : null; }

  /**
   * Flags the recovery the player just asked for, before the teleport lands.
   *
   * A recovery must never turn a teleport into a ranked shortcut, so the run
   * stops recording a best — and the gap itself is not travel, so the next
   * step must not sweep a checkpoint the runner never reached.
   */
  noteRecovery(): void {
    this.recordingValid = false;
    this.recovered = true;
  }

  constructor(private readonly route: RouteDefinition) {
    this.id = route.id;
    this.name = route.name;
    this.summary = route.summary;
  }

  get anchor(): Vector3 {
    return this.route.gates[0]?.position ?? Vector3.Zero();
  }

  start(world: ActivityWorld): void {
    this.index = 0;
    this.elapsed = 0;
    this.missedGate = false;
    this.best = this.route.recordBest === false ? null : world.save.bestFor(this.route.id);
    this.finishedIn = 0;
    this.frames.length = 0;
    this.recordingValid = true;
    this.recovered = false;
    this.nextSample = 0.2;
    this.previous.copyFrom(world.player.position);
    this.replay = this.route.recordBest === false ? null : world.save.data.routeReplays[this.route.id] ?? null;
    this.ghostVisible = false;
    this.capture(world);
    world.toast(`${this.route.name} — go`);
  }

  update(dt: number, world: ActivityWorld): ActivityResult {
    this.elapsed += dt;
    // A recovery is not travel, and unlike the coarse distance test below it
    // names the teleport exactly — so it alone breaks gate continuity, leaving
    // authored respawns to move the runner without dropping a checkpoint.
    const recovered = this.recovered;
    this.recovered = false;
    if (recovered || Vector3.DistanceSquared(this.previous, world.player.position) > (Math.max(400, world.player.speed) * dt + 8) ** 2) this.recordingValid = false;
    this.ghostVisible = this.replay !== null && sampleReplay(this.replay, this.elapsed, this.ghost);
    if (this.elapsed >= this.nextSample && this.frames.length < MAX_REPLAY_FRAMES - 1) {
      this.capture(world);
      this.nextSample = this.elapsed + 0.2;
    }
    const gate = this.route.gates[this.index];
    if (!gate) return "complete";

    const radius = gate.radius ?? 16;
    const player = world.player;
    // Sweeping across the recovery would bank the checkpoint on the far side of
    // the gap, so the step is dropped and the next one measures real motion.
    const crossed = !recovered && crossesGate(this.previous, player.position, gate.position, radius);
    this.previous.copyFrom(player.position);
    if (!crossed) return "running";

    if (gate.minSpeed !== undefined && player.speed < gate.minSpeed) {
      // Too slow through a speed gate: it does not count, and it says so once.
      if (!this.missedGate) {
        this.missedGate = true;
        world.toast(`Hold ${Math.round(gate.minSpeed * 3.6)} km/h through the gate`);
        world.effects.pulse(gate.position, "danger", 18);
      }
      return "running";
    }

    this.missedGate = false;
    this.index += 1;
    player.charge = Math.min(100, player.charge + 10);
    world.effects.pulse(gate.position, "warm", 22);

    if (this.index >= this.route.gates.length) {
      this.finishedIn = this.elapsed;
      this.capture(world);
      const recording = this.recordingValid && this.elapsed <= 240 && this.frames.length <= MAX_REPLAY_FRAMES
        ? { duration: this.elapsed, frames: this.frames } : undefined;
      const improved = this.route.recordBest !== false && this.recordingValid && world.save.recordRoute(this.route.id, this.elapsed, recording);
      world.toast(
        improved
          ? `New best · ${formatTime(this.elapsed)}`
          : this.recordingValid ? `Clear · ${formatTime(this.elapsed)}` : "Practice finish · recovery used, best time unchanged",
      );
      return "complete";
    }

    world.toast(`Split ${this.index}/${this.route.gates.length} · ${formatTime(this.elapsed)}`);
    return "running";
  }

  status(): ActivityStatus {
    const gate = this.route.gates[this.index];
    const speedNote =
      gate?.minSpeed !== undefined ? ` · hold ${Math.round(gate.minSpeed * 3.6)} km/h` : "";
    const bestNote = this.route.recordBest === false ? "delivery in progress" : this.best === null ? "first recorded run"
      : `best ${formatTime(this.best)}${this.replay ? " · personal-best ghost" : ""}`;
    return {
      title: `${this.route.name} · ${Math.min(this.index + 1, this.route.gates.length)}/${this.route.gates.length}`,
      detail: `${formatTime(this.elapsed)} · ${bestNote}${speedNote}`,
      progress: this.index / this.route.gates.length,
    };
  }

  markers(): MarkerEntry[] {
    const gate = this.route.gates[this.index];
    if (!gate) return [];
    const entries: MarkerEntry[] = [
      { position: gate.position, style: "checkpoint", radius: gate.radius ?? 16 },
    ];
    // Show the next gate faintly so the line ahead is readable at speed.
    const next = this.route.gates[this.index + 1];
    if (next) entries.push({ position: next.position, style: "objective", radius: 10 });
    return entries;
  }

  stop(): void {
    this.index = 0;
    this.ghostVisible = false;
    this.frames.length = 0;
  }

  private capture(world: ActivityWorld): void {
    if (this.route.recordBest === false) return;
    const p = world.player.position;
    const previous = this.frames[this.frames.length - 1];
    if (previous && Math.abs(previous[0] - this.elapsed) < 0.00001) return;
    this.frames.push([this.elapsed, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10, world.player.root.rotation.y]);
  }

  successMessage(): string {
    if (!this.recordingValid) return `${this.route.name} practice complete · recovery used, best unchanged`;
    const par = this.route.par;
    if (par !== undefined && this.finishedIn <= par) {
      return `${this.route.name} cleared under par — ${formatTime(this.finishedIn)}`;
    }
    return `${this.route.name} cleared — ${formatTime(this.finishedIn)}`;
  }
}

/** Segment-sphere gate test: retains a checkpoint crossed between simulation samples. */
export function crossesGate(from: Vector3, to: Vector3, centre: Vector3, radius: number): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((centre.x - from.x) * dx + (centre.y - from.y) * dy + (centre.z - from.z) * dz) / lengthSq));
  return (from.x + dx * t - centre.x) ** 2 + (from.y + dy * t - centre.y) ** 2 + (from.z + dz * t - centre.z) ** 2 <= radius * radius;
}
