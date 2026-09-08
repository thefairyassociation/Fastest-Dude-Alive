import {
  Color3,
  Color4,
  LinesMesh,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  Scene,
  Vector3,
  TransformNode,
} from "@babylonjs/core";
import { SpeedTrails } from "./SpeedTrails";
import { clamp } from "../core/Rng";
import type { Quality } from "../core/Save";
import { createSparkSprite } from "../world/Textures";
import type { Player } from "../player/Player";

/**
 * Every transient visual, pooled.
 *
 * Nothing here allocates during play: rings, arcs and afterimages are taken
 * from fixed pools and returned when they expire, and the slipstream is a
 * single particle system whose emit rate is driven by perceptual speed rather
 * than by spawning thousands of one-shot emitters.
 */

export type PulseTone = "warm" | "cool" | "pale" | "danger";

interface Pooled<T> {
  mesh: T;
  age: number;
  duration: number;
  grow: number;
  /** Peak opacity; the fade multiplies this rather than the live value. */
  alpha: number;
  active: boolean;
}

const POOL_PULSES = 24;
const POOL_BOLTS = 12;
const POOL_GHOSTS = 26;
const BOLT_POINTS = 6;

export class Effects {
  private readonly pulses = new Map<PulseTone, Array<Pooled<Mesh>>>();
  private readonly bolts: Array<Pooled<LinesMesh>> = [];
  private readonly ghosts: Array<Pooled<Mesh>> = [];
  private readonly boltPoints: Vector3[][] = [];
  private readonly slipstream: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly emitter: Mesh;
  private readonly arcOrigin = new Vector3();
  private readonly arcTarget = new Vector3();

  private readonly trails: SpeedTrails;
  private ghostClock = 0;
  private arcClock = 0;
  private reducedMotion = false;

  constructor(
    private readonly scene: Scene,
    ghostSource: Mesh,
    quality: Quality,
    trailAnchors: TransformNode[],
  ) {
    this.trails = new SpeedTrails(scene, quality === "low" ? trailAnchors.slice(0, 2) : trailAnchors);
    const tones: Record<PulseTone, string> = {
      warm: "#ffc38a",
      cool: "#9fd4ff",
      pale: "#e6edf2",
      danger: "#ff6a58",
    };

    // Rings are pooled per tone so the shared material never has to change.
    for (const [tone, hex] of Object.entries(tones) as Array<[PulseTone, string]>) {
      const material = new PBRMaterial(`pulse-${tone}`, scene);
      material.albedoColor = Color3.Black();
      material.emissiveColor = Color3.FromHexString(hex).scale(2.2);
      material.roughness = 1;
      material.metallic = 0;
      material.disableDepthWrite = true;
      material.alpha = 0.9;

      const pool: Array<Pooled<Mesh>> = [];
      for (let i = 0; i < POOL_PULSES / 4; i += 1) {
        const ring = MeshBuilder.CreateTorus(
          `pulse-${tone}-${i}`,
          { diameter: 1, thickness: 0.045, tessellation: 28 },
          scene,
        );
        ring.material = material;
        ring.isPickable = false;
        ring.setEnabled(false);
        pool.push({ mesh: ring, age: 0, duration: 0.45, grow: 1, alpha: 1, active: false });
      }
      this.pulses.set(tone, pool);
    }

    for (let i = 0; i < POOL_BOLTS; i += 1) {
      const points: Vector3[] = [];
      for (let p = 0; p < BOLT_POINTS; p += 1) points.push(new Vector3(0, 0, 0));
      const lines = MeshBuilder.CreateLines(`bolt-${i}`, { points, updatable: true }, scene);
      lines.color = Color3.FromHexString("#bcd8ff");
      lines.isPickable = false;
      lines.setEnabled(false);
      this.boltPoints.push(points);
      this.bolts.push({ mesh: lines, age: 0, duration: 0.16, grow: 0, alpha: 1, active: false });
    }

    const ghostCount = quality === "low" ? 8 : POOL_GHOSTS;
    for (let i = 0; i < ghostCount; i += 1) {
      // Clones share geometry/material but support independent fading.
      // InstancedMesh.visibility is ignored and logs a warning every tick.
      const instance = ghostSource.clone(`ghost-${i}`, null, true);
      instance.isPickable = false;
      instance.setEnabled(false);
      this.ghosts.push({ mesh: instance, age: 0, duration: 0.34, grow: 0, alpha: 0.4, active: false });
    }

    // Emitter node follows the player; both systems hang off it.
    this.emitter = MeshBuilder.CreateBox("fx-emitter", { size: 0.01 }, scene);
    this.emitter.isVisible = false;
    this.emitter.isPickable = false;

    const spark = createSparkSprite(scene);
    const capacity = quality === "low" ? 300 : quality === "medium" ? 900 : 1600;

    this.slipstream = new ParticleSystem("slipstream", capacity, scene);
    this.slipstream.particleTexture = spark;
    this.slipstream.emitter = this.emitter;
    this.slipstream.minEmitBox = new Vector3(-0.4, 0.2, -0.4);
    this.slipstream.maxEmitBox = new Vector3(0.4, 1.7, 0.4);
    this.slipstream.color1 = new Color4(1, 0.82, 0.44, 0.9);
    this.slipstream.color2 = new Color4(1, 0.6, 0.2, 0.7);
    this.slipstream.colorDead = new Color4(0.6, 0.4, 0.2, 0);
    this.slipstream.minSize = 0.12;
    this.slipstream.maxSize = 0.55;
    this.slipstream.minLifeTime = 0.12;
    this.slipstream.maxLifeTime = 0.34;
    this.slipstream.emitRate = 0;
    this.slipstream.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.slipstream.gravity = new Vector3(0, 2.5, 0);
    this.slipstream.minEmitPower = 1;
    this.slipstream.maxEmitPower = 4;
    this.slipstream.updateSpeed = 0.014;
    this.slipstream.start();

    this.sparks = new ParticleSystem("impact-sparks", Math.floor(capacity / 3), scene);
    this.sparks.particleTexture = spark;
    this.sparks.emitter = new Vector3(0, 0, 0);
    this.sparks.color1 = new Color4(1, 0.9, 0.7, 1);
    this.sparks.color2 = new Color4(1, 0.7, 0.35, 0.9);
    this.sparks.colorDead = new Color4(0.5, 0.4, 0.3, 0);
    this.sparks.minSize = 0.08;
    this.sparks.maxSize = 0.42;
    this.sparks.minLifeTime = 0.15;
    this.sparks.maxLifeTime = 0.45;
    this.sparks.emitRate = 0;
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.sparks.gravity = new Vector3(0, -9, 0);
    this.sparks.minEmitPower = 3;
    this.sparks.maxEmitPower = 11;
    this.sparks.createSphereEmitter(0.4);
    this.sparks.start();
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) {
      this.trails.reset();
      this.slipstream.emitRate = 0;
      for (const ghost of this.ghosts) this.release(ghost);
    }
  }

  reset(): void {
    this.trails.reset();
    this.slipstream.reset(); this.sparks.reset();
    this.slipstream.emitRate = 0;
    for (const pool of this.pulses.values()) for (const entry of pool) this.release(entry);
    for (const entry of this.bolts) this.release(entry);
    for (const entry of this.ghosts) this.release(entry);
  }

  /* ---------------- spawners ---------------- */

  pulse(position: Vector3, tone: PulseTone, diameter: number, duration = 0.45): void {
    const pool = this.pulses.get(tone);
    if (!pool) return;
    const entry = firstFree(pool);
    if (!entry) return;
    entry.mesh.position.copyFrom(position);
    entry.mesh.position.y += 0.4;
    entry.mesh.rotation.x = 0;
    entry.mesh.scaling.setAll(diameter * 0.25);
    entry.mesh.visibility = 1;
    entry.mesh.setEnabled(true);
    entry.age = 0;
    entry.alpha = 1;
    entry.duration = duration;
    entry.grow = diameter;
    entry.active = true;
  }

  bolt(from: Vector3, to: Vector3): void {
    let index = -1;
    for (let i = 0; i < this.bolts.length; i += 1) {
      if (this.bolts[i]?.active === false) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    const entry = this.bolts[index];
    const points = this.boltPoints[index];
    if (!entry || !points) return;

    // Jitter the interior points so no two arcs read the same.
    for (let i = 0; i < BOLT_POINTS; i += 1) {
      const point = points[i];
      if (!point) continue;
      const t = i / (BOLT_POINTS - 1);
      Vector3.LerpToRef(from, to, t, point);
      if (i > 0 && i < BOLT_POINTS - 1) {
        const spread = Math.sin(t * Math.PI) * 3.2;
        point.x += (Math.random() - 0.5) * spread;
        point.y += (Math.random() - 0.5) * spread + 0.8;
        point.z += (Math.random() - 0.5) * spread;
      }
    }

    MeshBuilder.CreateLines(entry.mesh.name, { points, instance: entry.mesh }, this.scene);
    entry.mesh.setEnabled(true);
    entry.mesh.visibility = 1;
    entry.age = 0;
    entry.alpha = 1;
    entry.duration = 0.16;
    entry.active = true;
  }

  /** One-shot spark burst; used for impacts, landings and water spray. */
  burst(position: Vector3, count: number, tone: PulseTone = "warm"): void {
    if (this.reducedMotion) count = Math.floor(count * 0.4);
    if (count <= 0) return;
    const emitter = this.sparks.emitter;
    if (emitter instanceof Vector3) emitter.copyFrom(position);
    switch (tone) {
      case "warm":
        this.sparks.color1.set(1, 0.9, 0.7, 1);
        this.sparks.color2.set(1, 0.7, 0.35, 0.9);
        break;
      case "cool":
        this.sparks.color1.set(0.75, 0.9, 1, 1);
        this.sparks.color2.set(0.5, 0.7, 1, 0.9);
        break;
      case "pale":
        this.sparks.color1.set(0.95, 0.97, 1, 1);
        this.sparks.color2.set(0.8, 0.85, 0.9, 0.85);
        break;
      case "danger":
        this.sparks.color1.set(1, 0.5, 0.38, 1);
        this.sparks.color2.set(1, 0.28, 0.2, 0.9);
        break;
    }
    this.sparks.manualEmitCount = count;
  }

  /* ---------------- per-frame ---------------- */

  update(dt: number, player: Player, focusActive: boolean): void {
    this.emitter.position.copyFrom(player.position);

    const ratio = player.speedRatio;
    this.trails.update(dt, player.position, player.root.rotation.y, ratio, focusActive, this.reducedMotion);
    if (!this.reducedMotion) {
      this.slipstream.emitRate = ratio > 0.14 ? ratio * ratio * 460 : 0;
      this.slipstream.minEmitPower = 1 + ratio * 6;
      this.slipstream.maxEmitPower = 4 + ratio * 18;
      if (focusActive) {
        this.slipstream.color1.set(0.6, 0.85, 1, 0.9);
        this.slipstream.color2.set(0.35, 0.6, 1, 0.7);
      } else {
        this.slipstream.color1.set(1, 0.82, 0.44, 0.9);
        this.slipstream.color2.set(1, 0.6, 0.2, 0.7);
      }

      // Afterimages: cadence tightens as the runner opens up.
      this.ghostClock -= dt;
      if (ratio > 0.3 && this.ghostClock <= 0) {
        this.ghostClock = 0.11 - ratio * 0.04;
        this.spawnGhost(player);
      }

      // Loose arcs crackling off the suit at the top of the range.
      this.arcClock -= dt;
      if (ratio > 0.55 && this.arcClock <= 0) {
        this.arcClock = 0.09 + Math.random() * 0.14;
        const origin = this.arcOrigin.copyFrom(player.position).addInPlaceFromFloats(0, 0.9, 0);
        const target = this.arcTarget.copyFrom(origin).addInPlaceFromFloats(
          (Math.random() - 0.5) * 5, (Math.random() - 0.4) * 3.5, (Math.random() - 0.5) * 5,
        );
        this.bolt(origin, target);
      }
    }

    for (const pool of this.pulses.values()) this.tickPool(pool, dt, true);
    this.tickPool(this.bolts, dt, false);
    this.tickPool(this.ghosts, dt, false);
  }

  private spawnGhost(player: Player): void {
    const entry = firstFree(this.ghosts);
    if (!entry) return;
    entry.mesh.position.copyFrom(player.position);
    entry.mesh.rotation.copyFrom(player.root.rotation);
    entry.mesh.setEnabled(true);
    entry.alpha = clamp(player.speedRatio * 0.23, 0.04, 0.2);
    entry.mesh.visibility = entry.alpha;
    entry.age = 0;
    entry.duration = 0.3;
    entry.active = true;
  }

  private tickPool<T extends Mesh>(
    pool: Array<Pooled<T>>,
    dt: number,
    scaleWithGrow: boolean,
  ): void {
    for (const entry of pool) {
      if (!entry.active) continue;
      entry.age += dt;
      const progress = Math.min(1, entry.age / entry.duration);
      entry.mesh.visibility = entry.alpha * (1 - progress);
      if (scaleWithGrow && entry.grow > 0) {
        entry.mesh.scaling.setAll(entry.grow * (0.25 + progress * 0.75));
      }
      if (progress >= 1) this.release(entry);
    }
  }

  private release<T extends Mesh>(entry: Pooled<T>): void {
    entry.active = false;
    entry.mesh.setEnabled(false);
  }
}

/** Index loop rather than `Array.find`, to keep the hot path allocation-free. */
function firstFree<T>(pool: Array<Pooled<T>>): Pooled<T> | null {
  for (let i = 0; i < pool.length; i += 1) {
    const entry = pool[i];
    if (entry && !entry.active) return entry;
  }
  return null;
}
