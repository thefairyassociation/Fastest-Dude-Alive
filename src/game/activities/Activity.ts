import type { Vector3 } from "@babylonjs/core";
import type { Save } from "../core/Save";
import type { Effects } from "../fx/Effects";
import type { MarkerEntry } from "../fx/Markers";
import type { Player } from "../player/Player";
import type { City } from "../world/City";
import type { Rogue } from "../npc/Rogue";
import type { Bystander } from "../npc/Bystander";
import type { Rng } from "../core/Rng";
import type { RouteGhost } from "./RouteGhost";

/**
 * The shared contract for everything you can *do* in Meridian.
 *
 * Free roam offers activities; story chapters run the same objects for their
 * set pieces. Nothing here knows about the HUD — an activity reports status
 * and markers, and the mode above it decides how to draw them.
 */

export interface ActivityWorld {
  city: City;
  player: Player;
  effects: Effects;
  save: Save;
  rng: Rng;
  /** Shared PB ghost mesh; RouteRun starts/stops it. */
  routeGhost: RouteGhost | null;
  toast(message: string): void;
  /** Spawns a rogue for an encounter; the world owns its lifetime. */
  spawnRogue(id: string, position: Vector3): Rogue;
  clearRogues(): void;
  activeRogues(): Rogue[];
  /** Borrows a bystander from the shared pool, or null when exhausted. */
  takeBystander(): Bystander | null;
  releaseBystanders(): void;
  /** Live remnant echo position, or null when none is active. */
  remnantPosition(): Vector3 | null;
}

export type ActivityResult = "running" | "complete" | "failed";

export interface ActivityStatus {
  title: string;
  detail: string;
  /** 0..1, drawn as a bar when present. */
  progress?: number;
  /** Seconds remaining, drawn as a countdown when present. */
  timer?: number;
}

export interface Activity {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Where the free-roam prompt for this activity sits. */
  readonly anchor: Vector3;
  start(world: ActivityWorld): void;
  update(dt: number, world: ActivityWorld): ActivityResult;
  status(): ActivityStatus;
  markers(): MarkerEntry[];
  stop(world: ActivityWorld): void;
  /** Message shown on success; used for both the toast and the results card. */
  successMessage(): string;
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}
