import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionGrid } from '../src/game/world/Collision.ts';

function box(minX, maxX, minZ, maxZ, top = 20) {
  return { minX, maxX, minZ, maxZ, top, bottom: -1, climbable: true };
}

test('depenetration pushes a body that corner-cut into a solid back onto a face', () => {
  const grid = new CollisionGrid();
  grid.add(box(0, 40, 0, 40));
  const out = { x: 0, z: 0 };
  assert.equal(grid.overlaps(0.2, 0.2, 0.42, 0, 1.8, 0.55), true);
  assert.equal(grid.depenetrate(0.2, 0.2, 0.42, 0, 1.8, 0.55, out), true);
  assert.equal(grid.overlaps(out.x, out.z, 0.42, 0, 1.8, 0.55), false);
  assert.ok(out.x < 0 || out.z < 0, 'exit along the shallower axis');
});

test('a body already in open space is left alone', () => {
  const grid = new CollisionGrid();
  grid.add(box(0, 40, 0, 40));
  const out = { x: 99, z: 99 };
  assert.equal(grid.depenetrate(-10, -10, 0.42, 0, 1.8, 0.55, out), false);
  assert.equal(out.x, -10);
  assert.equal(out.z, -10);
});
