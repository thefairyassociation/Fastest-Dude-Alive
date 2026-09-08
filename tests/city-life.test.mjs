import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3, VertexBuffer } from '@babylonjs/core';
import { CityLife, CITY_LIFE_BUDGETS, blockLoopLength, blockLoopPose } from '../src/game/world/CityLife.ts';
import { Soundscape, MAX_SOUND_VOICES, soundMix } from '../src/game/audio/Soundscape.ts';

test('road loop tangents and corners are continuous, including reverse travel and wraparound', () => {
  const pose = { x: 0, z: 0, yaw: 0 };
  const ahead = { ...pose };
  for (const halfSide of [69.2, 80.8, 54.3]) {
    const corner = halfSide === 54.3 ? 2.5 : 9;
    const length = blockLoopLength(halfSide, corner);
    for (let d = -length; d < length * 2; d += 0.6) {
      blockLoopPose(d, halfSide, corner, pose);
      blockLoopPose(d + 0.001, halfSide, corner, ahead);
      assert.ok(Math.abs(pose.x) <= halfSide + 1e-8 && Math.abs(pose.z) <= halfSide + 1e-8);
      assert.ok(Math.abs(Math.hypot(ahead.x - pose.x, ahead.z - pose.z) - 0.001) < 1e-6);
      const dot = (ahead.x - pose.x) * Math.sin(pose.yaw) + (ahead.z - pose.z) * Math.cos(pose.yaw);
      assert.ok(dot > 0.00099, 'rendered heading follows the direction of motion');
      if (halfSide > 60) assert.ok(Math.abs(pose.x) > 57 || Math.abs(pose.z) > 57, 'car clears sidewalk corners');
    }
  }
});

function fakeCity(extent = 2775) {
  let queries = 0;
  return {
    extent,
    isWater: (x, z) => Math.abs(x - 1050) <= 75 && Math.abs(z) > 55,
    groundHeight: (x, z) => Math.abs(x - Math.round(x / 150) * 150) <= 55 && Math.abs(z - Math.round(z / 150) * 150) <= 55 ? 0.42 : 0,
    grid: {
      overlaps() { queries += 1; return false; },
      get count() { return 0; },
    },
    get queries() { return queries; },
  };
}

function liveMatrices(mesh) {
  // Babylon's thinInstanceGetWorldMatrices caches a snapshot. Read the
  // buffer actually uploaded by thinInstanceBufferUpdated on each frame.
  const data = mesh._thinInstanceDataStorage.matrixData;
  return Array.from({ length: data.length / 16 }, (_, index) => ({ m: data.subarray(index * 16, index * 16 + 16) }));
}

test('population stays inside expanded city roads, uses seven fixed batches, and never enters rescue/collision pools', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const city = fakeCity();
  const life = new CityLife(scene, city, 'high');
  try {
    assert.equal(scene.meshes.length, 7);
    const meshes = [...scene.meshes];
    const focus = new Vector3(75, 0, -75);
    for (const [x, z] of [[75, -75], [2450, 2200], [1020, 450], [-2720, -2600]]) {
      focus.set(x, 0, z);
      for (let frame = 0; frame < 200; frame += 1) life.update(1 / 60, focus, frame > 120 ? 0.16 : 1);
      const car = meshes.find(m => m.name === 'city-life-car-paint');
      const torso = meshes.find(m => m.name === 'city-life-citizen-torso');
      for (const mesh of [car, torso]) {
        const matrices = liveMatrices(mesh);
        let visible = 0;
        for (const matrix of matrices) {
          assert.ok(matrix.m.every(Number.isFinite));
          if (Math.abs(matrix.m[0]) + Math.abs(matrix.m[2]) < 0.05) continue;
          visible += 1;
          const px = matrix.m[12], pz = matrix.m[14];
          assert.ok(Math.abs(px) < city.extent && Math.abs(pz) < city.extent, 'within map bounds');
          assert.equal(city.isWater(px, pz), false, 'no actors in the river');
          assert.equal(city.groundHeight(px, pz), mesh === car ? 0 : 0.42, 'cars stay on roads and citizens on pavement');
        }
        assert.ok(visible > 0, 'nearby population recycles after cross-city teleport');
      }
    }
    assert.deepEqual(scene.meshes, meshes, 'population does not add meshes during updates');
    assert.equal(city.grid.count, 0, 'ambient actors have no gameplay colliders');
    for (const mesh of meshes) {
      assert.equal(mesh.isPickable, false);
      assert.equal(mesh.alwaysSelectAsActiveMesh, true, 'world-space thin instances are not culled at their origin');
      assert.ok(mesh.getVerticesData(VertexBuffer.PositionKind).every(Number.isFinite));
    }
    life.setQuality('low');
    life.update(1 / 60, focus);
    const car = meshes.find(m => m.name === 'city-life-car-paint');
    for (const matrix of liveMatrices(car).slice(CITY_LIFE_BUDGETS.low.cars)) {
      assert.equal(Math.abs(matrix.m[0]), 0, 'quality reduction hides unused pool slots');
    }
    const queries = city.queries;
    for (let frame = 0; frame < 200; frame += 1) life.update(1 / 60, focus);
    assert.equal(city.queries, queries, 'validated routes do not query the collision grid each frame');
    life.dispose();
    assert.equal(scene.meshes.length, 0);
  } finally { engine.dispose(); }
});

class FakeParam {
  value = 0;
  calls = [];
  setValueAtTime(value) { this.value = value; this.calls.push(value); }
  linearRampToValueAtTime(value) { this.value = value; this.calls.push(value); }
  exponentialRampToValueAtTime(value) { this.value = value; this.calls.push(value); }
  setTargetAtTime(value) { this.value = value; this.calls.push(value); }
  cancelScheduledValues() {}
}
class FakeNode {
  gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam();
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
  stopped = false; disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
  start() {}
  stop() { this.stopped = true; }
}
class FakeContext {
  static latest;
  state = 'suspended'; currentTime = 0; sampleRate = 8000; destination = new FakeNode(); nodes = [];
  constructor() { FakeContext.latest = this; }
  node() { const node = new FakeNode(); this.nodes.push(node); return node; }
  createGain() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createOscillator() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBuffer(_channels, size) { const buffer = new Float32Array(size); return { getChannelData: () => buffer }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

test('audio is gesture-lazy, voice-bounded, silent while paused, and releases transient nodes', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = FakeContext;
  const sound = new Soundscape();
  try {
    assert.equal(FakeContext.latest, undefined, 'constructor does not create an AudioContext');
    sound.play('dash');
    assert.equal(sound.activeVoices, 0);
    await sound.unlock();
    const context = FakeContext.latest;
    assert.equal(context.state, 'running');
    sound.play('dash');
    assert.equal(sound.activeVoices, 0, 'menus remain silent after audio unlock');
    sound.setPaused(false);
    for (let i = 0; i < 50; i += 1) {
      context.currentTime += 0.2;
      sound.play('strike');
    }
    assert.equal(sound.activeVoices, MAX_SOUND_VOICES);
    const liveNodes = context.nodes.filter(node => typeof node.onended === 'function');
    sound.setPaused(true);
    assert.equal(sound.activeVoices, 0);
    assert.ok(liveNodes.every(node => node.stopped && node.disconnected));
    sound.setPaused(false);
    sound.setVolume(0);
    sound.play('pulse');
    assert.equal(sound.activeVoices, 0);
    sound.setVolume(0.6);
    sound.play('pulse');
    assert.equal(sound.activeVoices, 1);
    sound.update(1 / 30, Infinity, true, NaN);
    assert.ok(context.nodes.flatMap(node => node.gain.calls).every(Number.isFinite));
    sound.dispose();
    assert.equal(sound.activeVoices, 0);
    assert.equal(context.state, 'closed');
  } finally { globalThis.AudioContext = original; sound.dispose(); }
});

test('sound mix remains finite and lowers the city bed during focus and at night', () => {
  assert.ok(soundMix(0, false, 0).city > soundMix(0, false, 1).city);
  assert.ok(soundMix(1, true, 0).city < soundMix(1, false, 0).city);
  for (const speed of [-1, 0, 0.3, 1, 900, Infinity, NaN]) {
    const values = Object.values(soundMix(speed, true, NaN));
    assert.ok(values.every(v => Number.isFinite(v) && v >= 0));
  }
});
