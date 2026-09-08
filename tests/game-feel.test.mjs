import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '@babylonjs/core';
import { ChaseBoom } from '../src/game/core/ChaseCamera.ts';
import { MomentumRun } from '../src/game/activities/MomentumRun.ts';

test('chase remains within its boom at sprint speed, through reversals, falls and recovery at 20–144 Hz', () => {
  for (const hz of [20, 60, 144]) {
    const boom = new ChaseBoom();
    const player = Vector3.Zero();
    for (let frame = 0; frame < hz * 5; frame++) {
      player.z += (frame < hz * 2 ? 215 : -215) / hz;
      if (frame === hz * 3) player.set(2500, 120, -1200);
      const offset = boom.update(1 / hz, frame < hz * 2 ? 0 : Math.PI, 0.16, 1, false);
      const camera = player.add(offset);
      assert.ok(Vector3.Distance(camera, player) < 10, 'camera never accumulates translation lag');
      assert.ok(Math.abs(camera.y - player.y) < 4, 'fall/recovery carries vertical position too');
    }
    assert.ok(Math.abs(boom.offset.z - 8.8) < 0.001, 'boom recovers behind reversed heading');
    boom.reset();
    assert.deepEqual(boom.offset.asArray(), [0, 3.1, -6.4]);
  }
});

test('reduced motion fixes viewing distance while preserving camera control', () => {
  const a = new ChaseBoom(), b = new ChaseBoom();
  for (let frame = 0; frame < 120; frame++) {
    a.update(1 / 60, Math.PI / 2, 0.16, 0, true);
    b.update(1 / 60, Math.PI / 2, 0.16, 1, true);
  }
  assert.deepEqual(a.offset.asArray(), b.offset.asArray());
  assert.ok(a.offset.x < -6.3);
});

test('momentum rewards each distance milestone once and is consistent across step sizes', () => {
  for (const hz of [20, 120]) {
    const run = new MomentumRun();
    let energy = 0;
    for (let i = 0; i < hz * 10; i++) energy += run.update(1 / hz, 120, 120 / hz, 'ground');
    assert.ok(Math.abs(run.score - 1200) < 0.001);
    assert.equal(energy, 24);
    assert.equal(run.update(0, 120, 0, 'ground'), 0);
    run.update(1 / hz, 120, 120 / hz, 'slide');
    assert.equal(run.multiplier, 2);
    run.update(1 / hz, 120, 120 / hz, 'ground');
    assert.equal(run.multiplier, 2, 'repeating an existing style cannot farm multipliers');
    const best = run.best;
    run.update(3, 0, 0, 'ground');
    assert.equal(run.score, 0);
    assert.equal(run.best, best);
    assert.equal(run.active, false);
  }
});

test('flow grace expires even when the remaining time is not an exact multiple of dt', () => {
  const run = new MomentumRun();
  run.update(1 / 120, 50, 1, 'ground');
  assert.equal(run.active, true);
  for (let step = 0; step < 40; step++) run.update(0.07, 0, 0, 'ground');
  assert.equal(run.active, false);
  assert.ok(run.best > 0);
});

test('recovery cannot turn a teleport into a flow reward; blocked motion earns nothing', () => {
  const run = new MomentumRun();
  assert.equal(run.update(1 / 120, 215, 5000, 'ground', true), 0);
  assert.equal(run.score, 0);
  run.update(1 / 120, 215, 5000, 'ground');
  assert.ok(run.score < 2);
  const score = run.score;
  run.update(0.1, 215, 0, 'ground');
  assert.equal(run.score, score);
});
