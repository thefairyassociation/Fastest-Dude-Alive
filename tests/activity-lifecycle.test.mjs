import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '@babylonjs/core';
import { SpeedGame } from '../src/game/SpeedGame.ts';

test('retry stops active actors before restarting at the anchor with fresh resources', () => {
  const order = [];
  const activity = { anchor: new Vector3(75, .42, 225), stop: () => order.push('stop'), start: w => { order.push('start'); assert.deepEqual(w.player.position.asArray(), [75,.42,225]); } };
  const game = Object.create(SpeedGame.prototype);
  const player = { position: Vector3.Zero(), health: 2, charge: 1, teleport(p) { this.position.copyFrom(p); order.push('teleport'); } };
  Object.assign(game, { activity, lastActivity: null, player, world: { player }, momentum: { reset: () => order.push('flow-reset') }, input: { releaseAll() {} }, resetChaseCamera() {} });
  game.retryActivity();
  assert.deepEqual(order, ['stop','flow-reset','teleport','start']);
  assert.equal(player.health, 100); assert.equal(player.charge, 60); assert.equal(game.lastActivity, activity);
  game.activity = null; order.length = 0; game.retryActivity();
  assert.deepEqual(order, ['flow-reset','teleport','start']);
});

test('completion suggests a different nearby activity without replacing a chosen destination', () => {
  const game = Object.create(SpeedGame.prototype);
  const completed = { name: 'Crest Circuit', anchor: Vector3.Zero() };
  const next = { name: 'Cascade Rescue', kind: 'rescue', anchor: new Vector3(10,0,0) };
  Object.assign(game, { player: { position: Vector3.Zero() }, hud: { destination: null }, available: [completed, next] });
  game.offerNextActivity(completed);
  assert.equal(game.hud.destination.name, next.name);
  game.hud.destination = { name: 'My own destination' };
  game.offerNextActivity(completed);
  assert.equal(game.hud.destination.name, 'My own destination');
});
