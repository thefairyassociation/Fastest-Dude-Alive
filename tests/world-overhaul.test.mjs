import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';
import { NullEngine, Scene, FreeCamera, Vector3, VertexBuffer, InternalTexture, InternalTextureSource } from '@babylonjs/core';
import { City, GRID_RADIUS, BLOCK_PITCH, BRIDGE_ROWS, districtAt } from '../src/game/world/City.ts';
import { Collectibles } from '../src/game/activities/Collectibles.ts';
import { buildPlaygroundRoutes } from '../src/game/world/Playgrounds.ts';
import { Player } from '../src/game/player/Player.ts';
import { buildRoutes } from '../src/game/activities/routes.ts';
import { mulberry32 } from '../src/game/core/Rng.ts';
import { StaticBoxBatch } from '../src/game/world/StaticGeometry.ts';

globalThis.Image = Image;
globalThis.document = {addEventListener() {}, removeEventListener() {}, createElement: tag => {
  if(tag === 'canvas') return createCanvas(1,1);
  if(tag === 'img') return new Image();
  throw Error(`Unexpected DOM element ${tag}`);
}};
function setup() {
  const engine = new NullEngine();
  engine._features.supportCSM = true;
  engine.createDepthStencilTexture = () => new InternalTexture(engine, InternalTextureSource.DepthStencil, true);
  engine.createCubeTexture = () => {
    const texture = new InternalTexture(engine, InternalTextureSource.Cube, true);
    texture.isCube = true; texture.isReady = true; return texture;
  };
  const scene = new Scene(engine);
  new FreeCamera('camera', new Vector3(75,2,-75), scene);
  return {engine,scene};
}

test('static geometry batches retain dimensions, outward normals and independent box indices', () => {
  const {engine,scene} = setup();
  try {
    const batch = new StaticBoxBatch();
    batch.add(-2000, 30, 2100, 16, 40, 24);
    batch.add(12, 4, -40, 8, 2, 10);
    const mesh = batch.build(scene,'batch');
    const p = mesh.getVerticesData(VertexBuffer.PositionKind), n = mesh.getVerticesData(VertexBuffer.NormalKind);
    assert.equal(mesh.getTotalVertices(),48);
    assert.equal(mesh.getIndices().length,72);
    assert.ok(mesh.getIndices().slice(36).every(i => i>=24));
    for(let i=0;i<24*3;i+=3) assert.ok((p[i]+2000)*n[i]+(p[i+1]-30)*n[i+1]+(p[i+2]-2100)*n[i+2]>0);
    mesh.computeWorldMatrix(true);
    assert.equal(mesh.getBoundingInfo().boundingBox.minimumWorld.x,-2008);
    assert.equal(mesh.getBoundingInfo().boundingBox.maximumWorld.y,50);
    assert.equal(mesh.subMeshes.length, 2, 'distant boxes keep separate cull bounds');
  } finally {engine.dispose();}
});

test('expanded city preserves saved mote locations and has valid routes, new roof landings and bounded LOD', () => {
  const {engine,scene} = setup();
  try {
    const started = performance.now();
    const city = new City(scene,'high');
    assert.equal(GRID_RADIUS,18);
    assert.equal(city.extent*2,5550);
    assert.equal((GRID_RADIUS*2+1)**2,1369);
    assert.equal(city.landmarks.length,15);
    assert.equal(districtAt(-16,4).id,'westhaven');
    assert.equal(districtAt(-5,16).id,'northline');
    assert.equal(districtAt(-5,-16).id,'foundry-belt');
    assert.equal(districtAt(16,-4).id,'saltmere');
    assert.equal(districtAt(0,0).id,'crest');
    for(const row of BRIDGE_ROWS) assert.equal(city.isWater(1050,row*BLOCK_PITCH),false);
    for(const z of [-1950,-1500,-750,300,1500,1950]) assert.equal(city.isWater(1050,z),true);

    const baseline = JSON.parse(readFileSync(new URL('./fixtures/legacy-motes.json',import.meta.url)));
    const collectedIds = new Set(['mote-0']);
    const collectibles = new Collectibles(scene,city,mulberry32(0x5eed10),{hasCollected:id=>collectedIds.has(id)});
    assert.equal(collectibles.total,112);
    assert.equal(collectibles.found,1);
    collectedIds.clear();
    collectibles.syncFromSave();
    assert.equal(collectibles.found,0,'reset profile reconciles the live world without reloading');
    assert.ok(collectibles.motes.every(mote=>!mote.taken));
    for(let i=0;i<64;i++) {
      const actual = collectibles.motes[i], expected=baseline.motes[i];
      assert.equal(actual.id,expected.id);
      for(let axis=0;axis<3;axis++) assert.ok(Math.abs(actual.position.asArray()[axis]-expected.position[axis])<1e-6, `${actual.id}: old ${expected.position}, new ${actual.position.asArray()}`);
    }
    for(const mote of collectibles.motes.slice(64)) {
      assert.ok(Math.max(Math.abs(mote.position.x),Math.abs(mote.position.z))>1875);
      assert.ok(Math.max(Math.abs(mote.position.x),Math.abs(mote.position.z))<city.extent);
    }

    for(const landmark of city.landmarks) {
      const p = landmark.position;
      assert.ok(Math.abs(p.x)<city.extent && Math.abs(p.z)<city.extent);
      assert.equal(city.grid.overlaps(p.x,p.z,.42,p.y,p.y+1.8,.55),false,`${landmark.id} entrance accessible`);
    }
    const roofs=[[-750,2400,33.42],[-2400,750,9.42],[-750,-2400,29.22],[2250,-600,19.42],[2391,2116,55.62],[2400,2116,70.02],[450,2250,10.42]];
    for(const [x,z,y] of roofs) {
      assert.ok(Math.abs(city.groundHeight(x,z,500)-y)<1e-6,`roof ${x},${z}`);
      assert.equal(city.grid.overlaps(x,z,.42,y,y+1.8,.55),false,`clear landing ${x},${z}`);
      assert.ok(city.grid.overlaps(x,z,.3,y-1,y-.1,0),`solid roof ${x},${z}`);
    }
    const routes=buildRoutes(city);
    assert.equal(routes.length,9);
    const playgrounds = buildPlaygroundRoutes(city);
    assert.equal(playgrounds.length, 3);
    assert.deepEqual(playgrounds.map(p => p.id), ['crest-circuit', 'river-rush', 'foundry-flow']);
    assert.ok(playgrounds.every(p => p.gates.length >= 16 && p.par >= 45));
    const bridgeY = city.groundHeight(300,328,400);
    assert.ok(bridgeY > 20);
    assert.equal(city.grid.overlaps(300,328,.42,bridgeY,bridgeY+1.8,.55),false);
    for(const route of [...routes, ...playgrounds]) for(const [i,gate] of route.gates.entries()) {
      const p=gate.position;
      assert.ok(p.asArray().every(Number.isFinite),`${route.id}/${i}`);
      assert.ok(Math.max(Math.abs(p.x),Math.abs(p.z))<city.extent,`${route.id}/${i} inside map`);
      assert.equal(city.grid.overlaps(p.x,p.z,.42,p.y,p.y+1.8,.55),false,`${route.id}/${i} outside solids`);
      if(city.isWater(p.x,p.z) && p.y<1) assert.ok(gate.minSpeed>=34,`${route.id}/${i} water pace gate`);
    }

    const runner = new Player(scene, city.start.clone());
    const input = { movement: () => ({x:0,z:1}), down: a => a === 'sprint', consume: () => false };
    const timings = [];
    for (const dt of [1/120, 1/20]) {
      runner.teleport(city.start);
      const begin = performance.now();
      for (let i=0;i<8/dt;i++) {
        runner.update(dt,input,0,city);
        assert.ok(runner.position.asArray().every(Number.isFinite));
        assert.equal(city.grid.overlaps(runner.position.x,runner.position.z,.40,runner.position.y,runner.position.y+1.8,.55),false,'sprint stays outside buildings');
      }
      timings.push(Math.round(performance.now()-begin));
      assert.ok(runner.speed > 190);
    }
    console.log(`8s full-city sprint simulation at 120Hz / 20Hz: ${timings.join(' / ')}ms CPU`);
    runner.teleport(new Vector3(272,.42,280));
    runner.velocity.z = 215;
    let wallSteps=0, crests=0;
    for(let i=0;i<480;i++) {
      const events = runner.update(1/120,input,0,city);
      if(runner.state==='vertical') wallSteps++;
      if(events.roofCrested) { crests++; assert.ok(runner.speed>100,'actual roof preserves momentum'); break; }
    }
    assert.ok(wallSteps>0 && crests===1,'Crest approach supports a continuous climb and roof exit');
    runner.teleport(new Vector3(1050,.1,300)); runner.velocity.z=150;
    let spray=0;
    for(let i=0;i<120;i++) { const events=runner.update(1/120,input,0,city); spray+=Number(events.waterSpray); assert.equal(events.sank,false); }
    assert.ok(spray>100,'water running remains continuous');
    runner.root.dispose(false,true);
    const full=scene.meshes.filter(m=>m.name.startsWith('facade:')&&m.name.endsWith('-merged'));
    const skyline=scene.meshes.filter(m=>m.name==='skyline-merged');
    city.updateStreaming(city.start);
    assert.ok(full.some(m=>m.isEnabled()) && full.some(m=>!m.isEnabled()));
    assert.ok(skyline.some(m=>m.isEnabled()),'far city uses simplified skyline');
    const before=new Set(full.filter(m=>m.isEnabled()));
    city.updateStreaming(new Vector3(-2400,3,2400));
    assert.ok(full.some(m=>m.isEnabled()&&!before.has(m)),'crossing the map activates outer city cells');
    let vertices=0;
    for(const mesh of scene.meshes) {
      vertices+=mesh.getTotalVertices();
      const p=mesh.getVerticesData(VertexBuffer.PositionKind);
      if(p) assert.ok(p.every(Number.isFinite),mesh.name);
    }
    console.log(`Expanded city: ${scene.meshes.length} meshes; ${vertices} vertices; ${city.grid.count} static colliders; ${Math.round(performance.now()-started)}ms CPU build/check (no GPU frame-rate claim).`);
    assert.ok(scene.meshes.length<2200,`mesh ceiling ${scene.meshes.length}`);
    assert.ok(vertices<4000000,`vertex ceiling ${vertices}`);
    assert.ok(city.grid.count<35000,`static collider ceiling ${city.grid.count}`);
  } finally {engine.dispose();}
});
