import { Vector3 } from "@babylonjs/core";
import type { MarkerEntry } from "../fx/Markers";
import type { Bystander } from "../npc/Bystander";
import {
  formatTime,
  type Activity,
  type ActivityResult,
  type ActivityStatus,
  type ActivityWorld,
} from "./Activity";

/**
 * Rescue runs.
 *
 * A building comes down, a gas main goes, a tram derails — the specifics are
 * the story's business. Mechanically: people are scattered across a few
 * blocks with a clock running, and every one you reach adds time. It is the
 * clearest expression of the fantasy that does not involve hitting anybody.
 */

interface Target {
  id: string;
  position: Vector3;
  bystander: Bystander | null;
  rescued: boolean;
}

export class RescueRun implements Activity {
  readonly id: string;
  readonly name: string;
  readonly summary: string;

  private readonly targets: Target[] = [];
  private timeLeft = 0;
  private elapsed = 0;
  private saved = 0;

  constructor(
    id: string,
    name: string,
    /** Where the incident is centred. */
    readonly anchor: Vector3,
    private readonly count: number,
    private readonly seconds: number,
    private readonly spread = 320,
  ) {
    this.id = id;
    this.name = name;
    this.summary = `Reach ${count} people before the clock runs out.`;
  }

  start(world: ActivityWorld): void {
    this.targets.length = 0;
    this.saved = 0;
    this.elapsed = 0;
    this.timeLeft = this.seconds;

    for (let i = 0; i < this.count; i += 1) {
      const position = world.city.roadPointNear(this.anchor, 60, this.spread, world.rng);
      const bystander = world.takeBystander();
      if (bystander) {
        bystander.place(position, world.rng() * Math.PI * 2);
        bystander.mood = "panic";
        bystander.setEnabled(true);
      }
      this.targets.push({ id: `${this.id}:person-${i + 1}`, position, bystander, rescued: false });
    }

    world.toast(`${this.name} — ${this.count} people, ${Math.round(this.seconds)} seconds`);
  }

  update(dt: number, world: ActivityWorld): ActivityResult {
    this.elapsed += dt;
    this.timeLeft -= dt;

    for (const target of this.targets) {
      if (target.rescued) continue;
      if (Vector3.DistanceSquared(world.player.position, target.position) > 12 * 12) continue;

      target.rescued = true;
      this.saved += 1;
      // Each save buys time; a clean route can finish with the clock climbing.
      this.timeLeft += 6;
      world.player.charge = Math.min(100, world.player.charge + 12);
      world.effects.pulse(target.position, "cool", 16);
      world.effects.burst(target.position, 22, "cool");
      if (target.bystander) {
        target.bystander.mood = "cheer";
      }
      world.toast(`${this.saved}/${this.count} clear · +6s`);
    }

    if (this.saved >= this.count) return "complete";
    if (this.timeLeft <= 0) return "failed";
    return "running";
  }

  status(): ActivityStatus {
    return {
      title: `${this.name} · ${this.saved}/${this.count}`,
      detail: `${formatTime(Math.max(0, this.timeLeft))} left · reach every marker`,
      progress: this.saved / this.count,
      timer: Math.max(0, this.timeLeft),
    };
  }

  markers(): MarkerEntry[] {
    const entries: MarkerEntry[] = [];
    for (const target of this.targets) {
      if (target.rescued) continue;
      entries.push({
        id: target.id,
        label: `Person ${this.targets.indexOf(target) + 1}`,
        position: target.position,
        style: "rescue",
        radius: 12,
      });
    }
    return entries;
  }

  stop(world: ActivityWorld): void {
    world.releaseBystanders();
    this.targets.length = 0;
  }

  successMessage(): string {
    return `${this.count} people clear in ${formatTime(this.elapsed)}`;
  }
}
