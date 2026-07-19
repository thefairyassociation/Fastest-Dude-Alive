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

export class Player {
  readonly root: TransformNode;
  readonly velocity = Vector3.Zero();
  readonly radius = 1.15;

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
  private readonly torso: Mesh;
  private readonly leftArm: Mesh;
  private readonly rightArm: Mesh;
  private readonly leftLeg: Mesh;
  private readonly rightLeg: Mesh;
  private stride = 0;

  constructor(scene: Scene, spawn: Vector3) {
    this.root = new TransformNode("speedster", scene);
    this.root.position.copyFrom(spawn);

    const suit = new StandardMaterial("speedster-suit", scene);
    suit.diffuseColor = Color3.FromHexString("#4b2377");
    suit.emissiveColor = Color3.FromHexString("#1b0832");
    suit.specularColor = new Color3(0.55, 0.35, 0.8);

    const accent = new StandardMaterial("speedster-accent", scene);
    accent.diffuseColor = Color3.FromHexString("#f5c95a");
    accent.emissiveColor = Color3.FromHexString("#9a5d13");

    const skin = new StandardMaterial("speedster-mask", scene);
    skin.diffuseColor = Color3.FromHexString("#92526e");
    skin.emissiveColor = Color3.FromHexString("#24101b");

    this.torso = MeshBuilder.CreateCapsule(
      "hero-torso",
      { height: 2.15, radius: 0.62, tessellation: 12 },
      scene,
    );
    this.torso.position.y = 2.05;
    this.torso.scaling.z = 0.72;
    this.torso.material = suit;
    this.torso.parent = this.root;

    const chest = MeshBuilder.CreatePolyhedron("hero-chest-mark", { type: 1, size: 0.34 }, scene);
    chest.position.set(0, 2.22, 0.57);
    chest.rotation.z = Math.PI * 0.25;
    chest.scaling.y = 1.5;
    chest.material = accent;
    chest.parent = this.root;

    const head = MeshBuilder.CreateSphere("hero-head", { diameter: 1.18, segments: 12 }, scene);
    head.position.y = 3.55;
    head.scaling.z = 0.92;
    head.material = skin;
    head.parent = this.root;

    const visor = MeshBuilder.CreateBox(
      "hero-visor",
      { width: 0.88, height: 0.16, depth: 0.09 },
      scene,
    );
    visor.position.set(0, 3.62, 0.55);
    visor.material = accent;
    visor.parent = this.root;

    this.leftArm = limb(scene, "hero-left-arm", suit, -0.72, 2.05, 0);
    this.rightArm = limb(scene, "hero-right-arm", suit, 0.72, 2.05, 0);
    this.leftLeg = limb(scene, "hero-left-leg", suit, -0.31, 0.75, 0, 1.55);
    this.rightLeg = limb(scene, "hero-right-leg", suit, 0.31, 0.75, 0, 1.55);
    for (const part of [this.leftArm, this.rightArm, this.leftLeg, this.rightLeg]) {
      part.parent = this.root;
    }

    const trailMaterial = new StandardMaterial("momentum-trail", scene);
    trailMaterial.diffuseColor = Color3.FromHexString("#5cecff");
    trailMaterial.emissiveColor = Color3.FromHexString("#42dfff");
    trailMaterial.alpha = 0.42;
    trailMaterial.disableLighting = true;

    for (let i = 0; i < 16; i += 1) {
      const streak = MeshBuilder.CreateBox(
        `trail-${i}`,
        { width: 0.12 + i * 0.025, height: 0.045, depth: 1.2 + i * 0.12 },
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

  private animate(dt: number): void {
    const pace = Math.min(1, this.speed / 55);
    this.stride += dt * (4 + this.speed * 0.17);
    const swing = Math.sin(this.stride) * 0.75 * pace;
    this.leftArm.rotation.x = swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x = -swing;
    this.rightLeg.rotation.x = swing;
    this.torso.rotation.x = 0.03 + this.speedRatio * 0.32;
    this.root.scaling.y = 1 - this.speedRatio * 0.035;
  }

  private updateTrail(dt: number): void {
    const visible = this.speed > 35;
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
      mesh.visibility = Math.max(0.04, (1 - i / this.trail.length) * this.speedRatio * 0.7);
    }
  }
}

function limb(
  scene: Scene,
  name: string,
  limbMaterial: StandardMaterial,
  x: number,
  y: number,
  z: number,
  height = 1.45,
): Mesh {
  const part = MeshBuilder.CreateCapsule(name, { height, radius: 0.2, tessellation: 8 }, scene);
  part.position.set(x, y, z);
  part.material = limbMaterial;
  return part;
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}
