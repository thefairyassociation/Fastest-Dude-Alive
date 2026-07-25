import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { approach, clamp, damp } from "../core/Rng";
import type { Input } from "../core/Input";
import type { City, MoveResult } from "../world/City";
import { HeroModel } from "./HeroModel";

/**
 * The speed controller.
 *
 * Runs at a fixed 120 Hz, sweeps a kinematic cylinder rather than trusting a
 * rigid body, and owns a small traversal state machine: ground, air, slide,
 * wall run and vertical run. Havok still handles ordinary props; a speedster
 * cannot survive one discrete rigid-body step per frame without tunnelling.
 */

/** Metres per second. 45 is already superhuman; sprint is the real fantasy. */
const RUN_TOP = 45;
const SPRINT_TOP = 215;
const ABSOLUTE_TOP = 280;
const RUN_ACCEL = 62;
const SPRINT_ACCEL = 58;
const BRAKE = 46;

const GRAVITY = 24;
const WALL_GRAVITY = 5.5;
const TERMINAL = 95;

const BODY_HEIGHT = 1.8;
const BODY_RADIUS = 0.42;
const STEP_HEIGHT = 0.55;

/** Below this you cannot stay on top of the river. */
const WATER_RUN_SPEED = 34;

export type TraversalState = "ground" | "air" | "wall" | "vertical" | "slide";

export interface PlayerEvents {
  landed: boolean;
  jumped: boolean;
  wallJumped: boolean;
  dashed: boolean;
  /** Fires once per foot plant, for dust and audio. */
  footstep: boolean;
  /** Fires while crossing the river above the run threshold. */
  waterSpray: boolean;
  sank: boolean;
  struck: boolean;
}

export class Player {
  readonly model: HeroModel;
  readonly root: TransformNode;
  readonly velocity = Vector3.Zero();
  readonly radius = BODY_RADIUS;
  readonly height = BODY_HEIGHT;

  health = 100;
  charge = 50;
  combo = 1;
  comboTimer = 0;

  dashCooldown = 0;
  boltCooldown = 0;
  pulseCooldown = 0;
  strikeCooldown = 0;
  invulnerable = 0;
  strikeTimer = 0;

  state: TraversalState = "ground";
  wallSide = 0;
  /** Metres travelled this session, for the profile. */
  distance = 0;
  focusHeld = false;

  private readonly move: MoveResult = {
    grounded: true,
    groundY: 0,
    hitWall: false,
    wallX: 0,
    wallZ: 0,
    progress: 1,
    onWater: false,
  };
  private readonly events: PlayerEvents = {
    landed: false,
    jumped: false,
    wallJumped: false,
    dashed: false,
    footstep: false,
    waterSpray: false,
    sank: false,
    struck: false,
  };

  private readonly wallNormal = new Vector3();
  private readonly heading = new Vector3(0, 0, 1);
  private readonly scratch = new Vector3();
  private readonly desired = new Vector3();

  private dashTimer = 0;
  private airDashAvailable = true;
  private coyote = 0;
  private wallTimer = 0;
  private wallCooldown = 0;
  private climbSpeed = 0;
  private slideTimer = 0;
  private sinkTimer = 0;
  private secondsSinceDamage = 99;
  private strideClock = 0;
  private lastTurn = 0;
  private previousYaw = 0;

  constructor(scene: Scene, spawn: Vector3) {
    this.model = new HeroModel(scene);
    this.root = this.model.root;
    this.root.position.copyFrom(spawn);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  /** Horizontal speed; vertical motion is deliberately excluded. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get speedKph(): number {
    return this.speed * 3.6;
  }

  get speedRatio(): number {
    return Math.min(1, this.speed / SPRINT_TOP);
  }

  get topSpeed(): number {
    return ABSOLUTE_TOP;
  }

  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  get grounded(): boolean {
    return this.state === "ground" || this.state === "slide";
  }

  /* ------------------------------------------------------------------ */

  update(dt: number, input: Input, cameraYaw: number, city: City): PlayerEvents {
    this.resetEvents();
    this.tickResources(dt);

    if (input.consume("recover")) this.recover(city);

    const movement = input.movement();
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const desired = this.desired.set(
      sin * movement.z + cos * movement.x,
      0,
      cos * movement.z - sin * movement.x,
    );
    const hasInput = desired.lengthSquared() > 0.001;
    if (hasInput) desired.normalize();

    const sprinting = input.down("sprint");
    const wantsJump = input.consume("jump");
    const wantsSlide = input.down("slide");

    switch (this.state) {
      case "ground":
      case "slide":
        this.updateGrounded(dt, city, desired, hasInput, sprinting, wantsJump, wantsSlide);
        break;
      case "air":
        this.updateAir(dt, city, desired, hasInput, wantsJump);
        break;
      case "wall":
        this.updateWallRun(dt, city, wantsJump);
        break;
      case "vertical":
        this.updateVerticalRun(dt, city, wantsJump);
        break;
    }

    this.integrate(dt, city);
    this.updateFacing(dt);
    this.animate(dt);
    return this.events;
  }

  /**
   * Steps the player without reading input.
   *
   * Used while a conversation owns the screen: the runner coasts to a stop
   * and keeps animating, but nothing may consume a key press — the dialogue
   * needs the same advance key the player uses to jump.
   */
  idle(dt: number, city: City): PlayerEvents {
    this.resetEvents();
    this.tickResources(dt);
    this.focusHeld = false;

    if (this.state === "wall" || this.state === "vertical") this.detachWall(0.2);
    this.setHorizontalSpeed(approach(this.speed, 0, BRAKE * 1.6 * dt));
    if (this.state === "air") {
      this.velocity.y = Math.max(-TERMINAL, this.velocity.y - GRAVITY * dt);
    }

    this.integrate(dt, city);
    this.updateFacing(dt);
    this.animate(dt);
    return this.events;
  }

  /* ---------------- states ---------------- */

  private updateGrounded(
    dt: number,
    city: City,
    desired: Vector3,
    hasInput: boolean,
    sprinting: boolean,
    wantsJump: boolean,
    wantsSlide: boolean,
  ): void {
    const sliding = this.state === "slide";
    let speed = this.speed;

    if (sliding) {
      // Slides trade control for a low-friction carry through corners.
      this.slideTimer += dt;
      speed = approach(speed, 0, 14 * dt);
      if (!wantsSlide || speed < 9 || this.slideTimer > 3.2) {
        this.state = "ground";
        this.slideTimer = 0;
      }
      if (hasInput) this.steer(desired, speed, dt, 0.35);
    } else {
      if (hasInput) {
        const target = sprinting ? SPRINT_TOP : RUN_TOP;
        const accel = sprinting ? SPRINT_ACCEL : RUN_ACCEL;
        speed = approach(speed, target, accel * dt);
        this.steer(desired, speed, dt, 1);
      } else {
        speed = approach(speed, 0, BRAKE * dt);
      }

      if (wantsSlide && speed > 20) {
        this.state = "slide";
        this.slideTimer = 0;
        // A slide entered at pace pays for itself once.
        speed = Math.min(ABSOLUTE_TOP, speed * 1.08);
      }
    }

    this.setHorizontalSpeed(speed);

    if (wantsJump) {
      this.launch(speed);
      return;
    }

    // Running flat into a facade fast enough converts speed into altitude.
    if (!sliding && speed > 48 && this.tryVerticalRun(city)) return;

    this.coyote = 0.12;
  }

  private updateAir(dt: number, city: City, desired: Vector3, hasInput: boolean, wantsJump: boolean): void {
    this.coyote = Math.max(0, this.coyote - dt);

    if (wantsJump) {
      if (this.coyote > 0) {
        this.launch(this.speed);
        return;
      }
      if (this.airDashAvailable && this.charge >= 18 && this.dashCooldown <= 0) {
        this.airDash(desired, hasInput);
        return;
      }
    }

    // Air control: real but reduced, so a jump commits without feeling stiff.
    if (hasInput) this.steer(desired, this.speed, dt, 0.42);

    this.velocity.y = Math.max(-TERMINAL, this.velocity.y - GRAVITY * dt);

    if (this.wallCooldown <= 0 && this.speed > 22) {
      this.tryWallLatch(city);
    }
  }

  private updateWallRun(dt: number, city: City, wantsJump: boolean): void {
    this.wallTimer -= dt;

    const normal = city.probeWall(this.root.position, this.radius, this.height, 0.55);
    if (!normal || this.wallTimer <= 0 || this.speed < 14) {
      this.detachWall(0);
      return;
    }
    this.wallNormal.copyFrom(normal);

    if (wantsJump) {
      // Kick off the wall: outward, upward, and keeping the carried speed.
      this.velocity.x += this.wallNormal.x * 26;
      this.velocity.z += this.wallNormal.z * 26;
      this.velocity.y = 13;
      this.detachWall(0.35);
      this.events.wallJumped = true;
      this.charge = Math.min(100, this.charge + 4);
      return;
    }

    // Project motion onto the wall plane and hold it there.
    const into = this.velocity.x * this.wallNormal.x + this.velocity.z * this.wallNormal.z;
    this.velocity.x -= this.wallNormal.x * into;
    this.velocity.z -= this.wallNormal.z * into;
    // A gentle suction keeps contact through facade seams.
    this.velocity.x -= this.wallNormal.x * 3;
    this.velocity.z -= this.wallNormal.z * 3;

    this.velocity.y = Math.max(-24, this.velocity.y - WALL_GRAVITY * dt);
    this.setHorizontalSpeed(approach(this.speed, 0, 7 * dt));

    const right = this.heading.z * -this.wallNormal.x - this.heading.x * -this.wallNormal.z;
    this.wallSide = right > 0 ? 1 : -1;
  }

  private updateVerticalRun(dt: number, city: City, wantsJump: boolean): void {
    const normal = city.probeWall(this.root.position, this.radius, this.height, 0.7);

    if (!normal) {
      // Crested the parapet: carry over the edge onto the roof.
      this.root.position.addInPlace(this.wallNormal.scale(-(this.radius + 0.8)));
      this.velocity.set(-this.wallNormal.x * 14, 6, -this.wallNormal.z * 14);
      this.state = "air";
      this.wallCooldown = 0.4;
      this.airDashAvailable = true;
      return;
    }
    this.wallNormal.copyFrom(normal);

    if (wantsJump) {
      this.velocity.set(this.wallNormal.x * 30, Math.max(12, this.climbSpeed * 0.4), this.wallNormal.z * 30);
      this.detachWall(0.35);
      this.events.wallJumped = true;
      return;
    }

    this.climbSpeed = approach(this.climbSpeed, 0, GRAVITY * 0.5 * dt);
    if (this.climbSpeed < 7) {
      this.detachWall(0.25);
      return;
    }

    this.velocity.set(-this.wallNormal.x * 3, this.climbSpeed, -this.wallNormal.z * 3);
    this.wallSide = 0;
  }

  /* ---------------- motion helpers ---------------- */

  private steer(desired: Vector3, speed: number, dt: number, authority: number): void {
    const normalized = Math.min(1, speed / SPRINT_TOP);
    // Turning gets heavier the faster you go; that is the whole handling model.
    const turnRate = (10.5 - normalized * 7.6) * authority;
    const blend = damp(turnRate, dt);
    const dirX = speed > 0.1 ? this.velocity.x / speed : desired.x;
    const dirZ = speed > 0.1 ? this.velocity.z / speed : desired.z;
    const newX = dirX + (desired.x - dirX) * blend;
    const newZ = dirZ + (desired.z - dirZ) * blend;
    const length = Math.hypot(newX, newZ) || 1;
    this.velocity.x = (newX / length) * speed;
    this.velocity.z = (newZ / length) * speed;
  }

  private setHorizontalSpeed(speed: number): void {
    const current = this.speed;
    if (current < 0.001) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      return;
    }
    const scale = speed / current;
    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  private launch(speed: number): void {
    // Faster runners jump further, which is what makes rooftops reachable.
    this.velocity.y = 8.5 + Math.min(1, speed / SPRINT_TOP) * 8;
    this.state = "air";
    this.coyote = 0;
    this.airDashAvailable = true;
    this.events.jumped = true;
  }

  private airDash(desired: Vector3, hasInput: boolean): void {
    this.charge -= 18;
    this.dashCooldown = 0.7;
    this.dashTimer = 0.18;
    this.airDashAvailable = false;
    this.invulnerable = Math.max(this.invulnerable, 0.3);

    const dirX = hasInput ? desired.x : this.heading.x;
    const dirZ = hasInput ? desired.z : this.heading.z;
    const boosted = Math.min(ABSOLUTE_TOP, Math.max(this.speed + 75, 140));
    this.velocity.set(dirX * boosted, Math.max(this.velocity.y, 2), dirZ * boosted);
    this.events.dashed = true;
  }

  private tryWallLatch(city: City): void {
    const normal = city.probeWall(this.root.position, this.radius, this.height, 0.5);
    if (!normal) return;

    const speed = this.speed;
    if (speed < 1) return;
    const into = (this.velocity.x * normal.x + this.velocity.z * normal.z) / speed;

    this.wallNormal.copyFrom(normal);
    if (into < -0.72 && speed > 48) {
      this.beginVerticalRun(speed);
      return;
    }
    if (into < -0.12) {
      this.state = "wall";
      this.wallTimer = 2.6;
      this.velocity.y = Math.max(this.velocity.y, 2.5);
      this.airDashAvailable = true;
    }
  }

  private tryVerticalRun(city: City): boolean {
    const normal = city.probeWall(this.root.position, this.radius, this.height, 0.5);
    if (!normal) return false;
    const speed = this.speed;
    const into = (this.velocity.x * normal.x + this.velocity.z * normal.z) / Math.max(speed, 0.001);
    if (into > -0.72) return false;
    this.wallNormal.copyFrom(normal);
    this.beginVerticalRun(speed);
    return true;
  }

  private beginVerticalRun(speed: number): void {
    this.state = "vertical";
    // Horizontal momentum becomes altitude, at a loss.
    this.climbSpeed = Math.min(130, speed * 0.82);
    this.velocity.y = this.climbSpeed;
    this.airDashAvailable = true;
    this.wallSide = 0;
  }

  private detachWall(cooldown: number): void {
    this.state = "air";
    this.wallSide = 0;
    this.wallCooldown = cooldown;
    this.climbSpeed = 0;
  }

  /* ---------------- integration ---------------- */

  private integrate(dt: number, city: City): void {
    const before = this.root.position.clone();

    // Vertical first: landing on a roof must not be eaten by a wall sweep.
    this.root.position.y += this.velocity.y * dt;

    const delta = this.scratch.set(this.velocity.x * dt, 0, this.velocity.z * dt);
    city.move(this.root.position, delta, this.radius, this.height, STEP_HEIGHT, this.move);

    const ground = this.move.groundY;
    if (this.root.position.y <= ground + 0.02) {
      const falling = this.velocity.y < -6;
      this.root.position.y = ground;
      this.velocity.y = 0;
      if (this.state === "air" || this.state === "wall" || this.state === "vertical") {
        this.state = "ground";
        this.airDashAvailable = true;
        this.wallSide = 0;
        this.events.landed = falling;
      }
    } else if (this.state === "ground" || this.state === "slide") {
      // Ran off an edge.
      this.state = "air";
      this.coyote = 0.12;
    }

    // Head-on impact into a facade scrubs speed instead of stopping dead.
    if (this.move.hitWall && this.move.progress < 0.35 && this.state !== "wall" && this.state !== "vertical") {
      this.setHorizontalSpeed(this.speed * 0.55);
    }

    // Running the river: fast enough and you stay on the surface.
    if (this.move.onWater && this.grounded) {
      if (this.speed >= WATER_RUN_SPEED) {
        this.sinkTimer = 0;
        this.events.waterSpray = true;
      } else {
        this.sinkTimer += dt;
        if (this.sinkTimer > 0.45) {
          this.events.sank = true;
          this.recover(city);
        }
      }
    } else {
      this.sinkTimer = 0;
    }

    this.distance += Vector3.Distance(before, this.root.position);
  }

  private updateFacing(dt: number): void {
    const speed = this.speed;
    if (speed > 0.6) {
      this.heading.set(this.velocity.x / speed, 0, this.velocity.z / speed);
      const yaw = Math.atan2(this.heading.x, this.heading.z);
      let difference = yaw - this.previousYaw;
      while (difference > Math.PI) difference -= Math.PI * 2;
      while (difference < -Math.PI) difference += Math.PI * 2;
      this.lastTurn = difference / Math.max(dt, 1e-4) * 0.12;
      this.previousYaw = yaw;
      this.root.rotation.y = yaw;
    } else {
      this.lastTurn *= 0.9;
    }
  }

  private animate(dt: number): void {
    const speed = this.speed;
    this.model.pose({
      dt,
      speed,
      speedRatio: this.speedRatio,
      grounded: this.grounded,
      wallSide: this.state === "wall" ? this.wallSide : 0,
      verticalRun: this.state === "vertical",
      sliding: this.state === "slide",
      strike: this.strikeTimer,
      turn: this.lastTurn,
    });
    this.model.setCharge(this.speedRatio, this.focusHeld);

    // Foot plants drive dust puffs and step audio.
    if (this.grounded && speed > 2) {
      this.strideClock += dt * Math.min(26, 3.2 + speed * 0.62);
      if (this.strideClock > Math.PI) {
        this.strideClock -= Math.PI;
        this.events.footstep = true;
      }
    }
  }

  /* ---------------- abilities and state ---------------- */

  canStrike(): boolean {
    return this.strikeCooldown <= 0;
  }

  useStrike(): void {
    this.strikeCooldown = 0.24;
    this.strikeTimer = 0.22;
    this.events.struck = true;
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
    this.invulnerable = Math.max(this.invulnerable, 0.25);
  }

  useFocus(dt: number): boolean {
    if (this.charge <= 0.25) return false;
    this.charge = Math.max(0, this.charge - 20 * dt);
    return true;
  }

  registerHit(power = 1): void {
    this.combo = Math.min(15, this.combo + 1);
    this.comboTimer = 3;
    this.charge = Math.min(100, this.charge + 5 + power * 3);
  }

  damage(amount: number, source: Vector3): boolean {
    if (this.invulnerable > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.secondsSinceDamage = 0;
    this.invulnerable = 0.55;
    this.combo = 1;

    const awayX = this.root.position.x - source.x;
    const awayZ = this.root.position.z - source.z;
    const length = Math.hypot(awayX, awayZ);
    if (length > 0.01) {
      this.velocity.x += (awayX / length) * 22;
      this.velocity.z += (awayZ / length) * 22;
      this.velocity.y = Math.max(this.velocity.y, 5);
      if (this.state === "wall" || this.state === "vertical") this.detachWall(0.4);
    }
    return true;
  }

  teleport(position: Vector3): void {
    this.root.position.copyFrom(position);
    this.velocity.setAll(0);
    this.state = "ground";
    this.climbSpeed = 0;
    this.sinkTimer = 0;
  }

  recover(city: City): void {
    const safe = city.nearestRoad(this.root.position);
    this.teleport(safe);
    this.health = Math.max(this.health, 35);
  }

  private resetEvents(): void {
    const e = this.events;
    e.landed = false;
    e.jumped = false;
    e.wallJumped = false;
    e.dashed = false;
    e.footstep = false;
    e.waterSpray = false;
    e.sank = false;
    e.struck = false;
  }

  private tickResources(dt: number): void {
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.boltCooldown = Math.max(0, this.boltCooldown - dt);
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    this.strikeCooldown = Math.max(0, this.strikeCooldown - dt);
    this.strikeTimer = Math.max(0, this.strikeTimer - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.secondsSinceDamage += dt;

    if (this.comboTimer <= 0) this.combo = 1;
    if (this.speed > 40) {
      this.charge = Math.min(100, this.charge + dt * (2.5 + this.speedRatio * 4.5));
    }
    if (this.secondsSinceDamage > 5 && this.health < 100) {
      this.health = Math.min(100, this.health + dt * 4);
    }
    this.health = clamp(this.health, 0, 100);
  }
}
