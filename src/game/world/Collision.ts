import { Vector3 } from "@babylonjs/core";

/** An axis-aligned solid. Everything the player can hit is one of these. */
export interface Solid {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** World Y of the walkable top face. */
  top: number;
  /** World Y of the underside; volumes below the feet never block. */
  bottom: number;
  /** Wall-runnable faces. Kerbs and cars are excluded so they read as clutter. */
  climbable: boolean;
}

export interface SweepResult {
  /** Outward normal of the surface that stopped the move, or null. */
  normalX: number;
  normalZ: number;
  hit: boolean;
  /** Height of the highest blocking face, for step-up decisions. */
  hitTop: number;
}

const CELL = 48;

/**
 * Uniform-grid broadphase.
 *
 * The prototype scanned every collider in the city for every substep, which
 * is O(n) per step at 120 Hz. A 3.7 km city has tens of thousands of solids,
 * so lookups go through a hash of 48 m cells instead; a query touches four
 * cells at most at player radius.
 */
export class CollisionGrid {
  private readonly cells = new Map<number, Solid[]>();
  private readonly all: Solid[] = [];

  add(solid: Solid): void {
    this.all.push(solid);
    const x0 = Math.floor(solid.minX / CELL);
    const x1 = Math.floor(solid.maxX / CELL);
    const z0 = Math.floor(solid.minZ / CELL);
    const z1 = Math.floor(solid.maxZ / CELL);
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const key = hash(x, z);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(solid);
      }
    }
  }

  get count(): number {
    return this.all.length;
  }

  /** Runs `visit` over every solid whose cell overlaps the AABB. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, visit: (solid: Solid) => void): void {
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    // A solid spanning several cells would be visited more than once; the
    // visitor is idempotent (max/boolean tests) so no dedupe is needed.
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const bucket = this.cells.get(hash(x, z));
        if (!bucket) continue;
        for (const solid of bucket) visit(solid);
      }
    }
  }

  /**
   * Highest walkable surface at (x, z) that is not above `ceiling`.
   * Returns `floor` when nothing is under the point.
   */
  surfaceHeight(x: number, z: number, ceiling: number, floor: number): number {
    let best = floor;
    this.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, (solid) => {
      if (x < solid.minX || x > solid.maxX || z < solid.minZ || z > solid.maxZ) return;
      if (solid.top > ceiling || solid.top < best) return;
      best = solid.top;
    });
    return best;
  }

  /**
   * Tests a vertical cylinder against the grid.
   * `feet`/`head` bound the body; solids whose top is below `feet + step`
   * are treated as walkable ground rather than obstacles.
   */
  overlaps(x: number, z: number, radius: number, feet: number, head: number, step: number): boolean {
    let blocked = false;
    this.query(x - radius, z - radius, x + radius, z + radius, (solid) => {
      if (blocked) return;
      if (solid.top <= feet + step || solid.bottom >= head) return;
      if (
        x + radius > solid.minX &&
        x - radius < solid.maxX &&
        z + radius > solid.minZ &&
        z - radius < solid.maxZ
      ) {
        blocked = true;
      }
    });
    return blocked;
  }

  /**
   * Pushes a body that has clipped into a solid back onto the nearest face.
   * Sequential X/Z sweeps can corner-cut at sprint speed; without this the
   * next frame still overlaps on both axes and the runner cannot walk out.
   * Returns true when a correction was applied.
   */
  depenetrate(
    x: number,
    z: number,
    radius: number,
    feet: number,
    head: number,
    step: number,
    out: { x: number; z: number },
  ): boolean {
    let px = x;
    let pz = z;
    let pushed = false;
    for (let pass = 0; pass < 4; pass += 1) {
      let best = Number.POSITIVE_INFINITY;
      let nx = 0;
      let nz = 0;
      this.query(px - radius, pz - radius, px + radius, pz + radius, (solid) => {
        if (solid.top <= feet + step || solid.bottom >= head) return;
        if (
          px + radius <= solid.minX ||
          px - radius >= solid.maxX ||
          pz + radius <= solid.minZ ||
          pz - radius >= solid.maxZ
        ) {
          return;
        }
        const dxMin = px + radius - solid.minX;
        const dxMax = solid.maxX - (px - radius);
        const dzMin = pz + radius - solid.minZ;
        const dzMax = solid.maxZ - (pz - radius);
        if (dxMin > 0 && dxMin < best) { best = dxMin; nx = -1; nz = 0; }
        if (dxMax > 0 && dxMax < best) { best = dxMax; nx = 1; nz = 0; }
        if (dzMin > 0 && dzMin < best) { best = dzMin; nx = 0; nz = -1; }
        if (dzMax > 0 && dzMax < best) { best = dzMax; nx = 0; nz = 1; }
      });
      if (!Number.isFinite(best) || best === Number.POSITIVE_INFINITY) break;
      const distance = best + 0.02;
      px += nx * distance;
      pz += nz * distance;
      pushed = true;
    }
    out.x = px;
    out.z = pz;
    return pushed;
  }

  /**
   * Finds the nearest climbable face within `reach` of the body, and returns
   * its outward normal. Used to latch onto walls for wall-running.
   */
  probeWall(
    x: number,
    z: number,
    radius: number,
    feet: number,
    head: number,
    reach: number,
    out: Vector3,
  ): boolean {
    const span = radius + reach;
    let bestDepth = Number.POSITIVE_INFINITY;
    let found = false;
    let nx = 0;
    let nz = 0;

    this.query(x - span, z - span, x + span, z + span, (solid) => {
      if (!solid.climbable) return;
      if (solid.top <= feet + 0.6 || solid.bottom >= head) return;
      if (
        x + span <= solid.minX ||
        x - span >= solid.maxX ||
        z + span <= solid.minZ ||
        z - span >= solid.maxZ
      ) {
        return;
      }

      // Penetration depth along each axis picks the face we are pressed into.
      const dxMin = x + span - solid.minX;
      const dxMax = solid.maxX - (x - span);
      const dzMin = z + span - solid.minZ;
      const dzMax = solid.maxZ - (z - span);
      const candidates: Array<[number, number, number]> = [
        [dxMin, -1, 0],
        [dxMax, 1, 0],
        [dzMin, 0, -1],
        [dzMax, 0, 1],
      ];
      for (const [depth, cx, cz] of candidates) {
        if (depth > 0 && depth < bestDepth) {
          bestDepth = depth;
          nx = cx;
          nz = cz;
          found = true;
        }
      }
    });

    if (found) out.set(nx, 0, nz);
    return found;
  }
}

function hash(x: number, z: number): number {
  // Cantor-ish pairing that stays fast and collision-free over the world size.
  return (x + 4096) * 16384 + (z + 4096);
}

export function makeSweepResult(): SweepResult {
  return { normalX: 0, normalZ: 0, hit: false, hitTop: 0 };
}
