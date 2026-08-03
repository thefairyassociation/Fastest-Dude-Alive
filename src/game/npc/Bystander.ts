import {
  Color3,
  MeshBuilder,
  PBRMaterial,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { pick, type Rng } from "../core/Rng";

/**
 * Ordinary people, at ordinary scale.
 *
 * Deliberately cheap: five primitives, one material per palette entry, and a
 * bob-and-wave animation. They exist so the city has stakes — a rescue target
 * is a person standing on a kerb, not a floating marker — and so 700 km/h has
 * something to be fast *relative to*.
 */

const COATS = ["#3d4a58", "#5c3a34", "#2f3b33", "#4a4258", "#6b5b3e", "#334a4a", "#5a2f38"];
const SKINS = ["#c79b7b", "#8a5c3f", "#e0bb96", "#6b4429", "#a87a56"];

export type BystanderMood = "idle" | "panic" | "cheer";

export class Bystander {
  readonly root: TransformNode;
  mood: BystanderMood = "idle";
  /** Set true once a rescue run has collected this one. */
  rescued = false;

  private readonly torso: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private clock: number;
  private readonly cadence: number;

  constructor(scene: Scene, rng: Rng, materials: BystanderMaterials) {
    this.root = new TransformNode("bystander", scene);
    this.clock = rng() * 10;
    this.cadence = 1.6 + rng() * 0.9;

    const coat = pick(rng, materials.coats);
    const skin = pick(rng, materials.skins);

    this.torso = new TransformNode("bystander-torso", scene);
    this.torso.parent = this.root;
    this.torso.position.y = 0.98;

    const body = MeshBuilder.CreateCapsule("bystander-body", { height: 0.56, radius: 0.16, tessellation: 8 }, scene);
    body.position.y = 0.16;
    body.scaling.set(1, 1, 0.72);
    body.material = coat;
    body.parent = this.torso;
    body.isPickable = false;

    const head = MeshBuilder.CreateSphere("bystander-head", { diameter: 0.21, segments: 8 }, scene);
    head.position.y = 0.53;
    head.scaling.set(0.94, 1.08, 1);
    head.material = skin;
    head.parent = this.torso;
    head.isPickable = false;

    const limb = (name: string, x: number, y: number, length: number, material: PBRMaterial, parent: TransformNode) => {
      const pivot = new TransformNode(name, scene);
      pivot.parent = parent;
      pivot.position.set(x, y, 0);
      const mesh = MeshBuilder.CreateCapsule(`${name}-mesh`, { height: length, radius: 0.052, tessellation: 6 }, scene);
      mesh.position.y = -length * 0.5;
      mesh.material = material;
      mesh.parent = pivot;
      mesh.isPickable = false;
      return pivot;
    };

    this.armL = limb("bystander-arm-l", -0.2, 0.4, 0.54, coat, this.torso);
    this.armR = limb("bystander-arm-r", 0.2, 0.4, 0.54, coat, this.torso);
    this.legL = limb("bystander-leg-l", -0.09, 0.98, 0.92, materials.trousers, this.root);
    this.legR = limb("bystander-leg-r", 0.09, 0.98, 0.92, materials.trousers, this.root);
  }

  place(position: Vector3, yaw: number): void {
    this.root.position.copyFrom(position);
    this.root.rotation.y = yaw;
  }

  setEnabled(value: boolean): void {
    this.root.setEnabled(value);
  }

  update(dt: number): void {
    this.clock += dt;
    const t = this.clock * this.cadence;

    if (this.mood === "panic") {
      // Arms up, weight shifting, head whipping around.
      this.armL.rotation.x = -2.5 + Math.sin(t * 6) * 0.3;
      this.armR.rotation.x = -2.5 + Math.cos(t * 6) * 0.3;
      this.torso.rotation.y = Math.sin(t * 3.4) * 0.5;
      this.torso.position.y = 0.98 + Math.abs(Math.sin(t * 5)) * 0.05;
      this.legL.rotation.x = Math.sin(t * 5) * 0.3;
      this.legR.rotation.x = -Math.sin(t * 5) * 0.3;
    } else if (this.mood === "cheer") {
      this.armL.rotation.x = -2.8;
      this.armR.rotation.x = -2.8;
      this.armL.rotation.z = Math.sin(t * 5) * 0.4;
      this.armR.rotation.z = -Math.sin(t * 5) * 0.4;
      this.torso.position.y = 0.98 + Math.abs(Math.sin(t * 4)) * 0.09;
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
    } else {
      const sway = Math.sin(t) * 0.12;
      this.armL.rotation.x = sway;
      this.armR.rotation.x = -sway;
      this.armL.rotation.z = 0.08;
      this.armR.rotation.z = -0.08;
      this.torso.rotation.y = Math.sin(t * 0.4) * 0.18;
      this.torso.position.y = 0.98 + Math.sin(t * 2) * 0.012;
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
    }
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}

export interface BystanderMaterials {
  coats: PBRMaterial[];
  skins: PBRMaterial[];
  trousers: PBRMaterial;
}

export function createBystanderMaterials(scene: Scene): BystanderMaterials {
  const make = (name: string, hex: string, roughness: number): PBRMaterial => {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = Color3.FromHexString(hex);
    material.roughness = roughness;
    material.metallic = 0;
    material.environmentIntensity = 0.85;
    material.freeze();
    return material;
  };

  return {
    coats: COATS.map((hex, index) => make(`bystander-coat-${index}`, hex, 0.85)),
    skins: SKINS.map((hex, index) => make(`bystander-skin-${index}`, hex, 0.72)),
    trousers: make("bystander-trousers", "#2b2f36", 0.9),
  };
}
