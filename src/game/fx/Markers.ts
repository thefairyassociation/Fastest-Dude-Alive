import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { createBeamSprite } from "../world/Textures";

/**
 * World-space waypoints.
 *
 * One pooled set of ring + light-column + spinning diamond groups serves
 * every activity and story objective, so nothing has to build its own
 * markers. Callers rebuild the list whenever their target set changes; the
 * pool only ever grows to the largest simultaneous count.
 */

export type MarkerStyle =
  | "objective"
  | "checkpoint"
  | "rescue"
  | "collectible"
  | "threat"
  | "relay"
  | "planned";

export interface MarkerEntry {
  /** Stable identity for Focus planning. */
  id?: string;
  /** Human-readable Speed Sense label. */
  label?: string;
  position: Vector3;
  style: MarkerStyle;
  /** Radius of the ground ring in metres. */
  radius?: number;
}

const STYLE_COLORS: Record<MarkerStyle, string> = {
  objective: "#f2a33c",
  checkpoint: "#f2a33c",
  rescue: "#6fd3a0",
  collectible: "#9fd4ff",
  threat: "#ff6a58",
  relay: "#68e1df",
  planned: "#fff08a",
};

interface MarkerNode {
  root: TransformNode;
  ring: Mesh;
  column: Mesh;
  diamond: Mesh;
  style: MarkerStyle;
}

/** Below this the light column is hidden — you are already standing in it. */
const COLUMN_NEAR = 34;
const COLUMN_FAR = 140;

export class Markers {
  private readonly pool: MarkerNode[] = [];
  private readonly materials = new Map<MarkerStyle, PBRMaterial>();
  private readonly columnMaterials = new Map<MarkerStyle, StandardMaterial>();
  private readonly beamSprite: ReturnType<typeof createBeamSprite>;
  private active = 0;
  private clock = 0;

  constructor(private readonly scene: Scene) {
    this.beamSprite = createBeamSprite(scene);

    for (const [style, hex] of Object.entries(STYLE_COLORS) as Array<[MarkerStyle, string]>) {
      const material = new PBRMaterial(`marker-${style}`, scene);
      material.albedoColor = Color3.Black();
      material.emissiveColor = Color3.FromHexString(hex).scale(2.4);
      material.roughness = 1;
      material.metallic = 0;
      material.alpha = 0.7;
      material.disableDepthWrite = true;
      material.backFaceCulling = false;
      this.materials.set(style, material);

      // The beam is an additive billboard, not geometry: a 60 m cylinder
      // paints the whole screen with its interior the moment you step inside.
      const column = new StandardMaterial(`marker-beam-${style}`, scene);
      column.diffuseTexture = this.beamSprite;
      column.emissiveTexture = this.beamSprite;
      column.emissiveColor = Color3.FromHexString(hex);
      column.diffuseColor = Color3.Black();
      column.specularColor = Color3.Black();
      column.useAlphaFromDiffuseTexture = true;
      column.disableLighting = true;
      column.disableDepthWrite = true;
      column.alphaMode = 1; // additive
      column.backFaceCulling = false;
      this.columnMaterials.set(style, column);
    }
  }

  /** Replaces the visible marker set. Cheap enough to call every frame. */
  set(entries: MarkerEntry[]): void {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      const node = this.nodeAt(i);
      node.root.position.copyFrom(entry.position);
      node.root.setEnabled(true);
      const radius = entry.radius ?? 8;
      node.ring.scaling.setAll(radius / 8);
      if (node.style !== entry.style) {
        const material = this.materials.get(entry.style) ?? null;
        node.ring.material = material;
        node.diamond.material = material;
        node.column.material = this.columnMaterials.get(entry.style) ?? null;
        node.style = entry.style;
      }
    }

    for (let i = entries.length; i < this.active; i += 1) {
      this.pool[i]?.root.setEnabled(false);
    }
    this.active = entries.length;
  }

  clear(): void {
    this.set([]);
  }

  update(dt: number, focus: Vector3): void {
    this.clock += dt;
    const bob = Math.sin(this.clock * 2.4) * 0.6;
    for (let i = 0; i < this.active; i += 1) {
      const node = this.pool[i];
      if (!node) continue;
      node.diamond.rotation.y += dt * 1.9;
      node.diamond.position.y = 5.2 + bob;
      node.ring.rotation.y += dt * 0.5;
      node.ring.scaling.x = node.ring.scaling.z = node.ring.scaling.y * (1 + Math.sin(this.clock * 4) * 0.03);

      // The column is a long-range wayfinding aid: it fades in with distance
      // and disappears entirely once you have arrived.
      const dx = node.root.position.x - focus.x;
      const dz = node.root.position.z - focus.z;
      const distance = Math.hypot(dx, dz);
      const near = distance < COLUMN_NEAR;
      if (node.column.isEnabled() === near) node.column.setEnabled(!near);
      if (!near) {
        const t = Math.min(1, (distance - COLUMN_NEAR) / (COLUMN_FAR - COLUMN_NEAR));
        node.column.visibility = 0.1 + t * 0.5;
      }
    }
  }

  private nodeAt(index: number): MarkerNode {
    const existing = this.pool[index];
    if (existing) return existing;

    const root = new TransformNode(`marker-${index}`, this.scene);
    const material = this.materials.get("objective") ?? null;

    const ring = MeshBuilder.CreateTorus(
      `marker-ring-${index}`,
      { diameter: 16, thickness: 0.35, tessellation: 40 },
      this.scene,
    );
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.4;
    ring.parent = root;
    ring.material = material;
    ring.isPickable = false;

    // A wide, soft beam so the marker is findable from street level.
    const column = MeshBuilder.CreatePlane(
      `marker-beam-${index}`,
      { width: 14, height: 70 },
      this.scene,
    );
    column.billboardMode = Mesh.BILLBOARDMODE_Y;
    column.position.y = 34;
    column.parent = root;
    column.material = this.columnMaterials.get("objective") ?? null;
    column.isPickable = false;
    column.visibility = 0.3;

    const diamond = MeshBuilder.CreatePolyhedron(
      `marker-diamond-${index}`,
      { type: 0, size: 1.1 },
      this.scene,
    );
    diamond.position.y = 5.2;
    diamond.parent = root;
    diamond.material = material;
    diamond.isPickable = false;

    const node: MarkerNode = { root, ring, column, diamond, style: "objective" };
    this.pool[index] = node;
    return node;
  }
}
