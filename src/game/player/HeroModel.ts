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
 * A continuous crimson suit follows monotone-cubic anatomical sections.
 * Flush surface panels and a fitted visor share those same body profiles,
 * so contrast comes from tailoring rather than floating primitive armour.
 * Everything hangs off named pivots; animation only writes joint rotations.
 */

/** Joint heights in metres above the feet. */
const HIP_Y = 0.98;
const SPINE_Y = 1.03;
const THIGH = 0.46;
const SHIN = 0.44;
const SHOULDER_Y = 0.44;
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

    // A continuous crimson running suit, with flush graphite stretch panels.
    // Geometry carries the anatomy; appliqued spheres must not stand in for it.
    const suit = pbr(scene, "hero-suit", "#821c2c", 0.59, 0.06);
    const panel = pbr(scene, "hero-panel", "#222831", 0.72, 0.02);
    const weave = createSuitWeave(scene);
    suit.bumpTexture = weave;
    panel.bumpTexture = weave;
    const trim = pbr(scene, "hero-trim", "#bc9152", 0.42, 0.58);
    const sole = pbr(scene, "hero-sole", "#12161c", 0.88, 0);
    this.visorMaterial = pbr(scene, "hero-visor", "#0b1722", 0.24, 0.25);
    this.visorMaterial.clearCoat.isEnabled = true;
    this.visorMaterial.clearCoat.intensity = 0.45;
    this.resonance = pbr(scene, "hero-resonance", "#251915", 0.42, 0.08);
    this.setCharge(0, false);

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
    const patch = (name: string, rings: BodyRing[], rows: PanelRow[], material: PBRMaterial, parent: TransformNode, lift = 0.0025): Mesh =>
      attach(surfacePanel(name, rings, rows, scene, lift), material, parent);
    const trace = (name: string, rings: BodyRing[], points: Array<[number, number]>, back: boolean, material: PBRMaterial, parent: TransformNode): Mesh => {
      const path: Vector3[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!, b = points[i + 1]!;
        for (let j = 0; j < 10; j++) {
          const t = j / 9;
          const x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t);
          const [, w, d, z = 0] = sampleProfile(rings, y);
          path.push(new Vector3(x, y, z + (back ? -1 : 1) * (d * Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) + 0.003)));
        }
      }
      return attach(MeshBuilder.CreateTube(name, { path, radius: 0.0035, tessellation: 6, cap: Mesh.CAP_ALL }, scene), material, parent);
    };
    const joint = (name: string, radius: number, parent: TransformNode): void => {
      // These sit inside the ends of sleeves; they only close a bent joint.
      attach(MeshBuilder.CreateSphere(name, { diameter: radius * 2, segments: 12 }, scene), suit, parent);
    };

    const pelvis: BodyRing[] = [
      [0.84, 0.09, 0.079], [0.9, 0.154, 0.105], [0.98, 0.162, 0.112], [1.07, 0.147, 0.111],
    ];
    form("hero-pelvis", pelvis, suit, this.body);
    // Thin waistband, not a metallic belt separating the torso from the hips.
    patch("hero-waist-seal", pelvis, [[1.017, Math.PI, Math.PI], [1.038, Math.PI, Math.PI]], panel, this.body);
    this.spine = new TransformNode("hero-spine", scene);
    this.spine.parent = this.body;
    this.spine.position.y = SPINE_Y;
    const torso: BodyRing[] = [
      [-0.045, 0.148, 0.111], [0.06, 0.145, 0.11], [0.17, 0.158, 0.117],
      [0.29, 0.187, 0.132], [0.375, 0.199, 0.13], [0.432, 0.19, 0.112],
      [0.478, 0.124, 0.088], [0.515, 0.065, 0.062],
    ];
    form("hero-anatomical-torso", torso, suit, this.spine);
    for (const side of [-1, 1] as const) {
      patch(`hero-flank-panel-${side}`, torso, [
        [-0.042, side * Math.PI / 2, 0.41], [0.065, side * Math.PI / 2, 0.39],
        [0.22, side * Math.PI / 2, 0.33], [0.37, side * Math.PI / 2, 0.18],
      ], panel, this.spine);
      // A single graphic line echoes the shoulders. Every point is evaluated
      // on the torso surface, so it cannot float like a necklace.
      trace(`hero-chest-seam-${side}`, torso, [[side * 0.143, 0.395], [side * 0.065, 0.358], [side * 0.017, 0.306]], false, trim, this.spine);
      trace(`hero-back-chevron-${side}`, torso, [[side * 0.148, 0.401], [side * 0.071, 0.365], [side * 0.026, 0.29], [side * 0.026, 0.065]], true, this.resonance, this.spine);
    }
    // Flat, split lozenge chest insignia. No oversized ring or stacked abs.
    patch("hero-resonance-core", torso, [[0.27, 0, 0.008], [0.31, 0, 0.105], [0.354, 0, 0.008]], this.resonance, this.spine);
    patch("hero-clavicle-panel", torso, [[0.448, 0, 1.05], [0.478, 0, 0.91], [0.51, 0, 0.65]], panel, this.spine);
    form("hero-collar", [[0.493, 0.066, 0.065], [0.536, 0.062, 0.06]], panel, this.spine);

    this.head = new TransformNode("hero-head", scene);
    this.head.parent = this.spine;
    this.head.position.y = 0.56;
    const helmet: BodyRing[] = [
      [-0.045, 0.052, 0.055, 0.015], [-0.017, 0.078, 0.079, 0.01],
      [0.052, 0.099, 0.103], [0.119, 0.098, 0.104, -0.007],
      [0.171, 0.076, 0.083, -0.012], [0.196, 0.043, 0.048, -0.014],
      [0.206, 0.002, 0.004, -0.014],
    ];
    form("hero-sculpted-helmet", helmet, suit, this.head);
    // The visor samples the helmet itself, including its changing width and
    // depth. The old constant-radius ribbon cut through the cowl at its edges.
    patch("hero-wraparound-visor", helmet, [[0.04, 0, 0.9], [0.066, 0, 1.32], [0.103, 0, 1.23]], this.visorMaterial, this.head);
    patch("hero-visor-bridge", helmet, [[0.04, 0, 0.075], [0.071, 0, 0.055], [0.09, 0, 0.008]], suit, this.head, 0.005);
    patch("hero-jaw-panel", helmet, [[-0.028, Math.PI, 1.3], [0.014, Math.PI, 1.04], [0.062, Math.PI, 0.82]], panel, this.head);
    for (const side of [-1, 1] as const) {
      patch(`hero-temple-${side}`, helmet, [[0.053, side * 1.48, 0.05], [0.076, side * 1.58, 0.2], [0.095, side * 1.74, 0.04]], trim, this.head);
      patch(`hero-temple-light-${side}`, helmet, [[0.09, side * 1.95, 0.03], [0.13, side * 2.05, 0.025]], this.resonance, this.head);
    }

    const buildArm = (side: -1 | 1): [TransformNode, TransformNode] => {
      const shoulder = new TransformNode(`hero-shoulder-${side}`, scene);
      shoulder.parent = this.spine;
      shoulder.position.set(side * 0.202, SHOULDER_Y - 0.015, 0);
      const upper: BodyRing[] = [
        [-UPPER_ARM - 0.016, 0.041, 0.046], [-0.235, 0.048, 0.052],
        [-0.135, 0.063, 0.067], [-0.045, 0.073, 0.076],
        [0.011, 0.061, 0.067], [0.046, 0.016, 0.026],
      ];
      form(`hero-upper-arm-${side}`, upper, suit, shoulder);
      patch(`hero-shoulder-panel-${side}`, upper, [[-0.15, side * Math.PI / 2, 0.42], [-0.055, side * Math.PI / 2, 0.57], [0.012, side * Math.PI / 2, 0.34]], panel, shoulder);
      patch(`hero-shoulder-inlay-${side}`, upper, [[-0.132, side * Math.PI / 2, 0.018], [-0.04, side * Math.PI / 2, 0.028]], trim, shoulder);
      const elbow = new TransformNode(`hero-elbow-${side}`, scene);
      elbow.parent = shoulder; elbow.position.y = -UPPER_ARM;
      joint(`hero-elbow-joint-${side}`, 0.043, elbow);
      const forearm: BodyRing[] = [
        [-FOREARM - 0.005, 0.034, 0.034], [-0.21, 0.039, 0.044],
        [-0.1, 0.055, 0.06], [-0.035, 0.05, 0.055], [0.022, 0.04, 0.044],
      ];
      form(`hero-forearm-${side}`, forearm, suit, elbow);
      patch(`hero-gauntlet-panel-${side}`, forearm, [[-0.284, Math.PI, 1.1], [-0.16, Math.PI, 1.2], [-0.065, Math.PI, 0.8]], panel, elbow);
      trace(`hero-gauntlet-light-${side}`, forearm, [[side * 0.009, -0.08], [side * 0.012, -0.21], [0, -0.258]], true, this.resonance, elbow);
      // Anatomical glove with a tapered knuckle block and one tucked thumb.
      form(`hero-glove-${side}`, [
        [-FOREARM - 0.104, 0.027, 0.025, 0.021], [-FOREARM - 0.074, 0.041, 0.035, 0.018],
        [-FOREARM - 0.018, 0.038, 0.031, 0.007], [-FOREARM + 0.014, 0.033, 0.033],
      ], panel, elbow);
      const thumb = form(`hero-thumb-${side}`, [[-0.045, 0.014, 0.018], [-0.015, 0.019, 0.022], [0.015, 0.013, 0.018]], panel, elbow);
      thumb.position.set(-side * 0.028, -FOREARM - 0.025, 0.031);
      thumb.rotation.z = side * 0.28;
      return [shoulder, elbow];
    };
    const [shoulderL, elbowL] = buildArm(-1);
    const [shoulderR, elbowR] = buildArm(1);
    this.shoulder = [shoulderL, shoulderR];
    this.elbow = [elbowL, elbowR];

    const buildLeg = (side: -1 | 1): [TransformNode, TransformNode, TransformNode] => {
      const hip = new TransformNode(`hero-hip-${side}`, scene);
      hip.parent = this.body; hip.position.set(side * 0.088, HIP_Y, 0);
      const thigh: BodyRing[] = [
        [-THIGH - 0.015, 0.052, 0.056], [-0.31, 0.061, 0.067],
        [-0.19, 0.078, 0.088], [-0.06, 0.087, 0.1], [0.046, 0.078, 0.085],
      ];
      form(`hero-thigh-${side}`, thigh, suit, hip);
      patch(`hero-thigh-panel-${side}`, thigh, [[-0.38, side * Math.PI / 2, 0.17], [-0.21, side * Math.PI / 2, 0.32], [-0.06, side * Math.PI / 2, 0.39], [0.02, side * Math.PI / 2, 0.35]], panel, hip);
      const knee = new TransformNode(`hero-knee-${side}`, scene);
      knee.parent = hip; knee.position.y = -THIGH;
      joint(`hero-knee-joint-${side}`, 0.05, knee);
      const calf: BodyRing[] = [
        [-SHIN - 0.016, 0.034, 0.037], [-0.32, 0.044, 0.049, -0.004],
        [-0.2, 0.058, 0.072, -0.013], [-0.108, 0.067, 0.08, -0.013],
        [-0.025, 0.053, 0.056], [0.02, 0.052, 0.055],
      ];
      form(`hero-calf-${side}`, calf, suit, knee);
      patch(`hero-knee-panel-${side}`, calf, [[-0.076, 0, 0.36], [-0.025, 0, 0.78], [0.019, 0, 0.62]], panel, knee);
      patch(`hero-calf-panel-${side}`, calf, [[-0.425, Math.PI, 0.64], [-0.25, Math.PI, 0.71], [-0.085, Math.PI, 0.49]], panel, knee);
      trace(`hero-calf-light-${side}`, calf, [[side * 0.013, -0.09], [side * 0.014, -0.235], [side * 0.009, -0.36]], true, this.resonance, knee);
      const ankle = new TransformNode(`hero-ankle-${side}`, scene);
      ankle.parent = knee; ankle.position.y = -SHIN;
      // Longitudinal shoe sections give a low toe box and an actual heel.
      // Revolving a vertical ankle profile made the previous feet look inflated.
      attach(buildBoot(`hero-boot-${side}`, false, scene), panel, ankle);
      attach(buildBoot(`hero-outsole-${side}`, true, scene), sole, ankle);
      form(`hero-ankle-cuff-${side}`, [[0.006, 0.036, 0.039], [0.097, 0.035, 0.039]], panel, ankle);
      const heel = MeshBuilder.CreateBox(`hero-heel-light-${side}`, { width: 0.047, height: 0.008, depth: 0.003 }, scene);
      heel.position.set(0, 0.005, -0.071);
      attach(heel, this.resonance, ankle);
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
    const r = 0.45 + heat * 1.6;
    const g = 0.25 + heat * 0.95;
    const b = 0.06 + heat * 0.5;
    if (focus) {
      this.resonance.emissiveColor.set(0.4 + heat, 0.75 + heat * 0.8, 1.5 + heat);
      this.visorMaterial.emissiveColor.set(0.012, 0.045, 0.07);
    } else {
      this.resonance.emissiveColor.set(r, g, b);
      this.visorMaterial.emissiveColor.set(0.006, 0.014 + heat * 0.012, 0.022 + heat * 0.015);
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
      let outward = (side === 0 ? -1 : 1) * (0.09 + pace * 0.05);

      if (this.crouch > 0.5) {
        pitchX = side === 0 ? -1.1 : 0.5;
        bend = -0.4;
        outward = (side === 0 ? -1 : 1) * 0.5;
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
      this.ankle[side].rotation.y = (side === 0 ? -1 : 1) * 0.045 * (1 - pace);
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
  // PBR uniforms are linear; authored hex swatches are sRGB.
  material.albedoColor = Color3.FromHexString(hex).toLinearSpace();
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
  const segments = 32;
  // Shared derivatives across sections, rather than a smoothstep that makes
  // every authored ring a separate bulge with a flat tangent at each end.
  const sections: BodyRing[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    for (let step = 0; step < 5; step++) sections.push(sampleProfile(rings, lerp(a[0], b[0], step / 5)));
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
  // The UV seam has duplicate vertices; give both the same outward normal.
  for (let r = 0; r < sections.length; r++) {
    const a = r * (segments + 1) * 3, b = a + segments * 3;
    const n = new Vector3(normals[a]! + normals[b]!, normals[a + 1]! + normals[b + 1]!, normals[a + 2]! + normals[b + 2]!).normalize();
    for (const i of [a, b]) { normals[i] = n.x; normals[i + 1] = n.y; normals[i + 2] = n.z; }
  }
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
  texture.uScale = 4; texture.vScale = 4; texture.level = 0.1;
  return texture;
}

/** A monotone cubic profile preserves a continuous tangent without overshoot. */
function sampleProfile(input: BodyRing[], y: number): BodyRing {
  const rings = input; // Callers author profiles in ascending height order.
  let i = 0;
  while (i < rings.length - 2 && y > rings[i + 1]![0]) i++;
  const a = rings[i]!, b = rings[i + 1]!;
  const span = b[0] - a[0], t = clamp((y - a[0]) / span, 0, 1);
  const value = (channel: 1 | 2 | 3): number => {
    const av = a[channel] ?? 0, bv = b[channel] ?? 0;
    const slope = (bv - av) / span;
    const derivative = (index: number): number => {
      if (index === 0 || index === rings.length - 1) return slope;
      const before = rings[index - 1]!, at = rings[index]!, after = rings[index + 1]!;
      const left = ((at[channel] ?? 0) - (before[channel] ?? 0)) / (at[0] - before[0]);
      const right = ((after[channel] ?? 0) - (at[channel] ?? 0)) / (after[0] - at[0]);
      return left * right <= 0 ? 0 : 2 * left * right / (left + right);
    };
    return (2 * t ** 3 - 3 * t ** 2 + 1) * av + (t ** 3 - 2 * t ** 2 + t) * span * derivative(i)
      + (-2 * t ** 3 + 3 * t ** 2) * bv + (t ** 3 - t ** 2) * span * derivative(i + 1);
  };
  return [y, value(1), value(2), value(3)];
}

/** Height, angular centre and half-width of a panel following the body. */
type PanelRow = [number, number, number];
function surfacePanel(name: string, body: BodyRing[], rows: PanelRow[], scene: Scene, lift: number): Mesh {
  const pathArray: Vector3[][] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!, b = rows[i + 1]!;
    for (let step = 0; step <= 8; step++) {
      if (i > 0 && step === 0) continue;
      const t = step / 8, y = lerp(a[0], b[0], t);
      const [, w, d, z = 0] = sampleProfile(body, y);
      const centre = lerp(a[1], b[1], t), half = lerp(a[2], b[2], t);
      const path: Vector3[] = [];
      for (let j = 0; j <= 24; j++) {
        const angle = centre + (j / 12 - 1) * half;
        path.push(new Vector3(Math.sin(angle) * (w + lift), y, Math.cos(angle) * (d + lift) + z));
      }
      pathArray.push(path);
    }
  }
  // Panels are thin surface decals in geometry, not volumes. Double-sided
  // triangles avoid winding changes when an angular panel crosses the seam.
  return MeshBuilder.CreateRibbon(name, { pathArray, sideOrientation: Mesh.DOUBLESIDE }, scene);
}

function buildBoot(name: string, outsole: boolean, scene: Scene): Mesh {
  // z, half-width, bottom, top. A flat sole and low toe box, with a taller heel.
  const sections = [
    [-0.073, 0.022, -0.061, 0.042], [-0.055, 0.045, -0.069, 0.092],
    [0.004, 0.051, -0.076, 0.068], [0.081, 0.052, -0.073, 0.007],
    [0.139, 0.043, -0.064, -0.01], [0.162, 0.009, -0.05, -0.029],
  ];
  const rings: BodyRing[] = sections.map(([z = 0, w = 0, bottom = 0, top = 0]) => {
    const lo = outsole ? bottom - 0.006 : bottom;
    const hi = outsole ? bottom + 0.008 : top;
    return [z, w + (outsole ? 0.001 : 0), (hi - lo) / 2, -(hi + lo) / 2];
  });
  const mesh = sculpt(name, rings, scene);
  mesh.rotation.x = Math.PI / 2;
  mesh.bakeCurrentTransformIntoVertices();
  return mesh;
}
