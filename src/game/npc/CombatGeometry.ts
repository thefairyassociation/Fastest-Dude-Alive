/** Squared distance to a horizontal swept lunge; avoids hits skipping at pace. */
export function distanceToLungeSquared(
  x: number, z: number,
  startX: number, startZ: number,
  endX: number, endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const length = dx * dx + dz * dz;
  const time = length > 0 ? Math.max(0, Math.min(1, ((x - startX) * dx + (z - startZ) * dz) / length)) : 0;
  return (x - startX - dx * time) ** 2 + (z - startZ - dz * time) ** 2;
}
