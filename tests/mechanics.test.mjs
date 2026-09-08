import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, Image } from '@napi-rs/canvas';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { Player } from '../src/game/player/Player.ts';
import { Rogue, rogueById } from '../src/game/npc/Rogue.ts';
import { Input } from '../src/game/core/Input.ts';

globalThis.Image = Image;
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: tag => tag === 'canvas' ? createCanvas(1, 1) : new Image(),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const STEP = 1 / 120;
function sceneFixture() {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360, textureSize: 128 });
  return { engine, scene: new Scene(engine) };
}
function controls({ x = 0, z = 0, sprint = false, slide = false, jump = false } = {}) {
  let pendingJump = jump;
  return {
    movement: () => ({ x, z }),
    consume: action => {
      if (action !== 'jump') return false;
      const result = pendingJump;
      pendingJump = false;
      return result;
    },
    down: action => action === 'sprint' ? sprint : action === 'slide' ? slide : false,
  };
}
function terrain(height = () => 0) {
  return {
    groundHeight: (x, z) => height(x, z),
    probeWall: () => null,
    nearestRoad: () => new Vector3(500, 0, 0),
    move(position, delta, radius, bodyHeight, stepHeight, out) {
      position.addInPlace(delta);
      out.groundY = height(position.x, position.z);
      out.grounded = position.y <= out.groundY;
      out.hitWall = false;
      out.progress = 1;
      out.onWater = false;
    },
  };
}

test('opposite input brakes a sprint and establishes reverse travel, including slow steps', () => {
  const { engine, scene } = sceneFixture();
  try {
    const player = new Player(scene, Vector3.Zero());
    for (const dt of [STEP, 1 / 20]) {
      player.teleport(Vector3.Zero());
      player.velocity.z = 215;
      const input = controls({ z: -1, sprint: true });
      player.update(dt, input, 0, terrain());
      assert.equal(player.braking, true);
      assert.ok(player.speed < 215, 'opposite steering must reduce speed immediately');
      for (let time = dt; time < 3; time += dt) player.update(dt, input, 0, terrain());
      assert.ok(player.velocity.z < -40, `reverse velocity at dt=${dt}: ${player.velocity.z}`);
      assert.ok(Number.isFinite(player.position.x));
    }
  } finally { engine.dispose(); }
});

test('analog movement supports walking while full input retains sprint speed', () => {
  const { engine, scene } = sceneFixture();
  try {
    const player = new Player(scene, Vector3.Zero());
    const walk = controls({ z: 0.12 });
    for (let frame = 0; frame < 120; frame++) player.update(STEP, walk, 0, terrain());
    assert.ok(Math.abs(player.speed - 5.4) < 0.01);
    const sprint = controls({ z: 1, sprint: true });
    for (let frame = 0; frame < 600; frame++) player.update(STEP, sprint, 0, terrain());
    assert.ok(Math.abs(player.speed - 215) < 0.01);
  } finally { engine.dispose(); }
});

test('a jump shortly before landing queues one jump without consuming an air dash', () => {
  const { engine, scene } = sceneFixture();
  try {
    const player = new Player(scene, new Vector3(0, 1, 0));
    player.state = 'air';
    player.velocity.y = -12;
    const input = controls({ jump: true });
    let jumps = 0;
    for (let frame = 0; frame < 100; frame++) {
      const events = player.update(STEP, input, 0, terrain());
      assert.equal(events.dashed, false);
      jumps += Number(events.jumped);
    }
    assert.equal(jumps, 1);
    assert.equal(player.charge, 50, 'landing buffer does not spend dash charge');
  } finally { engine.dispose(); }
});

test('mid-air Space still phase dashes away from a landing surface', () => {
  const { engine, scene } = sceneFixture();
  try {
    const player = new Player(scene, new Vector3(0, 20, 0));
    player.state = 'air';
    const event = player.update(STEP, controls({ z: 1, jump: true }), 0, terrain());
    assert.equal(event.dashed, true);
    assert.equal(player.charge, 32);
    assert.ok(player.speed >= 140);
  } finally { engine.dispose(); }
});

test('running off a roof preserves the coyote jump window', () => {
  const { engine, scene } = sceneFixture();
  try {
    const city = terrain((_x, z) => z < 0 ? 4 : 0);
    const player = new Player(scene, new Vector3(0, 4, -0.1));
    player.velocity.z = 45;
    player.update(STEP, controls({ z: 1 }), 0, city);
    assert.equal(player.state, 'air');
    const event = player.update(STEP, controls({ z: 1, jump: true }), 0, city);
    assert.equal(event.jumped, true);
    assert.equal(event.dashed, false);
  } finally { engine.dispose(); }
});

test('a held slide cannot automatically restart or harvest repeated speed boosts', () => {
  const { engine, scene } = sceneFixture();
  try {
    const player = new Player(scene, Vector3.Zero());
    player.velocity.z = 215;
    const slide = controls({ z: 1, sprint: true, slide: true });
    player.update(STEP, slide, 0, terrain());
    assert.equal(player.state, 'slide');
    assert.equal(player.speed, 215, "entry alone never grants a boost");
    for (let frame = 0; frame < 600; frame++) player.update(STEP, slide, 0, terrain());
    assert.equal(player.state, 'ground');
    assert.ok(player.speed <= 215);
    player.update(STEP, controls({ z: 1, sprint: true }), 0, terrain());
    player.update(STEP, slide, 0, terrain());
    assert.equal(player.state, 'slide', 'release rearms the slide');
  } finally { engine.dispose(); }
});

test('recovery clears dash state and never counts a rescue teleport as distance run', () => {
  const { engine, scene } = sceneFixture();
  try {
    const player = new Player(scene, new Vector3(0, 20, 0));
    player.state = 'air';
    player.update(STEP, controls({ jump: true }), 0, terrain());
    assert.equal(player.dashing, true);
    player.recover(terrain());
    assert.equal(player.dashing, false);
    const city = terrain();
    const move = city.move;
    city.move = (...args) => { move(...args); args[5].onWater = true; };
    player.teleport(Vector3.Zero());
    player.distance = 0;
    for (let frame = 0; frame < 60; frame++) player.update(STEP, controls(), 0, city);
    assert.equal(player.position.x, 500);
    assert.equal(player.distance, 0);
  } finally { engine.dispose(); }
});

test('gamepad radial deadzone is continuous and look distance is frame-rate independent', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const pad = { connected: true, axes: [0, -0.181, 1, 0], buttons: [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  try {
    const input = new Input({});
    assert.ok(input.movement().z > 0 && input.movement().z < 0.002);
    pad.axes[0] = 0.15; pad.axes[1] = -0.15;
    assert.ok(input.movement().z > 0, 'diagonal stick uses radial rather than independent-axis deadzones');
    let atThirty = 0, atOneTwenty = 0;
    for (let frame = 0; frame < 30; frame++) atThirty += input.takeLook(1 / 30).x;
    for (let frame = 0; frame < 120; frame++) atOneTwenty += input.takeLook(1 / 120).x;
    assert.ok(Math.abs(atThirty - atOneTwenty) < 1e-9);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
});

test('menu confirmation, back and map buttons are quarantined until released after resume', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  const pad = { connected: true, axes: [0, 0, 0, 0], buttons };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  try {
    const input = new Input({});
    input.setEnabled(false);
    for (const index of [0, 1, 11]) buttons[index].pressed = true;
    input.setEnabled(true);
    for (let frame = 0; frame < 5; frame++) {
      input.poll();
      assert.equal(input.consume('jump'), false, 'menu A cannot become a jump');
      assert.equal(input.consume('advance'), false, 'menu A cannot skip opening dialogue');
      assert.equal(input.down('slide'), false, 'menu B cannot become a slide');
      assert.equal(input.consume('map'), false, 'a held map button cannot reopen the map');
    }
    for (const index of [0, 1, 11]) buttons[index].pressed = false;
    input.poll();
    for (const index of [0, 1, 11]) buttons[index].pressed = true;
    input.poll();
    assert.equal(input.consume('jump'), true);
    assert.equal(input.down('slide'), true);
    assert.equal(input.consume('map'), true);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  }
});

test('muted gameplay input leaves native menu Space keyup activation intact', () => {
  const oldWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = { addEventListener: (type, handler) => listeners.set(type, handler) };
  try {
    const input = new Input({});
    let prevented = false;
    const event = { code: 'Space', preventDefault: () => { prevented = true; } };
    input.setEnabled(false);
    listeners.get('keyup')(event);
    assert.equal(prevented, false, 'focused menu buttons retain their native activation');
    input.setEnabled(true);
    listeners.get('keyup')(event);
    assert.equal(prevented, true, 'gameplay still prevents page scrolling');
  } finally { globalThis.window = oldWindow; }
});

test('ranged telegraphs commit aim early enough to dodge and resolve once', () => {
  const { engine, scene } = sceneFixture();
  try {
    const rogue = new Rogue(scene, rogueById('gale'), Vector3.Zero());
    const originalTarget = new Vector3(0, 0, 45);
    const opened = rogue.update(STEP, originalTarget, 0);
    assert.equal(opened.telegraph, true);
    const marker = scene.getMeshByName('rogue-target-gale');
    assert.equal(marker.isEnabled(), true);
    assert.equal(marker.position.z, 45);
    const escaped = new Vector3(30, 0, 45);
    let damage = 0, projectiles = 0;
    for (let frame = 0; frame < 115; frame++) {
      const out = rogue.update(STEP, escaped, 0);
      damage += out.damage;
      if (out.projectile) {
        projectiles++;
        assert.equal(out.projectile.x, 0);
        assert.equal(out.projectile.z, 45);
      }
    }
    assert.equal(projectiles, 1);
    assert.equal(damage, 0);
  } finally { engine.dispose(); }
});

test('a committed charge travels down its warning lane instead of tracking a dodge', () => {
  const { engine, scene } = sceneFixture();
  try {
    const rogue = new Rogue(scene, rogueById('kiln'), Vector3.Zero());
    rogue.update(STEP, new Vector3(0, 0, 10), 0);
    assert.equal(scene.getMeshByName('rogue-lane-kiln').isEnabled(), true);
    const escaped = new Vector3(18, 0, 10);
    let damage = 0;
    for (let frame = 0; frame < 130; frame++) damage += rogue.update(STEP, escaped, 0).damage;
    assert.equal(damage, 0);
    assert.ok(Math.abs(rogue.position.x) < 0.01, 'charge remains on the committed axis');
    assert.ok(rogue.position.z > 20);
  } finally { engine.dispose(); }
});

test('Vantage adds a low-health ground sweep with a real jump counter and recovery window', () => {
  const { engine, scene } = sceneFixture();
  try {
    const grounded = new Rogue(scene, rogueById('vantage'), Vector3.Zero());
    const airborne = new Rogue(scene, rogueById('vantage'), new Vector3(100, 0, 0));
    grounded.health = grounded.maxHealth * 0.5;
    airborne.health = airborne.maxHealth * 0.5;
    let groundDamage = 0, airDamage = 0;
    const groundTarget = new Vector3(0, 0, 20);
    const airTarget = new Vector3(100, 4, 20);
    grounded.update(STEP, groundTarget, 0);
    airborne.update(STEP, airTarget, 0);
    assert.match(grounded.tacticHint, /jump/i);
    for (let frame = 0; frame < 175; frame++) {
      groundDamage += grounded.update(STEP, groundTarget, 0).damage;
      airDamage += airborne.update(STEP, airTarget, 0).damage;
    }
    assert.equal(groundDamage, grounded.definition.damage);
    assert.equal(airDamage, 0);
    assert.equal(grounded.vulnerable, true);
    assert.match(grounded.tacticHint, /Recovery/);
  } finally { engine.dispose(); }
});

test('a timed standing jump clears the Vantage sweep without needing sprint momentum', () => {
  const { engine, scene } = sceneFixture();
  try {
    const rogue = new Rogue(scene, rogueById('vantage'), Vector3.Zero());
    rogue.health *= 0.5;
    const player = new Player(scene, new Vector3(0, 0, 20));
    let damage = 0, jumped = false;
    for (let frame = 0; frame < 180; frame++) {
      // Jump near the end of the warned wind-up, then coast over the wave.
      const events = player.update(STEP, controls({ jump: frame === 98 }), 0, terrain());
      jumped ||= events.jumped;
      damage += rogue.update(STEP, player.position, 0).damage;
    }
    assert.equal(jumped, true);
    assert.equal(player.speed, 0);
    assert.equal(damage, 0);
  } finally { engine.dispose(); }
});

test('body contact damage cannot drain an opponent every simulation tick', () => {
  const { engine, scene } = sceneFixture();
  try {
    const rogue = new Rogue(scene, rogueById('kiln'), Vector3.Zero());
    rogue.hit(4, 0, 0);
    const health = rogue.health;
    assert.equal(rogue.vulnerable, false);
    for (let frame = 0; frame < 10; frame++) {
      rogue.update(STEP, new Vector3(0, 0, 50), 0);
      rogue.hit(4, 0, 0);
    }
    assert.equal(rogue.health, health);
    rogue.update(0.2, new Vector3(0, 0, 50), 0);
    assert.equal(rogue.vulnerable, true);
  } finally { engine.dispose(); }
});

test('boss warnings and slow fields reuse bounded meshes and release every owned resource', () => {
  const { engine, scene } = sceneFixture();
  try {
    // Babylon lazily creates its scene-owned fallback on the first untextured
    // caster. It is not an encounter resource and survives encounter teardown.
    void scene.defaultMaterial;
    const baselineMeshes = scene.meshes.length;
    const baselineMaterials = scene.materials.length;
    const bosses = [
      new Rogue(scene, rogueById('vantage'), Vector3.Zero()),
      new Rogue(scene, rogueById('coldsnap'), new Vector3(100, 0, 0)),
    ];
    bosses[0].health *= 0.5;
    const meshes = [...scene.meshes];
    const allocatedMeshes = scene.meshes.length;
    const playerPosition = new Vector3();
    let windups = 0, sweepFrames = 0, fieldFrames = 0;
    for (let frame = 0; frame < 3600; frame++) {
      for (const boss of bosses) {
        playerPosition.copyFrom(boss.position);
        playerPosition.z += boss.definition.archetype === 'zoner' ? 26 : 10;
        windups += Number(boss.update(1 / 60, playerPosition, 0).telegraph);
        assert.ok(boss.fields.length <= 4);
        if (boss.tacticHint.includes('Ground sweep')) sweepFrames++;
        if (boss.fields.length) fieldFrames++;
      }
    }
    assert.ok(windups > 20 && sweepFrames > 100 && fieldFrames > 100, 'exercise repeated charges, sweeps and fields');
    assert.equal(scene.meshes.length, allocatedMeshes, 'attacks reuse their meshes');
    for (const boss of bosses) boss.dispose();
    assert.equal(scene.meshes.length, baselineMeshes);
    assert.equal(scene.materials.length, baselineMaterials, scene.materials.map(material => material.name).join(', '));
    assert.ok(meshes.every(mesh => mesh.isDisposed()));
  } finally { engine.dispose(); }
});

test('new sprint reaches 90 percent in 1.5s and Focus sharpens a high-speed corner', () => {
  const { engine, scene } = sceneFixture();
  try {
    const p = new Player(scene, Vector3.Zero());
    for (let i = 0; i < 180; i++) p.update(STEP, controls({ z: 1, sprint: true }), 0, terrain());
    assert.ok(p.speed >= 193.5 && p.speed <= 215);
    const corner = focus => {
      p.teleport(Vector3.Zero()); p.velocity.z = 215; p.focusHeld = focus;
      for (let i = 0; i < 24; i++) p.update(STEP, controls({ x: 1, sprint: true }), 0, terrain());
      return Math.atan2(p.velocity.x, p.velocity.z);
    };
    const normal = corner(false), focused = corner(true);
    assert.ok(normal > 1.2, `ordinary steering turns ${normal} radians within 0.2s`);
    assert.ok(focused > normal && focused <= Math.PI / 2);
  } finally { engine.dispose(); }
});

test('drift rewards an actual sustained corner once; tapping and straight slides earn nothing', () => {
  const { engine, scene } = sceneFixture();
  try {
    const p = new Player(scene, Vector3.Zero());
    const attempt = (frames, turning) => {
      p.teleport(Vector3.Zero()); p.velocity.z = 150;
      p.update(STEP, controls({ z: 1, sprint: true, slide: true }), 0, terrain());
      for (let i = 0; i < frames; i++) p.update(STEP, controls({ x: turning ? 1 : 0, z: turning ? 0 : 1, sprint: true, slide: true }), 0, terrain());
      const speed = p.speed;
      const rewarded = p.update(STEP, controls({ x: 1, sprint: true }), 0, terrain()).driftExited;
      if (rewarded) assert.ok(p.speed > speed + 20);
      assert.equal(p.update(STEP, controls({ x: 1, sprint: true }), 0, terrain()).driftExited, false);
      return rewarded;
    };
    assert.equal(attempt(60, true), true);
    assert.equal(attempt(1, true), false);
    assert.equal(attempt(60, false), false);
  } finally { engine.dispose(); }
});

test('wall crest carries entry momentum through a collision sweep and seam grace expires', () => {
  const { engine, scene } = sceneFixture();
  try {
    const p = new Player(scene, new Vector3(0, 100, 0));
    p.wallNormal.set(0, 0, -1); p.beginVerticalRun(200);
    let sweeps = 0;
    const city = terrain(); const move = city.move;
    city.move = (...args) => { sweeps++; move(...args); };
    assert.equal(p.update(STEP, controls(), 0, city).roofCrested, true);
    assert.ok(p.velocity.z >= 170);
    assert.ok(sweeps >= 2, 'lip movement and regular integration both sweep');
    p.state = 'wall'; p.wallTimer = 2; p.wallSeamGrace = .1;
    p.update(STEP, controls(), 0, city);
    assert.equal(p.state, 'wall');
    for (let i = 0; i < 15; i++) p.update(STEP, controls(), 0, city);
    assert.equal(p.state, 'air');
  } finally { engine.dispose(); }
});

test('courier follows its committed loop, warns a sweep, and opens a recovery window', () => {
  const { engine, scene } = sceneFixture();
  try {
    const rogue = new Rogue(scene, rogueById('vantage'), Vector3.Zero());
    rogue.configureCourier([Vector3.Zero(), new Vector3(600, 0, 0), new Vector3(600, 0, 300), new Vector3(0, 0, 300)]);
    let warnings = 0, openings = 0;
    for (let i = 0; i < 120 * 7; i++) {
      const result = rogue.update(STEP, new Vector3(1000, 0, 1000), 0);
      warnings += Number(result.telegraph); openings += Number(rogue.vulnerable);
      assert.ok(rogue.position.z >= -.1 && rogue.position.z <= 300.1);
      assert.ok(rogue.position.x >= -.1 && rogue.position.x <= 600.1);
    }
    assert.ok(warnings >= 1); assert.ok(openings > 100, 'long enough to close the gap');
  } finally { engine.dispose(); }
});
