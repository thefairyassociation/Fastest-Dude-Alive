import { Vector3 } from "@babylonjs/core";
import type { Bystander } from "../npc/Bystander";
import type { Rogue } from "../npc/Rogue";
import type { MarkerEntry } from "../fx/Markers";
import type { Activity, ActivityResult, ActivityStatus, ActivityWorld } from "./Activity";
import { crossesGate } from "./RouteRun";

/** Authored, opt-in emergencies. Objective time is real; hazards use Focus time. */
export class CascadeRescue implements Activity {
  readonly id = "cascade-rescue";
  readonly name = "Cascade Rescue";
  readonly summary = "Save four people in any order. Red rings warn of grid surges; Focus delays each surge.";
  readonly kind = "rescue" as const;
  private targets: Array<{ position: Vector3; actor: Bystander | null; safe: boolean }> = [];
  private readonly previous = Vector3.Zero();
  private remaining = 65;
  private hazardClock = 0;
  private hazardIndex = 0;
  private saved = 0;
  private warned = false;
  private ready = false;

  constructor(readonly anchor: Vector3, private readonly positions: Vector3[]) {}

  start(world: ActivityWorld): void {
    world.releaseBystanders();
    this.remaining = 65; this.hazardClock = 0; this.hazardIndex = 0; this.saved = 0; this.warned = false;
    this.previous.copyFrom(world.player.position);
    this.targets = this.positions.map(position => {
      const actor = world.takeBystander();
      actor?.place(position, 0); actor?.setEnabled(true);
      if (actor) actor.mood = "panic";
      return { position, actor, safe: false };
    });
    this.ready = this.targets.length > 0 && this.targets.every(target => target.actor !== null);
    world.toast(this.summary);
  }

  update(dt: number, world: ActivityWorld): ActivityResult {
    if (!this.ready || world.player.health <= 0) return "failed";
    this.remaining -= dt;
    if (this.remaining <= 0) return "failed";
    const p = world.player;
    const continuous = Vector3.DistanceSquared(this.previous, p.position) <= (400 * dt + 8) ** 2;
    for (const target of this.targets) {
      if (target.safe || !continuous || !crossesGate(this.previous, p.position, target.position, 12)) continue;
      target.safe = true; this.saved++;
      if (target.actor) target.actor.mood = "cheer";
      p.charge = Math.min(100, p.charge + 18);
      world.effects.pulse(target.position, "cool", 14, 0.4);
      world.toast(`${this.saved}/${this.targets.length} safe · +18 energy`);
    }
    this.previous.copyFrom(p.position);
    if (this.saved === this.targets.length) return "complete";
    this.hazardClock += dt * (p.focusHeld ? 0.16 : 1);
    let target = this.targets[this.hazardIndex % this.targets.length]!;
    if (target.safe) {
      this.hazardIndex = this.targets.findIndex(candidate => !candidate.safe);
      this.hazardClock = 0; this.warned = false;
      target = this.targets[this.hazardIndex]!;
    }
    if (!this.warned) { world.effects.pulse(target.position, "danger", 18, 0.5); this.warned = true; }
    if (this.hazardClock >= 3) {
      world.effects.burst(target.position, 24, "danger");
      if (Vector3.DistanceSquared(p.position, target.position) < 24 ** 2) p.damage(18, target.position);
      this.hazardClock = 0; this.hazardIndex++; this.warned = false;
    }
    return "running";
  }

  status(): ActivityStatus {
    return { title: `${this.name} · ${this.saved}/${this.positions.length} safe`, detail: "Choose your line · F delays red-ring surges · reach green diamonds", timer: Math.max(0, this.remaining), progress: this.saved / this.positions.length };
  }
  markers(): MarkerEntry[] {
    return this.targets.flatMap((t, i): MarkerEntry[] => t.safe ? [] : [
      { position: t.position, style: "rescue", radius: 10 },
      ...(i === this.hazardIndex % this.targets.length ? [{ position: t.position, style: "threat" as const, radius: 24 * Math.min(1, this.hazardClock / 3) }] : []),
    ]);
  }
  stop(world: ActivityWorld): void { world.releaseBystanders(); this.targets.length = 0; this.ready = false; }
  successMessage(): string { return `Every address reached · ${Math.max(0, 65 - this.remaining).toFixed(1)}s`; }
}

export class CourierInterception implements Activity {
  readonly id = "courier-interception";
  readonly name = "Courier Interception";
  readonly summary = "Catch the courier on the foundry loop. Jump the red ground sweep, then strike during recovery.";
  readonly kind = "duel" as const;
  private rogue: Rogue | null = null;
  private remaining = 90;
  constructor(readonly anchor: Vector3, private readonly path: Vector3[]) {}
  start(world: ActivityWorld): void {
    world.clearRogues(); this.remaining = 90;
    this.rogue = world.spawnRogue("courier", this.path[0]!.clone());
    this.rogue.configureCourier(this.path);
    world.toast(this.summary);
  }
  update(dt: number, world: ActivityWorld): ActivityResult {
    this.remaining -= dt;
    if (world.player.health <= 0 || this.remaining <= 0 || !this.rogue) return "failed";
    return this.rogue.alive ? "running" : "complete";
  }
  status(): ActivityStatus {
    return { title: this.name, detail: this.rogue?.tacticHint ?? this.summary, timer: Math.max(0, this.remaining), progress: 1 - (this.rogue?.healthRatio ?? 1) };
  }
  markers(): MarkerEntry[] { return this.rogue?.alive ? [{ position: this.rogue.position, style: "threat", radius: 8 }] : []; }
  stop(world: ActivityWorld): void { world.clearRogues(); this.rogue = null; }
  successMessage(): string { return `Courier intercepted · ${(90 - this.remaining).toFixed(1)}s`; }
}
