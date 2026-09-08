import { Mesh, Scene, SubMesh, Vector4, VertexData } from "@babylonjs/core";

/** Street-grid cell used to split a batch into cullable submeshes. */
const CULL_CELL = 150;

interface CellGeom {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Assemble static box geometry directly, avoiding thousands of temporary scene nodes. */
export class StaticBoxBatch {
  private readonly cells = new Map<number, CellGeom>();

  add(x: number, y: number, z: number, width: number, height: number, depth: number, faceUV?: Vector4[]): void {
    const key = Math.floor(x / CULL_CELL) * 16384 + Math.floor(z / CULL_CELL);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { positions: [], normals: [], uvs: [], indices: [] };
      this.cells.set(key, cell);
    }
    const box = VertexData.CreateBox({ width, height, depth, faceUV });
    const offset = cell.positions.length / 3;
    const p = box.positions!;
    for (let i = 0; i < p.length; i += 3) cell.positions.push(p[i]! + x, p[i + 1]! + y, p[i + 2]! + z);
    for (const value of box.normals!) cell.normals.push(value);
    for (const value of box.uvs!) cell.uvs.push(value);
    for (const index of box.indices!) cell.indices.push(index + offset);
  }

  build(scene: Scene, name: string): Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const ranges: Array<{ start: number; count: number }> = [];

    for (const cell of this.cells.values()) {
      const vertOffset = positions.length / 3;
      const start = indices.length;
      for (const value of cell.positions) positions.push(value);
      for (const value of cell.normals) normals.push(value);
      for (const value of cell.uvs) uvs.push(value);
      for (const index of cell.indices) indices.push(index + vertOffset);
      ranges.push({ start, count: cell.indices.length });
    }

    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    data.applyToMesh(mesh);

    // One 750 m AABB would draw every box in a chunk whenever a corner was on
    // screen. Per-block submeshes let the frustum drop the rest.
    if (ranges.length > 1) {
      mesh.releaseSubMeshes();
      for (const range of ranges) {
        SubMesh.CreateFromIndices(0, range.start, range.count, mesh);
      }
    }
    return mesh;
  }
}
