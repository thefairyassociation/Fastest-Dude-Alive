import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { Rng } from "../core/Rng";
import type { Save } from "../core/Save";
import type { Effects } from "../fx/Effects";
import type { City } from "../world/City";

/**
 * Resonance motes.
 *
 * Loose charge left over from the breach, scattered across rooftops, bridge
 * cables and back alleys. They are the reason to look up in free roam: half
 * of them are only reachable by wall running, and the count persists in the
 * profile.
 */

interface Mote {
  id: string;
  position: Vector3;
  mesh: Mesh;
  taken: boolean;
  spin: number;
}

const COUNT = 64;
/** Motes only tick and draw within this range of the player. */
const ACTIVE_RANGE = 400;

export class Collectibles {
  private readonly motes: Mote[] = [];
  private collected = 0;
  private clock = 0;

  constructor(scene: Scene, city: City, rng: Rng, private readonly save: Save) {
    const material = new PBRMaterial("mote-material", scene);
    material.albedoColor = Color3.Black();
    material.emissiveColor = new Color3(1.6, 1.15, 0.5);
    material.roughness = 1;
    material.metallic = 0;
    material.alpha = 0.92;
    material.disableDepthWrite = true;

    const source = MeshBuilder.CreatePolyhedron("mote-source", { type: 3, size: 0.55 }, scene);
    source.material = material;
    source.isPickable = false;
    source.setEnabled(false);

    for (let i = 0; i < COUNT; i += 1) {
      const id = `mote-${i}`;
      // Two thirds go up high; the rest keep street level interesting.
      const highUp = i % 3 !== 0;
      const angle = rng() * Math.PI * 2;
      const radius = 120 + rng() * (city.extent - 260);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const surface = city.groundHeight(x, z, 500);
      const lift = highUp ? 2.4 : 1.6;
      const position = new Vector3(x, surface + lift, z);

      const mesh = source.clone(id);
      mesh.position.copyFrom(position);
      mesh.isPickable = false;
      const taken = save.hasCollected(id);
      mesh.setEnabled(false);
      if (taken) this.collected += 1;

      this.motes.push({ id, position, mesh, taken, spin: rng() * Math.PI * 2 });
    }
  }

  get total(): number {
    return COUNT;
  }

  get found(): number {
    return this.collected;
  }

  update(dt: number, playerPosition: Vector3, effects: Effects): boolean {
    this.clock += dt;
    let picked = false;

    for (const mote of this.motes) {
      if (mote.taken) continue;
      const dx = mote.position.x - playerPosition.x;
      const dz = mote.position.z - playerPosition.z;
      const flatSq = dx * dx + dz * dz;

      if (flatSq > ACTIVE_RANGE * ACTIVE_RANGE) {
        if (mote.mesh.isEnabled()) mote.mesh.setEnabled(false);
        continue;
      }

      if (!mote.mesh.isEnabled()) mote.mesh.setEnabled(true);
      mote.spin += dt * 2.2;
      mote.mesh.rotation.y = mote.spin;
      mote.mesh.position.y = mote.position.y + Math.sin(this.clock * 2 + mote.spin) * 0.24;

      const dy = mote.position.y - playerPosition.y;
      if (flatSq < 25 && Math.abs(dy) < 3.2) {
        mote.taken = true;
        mote.mesh.setEnabled(false);
        this.collected += 1;
        this.save.collect(mote.id);
        effects.pulse(mote.position, "warm", 8, 0.35);
        effects.burst(mote.position, 26, "warm");
        picked = true;
      }
    }

    return picked;
  }

  /** Nearest un-taken mote, for the minimap sweep. */
  nearest(from: Vector3, maxDistance: number): Vector3 | null {
    let best: Vector3 | null = null;
    let bestSq = maxDistance * maxDistance;
    for (const mote of this.motes) {
      if (mote.taken) continue;
      const distanceSq = Vector3.DistanceSquared(mote.position, from);
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        best = mote.position;
      }
    }
    return best;
  }
}
