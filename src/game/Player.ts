import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { City } from "./City";
import { Input } from "./Input";

const WALK_TOP_SPEED = 96;
const SPRINT_TOP_SPEED = 216;
const ABSOLUTE_TOP_SPEED = 265;

/** Vertical offset that plants the feet on the sidewalk/road surface. */
const BODY_OFFSET_Y = -0.74;

export class Player {
  readonly root: TransformNode;
  readonly velocity = Vector3.Zero();
  readonly radius = 1.15;
  /** Body meshes registered as shadow casters by the game. */
  readonly meshes: Mesh[] = [];

  health = 100;
  charge = 50;
  combo = 1;
  comboTimer = 0;
  dashCooldown = 0;
  boltCooldown = 0;
  pulseCooldown = 0;
  strikeCooldown = 0;
  invulnerable = 0;

  private dashTimer = 0;
  private secondsSinceDamage = 99;
  private readonly trail: Mesh[] = [];
  private readonly trailPoints: Vector3[] = [];

  private readonly body: TransformNode;
  private readonly upper: TransformNode;
  private readonly head: TransformNode;
  private readonly shoulderL: TransformNode;
  private readonly shoulderR: TransformNode;
  private readonly elbowL: TransformNode;
  private readonly elbowR: TransformNode;
  private readonly hipL: TransformNode;
  private readonly hipR: TransformNode;
  private readonly kneeL: TransformNode;
  private readonly kneeR: TransformNode;
  private readonly ankleL: TransformNode;
  private readonly ankleR: TransformNode;
  private stride = 0;
  private lifetime = 0;

  constructor(scene: Scene, spawn: Vector3) {
    this.root = new TransformNode("speedster", scene);
    this.root.position.copyFrom(spawn);

    // Athletic courier suit: worn crimson over charcoal, muted trim. No neon.
    const suit = new StandardMaterial("suit-crimson", scene);
    suit.diffuseColor = Color3.FromHexString("#7e222c");
    suit.specularColor = new Color3(0.28, 0.24, 0.24);
    suit.specularPower = 48;

    const suitDark = new StandardMaterial("suit-charcoal", scene);
    suitDark.diffuseColor = Color3.FromHexString("#2a2d31");
    suitDark.specularColor = new Color3(0.12, 0.12, 0.13);
    suitDark.specularPower = 32;

    const trim = new StandardMaterial("suit-trim", scene);
    trim.diffuseColor = Color3.FromHexString("#b78f3e");
    trim.specularColor = new Color3(0.45, 0.4, 0.28);
    trim.specularPower = 64;

    const skin = new StandardMaterial("hero-skin", scene);
    skin.diffuseColor = Color3.FromHexString("#b9866a");
    skin.specularColor = new Color3(0.1, 0.08, 0.07);

    const visorGlass = new StandardMaterial("visor-glass", scene);
    visorGlass.diffuseColor = Color3.FromHexString("#11161b");
    visorGlass.emissiveColor = Color3.FromHexString("#1c2833");
    visorGlass.specularColor = new Color3(0.85, 0.87, 0.9);
    visorGlass.specularPower = 128;

    this.body = new TransformNode("hero-body", scene);
    this.body.parent = this.root;
    this.body.position.y = BODY_OFFSET_Y;

    const add = (mesh: Mesh, material: StandardMaterial, parent: TransformNode): Mesh => {
      mesh.material = material;
      mesh.parent = parent;
      this.meshes.push(mesh);
      return mesh;
    };

    // Pelvis stays with the legs; everything above the waist hangs off an
    // upper-body pivot so the torso can lean into the sprint.
    const pelvis = MeshBuilder.CreateCapsule(
      "hero-pelvis",
      { height: 0.66, radius: 0.34, tessellation: 10 },
      scene,
    );
    pelvis.position.y = 2.14;
    pelvis.scaling.set(1.0, 1, 0.72);
    add(pelvis, suitDark, this.body);

    this.upper = new TransformNode("hero-upper", scene);
    this.upper.parent = this.body;
    this.upper.position.y = 2.38;

    // Layered chest-over-waist gives the athletic V-taper a single capsule
    // can't: broad upper chest, slimmer core.
    const waist = MeshBuilder.CreateCapsule(
      "hero-waist",
      { height: 1.24, radius: 0.32, tessellation: 12 },
      scene,
    );
    waist.position.y = 0.4;
    waist.scaling.set(1.05, 1, 0.78);
    add(waist, suit, this.upper);

    const chest = MeshBuilder.CreateCapsule(
      "hero-chest",
      { height: 0.98, radius: 0.44, tessellation: 12 },
      scene,
    );
    chest.position.y = 0.84;
    chest.scaling.set(1.12, 1, 0.76);
    add(chest, suit, this.upper);

    const chestPlate = MeshBuilder.CreateBox(
      "hero-chest-plate",
      { width: 0.54, height: 0.34, depth: 0.1 },
      scene,
    );
    chestPlate.position.set(0, 0.92, 0.31);
    chestPlate.rotation.x = 0.16;
    add(chestPlate, suitDark, this.upper);

    const belt = MeshBuilder.CreateCylinder(
      "hero-belt",
      { height: 0.1, diameter: 0.7, tessellation: 14 },
      scene,
    );
    belt.position.y = -0.1;
    belt.scaling.set(1.02, 1, 0.78);
    add(belt, trim, this.upper);

    const emblem = MeshBuilder.CreateCylinder(
      "hero-emblem",
      { height: 0.05, diameter: 0.34, tessellation: 16 },
      scene,
    );
    emblem.position.set(0, 0.82, 0.4);
    emblem.rotation.x = Math.PI * 0.5;
    add(emblem, trim, this.upper);

    const neck = MeshBuilder.CreateCylinder(
      "hero-neck",
      { height: 0.26, diameter: 0.26, tessellation: 10 },
      scene,
    );
    neck.position.y = 1.24;
    add(neck, skin, this.upper);

    this.head = new TransformNode("hero-head-pivot", scene);
    this.head.parent = this.upper;
    this.head.position.y = 1.36;

    const cowl = MeshBuilder.CreateSphere("hero-cowl", { diameter: 0.6, segments: 12 }, scene);
    cowl.position.y = 0.14;
    cowl.scaling.set(0.92, 1.08, 0.96);
    add(cowl, suit, this.head);

    const jaw = MeshBuilder.CreateSphere("hero-jaw", { diameter: 0.42, segments: 10 }, scene);
    jaw.position.set(0, -0.05, 0.16);
    jaw.scaling.set(0.86, 0.66, 0.86);
    add(jaw, skin, this.head);

    // Wraparound visor: front pane plus two angled side wings.
    const visor = MeshBuilder.CreateBox(
      "hero-visor",
      { width: 0.42, height: 0.12, depth: 0.08 },
      scene,
    );
    visor.position.set(0, 0.17, 0.27);
    add(visor, visorGlass, this.head);

    for (const side of [-1, 1] as const) {
      const wing = MeshBuilder.CreateBox(
        `hero-visor-wing-${side < 0 ? "l" : "r"}`,
        { width: 0.17, height: 0.11, depth: 0.05 },
        scene,
      );
      wing.position.set(side * 0.23, 0.17, 0.18);
      wing.rotation.y = side * 0.65;
      add(wing, visorGlass, this.head);

      // Swept aero fins along the cowl in place of ears.
      const fin = MeshBuilder.CreateBox(
        `hero-cowl-fin-${side < 0 ? "l" : "r"}`,
        { width: 0.04, height: 0.13, depth: 0.3 },
        scene,
      );
      fin.position.set(side * 0.26, 0.3, -0.02);
      fin.rotation.x = -0.35;
      fin.rotation.z = side * 0.28;
      add(fin, trim, this.head);
    }

    // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm + hand.
    const buildArm = (side: -1 | 1): { shoulder: TransformNode; elbow: TransformNode } => {
      const label = side < 0 ? "l" : "r";
      const shoulder = new TransformNode(`hero-shoulder-${label}`, scene);
      shoulder.parent = this.upper;
      shoulder.position.set(side * 0.62, 0.94, 0);

      const deltoid = MeshBuilder.CreateSphere(
        `hero-deltoid-${label}`,
        { diameter: 0.4, segments: 10 },
        scene,
      );
      deltoid.position.y = 0.02;
      deltoid.scaling.set(0.95, 1.05, 0.95);
      add(deltoid, suit, shoulder);

      const upperArm = MeshBuilder.CreateCapsule(
        `hero-upper-arm-${label}`,
        { height: 0.76, radius: 0.14, tessellation: 10 },
        scene,
      );
      upperArm.position.y = -0.36;
      add(upperArm, suit, shoulder);

      const elbow = new TransformNode(`hero-elbow-${label}`, scene);
      elbow.parent = shoulder;
      elbow.position.y = -0.74;

      const elbowPad = MeshBuilder.CreateSphere(
        `hero-elbow-pad-${label}`,
        { diameter: 0.23, segments: 8 },
        scene,
      );
      add(elbowPad, suitDark, elbow);

      const forearm = MeshBuilder.CreateCapsule(
        `hero-forearm-${label}`,
        { height: 0.68, radius: 0.115, tessellation: 10 },
        scene,
      );
      forearm.position.y = -0.32;
      forearm.scaling.set(1, 1, 1.08);
      add(forearm, suitDark, elbow);

      // Flattened fist rather than a ball.
      const hand = MeshBuilder.CreateSphere(
        `hero-hand-${label}`,
        { diameter: 0.22, segments: 8 },
        scene,
      );
      hand.position.y = -0.7;
      hand.scaling.set(0.72, 1.05, 0.55);
      add(hand, suitDark, elbow);

      return { shoulder, elbow };
    };

    const armL = buildArm(-1);
    const armR = buildArm(1);
    this.shoulderL = armL.shoulder;
    this.elbowL = armL.elbow;
    this.shoulderR = armR.shoulder;
    this.elbowR = armR.elbow;

    // Legs: hip pivot -> thigh -> knee pivot -> shin + boot.
    const buildLeg = (side: -1 | 1): { hip: TransformNode; knee: TransformNode; ankle: TransformNode } => {
      const label = side < 0 ? "l" : "r";
      const hip = new TransformNode(`hero-hip-${label}`, scene);
      hip.parent = this.body;
      hip.position.set(side * 0.26, 2.05, 0);

      const thigh = MeshBuilder.CreateCapsule(
        `hero-thigh-${label}`,
        { height: 0.98, radius: 0.19, tessellation: 8 },
        scene,
      );
      thigh.position.y = -0.48;
      add(thigh, suit, hip);

      const knee = new TransformNode(`hero-knee-${label}`, scene);
      knee.parent = hip;
      knee.position.y = -0.98;

      const kneePad = MeshBuilder.CreateSphere(
        `hero-knee-pad-${label}`,
        { diameter: 0.27, segments: 8 },
        scene,
      );
      kneePad.position.z = 0.05;
      kneePad.scaling.y = 1.1;
      add(kneePad, suitDark, knee);

      const shin = MeshBuilder.CreateCapsule(
        `hero-shin-${label}`,
        { height: 0.92, radius: 0.15, tessellation: 10 },
        scene,
      );
      shin.position.y = -0.44;
      shin.scaling.set(1, 1, 1.14);
      add(shin, suitDark, knee);

      const ankle = new TransformNode(`hero-ankle-${label}`, scene);
      ankle.parent = knee;
      ankle.position.y = -0.9;

      const heel = MeshBuilder.CreateBox(
        `hero-heel-${label}`,
        { width: 0.25, height: 0.15, depth: 0.34 },
        scene,
      );
      heel.position.set(0, -0.03, 0.02);
      add(heel, suitDark, ankle);

      const toe = MeshBuilder.CreateBox(
        `hero-toe-${label}`,
        { width: 0.23, height: 0.12, depth: 0.28 },
        scene,
      );
      toe.position.set(0, -0.045, 0.3);
      toe.rotation.x = 0.06;
      add(toe, suitDark, ankle);

      return { hip, knee, ankle };
    };

    const legL = buildLeg(-1);
    const legR = buildLeg(1);
    this.hipL = legL.hip;
    this.kneeL = legL.knee;
    this.ankleL = legL.ankle;
    this.hipR = legR.hip;
    this.kneeR = legR.knee;
    this.ankleR = legR.ankle;

    // Faint slipstream instead of a neon light ribbon: pale, translucent
    // streaks that read as displaced air at speed.
    const trailMaterial = new StandardMaterial("slipstream", scene);
    trailMaterial.diffuseColor = Color3.FromHexString("#dfe9ef");
    trailMaterial.emissiveColor = Color3.FromHexString("#c8d4da");
    trailMaterial.alpha = 0.16;
    trailMaterial.disableLighting = true;

    for (let i = 0; i < 16; i += 1) {
      const streak = MeshBuilder.CreateBox(
        `trail-${i}`,
        { width: 0.07 + i * 0.02, height: 0.035, depth: 1.3 + i * 0.14 },
        scene,
      );
      streak.material = trailMaterial;
      streak.setEnabled(false);
      this.trail.push(streak);
      this.trailPoints.push(spawn.clone());
    }
  }

  get speed(): number {
    return this.velocity.length();
  }

  get speedRatio(): number {
    return Math.min(1, this.speed / SPRINT_TOP_SPEED);
  }

  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  update(dt: number, input: Input, cameraYaw: number, city: City): void {
    this.tickResources(dt);

    if (input.consume("KeyR")) {
      this.recover(city);
    }

    const movement = input.movement();
    const cameraForward = new Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const cameraRight = new Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const desired = cameraForward.scale(movement.z).addInPlace(cameraRight.scale(movement.x));
    const hasInput = desired.lengthSquared() > 0.001;
    if (hasInput) desired.normalize();

    let speed = this.speed;
    let direction = speed > 0.1 ? this.velocity.scale(1 / speed) : cameraForward;

    if (input.consume("Space") && this.dashCooldown <= 0 && this.charge >= 20) {
      this.charge -= 20;
      this.dashCooldown = 0.75;
      this.dashTimer = 0.2;
      this.invulnerable = Math.max(this.invulnerable, 0.28);
      speed = Math.max(speed + 72, 150);
      direction = hasInput ? desired : cameraForward;
    }

    if (hasInput) {
      const sprinting = input.down("ShiftLeft") || input.down("ShiftRight");
      const target = this.dashTimer > 0 ? ABSOLUTE_TOP_SPEED : sprinting ? SPRINT_TOP_SPEED : WALK_TOP_SPEED;
      const acceleration = sprinting ? 74 : 96;
      speed = approach(speed, target, acceleration * dt);

      const normalizedSpeed = Math.min(1, speed / SPRINT_TOP_SPEED);
      const turnRate = 9.5 - normalizedSpeed * 6.8;
      const blend = 1 - Math.exp(-turnRate * dt);
      direction = Vector3.Lerp(direction, desired, blend);
      if (direction.lengthSquared() > 0.001) direction.normalize();
    } else if (this.dashTimer <= 0) {
      speed = approach(speed, 0, 34 * dt);
    }

    if (this.dashTimer > 0) {
      speed = Math.min(ABSOLUTE_TOP_SPEED, Math.max(speed, 185));
    }

    this.velocity.copyFrom(direction.scale(speed));
    const requested = this.velocity.scale(dt);
    const before = this.root.position.clone();
    const after = city.moveWithCollisions(before, requested, this.radius);
    const actualDistance = Vector3.Distance(before, after);
    this.root.position.copyFrom(after);

    if (requested.length() > 0.1 && actualDistance < requested.length() * 0.22) {
      this.velocity.scaleInPlace(0.28);
    }

    if (this.velocity.lengthSquared() > 0.5) {
      this.root.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
    }

    this.animate(dt);
    this.updateTrail(dt);
  }

  canStrike(): boolean {
    return this.strikeCooldown <= 0;
  }

  useStrike(): void {
    this.strikeCooldown = 0.22;
  }

  canBolt(): boolean {
    return this.boltCooldown <= 0 && this.charge >= 15;
  }

  useBolt(): void {
    this.charge -= 15;
    this.boltCooldown = 1.1;
  }

  canPulse(): boolean {
    return this.pulseCooldown <= 0 && this.charge >= 35;
  }

  usePulse(): void {
    this.charge -= 35;
    this.pulseCooldown = 2.8;
    this.invulnerable = Math.max(this.invulnerable, 0.2);
  }

  useFocus(dt: number): boolean {
    if (this.charge <= 0.25) return false;
    this.charge = Math.max(0, this.charge - 22 * dt);
    return true;
  }

  registerHit(power = 1): void {
    this.combo = Math.min(12, this.combo + 1);
    this.comboTimer = 3;
    this.charge = Math.min(100, this.charge + 5 + power * 3);
  }

  damage(amount: number, source: Vector3): boolean {
    if (this.invulnerable > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.secondsSinceDamage = 0;
    this.invulnerable = 0.5;
    const away = this.root.position.subtract(source);
    away.y = 0;
    if (away.lengthSquared() > 0.01) {
      away.normalize().scaleInPlace(28);
      this.velocity.addInPlace(away);
    }
    return true;
  }

  recover(city: City): void {
    this.root.position.copyFrom(city.nearestRoad(this.root.position));
    this.velocity.setAll(0);
    this.health = Math.max(this.health, 35);
  }

  private tickResources(dt: number): void {
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.boltCooldown = Math.max(0, this.boltCooldown - dt);
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    this.strikeCooldown = Math.max(0, this.strikeCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.secondsSinceDamage += dt;

    if (this.comboTimer <= 0) this.combo = 1;
    if (this.speed > 70) {
      this.charge = Math.min(100, this.charge + dt * (2.5 + this.speedRatio * 4));
    }
    if (this.secondsSinceDamage > 5 && this.health < 100) {
      this.health = Math.min(100, this.health + dt * 3);
    }
  }

  /**
   * Procedural run cycle: counter-swinging arms with bent elbows, knee
   * flexion during leg recovery, forward lean, cadence-locked bob and a
   * touch of torso roll. Amplitudes scale with pace so idling looks calm.
   */
  private animate(dt: number): void {
    this.lifetime += dt;
    const speed = this.speed;
    const pace = Math.min(1, speed / 55);
    const cadence = Math.min(27, 3.4 + speed * 0.155);
    this.stride += dt * cadence * pace;
    const p = this.stride;

    const swingL = Math.sin(p);
    const swingR = Math.sin(p + Math.PI);
    const breathe = Math.sin(this.lifetime * 2.1) * 0.02 * (1 - pace);

    const lean = this.speedRatio * 0.52 + pace * 0.1;
    this.body.rotation.x = lean * 0.4;
    this.body.rotation.z = swingL * 0.035 * pace;
    this.body.position.y = BODY_OFFSET_Y + Math.sin(p * 2) * 0.055 * pace;

    this.upper.rotation.x = lean * 0.55 + breathe;
    this.upper.rotation.y = swingL * 0.08 * pace;
    this.head.rotation.x = -lean * 0.7;

    const legAmp = 0.32 + pace * 0.78;
    this.hipL.rotation.x = -swingL * legAmp;
    this.hipR.rotation.x = -swingR * legAmp;
    const kneeBase = 0.05 + pace * 0.14;
    this.kneeL.rotation.x = kneeBase + Math.max(0, Math.sin(p - 1.9)) * (0.4 + pace * 1.25);
    this.kneeR.rotation.x = kneeBase + Math.max(0, Math.sin(p + Math.PI - 1.9)) * (0.4 + pace * 1.25);
    // Plantar flexion on the trailing leg sells the push-off.
    this.ankleL.rotation.x = 0.06 + Math.max(0, -swingL) * (0.18 + pace * 0.5);
    this.ankleR.rotation.x = 0.06 + Math.max(0, -swingR) * (0.18 + pace * 0.5);

    const armAmp = 0.22 + pace * 0.62;
    this.shoulderL.rotation.x = -swingR * armAmp;
    this.shoulderR.rotation.x = -swingL * armAmp;
    this.shoulderL.rotation.z = 0.1 + pace * 0.05;
    this.shoulderR.rotation.z = -0.1 - pace * 0.05;
    this.elbowL.rotation.x = -(0.22 + pace * 1.2 + Math.max(0, -swingR) * 0.3);
    this.elbowR.rotation.x = -(0.22 + pace * 1.2 + Math.max(0, -swingL) * 0.3);
  }

  private updateTrail(dt: number): void {
    const visible = this.speed > 45;
    const direction = this.speed > 1 ? this.velocity.normalizeToNew() : Vector3.Forward();
    const yaw = Math.atan2(direction.x, direction.z);

    for (let i = 0; i < this.trail.length; i += 1) {
      const mesh = this.trail[i];
      const point = this.trailPoints[i];
      if (!mesh || !point) continue;
      mesh.setEnabled(visible);
      const spread = i % 2 === 0 ? -0.42 : 0.42;
      const right = new Vector3(direction.z, 0, -direction.x);
      const target = this.root.position
        .subtract(direction.scale(1.8 + i * (0.52 + this.speedRatio * 0.75)))
        .addInPlace(right.scale(spread))
        .addInPlaceFromFloats(0, 1.25 + (i % 3) * 0.35, 0);
      Vector3.LerpToRef(point, target, 1 - Math.exp(-18 * dt), point);
      mesh.position.copyFrom(point);
      mesh.rotation.y = yaw;
      mesh.visibility = Math.max(0.03, (1 - i / this.trail.length) * this.speedRatio * 0.45);
    }
  }
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}
