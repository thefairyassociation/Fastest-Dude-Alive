import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, Image } from '@napi-rs/canvas';
import { NullEngine, Scene, FreeCamera, Vector3, VertexBuffer, InternalTexture, InternalTextureSource } from '@babylonjs/core';
import { HeroModel } from '../src/game/player/HeroModel.ts';
import { SpeedTrails } from '../src/game/fx/SpeedTrails.ts';
import { Palette } from '../src/game/world/Materials.ts';
import { mulberry32 } from '../src/game/core/Rng.ts';

// Real CPU canvas painting, with Babylon's non-GPU engine. This verifies
// geometry/masks/state transitions, not shader output or visual appearance.
globalThis.Image = Image;
globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement: (tag) => {
  if (tag === 'canvas') return createCanvas(1, 1);
  if (tag === 'img') return new Image();
  throw new Error(`Unexpected element in graphics test: ${tag}`);
} };
function setup() {
  const engine = new NullEngine({ renderWidth: 1280, renderHeight: 720, textureSize: 512, deterministicLockstep: true, lockstepMaxSteps: 12 });
  const scene = new Scene(engine);
  new FreeCamera('camera', new Vector3(0, 2, -6), scene);
  return { engine, scene };
}
const idle = { dt: 1 / 60, speed: 0, speedRatio: 0, grounded: true, wallSide: 0, verticalRun: false, sliding: false, strike: 0, turn: 0 };

test('hero mesh has finite geometry, outward normals and human-scale proportions', () => {
  const { engine, scene } = setup();
  try {
    const hero = new HeroModel(scene);
    let vertices = 0;
    for (const mesh of hero.root.getChildMeshes()) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) continue;
      assert.ok(positions.every(Number.isFinite), mesh.name);
      vertices += positions.length / 3;
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
      assert.ok(normals?.every(Number.isFinite), `${mesh.name} normals`);
      assert.ok(mesh.getIndices().every(i => i >= 0 && i < positions.length / 3), mesh.name);
    }
    const torso = scene.getMeshByName('hero-anatomical-torso');
    const p = torso.getVerticesData(VertexBuffer.PositionKind), n = torso.getVerticesData(VertexBuffer.NormalKind);
    // Sample a side wall away from end caps. Inward normals invert lighting.
    const ring = 4, i = ring * 25 * 3;
    assert.ok(p[i] * n[i] + p[i + 2] * n[i + 2] > 0, 'torso normals face out');
    const bounds = hero.root.getHierarchyBoundingVectors();
    assert.ok(bounds.max.y > 1.75 && bounds.max.y < 1.9, `height ${bounds.max.y}`);
    assert.ok(bounds.min.y >= -0.01 && bounds.min.y < 0.03, `feet ${bounds.min.y}`);
    assert.ok(vertices < 60000, `hero vertex budget: ${vertices}`);
    assert.equal(hero.trailAnchors.length, 4);
    assert.ok(hero.shadowCaster.getChildMeshes().length > 50, 'actual animated limbs cast shadows');
    console.log(`Hero: ${vertices} vertices, ${hero.root.getChildMeshes().length} meshes`);
  } finally { engine.dispose(); }
});

test('animation stays finite through sprint, slow frames, slide, jump and both wall directions', () => {
  const { engine, scene } = setup();
  try {
    const hero = new HeroModel(scene);
    for (const dt of [1 / 120, 1 / 60, 1 / 20]) {
      for (const state of [{}, { sliding: true }, { grounded: false }, { wallSide: -1, grounded: false }, { wallSide: 1, grounded: false }, { verticalRun: true, grounded: false }, { strike: 0.2 }]) {
        for (let frame = 0; frame < 30; frame++) {
          hero.pose({ ...idle, speed: 215, speedRatio: 1, turn: 0.8, ...state, dt });
          for (const node of hero.root.getDescendants()) assert.ok(node.computeWorldMatrix(true).m.every(Number.isFinite), node.name);
        }
      }
    }
    for (let frame = 0; frame < 120; frame++) hero.pose(idle);
    assert.ok(Math.abs(scene.getTransformNodeByName('hero-hip--1').rotation.x) < 0.01, 'idle legs do not keep cycling');
    hero.pose({ ...idle, dt: 1, sliding: true, wallSide: 1 });
    hero.resetPose();
    hero.pose({ ...idle, dt: 0 });
    assert.equal(hero.shadowCaster.position.y, 0, 'reduced-motion portrait clears slide crouch');
    assert.equal(hero.shadowCaster.rotation.z, 0, 'reduced-motion portrait clears wall lean');
    hero.setCharge(1, true);
    assert.ok(scene.getMaterialByName('hero-resonance').emissiveColor.b > 1);
  } finally { engine.dispose(); }
});

test('speed ribbons are bounded, fade at rest, clear on teleport and respect reduced motion', () => {
  const { engine, scene } = setup();
  try {
    const hero = new HeroModel(scene), trails = new SpeedTrails(scene, hero.trailAnchors);
    const meshes = scene.meshes.filter(m => m.name.startsWith('trail-'));
    const total = scene.meshes.length;
    for (let frame = 0; frame < 300; frame++) {
      hero.root.position.z += 215 / 60;
      hero.pose({ ...idle, speed: 215, speedRatio: 1 });
      trails.update(1 / 60, hero.root.position, 0, 1, false, false);
    }
    assert.equal(scene.meshes.length, total, 'no new meshes while running');
    for (const mesh of meshes) {
      assert.equal(mesh.getTotalVertices(), 64);
      assert.ok(mesh.isEnabled());
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      assert.ok(positions.every(Number.isFinite));
      assert.ok(Math.max(...positions.filter((_, i) => i % 3 === 2)) > 1000, 'trail follows world position');
    }
    hero.root.position.x += 500;
    trails.update(1 / 60, hero.root.position, 0, 1, false, false);
    assert.ok(meshes.every(m => !m.isEnabled()), 'teleport does not draw a cross-city streak');
    for (let i = 0; i < 3; i++) trails.update(1 / 60, hero.root.position, 0, 1, true, false);
    trails.update(1 / 60, hero.root.position, 0, 1, true, true);
    assert.ok(meshes.every(m => !m.isEnabled()));
    for (let i = 0; i < 3; i++) trails.update(1 / 60, hero.root.position, 0, 1, false, false);
    for (let i = 0; i < 20; i++) trails.update(1 / 60, hero.root.position, 0, 0, false, false);
    assert.ok(meshes.every(m => !m.isEnabled()), 'trails expire when stopped');
  } finally { engine.dispose(); }
});

test('facade masks illuminate windows only, keep roofs matte, and animate shared water UVs', () => {
  const { engine, scene } = setup();
  try {
    const palette = new Palette(scene, mulberry32(0x1234), 20);
    let litPixels = 0;
    for (const key of palette.facadeKeys) {
      const mat = palette.get(key);
      assert.notEqual(mat.albedoTexture, mat.emissiveTexture);
      assert.equal(mat.bumpTexture.gammaSpace, false, 'normals use linear data');
      assert.equal(mat.metallicTexture.gammaSpace, false, 'roughness uses linear data');
      const pixel = mat.emissiveTexture.getContext().getImageData(0, 0, 1, 1).data;
      assert.deepEqual([...pixel].slice(0, 3), [0, 0, 0], 'roof patch never glows');
      const rough = mat.metallicTexture.getContext().getImageData(0, 0, 1, 1).data;
      assert.ok(rough[1] > 200, 'roof is matte');
      const emission = mat.emissiveTexture.getContext().getImageData(0, 0, 512, 512).data;
      litPixels += emission.filter((v, i) => i % 4 !== 3 && v > 0).length;
    }
    assert.ok(litPixels > 0, 'occupied rooms emit light');
    palette.freeze();
    const water = palette.get('water');
    palette.update(1 / 60, 1);
    assert.ok(water.bumpTexture.uOffset > 0);
    assert.equal(water.alpha, 1, 'river does not sort as a city-length transparent plane');
    assert.ok(palette.get(palette.facadeKeys[0]).emissiveColor.r > 1);
    palette.update(1 / 60, 0);
    assert.ok(palette.get(palette.facadeKeys[0]).emissiveColor.r < 0.2);
  } finally { engine.dispose(); }
});

test('city builds with structural shadows, correct local detail, stable traversal and river tiling', async () => {
  const { City, BLOCK_PITCH } = await import('../src/game/world/City.ts');
  const { Player } = await import('../src/game/player/Player.ts');
  const { engine, scene } = setup();
  try {
    const started = performance.now();
    // NullEngine cannot draw cascades; enable construction only to inspect
    // the registered caster graph. No shadow pixels are tested here.
    engine._features.supportCSM = true;
    engine.createDepthStencilTexture = () => new InternalTexture(engine, InternalTextureSource.DepthStencil, true);
    engine.createCubeTexture = () => {
      const texture = new InternalTexture(engine, InternalTextureSource.Cube, true);
      texture.isCube = true; texture.isReady = true;
      return texture;
    };
    const city = new City(scene, 'high');
    const casters = city.sky.shadows.getShadowMap().renderList;
    assert.ok(casters.some(m => m.name.startsWith('facade:')), 'merged towers cast shadows');
    assert.ok(casters.every(m => !m.isDisposed()), 'shadow list contains no disposed pre-merge meshes');
    const water = city.palette.get('water');
    assert.equal(water.bumpTexture.uScale, BLOCK_PITCH / 40);
    assert.ok(water.bumpTexture.vScale > 90);
    const player = new Player(scene, city.start);
    const input = { consume: () => false, down: action => action === 'sprint', movement: () => ({ x: 0, z: 1 }) };
    for (const dt of [1 / 120, 1 / 20]) {
      player.teleport(city.start);
      for (let frame = 0; frame < Math.round(6 / dt); frame++) player.update(dt, input, 0, city);
      assert.ok(player.speed > 200, `sprint reaches top speed at dt=${dt}: ${player.speed}`);
      assert.ok(Number.isFinite(player.position.z));
      assert.ok(!city.grid.overlaps(player.position.x, player.position.z, player.radius,
        player.position.y, player.position.y + player.height, 0.55), 'runner remains outside buildings');
    }
    // At a chunk corner, centre-distance culling used to hide objects nearby.
    city.setDetailRadius(260);
    const focus = new Vector3(360, 0, 360);
    city.updateStreaming(focus);
    const near = scene.meshes.filter(m => m.name === 'street-light-merged' && (() => {
      const b = m.getBoundingInfo().boundingBox;
      return b.minimumWorld.x < 400 && b.maximumWorld.x > 350 && b.minimumWorld.z < 400 && b.maximumWorld.z > 350;
    })());
    assert.ok(near.length > 0);
    assert.ok(near.every(m => m.isEnabled()), 'chunk intersecting detail radius stays enabled');
    for (const atmosphere of ['night', 'storm', 'dawn', 'golden']) {
      city.sky.setAtmosphere(atmosphere, true);
      city.sky.setReducedMotion(true);
      for (let i = 0; i < 20; i++) city.sky.update(1);
      assert.equal(city.sky.flashing, false, 'reduced motion suppresses lightning');
      assert.ok(Number.isFinite(city.sky.exposure));
    }
    console.log(`City: ${scene.meshes.length} meshes, ${casters.length} shadow casters, construction/checks ${Math.round(performance.now() - started)} ms (CPU only)`);
  } finally { engine.dispose(); }
});


test('effect resets clear the previous run and Low allocates only two ribbons', async () => {
  const { Effects } = await import('../src/game/fx/Effects.ts');
  const { engine, scene } = setup();
  try {
    const hero = new HeroModel(scene);
    const effects = new Effects(scene, hero.ghostSource, 'low', hero.trailAnchors);
    assert.equal(scene.meshes.filter(m => m.name.startsWith('trail-')).length, 2);
    effects.pulse(Vector3.Zero(), 'warm', 20);
    effects.bolt(Vector3.Zero(), new Vector3(5, 1, 0));
    assert.ok(scene.meshes.some(m => m.name.startsWith('pulse-') && m.isEnabled()));
    effects.reset();
    assert.ok(scene.meshes.filter(m => /^(pulse-|bolt-|ghost-|trail-)/.test(m.name)).every(m => !m.isEnabled()));
    effects.pulse(Vector3.Zero(), 'cool', 10);
    assert.ok(scene.meshes.some(m => m.name.startsWith('pulse-cool') && m.isEnabled()), 'pools remain reusable after reset');
    effects.setReducedMotion(true);
  } finally { engine.dispose(); }
});
