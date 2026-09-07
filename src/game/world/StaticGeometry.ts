import { Mesh, Scene, Vector4, VertexData } from "@babylonjs/core";

/** Assemble static box geometry directly, avoiding thousands of temporary scene nodes. */
export class StaticBoxBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  add(x: number, y: number, z: number, width: number, height: number, depth: number, faceUV?: Vector4[]): void {
    const box = VertexData.CreateBox({ width, height, depth, faceUV });
    const offset = this.positions.length / 3;
    const p = box.positions!;
    for (let i = 0; i < p.length; i += 3) this.positions.push(p[i]! + x, p[i + 1]! + y, p[i + 2]! + z);
    for (const value of box.normals!) this.normals.push(value);
    for (const value of box.uvs!) this.uvs.push(value);
    for (const index of box.indices!) this.indices.push(index + offset);
  }

  build(scene: Scene, name: string): Mesh {
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.normals = this.normals;
    data.uvs = this.uvs;
    data.indices = this.indices;
    data.applyToMesh(mesh);
    return mesh;
  }
}
