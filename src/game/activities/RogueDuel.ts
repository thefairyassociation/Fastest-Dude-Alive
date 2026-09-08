import { Vector3 } from "@babylonjs/core";
import type { MarkerEntry } from "../fx/Markers";
import { rogueById, type RogueDefinition } from "../npc/Rogue";
import {
  type Activity,
  type ActivityResult,
  type ActivityStatus,
  type ActivityWorld,
} from "./Activity";

/**
 * Opt-in encounters.
 *
 * Combat is a minigame here, not a tax. A duel only exists between `start`
 * and `stop`, it is bounded by an arena radius so it cannot follow you across
 * the city, and it ends the moment either side is done.
 */
export class RogueDuel implements Activity {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  private readonly definition: RogueDefinition;

  private started = false;
  private elapsed = 0;
  private introShown = false;
  private tactic = "Read the warning, then strike during recovery.";
  /** Latched the first time health crosses the threshold, not per frame. */
  private wasHurtBadly = false;

  constructor(
    rogueId: string,
    readonly anchor: Vector3,
    /** How far from the anchor the fight is allowed to wander. */
    private readonly arenaRadius = 240,
  ) {
    this.definition = rogueById(rogueId);
    this.id = `duel-${rogueId}`;
    this.name = `Rogue: ${this.definition.codename}`;
    this.summary = this.definition.blurb;
  }

  get rogueId(): string {
    return this.definition.id;
  }

  start(world: ActivityWorld): void {
    world.clearRogues();
    const spawn = world.city.nearestRoad(this.anchor.add(new Vector3(38, 0, 22)));
    world.spawnRogue(this.definition.id, spawn);
    this.started = true;
    this.elapsed = 0;
    this.wasHurtBadly = false;
    this.introShown = false;
  }

  update(dt: number, world: ActivityWorld): ActivityResult {
    if (!this.started) return "failed";
    this.elapsed += dt;

    if (!this.introShown && this.elapsed > 0.35) {
      this.introShown = true;
      world.toast(`${this.definition.codename}: “${this.definition.taunt}”`);
    }

    const rogues = world.activeRogues();
    const rogue = rogues[0];
    if (rogue) this.tactic = rogue.tacticHint;
    if (!rogue || !rogue.alive) {
      world.save.update((profile) => {
        if (!profile.roguesBeaten.includes(this.definition.id)) {
          profile.roguesBeaten.push(this.definition.id);
        }
      });
      return "complete";
    }

    // Wandering out of the arena ends it rather than dragging the fight along.
    if (Vector3.DistanceSquared(world.player.position, this.anchor) > this.arenaRadius * this.arenaRadius) {
      world.toast(`${this.definition.codename} broke off`);
      return "failed";
    }

    if (world.player.health <= 25) this.wasHurtBadly = true;
    if (world.player.health <= 0) return "failed";
    return "running";
  }

  status(): ActivityStatus {
    return {
      title: this.name,
      detail: `${this.definition.name} · ${this.tactic}`,
      progress: undefined,
    };
  }

  markers(): MarkerEntry[] {
    return [];
  }

  stop(world: ActivityWorld): void {
    world.clearRogues();
    this.started = false;
  }

  successMessage(): string {
    const clean = this.wasHurtBadly ? "" : " without dropping below a quarter";
    return `${this.definition.codename} is down${clean}.`;
  }
}
