import { Color3, Mesh, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";

const SAMPLES = 32;
const LIFETIME = 0.24;

interface Ribbon {
  anchor: TransformNode;
  mesh: Mesh;
  positions: Float32Array;
  colors: Float32Array;
  history: Vector3[];
  ages: Float32Array;
  count: number;
}

/** Four bounded ribbons follow the wrists/heels, including around corners.
 * Age-based fading is independent of frame rate. No render targets or shaders
 * are required, so the same geometry works on WebGL and WebGPU. */
export class SpeedTrails {
  private readonly ribbons: Ribbon[] = [];
  private readonly material: StandardMaterial;
  private readonly lastPosition = new Vector3();
  private hasPosition = false;

  constructor(scene: Scene, anchors: TransformNode[]) {
    this.material = new StandardMaterial("resonance-ribbon", scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = new Color3(1.8, 0.8, 0.25);
    this.material.diffuseColor = Color3.Black();
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.alphaMode = 1;
    for (const anchor of anchors) {
      const positions = new Float32Array(SAMPLES * 6);
      const colors = new Float32Array(SAMPLES * 8);
      const indices: number[] = [];
      for (let i = 0; i < SAMPLES - 1; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const mesh = new Mesh(`trail-${anchor.name}`, scene);
      const data = new VertexData();
      data.positions = positions; data.indices = indices; data.colors = colors;
      data.applyToMesh(mesh, true);
      mesh.material = this.material;
      mesh.hasVertexAlpha = true;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.ribbons.push({ anchor, mesh, positions, colors, history: Array.from({ length: SAMPLES }, () => new Vector3()), ages: new Float32Array(SAMPLES), count: 0 });
    }
  }

  reset(): void {
    this.hasPosition = false;
    for (const ribbon of this.ribbons) { ribbon.count = 0; ribbon.mesh.setEnabled(false); }
  }

  update(dt: number, position: Vector3, yaw: number, speed: number, focus: boolean, reduced: boolean): void {
    if (reduced || (this.hasPosition && Vector3.DistanceSquared(position, this.lastPosition) > 40 * 40)) this.reset();
    this.lastPosition.copyFrom(position);
    this.hasPosition = true;
    if (reduced) return;
    this.material.emissiveColor.set(focus ? 0.35 : 1.8, focus ? 1.3 : 0.8, focus ? 2 : 0.25);
    const emitting = speed > 0.16;
    for (const ribbon of this.ribbons) {
      for (let i = 0; i < ribbon.count; i++) ribbon.ages[i] = ribbon.ages[i]! + dt;
      while (ribbon.count > 0 && ribbon.ages[ribbon.count - 1]! >= LIFETIME) ribbon.count--;
      if (emitting) {
        ribbon.count = Math.min(SAMPLES, ribbon.count + 1);
        for (let i = ribbon.count - 1; i > 0; i--) {
          ribbon.history[i]!.copyFrom(ribbon.history[i - 1]!);
          ribbon.ages[i] = ribbon.ages[i - 1]!;
        }
        ribbon.anchor.computeWorldMatrix(true);
        ribbon.history[0]!.copyFrom(ribbon.anchor.getAbsolutePosition());
        ribbon.ages[0] = 0;
      }
      ribbon.mesh.setEnabled(ribbon.count > 1);
      if (ribbon.count < 2) continue;
      for (let i = 0; i < SAMPLES; i++) {
        const sample = ribbon.history[Math.min(i, ribbon.count - 1)]!;
        const fade = i < ribbon.count ? Math.max(0, 1 - ribbon.ages[i]! / LIFETIME) : 0;
        const width = (0.025 + speed * 0.05) * fade;
        for (let side = 0; side < 2; side++) {
          const sign = side === 0 ? -1 : 1;
          const p = i * 6 + side * 3, c = i * 8 + side * 4;
          ribbon.positions[p] = sample.x + Math.cos(yaw) * width * sign;
          ribbon.positions[p + 1] = sample.y + width * sign * 0.3;
          ribbon.positions[p + 2] = sample.z - Math.sin(yaw) * width * sign;
          ribbon.colors[c] = 1; ribbon.colors[c + 1] = 1; ribbon.colors[c + 2] = 1;
          ribbon.colors[c + 3] = fade * fade * 0.7;
        }
      }
      ribbon.mesh.updateVerticesData(VertexBuffer.PositionKind, ribbon.positions, true);
      ribbon.mesh.updateVerticesData(VertexBuffer.ColorKind, ribbon.colors);
    }
  }
}
