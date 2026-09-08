import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '@babylonjs/core';
import { Save, migrate, validateReplay, MAX_REPLAY_FRAMES, MAX_REPLAYS } from '../src/game/core/Save.ts';
import { RouteRun, crossesGate } from '../src/game/activities/RouteRun.ts';
import { sampleReplay } from '../src/game/fx/RouteGhost.ts';
import { buildRoutes } from '../src/game/activities/routes.ts';

globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
let stored = null;
globalThis.localStorage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
const replay = { duration: 2, frames: [[0, 0, 0, 0, 3.1], [1, 10, 4, 20, -3.1], [2, 20, 0, 40, -3]] };

test('v2 progress, route bests and collectible IDs survive migration; old finale unlocks rebuilding', () => {
  const p = migrate({ version: 2, settings: { quality: 'low', lookSensitivity: 2 }, campaign: { unlocked: 12, completed: ['ch12-fastest-dude-alive'] }, routeBests: { 'meridian-loop': 48.2 }, collected: ['mote-12'], topSpeedKph: 730 });
  assert.equal(p.version, 3);
  assert.equal(p.campaign.unlocked, 13);
  assert.equal(p.routeBests['meridian-loop'], 48.2);
  assert.deepEqual(p.collected, ['mote-12']);
  assert.equal(p.settings.masterVolume, .65);
  assert.equal(p.settings.muted, false);
  assert.deepEqual(p.campaign.choices, {});
  assert.equal(p.settings.quality, 'low');
});

test('save migration clamps volume and chapters, rejects malformed ghosts and prototype keys', () => {
  const p = migrate(JSON.parse('{"campaign":{"unlocked":9999,"choices":{"ch12-fastest-dude-alive":"disconnect","__proto__":"poison"}},"routeBests":{"__proto__":1,"northline-express":2},"settings":{"masterVolume":9,"muted":true}}'));
  assert.equal(p.campaign.unlocked, 15);
  assert.equal(p.settings.masterVolume, 1);
  assert.equal(p.settings.muted, true);
  assert.equal(Object.getPrototypeOf(p.routeBests), Object.prototype);
  assert.equal(p.campaign.choices['ch12-fastest-dude-alive'], 'disconnect');
  assert.equal(Object.hasOwn(p.campaign.choices, '__proto__'), false);
  for (const invalid of [null, {}, { ...replay, duration: Infinity }, { ...replay, frames: [[0, 0, 0, 0, 0]] }, { ...replay, frames: [[0, 0, 0, 0, 0], [0, 1, 1, 1, 0]] }, { ...replay, frames: [[0, 5000, 0, 0, 0], [2, 1, 1, 1, 0]] }, { ...replay, frames: Array(MAX_REPLAY_FRAMES + 1).fill(replay.frames[0]) }]) assert.equal(validateReplay(invalid), null);
  assert.deepEqual(validateReplay(replay), replay);
});

test('best-time ghosts are bounded and never replaced by a slower run; stale recordings removed', () => {
  stored = null;
  const save = new Save();
  for (let i = 0; i < MAX_REPLAYS + 3; i++) assert.equal(save.recordRoute(`route-${i}`, 2, replay), true);
  assert.equal(Object.keys(save.data.routeReplays).length, MAX_REPLAYS);
  assert.equal(save.recordRoute('route-10', 3, { ...replay, duration: 3 }), false);
  assert.equal(save.bestFor('route-10'), 2);
  assert.equal(save.recordRoute('route-10', 1), true);
  assert.equal(save.data.routeReplays['route-10'], undefined);
  assert.equal(save.recordRoute('bad', NaN), false);
  save.flush();
  assert.equal(new Save().bestFor('route-10'), 1);
});

test('ghost interpolates positions and takes the short path across heading wrap', () => {
  const out = [0, 0, 0, 0];
  assert.equal(sampleReplay(replay, .5, out), true);
  assert.deepEqual(out.slice(0, 3), [5, 2, 10]);
  assert.ok(Math.abs(out[3] - Math.PI) < .001);
  assert.equal(sampleReplay(replay, 2.1, out), false);
});

test('checkpoints use full 3D swept intersection without accepting near misses', () => {
  assert.equal(crossesGate(new Vector3(-40, 0, 0), new Vector3(40, 0, 0), Vector3.Zero(), 16), true);
  assert.equal(crossesGate(new Vector3(-40, 25, 0), new Vector3(40, 25, 0), Vector3.Zero(), 16), false);
  assert.equal(crossesGate(Vector3.Zero(), Vector3.Zero(), Vector3.Zero(), 16), true);
});

function world() {
  stored = null;
  return { save: new Save(), player: { position: Vector3.Zero(), speed: 100, charge: 0, root: { rotation: { y: 0 } } }, toast() {}, effects: { pulse() {} } };
}
test('completed run stores a usable ghost; recovery run finishes practice without overwriting it', () => {
  const w = world();
  const route = new RouteRun({ id: 'test-route', name: 'Test', summary: '', gates: [{ position: Vector3.Zero() }, { position: new Vector3(100, 0, 0) }] });
  route.start(w);
  assert.equal(route.update(.01, w), 'running');
  for (let i = 1; i <= 9; i++) { w.player.position.x = i * 10; route.update(.1, w); }
  const best = w.save.bestFor('test-route');
  assert.ok(best > 0);
  assert.ok(w.save.data.routeReplays['test-route']);
  route.stop();
  w.player.position.setAll(0);
  route.start(w);
  route.noteRecovery();
  route.update(.01, w);
  route.update(.01, w);
  w.player.position.x = 100;
  assert.equal(route.update(.01, w), 'complete');
  assert.equal(w.save.bestFor('test-route'), best);
  assert.match(route.successMessage(), /practice/);
});

test('a recovery teleport cannot bank the checkpoint it is swept through', () => {
  const w = world();
  const gates = [{ position: new Vector3(400, 0, 0) }, { position: new Vector3(800, 0, 0) }];
  const route = new RouteRun({ id: 'sweep-route', name: 'Sweep', summary: '', gates });
  w.player.position.set(300, 0, 0);
  route.start(w);

  // Run legitimately to just short of the first gate.
  w.player.position.set(360, 0, 0);
  route.update(.2, w);
  assert.match(route.status().title, /1\/2/);

  // Now stall off-route and recover. The snap to the nearest road lands past
  // the gate, so the swept test would otherwise bank a checkpoint the runner
  // never reached.
  route.noteRecovery();
  w.player.position.set(430, 0, 0);
  assert.equal(route.update(.016, w), 'running');
  assert.match(route.status().title, /1\/2/, 'the swept teleport must not advance the gate');

  // Going back and crossing it under their own power still counts, and the
  // finished run is practice rather than a ranked time.
  w.player.position.set(400, 0, 0);
  route.update(.3, w);
  assert.match(route.status().title, /2\/2/);
  w.player.position.set(800, 0, 0);
  assert.equal(route.update(1, w), 'complete');
  assert.equal(w.save.bestFor('sweep-route'), null);
});

test('map growth does not move legacy route gates; expansion routes occupy the outer boroughs', () => {
  const city = { extent: 2775, nearestRoad: v => v, groundHeight: () => 50 };
  const old = buildRoutes({ ...city, extent: 1875 });
  const current = buildRoutes(city);
  assert.equal(current.length, 9);
  assert.equal(new Set(current.map(r => r.id)).size, 9);
  for (const id of ['meridian-loop', 'riverline-sprint', 'crest-ladder', 'dock-chain']) assert.deepEqual(current.find(r => r.id === id), old.find(r => r.id === id));
  for (const r of current.slice(0, 5)) {
    assert.ok(r.gates.some(g => Math.max(Math.abs(g.position.x), Math.abs(g.position.z)) > 1875), r.id);
    assert.ok(r.gates.every(g => Math.max(Math.abs(g.position.x), Math.abs(g.position.z)) < 2775), r.id);
  }
});

test('campaign deliveries do not evict free-roam recordings or advertise unavailable ghosts', () => {
  const w = world();
  for (let i = 0; i < MAX_REPLAYS; i++) w.save.recordRoute(`route-${i}`, 2, replay);
  const run = new RouteRun({ id: 'story-delivery', name: 'Delivery', summary: '', recordBest: false, gates: [{ position: Vector3.Zero() }, { position: new Vector3(100, 0, 0) }] });
  run.start(w);
  run.update(.01, w);
  for (let i = 1; i <= 9; i++) { w.player.position.x = i * 10; run.update(.1, w); }
  assert.equal(Object.keys(w.save.data.routeReplays).length, MAX_REPLAYS);
  assert.equal(w.save.bestFor('story-delivery'), null);
  assert.equal(w.save.data.routeReplays['story-delivery'], undefined);
  w.save.recordRoute('legacy-best', 40);
  const legacy = new RouteRun({ id: 'legacy-best', name: 'Legacy', summary: '', gates: [{ position: Vector3.Zero() }] });
  legacy.start(w);
  assert.doesNotMatch(legacy.status().detail, /ghost/);
});
