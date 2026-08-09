import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

/**
 * A short-lived resonance echo.
 *
 * Replays a recent stretch of the runner's path — decoy for rogues, second
 * body for rescues, and a set-piece verb that reads as "you were already there."
 */

const SAMPLE_CAPACITY = 72;

export class Remnant {
  readonly root: TransformNode;
  private readonly mesh: Mesh;
  private readonly material: PBRMaterial;
  private readonly path: Vector3[] = [];
  private life = 0;
  private duration = 0;
  private index = 0;
  private active = false;

  constructor(scene: Scene) {
    this.root = new TransformNode("remnant", scene);
    this.material = new PBRMaterial("remnant-mat", scene);
    this.material.albedoColor = Color3.Black();
    this.material.emissiveColor = Color3.FromHexString("#7ec8ff").scale(1.8);
    this.material.roughness = 1;
    this.material.metallic = 0;
    this.material.alpha = 0.55;
    this.material.disableDepthWrite = true;

    this.mesh = MeshBuilder.CreateCapsule(
      "remnant-body",
      { height: 1.7, radius: 0.32, tessellation: 8 },
      scene,
    );
    this.mesh.parent = this.root;
    this.mesh.position.y = 0.85;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.root.setEnabled(false);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get alive(): boolean {
    return this.active;
  }

  /**
   * Begins a replay of `samples` (oldest → newest). The echo races the path
   * in `duration` seconds, then fades.
   */
  spawn(samples: readonly Vector3[], duration = 2.8): boolean {
    if (samples.length < 4) return false;
    this.path.length = 0;
    for (const sample of samples) this.path.push(sample.clone());
    this.duration = Math.max(1.2, duration);
    this.life = 0;
    this.index = 0;
    this.active = true;
    this.root.position.copyFrom(this.path[0]!);
    this.root.setEnabled(true);
    this.material.alpha = 0.6;
    return true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.life += dt;
    const progress = Math.min(1, this.life / this.duration);
    const targetIndex = Math.min(this.path.length - 1, Math.floor(progress * (this.path.length - 1)));
    while (this.index < targetIndex) {
      this.index += 1;
      const point = this.path[this.index];
      if (!point) break;
      const previous = this.path[this.index - 1] ?? point;
      const dx = point.x - previous.x;
      const dz = point.z - previous.z;
      if (dx * dx + dz * dz > 0.0001) {
        this.root.rotation.y = Math.atan2(dx, dz);
      }
      this.root.position.copyFrom(point);
    }

    this.material.alpha = 0.6 * (1 - progress * progress);
    if (progress >= 1) this.stop();
  }

  stop(): void {
    this.active = false;
    this.path.length = 0;
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.stop();
    this.root.dispose(false, true);
  }
}

/** Ring buffer of recent world positions for remnant playback. */
export class PathRecorder {
  private readonly samples: Vector3[] = [];
  private write = 0;
  private filled = 0;
  private clock = 0;

  constructor(private readonly capacity = SAMPLE_CAPACITY) {
    for (let i = 0; i < capacity; i += 1) this.samples.push(new Vector3());
  }

  /** Sample ~20 Hz so a 3.6 s trail fits in 72 slots. */
  record(dt: number, position: Vector3): void {
    this.clock += dt;
    if (this.clock < 0.05) return;
    this.clock = 0;
    const slot = this.samples[this.write];
    if (!slot) return;
    slot.copyFrom(position);
    this.write = (this.write + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
  }

  /** Oldest → newest copy for remnant spawn. */
  snapshot(): Vector3[] {
    const out: Vector3[] = [];
    const count = this.filled;
    const start = (this.write - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i += 1) {
      const sample = this.samples[(start + i) % this.capacity];
      if (sample) out.push(sample.clone());
    }
    return out;
  }

  clear(): void {
    this.write = 0;
    this.filled = 0;
    this.clock = 0;
  }
}
