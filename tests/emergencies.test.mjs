import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '@babylonjs/core';
import { CascadeRescue, CourierInterception } from '../src/game/activities/Emergency.ts';
function fixture() {
  let releases = 0, damage = 0;
  const world = {
    player: { position: Vector3.Zero(), health: 100, charge: 0, focusHeld: false, damage: n => { damage += n; } },
    effects: { pulse() {}, burst() {} }, toast() {},
    releaseBystanders: () => releases++,
    takeBystander: () => ({ place() {}, setEnabled() {}, mood: 'idle' }),
  };
  return { world, get releases() { return releases; }, get damage() { return damage; } };
}
test('cascade supports any rescue order, swept pickups, completion and pool cleanup', () => {
  const f = fixture(), targets = [new Vector3(50, 0, 0), new Vector3(100, 0, 0)];
  const a = new CascadeRescue(Vector3.Zero(), targets); a.start(f.world);
  f.world.player.position.x = 125;
  assert.equal(a.update(.5, f.world), 'complete');
  assert.equal(f.world.player.charge, 36);
  a.stop(f.world); assert.equal(a.markers().length, 0); assert.equal(f.releases, 2);
  a.start(f.world); assert.equal(a.status().progress, 0);
});
test('Focus delays hazard detonation but never extends the rescue deadline', () => {
  for (const focus of [false, true]) {
    const f = fixture(); f.world.player.position.x = 20; f.world.player.focusHeld = focus;
    const a = new CascadeRescue(Vector3.Zero(), [Vector3.Zero()]); a.start(f.world);
    for (let i = 0; i < 361; i++) a.update(1 / 120, f.world);
    assert.equal(f.damage, focus ? 0 : 18);
    assert.ok(a.status().timer < 62.01);
    assert.equal(a.update(65, f.world), 'failed');
  }
});
test('teleports cannot sweep rescues, exhausted actor pools fail, and pursuit cleans up', () => {
  const f = fixture(); const a = new CascadeRescue(Vector3.Zero(), [new Vector3(50, 0, 0)]);
  a.start(f.world); f.world.player.position.x = 1000;
  assert.equal(a.update(1 / 120, f.world), 'running'); assert.equal(a.status().progress, 0);
  a.stop(f.world); f.world.takeBystander = () => null; a.start(f.world);
  assert.equal(a.update(.1, f.world), 'failed'); a.stop(f.world);
  let clears = 0;
  const rogue = { alive: true, configureCourier() {}, healthRatio: 1, position: Vector3.Zero() };
  f.world.clearRogues = () => clears++; f.world.spawnRogue = () => rogue;
  const chase = new CourierInterception(Vector3.Zero(), [Vector3.Zero(), new Vector3(100, 0, 0)]);
  chase.start(f.world); assert.equal(chase.update(1, f.world), 'running');
  rogue.alive = false; assert.equal(chase.update(.1, f.world), 'complete');
  chase.stop(f.world); assert.equal(clears, 2); assert.deepEqual(chase.markers(), []);
  chase.start(f.world); assert.equal(chase.update(91, f.world), 'failed');
});
