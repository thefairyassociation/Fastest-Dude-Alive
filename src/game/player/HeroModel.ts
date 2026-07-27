import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { clamp, damp, lerp } from "../core/Rng";

/**
 * The hero rig.
 *
 * Built from primitives, but built like a character: real human proportions
 * (1.86 m), a layered torso that tapers, jointed limbs with pads at the
 * hinges, boots with soles, and resonance lines that brighten as the runner
 * loads up. Everything hangs off named pivots so the animation code only ever
 * writes rotations — no mesh is ever moved directly.
 */

/** Joint heights in metres above the feet. */
const HIP_Y = 0.98;
const SPINE_Y = 1.03;
const THIGH = 0.46;
const SHIN = 0.44;
const SHOULDER_Y = 0.44;
const SHOULDER_X = 0.2;
const UPPER_ARM = 0.31;
const FOREARM = 0.29;

export interface PoseInput {
  dt: number;
  /** Metres per second. */
  speed: number;
  /** 0..1 against sprint top speed. */
  speedRatio: number;
  grounded: boolean;
  /** -1 wall on the left, 1 wall on the right, 0 none. */
  wallSide: number;
  /** True while running straight up a facade. */
  verticalRun: boolean;
  sliding: boolean;
  /** Seconds remaining on a strike animation, 0 when idle. */
  strike: number;
  /** Signed turn rate, for banking into corners. */
  turn: number;
}

export class HeroModel {
  readonly root: TransformNode;
  /** Single hull proxy for cascaded shadows; limbs stay out of the map. */
  readonly shadowCaster: Mesh;
  /** Low-poly merged silhouette, instanced for speed afterimages. */
  readonly ghostSource: Mesh;

  private readonly body: TransformNode;
  private readonly spine: TransformNode;
  private readonly head: TransformNode;
  private readonly shoulder: [TransformNode, TransformNode];
  private readonly elbow: [TransformNode, TransformNode];
  private readonly hip: [TransformNode, TransformNode];
  private readonly knee: [TransformNode, TransformNode];
  private readonly ankle: [TransformNode, TransformNode];
  private readonly resonance: PBRMaterial;
  private readonly visorMaterial: PBRMaterial;

  private stride = 0;
  private lifetime = 0;
  private roll = 0;
  private crouch = 0;
  private pitch = 0;

  constructor(scene: Scene) {
    this.root = new TransformNode("hero", scene);

    const suit = pbr(scene, "hero-suit", "#7d1f2b", 0.46, 0.06);
    const panel = pbr(scene, "hero-panel", "#23262a", 0.52, 0.12);
    const trim = pbr(scene, "hero-trim", "#b98f43", 0.28, 0.85);
    const skin = pbr(scene, "hero-skin", "#b9866a", 0.72, 0);
    const sole = pbr(scene, "hero-sole", "#15171a", 0.88, 0);

    this.visorMaterial = pbr(scene, "hero-visor", "#0d1116", 0.08, 0.35);
    this.visorMaterial.emissiveColor = new Color3(0.04, 0.07, 0.1);

    this.resonance = pbr(scene, "hero-resonance", "#1a1416", 0.4, 0.1);
    this.resonance.emissiveColor = new Color3(0.35, 0.2, 0.06);

    // Invisible upright hull for CSM. visibility 0 only casts because the
    // generator runs with transparencyShadow enabled — see Sky.ts.
    this.shadowCaster = MeshBuilder.CreateCapsule(
      "hero-shadow",
      { height: 1.8, radius: 0.3, tessellation: 6 },
      scene,
    );
    this.shadowCaster.parent = this.root;
    this.shadowCaster.position.y = 0.9;
    this.shadowCaster.isPickable = false;
    this.shadowCaster.visibility = 0;
    this.shadowCaster.receiveShadows = false;

    this.body = new TransformNode("hero-body", scene);
    this.body.parent = this.root;

    const attach = (mesh: Mesh, material: PBRMaterial, parent: TransformNode): Mesh => {
      mesh.material = material;
      mesh.parent = parent;
      mesh.isPickable = false;
      return mesh;
    };

    /* -------- pelvis and spine -------- */

    const pelvis = MeshBuilder.CreateCapsule(
      "hero-pelvis",
      { height: 0.3, radius: 0.16, tessellation: 12 },
      scene,
    );
    pelvis.position.y = HIP_Y + 0.02;
    pelvis.scaling.set(1.05, 1, 0.74);
    attach(pelvis, panel, this.body);

    this.spine = new TransformNode("hero-spine", scene);
    this.spine.parent = this.body;
    this.spine.position.y = SPINE_Y;

    const waist = MeshBuilder.CreateCapsule(
      "hero-waist",
      { height: 0.26, radius: 0.15, tessellation: 12 },
      scene,
    );
    waist.position.y = 0.08;
    waist.scaling.set(1.06, 1, 0.76);
    attach(waist, suit, this.spine);

    // A separate, wider chest volume is what gives the athletic V-taper that a
    // single capsule never reads as.
    const chest = MeshBuilder.CreateCapsule(
      "hero-chest",
      { height: 0.3, radius: 0.2, tessellation: 14 },
      scene,
    );
    chest.position.y = 0.31;
    chest.scaling.set(1.14, 1, 0.72);
    attach(chest, suit, this.spine);

    const lats = MeshBuilder.CreateBox("hero-lats", { width: 0.36, height: 0.2, depth: 0.2 }, scene);
    lats.position.set(0, 0.24, -0.03);
    attach(lats, panel, this.spine);

    // Chevron chest plate.
    for (const side of [-1, 1] as const) {
      const wing = MeshBuilder.CreateBox(
        `hero-chevron-${side}`,
        { width: 0.19, height: 0.055, depth: 0.045 },
        scene,
      );
      wing.position.set(side * 0.075, 0.36, 0.145);
      wing.rotation.z = side * 0.42;
      attach(wing, trim, this.spine);
    }

    const emblem = MeshBuilder.CreateCylinder(
      "hero-emblem",
      { height: 0.02, diameter: 0.1, tessellation: 18 },
      scene,
    );
    emblem.position.set(0, 0.3, 0.155);
    emblem.rotation.x = Math.PI * 0.5;
    attach(emblem, trim, this.spine);

    const belt = MeshBuilder.CreateCylinder(
      "hero-belt",
      { height: 0.05, diameter: 0.32, tessellation: 16 },
      scene,
    );
    belt.position.y = -0.03;
    belt.scaling.set(1.02, 1, 0.78);
    attach(belt, trim, this.spine);

    // Resonance line down the sternum.
    const sternum = MeshBuilder.CreateBox(
      "hero-sternum-line",
      { width: 0.022, height: 0.26, depth: 0.02 },
      scene,
    );
    sternum.position.set(0, 0.16, 0.152);
    attach(sternum, this.resonance, this.spine);

    /* -------- head -------- */

    const neck = MeshBuilder.CreateCylinder(
      "hero-neck",
      { height: 0.09, diameter: 0.11, tessellation: 10 },
      scene,
    );
    neck.position.y = 0.5;
    attach(neck, skin, this.spine);

    this.head = new TransformNode("hero-head", scene);
    this.head.parent = this.spine;
    this.head.position.y = 0.56;

    const cowl = MeshBuilder.CreateSphere("hero-cowl", { diameter: 0.235, segments: 14 }, scene);
    cowl.position.y = 0.055;
    cowl.scaling.set(0.94, 1.13, 1);
    attach(cowl, suit, this.head);

    const jaw = MeshBuilder.CreateSphere("hero-jaw", { diameter: 0.17, segments: 12 }, scene);
    jaw.position.set(0, -0.025, 0.055);
    jaw.scaling.set(0.9, 0.72, 0.9);
    attach(jaw, skin, this.head);

    // Wraparound visor: a front pane plus two swept side wings.
    const visor = MeshBuilder.CreateBox("hero-visor-pane", { width: 0.16, height: 0.05, depth: 0.035 }, scene);
    visor.position.set(0, 0.062, 0.1);
    attach(visor, this.visorMaterial, this.head);

    for (const side of [-1, 1] as const) {
      const wing = MeshBuilder.CreateBox(
        `hero-visor-wing-${side}`,
        { width: 0.07, height: 0.046, depth: 0.025 },
        scene,
      );
      wing.position.set(side * 0.088, 0.062, 0.068);
      wing.rotation.y = side * 0.7;
      attach(wing, this.visorMaterial, this.head);

      // Swept aero fins in place of ears.
      const fin = MeshBuilder.CreateBox(
        `hero-cowl-fin-${side}`,
        { width: 0.018, height: 0.05, depth: 0.12 },
        scene,
      );
      fin.position.set(side * 0.1, 0.105, -0.012);
      fin.rotation.x = -0.34;
      fin.rotation.z = side * 0.3;
      attach(fin, trim, this.head);
    }

    /* -------- arms -------- */

    const buildArm = (side: -1 | 1): [TransformNode, TransformNode] => {
      const label = side < 0 ? "l" : "r";
      const shoulder = new TransformNode(`hero-shoulder-${label}`, scene);
      shoulder.parent = this.spine;
      shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0);

      const deltoid = MeshBuilder.CreateSphere(`hero-deltoid-${label}`, { diameter: 0.17, segments: 12 }, scene);
      deltoid.scaling.set(1, 1.08, 1);
      attach(deltoid, suit, shoulder);

      const upperArm = MeshBuilder.CreateCapsule(
        `hero-upper-arm-${label}`,
        { height: UPPER_ARM, radius: 0.058, tessellation: 10 },
        scene,
      );
      upperArm.position.y = -UPPER_ARM * 0.5;
      attach(upperArm, suit, shoulder);

      const elbow = new TransformNode(`hero-elbow-${label}`, scene);
      elbow.parent = shoulder;
      elbow.position.y = -UPPER_ARM;

      const elbowPad = MeshBuilder.CreateSphere(`hero-elbow-pad-${label}`, { diameter: 0.098, segments: 10 }, scene);
      attach(elbowPad, panel, elbow);

      const forearm = MeshBuilder.CreateCapsule(
        `hero-forearm-${label}`,
        { height: FOREARM, radius: 0.05, tessellation: 10 },
        scene,
      );
      forearm.position.y = -FOREARM * 0.5;
      attach(forearm, panel, elbow);

      // Gauntlet resonance line.
      const line = MeshBuilder.CreateBox(`hero-arm-line-${label}`, { width: 0.016, height: 0.2, depth: 0.016 }, scene);
      line.position.set(side * 0.05, -FOREARM * 0.5, 0.02);
      attach(line, this.resonance, elbow);

      const gauntlet = MeshBuilder.CreateCylinder(
        `hero-gauntlet-${label}`,
        { height: 0.06, diameter: 0.115, tessellation: 12 },
        scene,
      );
      gauntlet.position.y = -FOREARM + 0.03;
      attach(gauntlet, trim, elbow);

      // Flattened fist rather than a ball.
      const hand = MeshBuilder.CreateSphere(`hero-hand-${label}`, { diameter: 0.095, segments: 10 }, scene);
      hand.position.y = -FOREARM - 0.05;
      hand.scaling.set(0.78, 1.1, 0.6);
      attach(hand, panel, elbow);

      return [shoulder, elbow];
    };

    const [shoulderL, elbowL] = buildArm(-1);
    const [shoulderR, elbowR] = buildArm(1);
    this.shoulder = [shoulderL, shoulderR];
    this.elbow = [elbowL, elbowR];

    /* -------- legs -------- */

    const buildLeg = (side: -1 | 1): [TransformNode, TransformNode, TransformNode] => {
      const label = side < 0 ? "l" : "r";
      const hip = new TransformNode(`hero-hip-${label}`, scene);
      hip.parent = this.body;
      hip.position.set(side * 0.09, HIP_Y, 0);

      const thigh = MeshBuilder.CreateCapsule(
        `hero-thigh-${label}`,
        { height: THIGH, radius: 0.083, tessellation: 10 },
        scene,
      );
      thigh.position.y = -THIGH * 0.5;
      thigh.scaling.set(1.08, 1, 1.02);
      attach(thigh, suit, hip);

      const knee = new TransformNode(`hero-knee-${label}`, scene);
      knee.parent = hip;
      knee.position.y = -THIGH;

      const kneePad = MeshBuilder.CreateSphere(`hero-knee-pad-${label}`, { diameter: 0.12, segments: 10 }, scene);
      kneePad.position.z = 0.018;
      kneePad.scaling.y = 1.12;
      attach(kneePad, panel, knee);

      const shin = MeshBuilder.CreateCapsule(
        `hero-shin-${label}`,
        { height: SHIN, radius: 0.066, tessellation: 10 },
        scene,
      );
      shin.position.y = -SHIN * 0.5;
      attach(shin, panel, knee);

      const line = MeshBuilder.CreateBox(`hero-shin-line-${label}`, { width: 0.016, height: 0.22, depth: 0.016 }, scene);
      line.position.set(0, -SHIN * 0.5, 0.062);
      attach(line, this.resonance, knee);

      const ankle = new TransformNode(`hero-ankle-${label}`, scene);
      ankle.parent = knee;
      ankle.position.y = -SHIN;

      const boot = MeshBuilder.CreateBox(`hero-boot-${label}`, { width: 0.105, height: 0.075, depth: 0.16 }, scene);
      boot.position.set(0, -0.012, 0.012);
      attach(boot, panel, ankle);

      const toe = MeshBuilder.CreateBox(`hero-toe-${label}`, { width: 0.1, height: 0.055, depth: 0.115 }, scene);
      toe.position.set(0, -0.028, 0.125);
      toe.rotation.x = 0.09;
      attach(toe, panel, ankle);

      const soleMesh = MeshBuilder.CreateBox(`hero-sole-${label}`, { width: 0.108, height: 0.026, depth: 0.26 }, scene);
      soleMesh.position.set(0, -0.052, 0.055);
      attach(soleMesh, sole, ankle);

      const cuff = MeshBuilder.CreateCylinder(
        `hero-cuff-${label}`,
        { height: 0.05, diameter: 0.15, tessellation: 12 },
        scene,
      );
      cuff.position.y = 0.045;
      attach(cuff, trim, ankle);

      return [hip, knee, ankle];
    };

    const [hipL, kneeL, ankleL] = buildLeg(-1);
    const [hipR, kneeR, ankleR] = buildLeg(1);
    this.hip = [hipL, hipR];
    this.knee = [kneeL, kneeR];
    this.ankle = [ankleL, ankleR];

    this.ghostSource = buildGhostSource(scene);
  }

  /** Brightens the resonance lines and visor as the runner loads up. */
  setCharge(speedRatio: number, focus: boolean): void {
    const heat = clamp(speedRatio, 0, 1);
    const r = 0.35 + heat * 1.9;
    const g = 0.2 + heat * 1.25;
    const b = 0.06 + heat * 0.5;
    if (focus) {
      this.resonance.emissiveColor.set(0.4 + heat, 0.75 + heat * 0.8, 1.5 + heat);
      this.visorMaterial.emissiveColor.set(0.1, 0.28, 0.5);
    } else {
      this.resonance.emissiveColor.set(r, g, b);
      this.visorMaterial.emissiveColor.set(0.04 + heat * 0.3, 0.07 + heat * 0.2, 0.1 + heat * 0.1);
    }
  }

  setEnabled(value: boolean): void {
    this.root.setEnabled(value);
  }

  /**
   * Procedural animation.
   *
   * A cadence-locked run cycle underneath, with additive state poses layered
   * on top: crouch for slides, body roll for wall runs, a forward pitch when
   * running vertically, and a thrown shoulder on strikes. Everything is
   * damped rather than snapped so transitions read as weight, not teleports.
   */
  pose(input: PoseInput): void {
    const { dt } = input;
    this.lifetime += dt;

    const pace = clamp(input.speed / 14, 0, 1);
    const cadence = Math.min(26, 3.2 + input.speed * 0.62);
    this.stride += dt * cadence * Math.max(pace, input.grounded ? 0.06 : 0.4);
    const p = this.stride;

    const swingL = Math.sin(p);
    const swingR = Math.sin(p + Math.PI);
    const breathe = Math.sin(this.lifetime * 2.1) * 0.02 * (1 - pace);

    // Targets for the layered state poses.
    const targetRoll = input.wallSide * 1.12;
    const targetCrouch = input.sliding ? 1 : 0;
    const targetPitch = input.verticalRun ? -1.32 : 0;
    this.roll = lerp(this.roll, targetRoll, damp(11, dt));
    this.crouch = lerp(this.crouch, targetCrouch, damp(14, dt));
    this.pitch = lerp(this.pitch, targetPitch, damp(9, dt));

    const lean = input.speedRatio * 0.5 + pace * 0.12;
    const airborne = !input.grounded && !input.verticalRun && input.wallSide === 0;

    /* -------- root body -------- */
    this.body.rotation.x = lean * 0.34 + this.pitch;
    this.body.rotation.z = this.roll + swingL * 0.03 * pace - clamp(input.turn, -1, 1) * 0.22;
    this.body.position.y =
      Math.sin(p * 2) * 0.022 * pace * (input.grounded ? 1 : 0) - this.crouch * 0.42;

    /* -------- spine and head -------- */
    this.spine.rotation.x = lean * 0.5 + breathe + this.crouch * 0.45;
    this.spine.rotation.y = swingL * 0.09 * pace;
    // The head stays level with the horizon whatever the body is doing.
    this.head.rotation.x = -(this.body.rotation.x + this.spine.rotation.x) * 0.72;
    this.head.rotation.z = -this.roll * 0.5;

    /* -------- legs -------- */
    if (this.crouch > 0.5) {
      // Slide: lead leg extended, trailing leg tucked under.
      this.setLeg(0, -0.95, 0.15, 0.3);
      this.setLeg(1, 0.35, 1.85, -0.1);
    } else if (airborne) {
      const tuck = 0.55 + Math.sin(this.lifetime * 6) * 0.1;
      this.setLeg(0, -0.5 - tuck * 0.3, tuck + 0.5, 0.1);
      this.setLeg(1, 0.42, 0.35, -0.15);
    } else {
      const legAmp = 0.34 + pace * 0.82;
      const kneeBase = 0.06 + pace * 0.16;
      const kneeSwing = 0.42 + pace * 1.3;
      this.setLeg(
        0,
        -swingL * legAmp,
        kneeBase + Math.max(0, Math.sin(p - 1.9)) * kneeSwing,
        0.06 + Math.max(0, -swingL) * (0.18 + pace * 0.5),
      );
      this.setLeg(
        1,
        -swingR * legAmp,
        kneeBase + Math.max(0, Math.sin(p + Math.PI - 1.9)) * kneeSwing,
        0.06 + Math.max(0, -swingR) * (0.18 + pace * 0.5),
      );
    }

    /* -------- arms -------- */
    const strike = clamp(input.strike / 0.22, 0, 1);
    const armAmp = 0.24 + pace * 0.66;
    const elbowBend = 0.24 + pace * 1.25;

    for (const side of [0, 1] as const) {
      const shoulder = this.shoulder[side];
      const elbow = this.elbow[side];
      const swing = side === 0 ? swingR : swingL;

      let pitchX = -swing * armAmp;
      let bend = -(elbowBend + Math.max(0, -swing) * 0.32);
      let outward = (side === 0 ? 1 : -1) * (0.12 + pace * 0.06);

      if (this.crouch > 0.5) {
        pitchX = side === 0 ? -1.1 : 0.5;
        bend = -0.4;
        outward = (side === 0 ? 1 : -1) * 0.5;
      } else if (airborne) {
        pitchX = side === 0 ? 0.7 : 0.5;
        bend = -0.9;
      }

      // Strikes throw the right shoulder straight through the target.
      if (side === 1 && strike > 0) {
        pitchX = lerp(pitchX, -2.05, strike);
        bend = lerp(bend, -0.12, strike);
      }

      shoulder.rotation.x = pitchX;
      shoulder.rotation.z = outward;
      elbow.rotation.x = bend;
    }
  }

  private setLeg(side: 0 | 1, hipX: number, kneeX: number, ankleX: number): void {
    const hip = this.hip[side];
    const knee = this.knee[side];
    const ankle = this.ankle[side];
    hip.rotation.x = hipX;
    knee.rotation.x = kneeX;
    ankle.rotation.x = ankleX;
  }
}

function pbr(scene: Scene, name: string, hex: string, roughness: number, metallic: number): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(hex);
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.9;
  return material;
}

/**
 * A cheap merged silhouette frozen in mid-stride. Afterimages instance this
 * instead of cloning the 40-node rig, which keeps the ghost trail free.
 */
function buildGhostSource(scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const torso = MeshBuilder.CreateCapsule("ghost-torso", { height: 0.62, radius: 0.17, tessellation: 8 }, scene);
  torso.position.set(0, 1.24, 0);
  torso.scaling.set(1.1, 1, 0.76);
  parts.push(torso);

  const head = MeshBuilder.CreateSphere("ghost-head", { diameter: 0.23, segments: 8 }, scene);
  head.position.set(0, 1.66, 0.02);
  parts.push(head);

  const legFront = MeshBuilder.CreateCapsule("ghost-leg-front", { height: 0.9, radius: 0.08, tessellation: 6 }, scene);
  legFront.position.set(-0.08, 0.6, 0.2);
  legFront.rotation.x = -0.6;
  parts.push(legFront);

  const legBack = MeshBuilder.CreateCapsule("ghost-leg-back", { height: 0.9, radius: 0.08, tessellation: 6 }, scene);
  legBack.position.set(0.08, 0.62, -0.22);
  legBack.rotation.x = 0.7;
  parts.push(legBack);

  const armFront = MeshBuilder.CreateCapsule("ghost-arm-front", { height: 0.6, radius: 0.055, tessellation: 6 }, scene);
  armFront.position.set(0.2, 1.28, 0.16);
  armFront.rotation.x = -0.8;
  parts.push(armFront);

  const armBack = MeshBuilder.CreateCapsule("ghost-arm-back", { height: 0.6, radius: 0.055, tessellation: 6 }, scene);
  armBack.position.set(-0.2, 1.3, -0.16);
  armBack.rotation.x = 0.7;
  parts.push(armBack);

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (!merged) throw new Error("Could not build the afterimage silhouette.");
  merged.name = "hero-ghost-source";
  merged.isPickable = false;
  merged.setEnabled(false);

  const material = new PBRMaterial("hero-ghost-material", scene);
  material.albedoColor = Color3.Black();
  material.emissiveColor = new Color3(0.9, 0.55, 0.22);
  material.roughness = 1;
  material.metallic = 0;
  material.alpha = 0.3;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  merged.material = material;
  return merged;
}

export function ghostMaterialOf(mesh: Mesh): PBRMaterial | null {
  return mesh.material instanceof PBRMaterial ? mesh.material : null;
}

/** Small helper so callers can place a ghost without importing Vector3 maths. */
export function placeGhost(ghost: Mesh, position: Vector3, yaw: number, roll: number): void {
  ghost.position.copyFrom(position);
  ghost.rotation.set(0, yaw, roll);
}
