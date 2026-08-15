import { Vector3 } from "@babylonjs/core";
import type { MarkerEntry } from "../fx/Markers";
import {
  formatTime,
  type Activity,
  type ActivityResult,
  type ActivityStatus,
  type ActivityWorld,
} from "./Activity";

export interface RelayNodeDefinition {
  id: string;
  label: string;
  position: Vector3;
  minSpeed: number;
}

export interface RelayDefinition {
  id: string;
  name: string;
  summary: string;
  anchor: Vector3;
  seconds: number;
  nodes: RelayNodeDefinition[];
}

interface RelayNode extends RelayNodeDefinition {
  tuned: boolean;
  tuning: number;
  warned: boolean;
  armed: boolean;
}

const RELAY_RADIUS = 28;

/** A traversal-first emergency: arrive fast, then spend Focus to tune. */
export class HarmonicRelay implements Activity {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly anchor: Vector3;

  private readonly nodes: RelayNode[];
  private timeLeft = 0;
  private elapsed = 0;
  private tuned = 0;
  private finishedReserve = 0;
  private assist = false;
  private currentNode: RelayNode | null = null;

  constructor(private readonly definition: RelayDefinition) {
    this.id = definition.id;
    this.name = definition.name;
    this.summary = definition.summary;
    this.anchor = definition.anchor;
    this.nodes = definition.nodes.map((node) => ({
      ...node,
      tuned: false,
      tuning: 0,
      warned: false,
      armed: false,
    }));
  }

  start(world: ActivityWorld): void {
    this.assist = world.save.settings.relayAssist;
    this.timeLeft = this.definition.seconds * (this.assist ? 1.25 : 1);
    this.elapsed = 0;
    this.tuned = 0;
    this.finishedReserve = 0;
    this.currentNode = null;
    for (const node of this.nodes) {
      node.tuned = false;
      node.tuning = 0;
      node.warned = false;
      node.armed = false;
      world.effects.pulse(node.position, "danger", 14, 0.45);
    }
    world.toast(`Gridfall — ${this.nodes.length} relays, ${Math.round(this.timeLeft)} seconds`);
  }

  update(dt: number, world: ActivityWorld): ActivityResult {
    this.elapsed += dt;
    this.timeLeft -= dt;
    const hold = this.assist ? 0.35 : 0.65;
    this.currentNode = this.nearestUntuned(world.player.position);

    for (const node of this.nodes) {
      if (node.tuned) continue;
      const inside = Vector3.DistanceSquared(world.player.position, node.position) <= RELAY_RADIUS * RELAY_RADIUS;
      const requiredSpeed = node.minSpeed * (this.assist ? 0.75 : 1);

      if (inside && world.player.speed >= requiredSpeed) node.armed = true;

      if (inside && !node.armed) {
        node.tuning = Math.max(0, node.tuning - dt * 0.35);
        if (!node.warned) {
          node.warned = true;
          world.toast(`${node.label} needs ${Math.round(requiredSpeed * 3.6)} km/h`);
          world.effects.pulse(node.position, "danger", 13, 0.3);
        }
        continue;
      }

      node.warned = false;
      if (inside && node.armed && world.focusActive()) {
        node.tuning = Math.min(hold, node.tuning + dt);
        if (node.tuning >= hold) {
          node.tuned = true;
          this.tuned += 1;
          this.timeLeft += 7;
          world.player.charge = Math.min(100, world.player.charge + 24);
          world.effects.pulse(node.position, "cool", 24, 0.6);
          world.effects.burst(node.position, 30, "cool");
          world.toast(`${node.label} stable · +7s`);
        }
      } else {
        // A partial read is remembered briefly; missed inputs are not a reset.
        node.tuning = Math.max(0, node.tuning - dt * 0.22);
        if (!inside) node.armed = false;
      }
    }

    if (this.tuned >= this.nodes.length) {
      this.finishedReserve = Math.max(0, this.timeLeft);
      world.save.recordRelay(this.id, this.elapsed, this.finishedReserve);
      return "complete";
    }
    if (this.timeLeft <= 0) return "failed";
    return "running";
  }

  status(): ActivityStatus {
    const active = this.currentNode ?? this.nodes.find((node) => !node.tuned) ?? null;
    const hold = this.assist ? 0.35 : 0.65;
    const speed = active ? active.minSpeed * (this.assist ? 0.75 : 1) : 0;
    const detail = active
      ? `${active.label} · ${Math.round(speed * 3.6)} km/h then hold Focus ${active.tuning.toFixed(2)}/${hold.toFixed(2)}s`
      : "Grid stable";
    return {
      title: `${this.name} · ${this.tuned}/${this.nodes.length}`,
      detail,
      progress: (this.tuned + (active?.tuning ?? 0) / hold) / this.nodes.length,
      timer: Math.max(0, this.timeLeft),
    };
  }

  markers(): MarkerEntry[] {
    return this.nodes
      .filter((node) => !node.tuned)
      .map((node) => ({
        id: `relay:${this.id}:${node.id}`,
        label: node.label,
        position: node.position,
        style: "relay",
        radius: RELAY_RADIUS,
      }));
  }

  stop(): void {
    for (const node of this.nodes) {
      node.tuned = false;
      node.tuning = 0;
      node.warned = false;
      node.armed = false;
    }
    this.currentNode = null;
  }

  successMessage(): string {
    return `Gridfall contained in ${formatTime(this.elapsed)} · ${Math.ceil(this.finishedReserve)}s reserve`;
  }

  private nearestUntuned(from: Vector3): RelayNode | null {
    let best: RelayNode | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const node of this.nodes) {
      if (node.tuned) continue;
      const distance = Vector3.DistanceSquared(from, node.position);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }
}
