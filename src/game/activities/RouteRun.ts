import { Vector3 } from "@babylonjs/core";
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
    this.best = world.save.bestFor(this.route.id);
    world.toast(`${this.route.name} — go`);
  }

  update(dt: number, world: ActivityWorld): ActivityResult {
    this.elapsed += dt;
    const gate = this.route.gates[this.index];
    if (!gate) return "complete";

    const radius = gate.radius ?? 16;
    const player = world.player;
    if (Vector3.DistanceSquared(player.position, gate.position) > radius * radius) {
      return "running";
    }

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
      const improved = world.save.recordRoute(this.route.id, this.elapsed);
      world.toast(
        improved
          ? `New best · ${formatTime(this.elapsed)}`
          : `Clear · ${formatTime(this.elapsed)}`,
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
    const bestNote = this.best === null ? "no time yet" : `best ${formatTime(this.best)}`;
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
  }

  successMessage(): string {
    const par = this.route.par;
    if (par !== undefined && this.finishedIn <= par) {
      return `${this.route.name} cleared under par — ${formatTime(this.finishedIn)}`;
    }
    return `${this.route.name} cleared — ${formatTime(this.finishedIn)}`;
  }
}
