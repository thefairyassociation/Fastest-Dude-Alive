import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  TransformNode,
  Vector3,
  VertexData,
  DynamicTexture,
} from "@babylonjs/core";
import { clamp, damp, lerp } from "../core/Rng";

/**
 * The hero rig.
 *
 * Authored elliptical body sections create an athletic 1.81 m silhouette,
 * with ceramic suit plates, a continuous curved visor and fabric underlayers.
 * Resonance inlays trace the scapulae, spine, wrists and calves at speed. Everything hangs off named pivots so the animation code only ever
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
  /** Parent of the actual animated shadow casters. */
  readonly shadowCaster: Mesh;
  /** Low-poly merged silhouette, instanced for speed afterimages. */
  readonly ghostSource: Mesh;
  readonly trailAnchors: TransformNode[];

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
  private poseBlend = 1;

  constructor(scene: Scene) {
    this.root = new TransformNode("hero", scene);

    // Garnet ceramic over a graphite compression suit. Pale shoulder armour
    // and the split amber spine remain legible from the chase camera.
    const suit = pbr(scene, "hero-suit", "#9b243d", 0.38, 0.24);
    suit.clearCoat.isEnabled = true;
    suit.clearCoat.intensity = 0.35;
    suit.clearCoat.roughness = 0.28;
    const panel = pbr(scene, "hero-panel", "#18242e", 0.78, 0.05);
    panel.bumpTexture = createSuitWeave(scene);
    const armour = pbr(scene, "hero-armour", "#d8dbd3", 0.3, 0.38);
    const trim = pbr(scene, "hero-trim", "#b79761", 0.28, 0.78);
    const sole = pbr(scene, "hero-sole", "#10151d", 0.88, 0);
    this.visorMaterial = pbr(scene, "hero-visor", "#111e2d", 0.12, 0.7);
    this.visorMaterial.clearCoat.isEnabled = true;
    this.visorMaterial.clearCoat.intensity = 1;
    this.resonance = pbr(scene, "hero-resonance", "#29161c", 0.32, 0.25);
    this.setCharge(0, false);

    // Register the actual animated mesh descendants for shadows. An empty
    // parent mesh replaces the upright capsule proxy, including on walls.
    this.shadowCaster = new Mesh("hero-shadow-root", scene);
    this.shadowCaster.parent = this.root;
    this.body = this.shadowCaster;
    const attach = (mesh: Mesh, material: PBRMaterial, parent: TransformNode): Mesh => {
      mesh.material = material;
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      return mesh;
    };
    const form = (name: string, rings: BodyRing[], material: PBRMaterial, parent: TransformNode): Mesh =>
      attach(sculpt(name, rings, scene), material, parent);
    const oval = (name: string, size: Vector3, at: Vector3, material: PBRMaterial, parent: TransformNode): Mesh => {
      const mesh = MeshBuilder.CreateSphere(name, { diameter: 2, segments: 16 }, scene);
      mesh.scaling.copyFrom(size);
      mesh.position.copyFrom(at);
      return attach(mesh, material, parent);
    };
    const seam = (name: string, points: number[][], radius: number, material: PBRMaterial, parent: TransformNode): Mesh =>
      attach(MeshBuilder.CreateTube(name, {
        path: points.map(([x = 0, y = 0, z = 0]) => new Vector3(x, y, z)),
        radius, tessellation: 6, cap: Mesh.CAP_ALL,
      }, scene), material, parent);

    form("hero-pelvis", [
      [0.85, 0.1, 0.09], [0.91, 0.155, 0.12], [1.01, 0.155, 0.11], [1.06, 0.135, 0.1],
    ], panel, this.body);
    this.spine = new TransformNode("hero-spine", scene);
    this.spine.parent = this.body;
    this.spine.position.y = SPINE_Y;
    form("hero-anatomical-torso", [
      [-0.04, 0.133, 0.102], [0.06, 0.14, 0.11], [0.17, 0.158, 0.12],
      [0.29, 0.198, 0.139], [0.39, 0.212, 0.132], [0.45, 0.175, 0.107],
      [0.51, 0.075, 0.071],
    ], panel, this.spine);

    for (const side of [-1, 1] as const) {
      // Pectoral and scapular plates have rounded edges and wrap the torso,
      // rather than intersecting cylinders across the chest.
      const chest = oval(`hero-pectoral-${side}`, new Vector3(0.108, 0.105, 0.035),
        new Vector3(side * 0.097, 0.345, 0.112), suit, this.spine);
      chest.rotation.z = side * 0.15;
      const back = oval(`hero-scapula-${side}`, new Vector3(0.105, 0.12, 0.035),
        new Vector3(side * 0.098, 0.335, -0.115), suit, this.spine);
      back.rotation.z = -side * 0.22;
      seam(`hero-back-chevron-${side}`, [
        [side * 0.19, 0.405, -0.1], [side * 0.105, 0.355, -0.151],
        [side * 0.025, 0.275, -0.14], [side * 0.025, 0.05, -0.115],
      ], 0.012, this.resonance, this.spine);
      seam(`hero-chest-seam-${side}`, [
        [side * 0.17, 0.43, 0.105], [side * 0.08, 0.38, 0.151], [0, 0.285, 0.155],
      ], 0.009, trim, this.spine);
      seam(`hero-flank-${side}`, [
        [side * 0.175, 0.27, 0.03], [side * 0.155, 0.17, 0.035], [side * 0.14, 0.045, 0.045],
      ], 0.022, suit, this.spine);
    }
    for (let i = 0; i < 3; i++) {
      oval(`hero-abdominal-${i}`, new Vector3(0.106 - i * 0.009, 0.037, 0.018),
        new Vector3(0, 0.21 - i * 0.073, 0.118 - i * 0.006), suit, this.spine);
      oval(`hero-spine-plate-${i}`, new Vector3(0.036, 0.034, 0.018),
        new Vector3(0, 0.22 - i * 0.07, -0.123), armour, this.spine);
    }
    const core = MeshBuilder.CreateTorus("hero-resonance-core", { diameter: 0.084, thickness: 0.015, tessellation: 24 }, scene);
    core.rotation.x = Math.PI / 2;
    core.position.set(0, 0.315, 0.154);
    attach(core, this.resonance, this.spine);
    form("hero-waist-seal", [[-0.045, 0.138, 0.108], [-0.01, 0.14, 0.111], [0.005, 0.136, 0.106]], trim, this.spine);
    form("hero-collar", [[0.48, 0.071, 0.067], [0.545, 0.063, 0.063]], panel, this.spine);

    this.head = new TransformNode("hero-head", scene);
    this.head.parent = this.spine;
    this.head.position.y = 0.56;
    form("hero-sculpted-helmet", [
      [-0.048, 0.058, 0.063, 0.025], [-0.015, 0.083, 0.088, 0.012],
      [0.05, 0.11, 0.113], [0.12, 0.106, 0.108, -0.009],
      [0.19, 0.079, 0.08, -0.015], [0.216, 0.018, 0.022, -0.015],
    ], suit, this.head);
    // One continuous curved visor, conforming to the helmet's face.
    const visorPath: Vector3[][] = [];
    for (const y of [0.026, 0.075, 0.105]) {
      const row: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const angle = -1.28 + i / 16 * 2.56;
        row.push(new Vector3(Math.sin(angle) * 0.113, y, Math.cos(angle) * 0.118 + 0.004));
      }
      visorPath.push(row);
    }
    attach(MeshBuilder.CreateRibbon("hero-wraparound-visor", { pathArray: visorPath, sideOrientation: Mesh.DOUBLESIDE }, scene), this.visorMaterial, this.head);
    for (const side of [-1, 1] as const) {
      oval(`hero-temple-${side}`, new Vector3(0.017, 0.04, 0.065),
        new Vector3(side * 0.103, 0.067, -0.008), trim, this.head);
      seam(`hero-temple-light-${side}`, [[side * 0.12, 0.072, 0.028], [side * 0.12, 0.084, -0.055]],
        0.007, this.resonance, this.head);
    }
    seam("hero-helmet-crown", [[0, 0.193, 0.055], [0, 0.221, -0.01], [0, 0.19, -0.083], [0, 0.09, -0.116]],
      0.008, trim, this.head);
    oval("hero-chin-guard", new Vector3(0.066, 0.03, 0.018), new Vector3(0, -0.014, 0.095), panel, this.head);

    const buildArm = (side: -1 | 1): [TransformNode, TransformNode] => {
      const shoulder = new TransformNode(`hero-shoulder-${side}`, scene);
      shoulder.parent = this.spine;
      shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
      oval(`hero-deltoid-${side}`, new Vector3(0.095, 0.096, 0.095), new Vector3(side * 0.016, -0.022, 0), suit, shoulder);
      oval(`hero-shoulder-shell-${side}`, new Vector3(0.075, 0.042, 0.091), new Vector3(side * 0.035, 0.039, 0), armour, shoulder);
      form(`hero-upper-arm-${side}`, [[-0.02, 0.073, 0.075], [-0.12, 0.072, 0.079], [-0.23, 0.054, 0.06], [-UPPER_ARM, 0.043, 0.044]], suit, shoulder);
      const elbow = new TransformNode(`hero-elbow-${side}`, scene);
      elbow.parent = shoulder;
      elbow.position.y = -UPPER_ARM;
      oval(`hero-elbow-joint-${side}`, new Vector3(0.046, 0.05, 0.048), Vector3.Zero(), panel, elbow);
      form(`hero-forearm-${side}`, [[0, 0.045, 0.045], [-0.065, 0.067, 0.068], [-0.16, 0.053, 0.058], [-FOREARM, 0.034, 0.038]], panel, elbow);
      oval(`hero-gauntlet-shell-${side}`, new Vector3(0.034, 0.094, 0.026), new Vector3(side * 0.04, -0.135, -0.017), suit, elbow);
      seam(`hero-gauntlet-light-${side}`, [[side * 0.064, -0.07, -0.024], [side * 0.052, -0.17, -0.027], [side * 0.038, -0.25, -0.02]], 0.009, this.resonance, elbow);
      form(`hero-wrist-seal-${side}`, [[-0.255, 0.039, 0.042], [-0.285, 0.037, 0.04]], trim, elbow);
      oval(`hero-glove-${side}`, new Vector3(0.044, 0.065, 0.033), new Vector3(0, -FOREARM - 0.045, 0.014), panel, elbow);
      oval(`hero-thumb-${side}`, new Vector3(0.022, 0.033, 0.026), new Vector3(-side * 0.035, -FOREARM - 0.015, 0.037), suit, elbow);
      oval(`hero-knuckles-${side}`, new Vector3(0.038, 0.025, 0.012), new Vector3(0, -FOREARM - 0.069, 0.043), armour, elbow);
      return [shoulder, elbow];
    };
    const [shoulderL, elbowL] = buildArm(-1);
    const [shoulderR, elbowR] = buildArm(1);
    this.shoulder = [shoulderL, shoulderR];
    this.elbow = [elbowL, elbowR];

    const buildLeg = (side: -1 | 1): [TransformNode, TransformNode, TransformNode] => {
      const hip = new TransformNode(`hero-hip-${side}`, scene);
      hip.parent = this.body;
      hip.position.set(side * 0.091, HIP_Y, 0);
      form(`hero-thigh-${side}`, [[0.02, 0.086, 0.097], [-0.09, 0.1, 0.112], [-0.24, 0.079, 0.09], [-THIGH, 0.055, 0.058]], suit, hip);
      seam(`hero-thigh-inlay-${side}`, [[side * 0.087, -0.065, -0.045], [side * 0.083, -0.19, -0.04], [side * 0.055, -0.36, -0.018]], 0.013, trim, hip);
      const knee = new TransformNode(`hero-knee-${side}`, scene);
      knee.parent = hip;
      knee.position.y = -THIGH;
      oval(`hero-knee-joint-${side}`, new Vector3(0.056, 0.062, 0.06), Vector3.Zero(), panel, knee);
      oval(`hero-kneecap-${side}`, new Vector3(0.049, 0.061, 0.024), new Vector3(0, 0.002, 0.053), armour, knee);
      form(`hero-calf-${side}`, [[0, 0.053, 0.055], [-0.1, 0.079, 0.085, -0.018], [-0.21, 0.063, 0.07, -0.012], [-SHIN, 0.036, 0.04]], panel, knee);
      oval(`hero-shin-shell-${side}`, new Vector3(0.045, 0.125, 0.02), new Vector3(0, -0.19, 0.052), suit, knee);
      seam(`hero-calf-light-${side}`, [[side * 0.048, -0.05, -0.058], [side * 0.057, -0.14, -0.084], [side * 0.035, -0.32, -0.049]], 0.009, this.resonance, knee);
      const ankle = new TransformNode(`hero-ankle-${side}`, scene);
      ankle.parent = knee;
      ankle.position.y = -SHIN;
      form(`hero-boot-${side}`, [[-0.061, 0.057, 0.115, 0.049], [-0.025, 0.06, 0.113, 0.05], [0.015, 0.055, 0.092, 0.043], [0.09, 0.038, 0.045]], suit, ankle);
      form(`hero-outsole-${side}`, [[-0.078, 0.058, 0.117, 0.05], [-0.057, 0.06, 0.119, 0.05]], sole, ankle);
      seam(`hero-heel-light-${side}`, [[-0.04, -0.043, -0.059], [0, -0.043, -0.072], [0.04, -0.043, -0.059]], 0.009, this.resonance, ankle);
      return [hip, knee, ankle];
    };
    const [hipL, kneeL, ankleL] = buildLeg(-1);
    const [hipR, kneeR, ankleR] = buildLeg(1);
    this.hip = [hipL, hipR];
    this.knee = [kneeL, kneeR];
    this.ankle = [ankleL, ankleR];
    this.trailAnchors = [elbowL, elbowR, ankleL, ankleR].map((parent, i) => {
      const anchor = new TransformNode(`hero-trail-anchor-${i}`, scene);
      anchor.parent = parent;
      anchor.position.set(0, i < 2 ? -FOREARM : -0.04, i < 2 ? -0.02 : -0.07);
      return anchor;
    });
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

  /** Clear traversal offsets before the static/reduced-motion title portrait. */
  resetPose(): void {
    this.stride = 0;
    this.lifetime = 0;
    this.roll = 0;
    this.crouch = 0;
    this.pitch = 0;
    this.body.position.setAll(0);
    for (const joint of [this.body, this.spine, this.head, ...this.shoulder, ...this.elbow, ...this.hip, ...this.knee, ...this.ankle]) {
      joint.rotation.setAll(0);
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
    this.poseBlend = damp(30, dt);

    const pace = clamp(input.speed / 14, 0, 1);
    const cadence = lerp(7.5, 22, Math.sqrt(clamp(input.speed / 90, 0, 1)));
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
    this.body.rotation.x = lean * 0.55 + this.pitch;
    this.body.rotation.z = this.roll + swingL * 0.03 * pace - clamp(input.turn, -1, 1) * 0.22;
    this.body.position.y =
      Math.cos(p * 2) * 0.032 * pace * (input.grounded ? 1 : 0) - this.crouch * 0.42;

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
      const legAmp = pace * 1.1;
      const kneeBase = 0.025 + pace * 0.16;
      const kneeSwing = pace * 1.65;
      this.setLeg(
        0,
        -swingL * legAmp,
        kneeBase + Math.max(0, Math.sin(p - 1.9)) * kneeSwing,
        0.01 + Math.max(0, -swingL) * (0.18 + pace * 0.5),
      );
      this.setLeg(
        1,
        -swingR * legAmp,
        kneeBase + Math.max(0, Math.sin(p + Math.PI - 1.9)) * kneeSwing,
        0.01 + Math.max(0, -swingR) * (0.18 + pace * 0.5),
      );
    }

    /* -------- arms -------- */
    const strike = clamp(input.strike / 0.22, 0, 1);
    const armAmp = pace * 0.95;
    const elbowBend = 0.13 + pace * 1.35;

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

      shoulder.rotation.x = lerp(shoulder.rotation.x, pitchX, this.poseBlend);
      shoulder.rotation.z = lerp(shoulder.rotation.z, outward, this.poseBlend);
      elbow.rotation.x = lerp(elbow.rotation.x, bend, this.poseBlend);
    }
  }

  private setLeg(side: 0 | 1, hipX: number, kneeX: number, ankleX: number): void {
    const hip = this.hip[side];
    const knee = this.knee[side];
    const ankle = this.ankle[side];
    hip.rotation.x = lerp(hip.rotation.x, hipX, this.poseBlend);
    knee.rotation.x = lerp(knee.rotation.x, kneeX, this.poseBlend);
    ankle.rotation.x = lerp(ankle.rotation.x, ankleX, this.poseBlend);
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

/** Elliptical anatomical sections: y, half-width, half-depth, forward offset. */
type BodyRing = [number, number, number, number?];

function sculpt(name: string, input: BodyRing[], scene: Scene): Mesh {
  const rings = [...input].sort((a, b) => a[0] - b[0]);
  const positions: number[] = [], indices: number[] = [], normals: number[] = [], uvs: number[] = [];
  const segments = 24;
  // Smooth interpolation between authored sections avoids stacked-cone joints.
  const sections: BodyRing[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    for (let step = 0; step < 3; step++) {
      const t = step / 3, smooth = t * t * (3 - 2 * t);
      sections.push([lerp(a[0], b[0], t), lerp(a[1], b[1], smooth), lerp(a[2], b[2], smooth), lerp(a[3] ?? 0, b[3] ?? 0, smooth)]);
    }
  }
  sections.push(rings[rings.length - 1]!);
  for (let r = 0; r < sections.length; r++) {
    const [y, w, d, z = 0] = sections[r]!;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2;
      positions.push(Math.sin(angle) * w, y, Math.cos(angle) * d + z);
      uvs.push(i / segments, r / (sections.length - 1));
      if (r < sections.length - 1 && i < segments) {
        const a = r * (segments + 1) + i, b = a + segments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  for (const end of [0, sections.length - 1]) {
    const [y, , , z = 0] = sections[end]!;
    const center = positions.length / 3;
    positions.push(0, y, z); uvs.push(0.5, end === 0 ? 0 : 1);
    for (let i = 0; i < segments; i++) {
      const a = end * (segments + 1) + i;
      if (end === 0) indices.push(center, a, a + 1);
      else indices.push(center, a + 1, a);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

function createSuitWeave(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("hero-fabric-normal", 128, scene, true);
  const ctx = texture.getContext();
  ctx.fillStyle = "#8080ff"; ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 4) {
    for (let x = 0; x < 128; x += 4) {
      ctx.fillStyle = ((x + y) / 4) % 2 ? "#7985fc" : "#877bfc";
      ctx.fillRect(x, y, 3, 2);
    }
  }
  texture.update(); texture.gammaSpace = false;
  texture.uScale = 4; texture.vScale = 4; texture.level = 0.2;
  return texture;
}
