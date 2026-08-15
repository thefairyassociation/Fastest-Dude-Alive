import {
  Color3,
  InstancedMesh,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  Vector3,
} from "@babylonjs/core";

/**
 * Local personal-best ghost.
 *
 * Replays a compact path recorded with a route PB. No network — just you
 * racing the you who already cleared it.
 */

const MAX_SAMPLES = 96;

export class RouteGhost {
  private readonly mesh: Mesh;
  private readonly trail: InstancedMesh[] = [];
  private path: Vector3[] = [];
  private bestTime = 0;
  private elapsed = 0;
  private active = false;
  private readonly scratch = new Vector3();

  constructor(scene: Scene) {
    const material = new PBRMaterial("route-ghost-mat", scene);
    material.albedoColor = Color3.Black();
    material.emissiveColor = Color3.FromHexString("#9fd4ff").scale(1.6);
    material.roughness = 1;
    material.metallic = 0;
    material.alpha = 0.45;
    material.disableDepthWrite = true;

    this.mesh = MeshBuilder.CreateCapsule(
      "route-ghost",
      { height: 1.65, radius: 0.3, tessellation: 6 },
      scene,
    );
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.setEnabled(false);

    for (let i = 0; i < 6; i += 1) {
      const instance = this.mesh.createInstance(`route-ghost-trail-${i}`);
      instance.isPickable = false;
      instance.setEnabled(false);
      this.trail.push(instance);
    }
  }

  start(flat: number[] | null, bestTime: number | null): void {
    this.stop();
    if (!flat || flat.length < 6 || bestTime === null || bestTime <= 0) return;
    this.path = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      this.path.push(new Vector3(flat[i], flat[i + 1], flat[i + 2]));
    }
    if (this.path.length < 2) return;
    this.bestTime = bestTime;
    this.elapsed = 0;
    this.active = true;
    this.mesh.setEnabled(true);
  }

  update(dt: number): void {
    if (!this.active || this.path.length < 2) return;
    this.elapsed += dt;
    const progress = Math.min(0.999, this.elapsed / this.bestTime);
    const scaled = progress * (this.path.length - 1);
    const index = Math.floor(scaled);
    const frac = scaled - index;
    const a = this.path[index]!;
    const b = this.path[Math.min(this.path.length - 1, index + 1)]!;
    Vector3.LerpToRef(a, b, frac, this.scratch);
    this.mesh.position.copyFrom(this.scratch);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz > 0.0001) this.mesh.rotation.y = Math.atan2(dx, dz);

    for (let i = 0; i < this.trail.length; i += 1) {
      const instance = this.trail[i]!;
      const lookBack = progress - (i + 1) * 0.012;
      if (lookBack <= 0) {
        instance.setEnabled(false);
        continue;
      }
      const t = lookBack * (this.path.length - 1);
      const ai = Math.floor(t);
      const af = t - ai;
      const pa = this.path[ai]!;
      const pb = this.path[Math.min(this.path.length - 1, ai + 1)]!;
      Vector3.LerpToRef(pa, pb, af, this.scratch);
      instance.position.copyFrom(this.scratch);
      instance.visibility = 0.35 * (1 - i / this.trail.length);
      instance.setEnabled(true);
    }
  }

  /** Sample the live run into a compact flat path for persistence. */
  static compress(samples: Vector3[]): number[] {
    if (samples.length === 0) return [];
    const stride = Math.max(1, Math.ceil(samples.length / MAX_SAMPLES));
    const out: number[] = [];
    for (let i = 0; i < samples.length; i += stride) {
      const p = samples[i]!;
      out.push(p.x, p.y, p.z);
    }
    const last = samples[samples.length - 1]!;
    const end = out.length;
    if (
      end < 3 ||
      out[end - 3] !== last.x ||
      out[end - 2] !== last.y ||
      out[end - 1] !== last.z
    ) {
      out.push(last.x, last.y, last.z);
    }
    return out;
  }

  stop(): void {
    this.active = false;
    this.path = [];
    this.mesh.setEnabled(false);
    for (const instance of this.trail) instance.setEnabled(false);
  }

  dispose(): void {
    this.stop();
    for (const instance of this.trail) instance.dispose();
    this.mesh.dispose();
  }
}
