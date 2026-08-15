import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { clamp, damp } from "../core/Rng";

/**
 * Rogues.
 *
 * The prototype had pursuit drones patrolling the whole sandbox, which made
 * combat the thing you tripped over on your way somewhere. Rogues replace
 * them: named opponents who only exist inside an encounter you chose to
 * start, each with one idea about how to stop a person who runs at 700 km/h.
 */

export type RogueArchetype = "brawler" | "artillery" | "zoner" | "speedster";

export interface RogueDefinition {
  id: string;
  /** The name on the file. */
  name: string;
  /** What the lab team calls them. Teo names the rogues. */
  codename: string;
  archetype: RogueArchetype;
  health: number;
  /** Metres per second. */
  speed: number;
  damage: number;
  suit: string;
  accent: string;
  blurb: string;
  /** Shown once when the encounter starts. */
  taunt: string;
}

export const ROGUES: RogueDefinition[] = [
  {
    id: "kiln",
    name: "Roland Boyce",
    codename: "Kiln",
    archetype: "brawler",
    health: 26,
    speed: 34,
    damage: 11,
    suit: "#5c2a1e",
    accent: "#ff7a2f",
    blurb: "Ran the smelting floor at Kestrel until the breach cooked it. Now he is the floor.",
    taunt: "Stand still. You will anyway, eventually.",
  },
  {
    id: "gale",
    name: "Margo Sable",
    codename: "Gale",
    archetype: "artillery",
    health: 22,
    speed: 26,
    damage: 9,
    suit: "#243a52",
    accent: "#8fd0ff",
    blurb: "Atmospheric researcher. Filed eleven warnings about the ring. Nobody read past the first.",
    taunt: "I told them what pressure does. Now I get to show you.",
  },
  {
    id: "coldsnap",
    name: "Cassian Vok",
    codename: "Coldsnap",
    archetype: "zoner",
    health: 30,
    speed: 20,
    damage: 8,
    suit: "#2b3a44",
    accent: "#bfe6f2",
    blurb: "A thief who worked out that you do not have to catch a speedster, only slow one.",
    taunt: "Everyone's fast until the air gets thick.",
  },
  {
    id: "ricochet",
    name: "Dara Whitlow",
    codename: "Ricochet",
    archetype: "artillery",
    health: 20,
    speed: 30,
    damage: 8,
    suit: "#3d3524",
    accent: "#f0c341",
    blurb: "Throws things that come back. Including, eventually, every favour she is owed.",
    taunt: "Catch. No — the other one.",
  },
  {
    id: "hollow",
    name: "Unidentified",
    codename: "Hollow",
    archetype: "zoner",
    health: 24,
    speed: 24,
    damage: 10,
    suit: "#2a2630",
    accent: "#b39ae0",
    blurb: "Phases out of the visible band. Halcyon's file on them is four lines and a question mark.",
    taunt: "You will hit exactly where I am not.",
  },
  {
    id: "vantage",
    name: "Unknown",
    codename: "Vantage",
    archetype: "speedster",
    health: 46,
    speed: 205,
    damage: 15,
    suit: "#d8d2c4",
    accent: "#f5c542",
    blurb: "Moves in negative resonance. Everything about him arrives before he does.",
    taunt: "You have had this speed for a year. I have had it far longer.",
  },
  {
    id: "anchor",
    name: "Ivo Marrow",
    codename: "Anchor",
    archetype: "zoner",
    health: 38,
    speed: 18,
    damage: 9,
    suit: "#3a3228",
    accent: "#c4a574",
    blurb:
      "Does not chase. Plants dead-zones that kill wall runs, water runs and top speed — a boss that rewrites the map instead of growing a health bar.",
    taunt: "Keep the walls. Keep the river. You will not need either.",
  },
];

export function rogueById(id: string): RogueDefinition {
  const found = ROGUES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown rogue "${id}".`);
  return found;
}

type Phase = "approach" | "telegraph" | "strike" | "recover" | "stagger" | "down";

/** How close to the marked landing point a ranged shot still hurts. */
const BLAST_RADIUS = 11;

export interface RogueOutcome {
  /** Damage to apply to the player this step. */
  damage: number;
  /** True on the frame the rogue is defeated. */
  defeated: boolean;
  /** Fires once when a wind-up starts, for audio and a HUD tell. */
  telegraph: boolean;
  /** Fires when a ranged attack launches; carries the impact point. */
  projectile: Vector3 | null;
  /** True while the rogue is open to being hit. */
  vulnerable: boolean;
}

export class Rogue {
  readonly root: TransformNode;
  readonly shadowCaster: Mesh;
  readonly definition: RogueDefinition;
  readonly maxHealth: number;

  health: number;
  alive = true;
  /**
   * Set for encounters the player is meant to survive rather than win.
   * A phantom takes no damage, which is a deliberate design statement:
   * chapter nine is about lasting ninety seconds, not landing a hit.
   */
  phantom = false;
  /**
   * Slow / denial fields the zoner archetype leaves behind.
   * Anchor's fields also strip wall, vertical and water running.
   */
  readonly fields: Array<{
    position: Vector3;
    radius: number;
    life: number;
    denyTraversal?: boolean;
    speedCap?: number;
  }> = [];

  private phase: Phase = "approach";
  private phaseTimer = 0;
  private readonly velocity = Vector3.Zero();
  private readonly outcome: RogueOutcome = {
    damage: 0,
    defeated: false,
    telegraph: false,
    projectile: null,
    vulnerable: true,
  };
  private readonly landing = new Vector3();
  /** Set when a ranged wind-up resolves; cleared once the blast is applied. */
  private blastPending = false;
  private stride = 0;
  private lifetime = Math.random() * 6;

  private readonly torso: TransformNode;
  private readonly hip: [TransformNode, TransformNode];
  private readonly shoulder: [TransformNode, TransformNode];
  private readonly aura: Mesh;
  private readonly auraMaterial: PBRMaterial;

  constructor(scene: Scene, definition: RogueDefinition, spawn: Vector3) {
    this.definition = definition;
    this.maxHealth = definition.health;
    this.health = definition.health;

    this.root = new TransformNode(`rogue-${definition.id}`, scene);
    this.root.position.copyFrom(spawn);

    const suit = solid(scene, `rogue-suit-${definition.id}`, definition.suit, 0.55, 0.08);
    const accent = solid(scene, `rogue-accent-${definition.id}`, definition.accent, 0.3, 0.5);
    const dark = solid(scene, `rogue-dark-${definition.id}`, "#1b1d21", 0.7, 0.05);

    this.shadowCaster = MeshBuilder.CreateCapsule(
      `rogue-shadow-${definition.id}`,
      { height: 1.85, radius: 0.34, tessellation: 6 },
      scene,
    );
    this.shadowCaster.parent = this.root;
    this.shadowCaster.position.y = 0.93;
    this.shadowCaster.visibility = 0;
    this.shadowCaster.isPickable = false;

    this.torso = new TransformNode(`rogue-torso-${definition.id}`, scene);
    this.torso.parent = this.root;
    this.torso.position.y = 1.02;

    const attach = (mesh: Mesh, material: PBRMaterial, parent: TransformNode): Mesh => {
      mesh.material = material;
      mesh.parent = parent;
      mesh.isPickable = false;
      return mesh;
    };

    const chest = MeshBuilder.CreateCapsule(`rogue-chest-${definition.id}`, { height: 0.44, radius: 0.2, tessellation: 12 }, scene);
    chest.position.y = 0.22;
    chest.scaling.set(1.12, 1, 0.78);
    attach(chest, suit, this.torso);

    const collar = MeshBuilder.CreateCylinder(`rogue-collar-${definition.id}`, { height: 0.08, diameter: 0.36, tessellation: 14 }, scene);
    collar.position.y = 0.45;
    attach(collar, accent, this.torso);

    const head = MeshBuilder.CreateSphere(`rogue-head-${definition.id}`, { diameter: 0.23, segments: 12 }, scene);
    head.position.y = 0.6;
    head.scaling.set(0.95, 1.1, 1);
    attach(head, dark, this.torso);

    // A silhouette accessory per archetype — readable at a glance from range.
    if (definition.archetype === "brawler") {
      for (const side of [-1, 1] as const) {
        const pauldron = MeshBuilder.CreateSphere(`rogue-pauldron-${definition.id}-${side}`, { diameter: 0.3, segments: 10 }, scene);
        pauldron.position.set(side * 0.26, 0.4, 0);
        pauldron.scaling.set(1, 0.7, 1);
        attach(pauldron, accent, this.torso);
      }
    } else if (definition.archetype === "artillery") {
      const pack = MeshBuilder.CreateBox(`rogue-pack-${definition.id}`, { width: 0.34, height: 0.36, depth: 0.16 }, scene);
      pack.position.set(0, 0.3, -0.2);
      attach(pack, accent, this.torso);
    } else if (definition.archetype === "zoner") {
      const coat = MeshBuilder.CreateCylinder(`rogue-coat-${definition.id}`, { height: 0.75, diameterTop: 0.42, diameterBottom: 0.62, tessellation: 14 }, scene);
      coat.position.y = -0.1;
      attach(coat, accent, this.torso);
    } else {
      const cowl = MeshBuilder.CreateSphere(`rogue-cowl-${definition.id}`, { diameter: 0.26, segments: 12 }, scene);
      cowl.position.y = 0.6;
      cowl.scaling.set(0.96, 1.12, 1);
      attach(cowl, accent, this.torso);
    }

    const buildLimb = (
      name: string,
      parent: TransformNode,
      offset: Vector3,
      length: number,
      radius: number,
      material: PBRMaterial,
    ): TransformNode => {
      const pivot = new TransformNode(name, scene);
      pivot.parent = parent;
      pivot.position.copyFrom(offset);
      const limb = MeshBuilder.CreateCapsule(`${name}-mesh`, { height: length, radius, tessellation: 8 }, scene);
      limb.position.y = -length * 0.5;
      attach(limb, material, pivot);
      return pivot;
    };

    this.shoulder = [
      buildLimb(`rogue-arm-l-${definition.id}`, this.torso, new Vector3(-0.24, 0.38, 0), 0.6, 0.06, suit),
      buildLimb(`rogue-arm-r-${definition.id}`, this.torso, new Vector3(0.24, 0.38, 0), 0.6, 0.06, suit),
    ];
    this.hip = [
      buildLimb(`rogue-leg-l-${definition.id}`, this.root, new Vector3(-0.1, 1.0, 0), 0.94, 0.08, dark),
      buildLimb(`rogue-leg-r-${definition.id}`, this.root, new Vector3(0.1, 1.0, 0), 0.94, 0.08, dark),
    ];

    // Telegraph aura: the only thing that tells you a hit is coming.
    this.auraMaterial = new PBRMaterial(`rogue-aura-${definition.id}`, scene);
    this.auraMaterial.albedoColor = Color3.Black();
    this.auraMaterial.emissiveColor = Color3.FromHexString(definition.accent).scale(2.6);
    this.auraMaterial.roughness = 1;
    this.auraMaterial.metallic = 0;
    this.auraMaterial.alpha = 0.5;
    this.auraMaterial.disableDepthWrite = true;
    this.aura = MeshBuilder.CreateTorus(`rogue-aura-mesh-${definition.id}`, { diameter: 3.2, thickness: 0.12, tessellation: 32 }, scene);
    this.aura.rotation.x = Math.PI * 0.5;
    this.aura.position.y = 0.15;
    this.aura.parent = this.root;
    this.aura.material = this.auraMaterial;
    this.aura.isPickable = false;
    this.aura.setEnabled(false);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get healthRatio(): number {
    return clamp(this.health / this.maxHealth, 0, 1);
  }

  /** True while the rogue can be damaged — the window the player plays for. */
  get vulnerable(): boolean {
    if (!this.alive || this.phantom) return false;
    // Speedsters are only open on the back swing; everyone else is fair game.
    if (this.definition.archetype !== "speedster") return true;
    return this.phase === "recover" || this.phase === "stagger";
  }

  update(dt: number, playerPosition: Vector3, groundY: number): RogueOutcome {
    const out = this.outcome;
    out.damage = 0;
    out.defeated = false;
    out.telegraph = false;
    out.projectile = null;
    out.vulnerable = this.vulnerable;

    if (!this.alive) return out;

    this.lifetime += dt;
    this.phaseTimer -= dt;

    for (let i = this.fields.length - 1; i >= 0; i -= 1) {
      const field = this.fields[i];
      if (!field) continue;
      field.life -= dt;
      if (field.life <= 0) this.fields.splice(i, 1);
    }

    const toPlayer = playerPosition.subtract(this.root.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const direction = distance > 0.01 ? toPlayer.scale(1 / distance) : new Vector3(0, 0, 1);

    switch (this.phase) {
      case "approach":
        this.approach(dt, direction, distance);
        break;
      case "telegraph":
        if (this.phaseTimer <= 0) {
          this.phase = "strike";
          this.phaseTimer = this.definition.archetype === "brawler" ? 0.45 : 0.2;
          if (this.definition.archetype === "artillery" || this.definition.archetype === "zoner") {
            this.landing.copyFrom(playerPosition);
            this.blastPending = true;
            out.projectile = this.landing;
            if (this.definition.archetype === "zoner") {
              const isAnchor = this.definition.id === "anchor";
              this.fields.push({
                position: playerPosition.clone(),
                radius: isAnchor ? 22 : 16,
                life: isAnchor ? 9 : 6,
                denyTraversal: isAnchor,
                speedCap: isAnchor ? 58 : undefined,
              });
            }
          }
        }
        break;
      case "strike":
        this.strike(dt, direction, distance, playerPosition, out);
        break;
      case "recover":
        this.velocity.scaleInPlace(Math.exp(-4 * dt));
        if (this.phaseTimer <= 0) this.phase = "approach";
        break;
      case "stagger":
        this.velocity.scaleInPlace(Math.exp(-2.2 * dt));
        if (this.phaseTimer <= 0) this.phase = "approach";
        break;
      case "down":
        break;
    }

    this.root.position.x += this.velocity.x * dt;
    this.root.position.z += this.velocity.z * dt;
    this.root.position.y = groundY;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.4) {
      this.root.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
    } else if (distance > 0.5) {
      this.root.rotation.y = Math.atan2(direction.x, direction.z);
    }

    this.animate(dt, speed);
    this.aura.setEnabled(this.phase === "telegraph");
    if (this.phase === "telegraph") {
      const pulse = 1 - clamp(this.phaseTimer / 0.6, 0, 1);
      this.aura.scaling.setAll(0.4 + pulse * 1.4);
      this.auraMaterial.alpha = 0.25 + pulse * 0.55;
    }

    return out;
  }

  private approach(dt: number, direction: Vector3, distance: number): void {
    const def = this.definition;
    let desiredX = 0;
    let desiredZ = 0;

    if (def.archetype === "brawler" || def.archetype === "speedster") {
      // Close, but orbit once inside reach so it never becomes a shove match.
      if (distance > 9) {
        desiredX = direction.x * def.speed;
        desiredZ = direction.z * def.speed;
      } else {
        desiredX = direction.z * def.speed * 0.6 - direction.x * 4;
        desiredZ = -direction.x * def.speed * 0.6 - direction.z * 4;
      }
    } else {
      // Ranged archetypes hold a band and back off if crowded.
      const band = def.archetype === "artillery" ? 48 : 26;
      const error = distance - band;
      desiredX = direction.x * clamp(error, -1, 1) * def.speed + direction.z * def.speed * 0.5;
      desiredZ = direction.z * clamp(error, -1, 1) * def.speed - direction.x * def.speed * 0.5;
    }

    const blend = damp(3.2, dt);
    this.velocity.x += (desiredX - this.velocity.x) * blend;
    this.velocity.z += (desiredZ - this.velocity.z) * blend;

    const reach = def.archetype === "brawler" ? 12 : def.archetype === "speedster" ? 16 : 70;
    if (distance < reach && this.phaseTimer <= 0) {
      this.phase = "telegraph";
      // Faster archetypes telegraph longer; that is the counterplay.
      this.phaseTimer = def.archetype === "speedster" ? 0.75 : 0.6;
      this.outcome.telegraph = true;
    }
  }

  private strike(
    dt: number,
    direction: Vector3,
    distance: number,
    playerPosition: Vector3,
    out: RogueOutcome,
  ): void {
    const def = this.definition;
    if (def.archetype === "brawler" || def.archetype === "speedster") {
      const lunge = def.archetype === "speedster" ? def.speed * 0.7 : def.speed * 2.2;
      this.velocity.x = direction.x * lunge;
      this.velocity.z = direction.z * lunge;
      if (distance < 4.2) {
        out.damage = def.damage;
        this.phase = "recover";
        this.phaseTimer = def.archetype === "speedster" ? 1.1 : 1.5;
      }
    } else {
      this.velocity.scaleInPlace(Math.exp(-5 * dt));
      // Ranged shots resolve once, at the point they were aimed at. Distance
      // to the thrower is not the question — these archetypes deliberately
      // hold 26-48 m away, so the old proximity check never fired at all.
      if (this.blastPending) {
        this.blastPending = false;
        if (Vector3.DistanceSquared(playerPosition, this.landing) < BLAST_RADIUS * BLAST_RADIUS) {
          out.damage = def.damage;
        }
      }
    }

    if (this.phaseTimer <= 0) {
      this.phase = "recover";
      this.phaseTimer = def.archetype === "artillery" ? 1.9 : 1.4;
    }
  }

  private animate(dt: number, speed: number): void {
    const pace = clamp(speed / 18, 0, 1);
    this.stride += dt * (3 + speed * 0.5);
    const swing = Math.sin(this.stride);

    this.torso.rotation.x = pace * 0.24 + (this.phase === "telegraph" ? -0.25 : 0);
    this.torso.position.y = 1.02 + Math.sin(this.stride * 2) * 0.03 * pace;

    const legAmp = 0.22 + pace * 0.6;
    const legL = this.hip[0];
    const legR = this.hip[1];
    legL.rotation.x = -swing * legAmp;
    legR.rotation.x = swing * legAmp;

    const armAmp = 0.2 + pace * 0.5;
    const armL = this.shoulder[0];
    const armR = this.shoulder[1];
    if (this.phase === "telegraph") {
      armL.rotation.x = -2.1;
      armR.rotation.x = -2.1;
    } else if (this.phase === "strike") {
      armL.rotation.x = -1.6;
      armR.rotation.x = -1.6;
    } else {
      armL.rotation.x = swing * armAmp;
      armR.rotation.x = -swing * armAmp;
    }
  }

  /** Returns true when this hit finished the rogue. */
  hit(damage: number, impulseX: number, impulseZ: number): boolean {
    if (!this.alive) return false;
    if (!this.vulnerable) return false;

    this.health -= damage;
    this.velocity.x += impulseX;
    this.velocity.z += impulseZ;
    this.phase = "stagger";
    this.phaseTimer = 0.42;

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.phase = "down";
      this.root.setEnabled(false);
      return true;
    }
    return false;
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.shadowCaster.dispose();
  }
}

function solid(scene: Scene, name: string, hex: string, roughness: number, metallic: number): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(hex);
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.9;
  return material;
}
