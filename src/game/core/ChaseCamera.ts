import { Vector3 } from "@babylonjs/core";
import type { CollisionGrid } from "../world/Collision";

/** Smooth only the camera boom. World translation is inherited in full, so
 * sprinting cannot create a speed / damping metres-long positional error. */
export class ChaseBoom {
  readonly offset = new Vector3(0, 3.1, -6.4);

  reset(): void { this.offset.set(0, 3.1, -6.4); }

  update(dt: number, yaw: number, pitch: number, speedRatio: number, reducedMotion: boolean): Vector3 {
    const ratio = reducedMotion ? 0 : Math.max(0, Math.min(1, speedRatio));
    const distance = 6.4 + ratio * 2.4;
    const desired = new Vector3(-Math.sin(yaw) * distance, 2.3 + pitch * 5 + ratio * 0.8, -Math.cos(yaw) * distance);
    Vector3.LerpToRef(this.offset, desired, 1 - Math.exp(-24 * Math.max(0, dt)), this.offset);
    return this.offset;
  }
}

/** Pull the camera in along its sightline before the nearest solid.
 * Expanded boxes conservatively protect a small volume around the lens.
 * Sweep the full segment: testing only its endpoint misses thin walls.
 */
export function constrainChaseCamera(grid: CollisionGrid, anchor: Vector3, desired: Vector3, out: Vector3): void {
  const radius = 0.2;
  const delta = desired.subtract(anchor);
  const length = delta.length();
  let fraction = 1;
  grid.query(Math.min(anchor.x, desired.x) - radius, Math.min(anchor.z, desired.z) - radius,
    Math.max(anchor.x, desired.x) + radius, Math.max(anchor.z, desired.z) + radius, solid => {
      let enter = 0, leave = 1;
      const slabs = [
        [anchor.x, delta.x, solid.minX - radius, solid.maxX + radius],
        [anchor.y, delta.y, solid.bottom - radius, solid.top + radius],
        [anchor.z, delta.z, solid.minZ - radius, solid.maxZ + radius],
      ];
      for (const [origin = 0, direction = 0, min = 0, max = 0] of slabs) {
        if (Math.abs(direction) < 1e-8) {
          if (origin < min || origin > max) return;
        } else {
          const a = (min - origin) / direction, b = (max - origin) / direction;
          enter = Math.max(enter, Math.min(a, b));
          leave = Math.min(leave, Math.max(a, b));
          if (enter > leave) return;
        }
      }
      fraction = Math.min(fraction, Math.max(0, enter - 0.01 / Math.max(length, 0.01)));
    });
  Vector3.LerpToRef(anchor, desired, fraction, out);
}
