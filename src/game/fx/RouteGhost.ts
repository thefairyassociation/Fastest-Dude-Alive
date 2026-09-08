import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { RouteReplay } from "../core/Save";

export type GhostPose = [number, number, number, number];

/** Interpolate a bounded recording without extrapolation or angular wrap snaps. */
export function sampleReplay(replay: RouteReplay, time: number, out: GhostPose): boolean {
  if (time < 0 || time > replay.duration) return false;
  const frames = replay.frames;
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid]![0] <= time) lo = mid;
    else hi = mid;
  }
  const a = frames[lo]!, b = frames[hi]!;
  const blend = Math.min(1, Math.max(0, (time - a[0]) / (b[0] - a[0])));
  out[0] = a[1] + (b[1] - a[1]) * blend;
  out[1] = a[2] + (b[2] - a[2]) * blend;
  out[2] = a[3] + (b[3] - a[3]) * blend;
  const turn = Math.atan2(Math.sin(b[4] - a[4]), Math.cos(b[4] - a[4]));
  out[3] = a[4] + turn * blend;
  return true;
}

/** One merged, unlit pace-runner mesh. No collision, lights, rig or shadow cost. */
export class RouteGhost {
  private readonly mesh: Mesh;
  constructor(scene: Scene) {
    const material = new StandardMaterial("personal-best-ghost", scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.FromHexString("#7de8dd");
    material.alpha = 0.32;
    const parts: Mesh[] = [];
    const torso = MeshBuilder.CreateCapsule("ghost-torso", { height: 0.8, radius: 0.22, tessellation: 8, subdivisions: 1 }, scene);
    torso.position.y = 1.13;
    parts.push(torso);
    const head = MeshBuilder.CreateSphere("ghost-head", { diameter: 0.31, segments: 6 }, scene);
    head.position.y = 1.7;
    parts.push(head);
    for (const sign of [-1, 1]) {
      const leg = MeshBuilder.CreateCapsule("ghost-leg", { height: 0.8, radius: 0.105, tessellation: 6, subdivisions: 1 }, scene);
      leg.position.set(sign * 0.15, 0.48, sign * 0.13);
      leg.rotation.x = sign * 0.4;
      parts.push(leg);
      const arm = MeshBuilder.CreateCapsule("ghost-arm", { height: 0.6, radius: 0.08, tessellation: 6, subdivisions: 1 }, scene);
      arm.position.set(sign * 0.31, 1.2, -sign * 0.13);
      arm.rotation.x = -sign * 0.6;
      parts.push(arm);
    }
    const ring = MeshBuilder.CreateTorus("ghost-ring", { diameter: 2, thickness: 0.04, tessellation: 24 }, scene);
    ring.position.y = 0.1;
    parts.push(ring);
    for (const part of parts) { part.material = material; part.computeWorldMatrix(true); }
    this.mesh = Mesh.MergeMeshes(parts, true, true)!;
    this.mesh.name = "personal-best-runner";
    this.mesh.isPickable = false;
    this.mesh.setEnabled(false);
  }
  update(pose: GhostPose | null, player: Vector3, enabled: boolean): void {
    const visible = enabled && pose !== null && (pose[0] - player.x) ** 2 + (pose[2] - player.z) ** 2 < 900 ** 2;
    this.mesh.setEnabled(visible);
    if (!visible || !pose) return;
    this.mesh.position.set(pose[0], pose[1], pose[2]);
    this.mesh.rotation.y = pose[3];
  }
  dispose(): void { this.mesh.dispose(false, true); }
}
