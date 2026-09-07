// CPU-only geometry export for inspecting the rig without starting the game.
// Usage: node --import ./tests/register.mjs tests/export-character.mjs /tmp/hero.json
import { writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { NullEngine, Scene, VertexBuffer, Vector3, Matrix } from '@babylonjs/core';
import { HeroModel } from '../src/game/player/HeroModel.ts';
globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement: () => createCanvas(1, 1) };
const engine = new NullEngine();
try {
  const scene = new Scene(engine), hero = new HeroModel(scene);
  for (let i = 0; i < 120; i++) hero.pose({ dt: 1 / 60, speed: 0, speedRatio: 0, grounded: true, wallSide: 0, verticalRun: false, sliding: false, strike: 0, turn: 0 });
  const meshes = [];
  for (const mesh of hero.root.getChildMeshes()) {
    const vertices = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!vertices) continue;
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    const world = mesh.computeWorldMatrix(true);
    const normalMatrix = Matrix.Transpose(Matrix.Invert(world));
    const positions = [], transformedNormals = [];
    for (let i = 0; i < vertices.length; i += 3) {
      positions.push(...Vector3.TransformCoordinates(Vector3.FromArray(vertices, i), world).asArray());
      transformedNormals.push(...Vector3.TransformNormal(Vector3.FromArray(normals, i), normalMatrix).normalize().asArray());
    }
    const mat = mesh.material;
    meshes.push({ name: mesh.name, positions, normals: transformedNormals, indices: [...mesh.getIndices()], color: mat.albedoColor.asArray(), emission: mat.emissiveColor.asArray(), roughness: mat.roughness });
  }
  await writeFile(process.argv[2] ?? '/tmp/hero.json', JSON.stringify(meshes));
  console.log(`Exported ${meshes.length} character meshes (CPU data only).`);
} finally { engine.dispose(); }
