import HavokPhysics from "@babylonjs/havok";
import {
  Color3,
  FreeCamera,
  GlowLayer,
  HavokPlugin,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { City } from "./City";
import { Enemy } from "./Enemy";
import { Hud } from "./Hud";
import { Input } from "./Input";
import { Player } from "./Player";
import { TimeTrial, formatTime } from "./TimeTrial";
import { createBestEngine } from "./engine";

interface Effect {
  mesh: Mesh | LinesMesh;
  age: number;
  duration: number;
  grow: number;
}

export class SpeedGame {
  private readonly input: Input;
  private scene!: Scene;
  private city!: City;
  private player!: Player;
  private enemies: Enemy[] = [];
  private camera!: FreeCamera;
  private hud!: Hud;
  private trial!: TimeTrial;
  private effects: Effect[] = [];
  private accumulator = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.18;
  private focusActive = false;
  private readonly dashVictims = new Set<number>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
  }

  async boot(): Promise<void> {
    const loadingStatus = document.getElementById("loading-status");
    if (loadingStatus) loadingStatus.textContent = "Negotiating with the GPU…";

    const { engine, renderer } = await createBestEngine(this.canvas);
    this.scene = new Scene(engine);

    if (loadingStatus) loadingStatus.textContent = "Waking Havok Physics V2…";
    try {
      const havok = await HavokPhysics();
      const plugin = new HavokPlugin(true, havok);
      this.scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
    } catch (error) {
      console.warn("Havok failed to initialize; the kinematic controller remains playable.", error);
    }

    if (loadingStatus) loadingStatus.textContent = "Building 2.5 km of Meridian City…";
    this.city = new City(this.scene);
    this.player = new Player(this.scene, this.city.start);
    this.enemies = this.city.enemySpawns.map(
      (spawn, index) => new Enemy(this.scene, index, spawn),
    );
    this.trial = new TimeTrial(this.scene, this.city.checkpointRoute);
    this.hud = new Hud(this.city.extent);
    this.hud.setRenderer(renderer);

    this.camera = new FreeCamera(
      "speed-camera",
      this.player.root.position.add(new Vector3(0, 7, -16)),
      this.scene,
    );
    this.camera.minZ = 0.08;
    this.camera.maxZ = 5200;
    this.camera.fov = 0.92;
    this.scene.activeCamera = this.camera;

    const glow = new GlowLayer("city-glow", this.scene, {
      blurKernelSize: 32,
    });
    glow.intensity = 0.7;

    this.scene.executeWhenReady(() => {
      document.getElementById("loading")?.classList.add("is-hidden");
      document.getElementById("hud")?.classList.remove("is-hidden");
      this.hud.toast("Welcome to Meridian");
    });

    window.addEventListener("resize", () => engine.resize());

    engine.runRenderLoop(() => {
      const frameDt = Math.min(0.05, engine.getDeltaTime() / 1000);
      this.accumulator = Math.min(0.1, this.accumulator + frameDt);

      let steps = 0;
      while (this.accumulator >= 1 / 120 && steps < 12) {
        this.fixedUpdate(1 / 120);
        this.accumulator -= 1 / 120;
        steps += 1;
      }

      this.updateCamera(frameDt);
      this.updateEffects(frameDt);
      this.hud.update(this.player, this.enemies, this.trial, this.focusActive);
      this.scene.render();
    });
  }

  private fixedUpdate(dt: number): void {
    if (this.input.consume("KeyT")) {
      this.trial.start();
      this.hud.toast("Meridian Loop started");
    }

    this.player.update(dt, this.input, this.cameraYaw, this.city);
    this.focusActive = this.input.down("KeyF") && this.player.useFocus(dt);

    this.handleCombat();
    this.handleEnemies(dt);
    this.handleTrial(dt);

    if (this.player.health <= 0) {
      this.player.health = 40;
      this.player.recover(this.city);
      this.hud.toast("Timeline reset");
    }
  }

  private handleCombat(): void {
    if (!this.player.dashing) this.dashVictims.clear();

    if (this.player.dashing) {
      for (const enemy of this.enemies) {
        if (
          enemy.alive &&
          !this.dashVictims.has(enemy.id) &&
          Vector3.DistanceSquared(enemy.position, this.player.root.position) < 6.5 * 6.5
        ) {
          this.dashVictims.add(enemy.id);
          const impulse = this.forward().scale(75);
          const defeated = enemy.hit(2.5, impulse);
          this.player.registerHit(2);
          this.spawnPulse(enemy.position, "#ffc857", 5);
          this.hud.flashAbility("ability-dash");
          if (defeated) this.hud.toast("Drone outrun");
        }
      }
    }

    if (this.input.consume("Mouse0") && this.player.canStrike()) {
      this.player.useStrike();
      const target = this.findTarget(16, -0.35);
      if (target) {
        const damage = 1.25 + this.player.speedRatio * 1.5;
        const defeated = target.hit(damage, this.forward().scale(34));
        this.player.registerHit();
        this.spawnPulse(target.position, "#fff1ac", 3);
        if (defeated) this.hud.toast("Velocity takedown");
      } else {
        this.spawnPulse(this.player.root.position, "#9c6bff", 1.5);
      }
    }

    if (this.input.consume("KeyE") && this.player.canBolt()) {
      const target = this.findTarget(125, 0.15);
      if (target) {
        this.player.useBolt();
        const from = this.player.root.position.add(new Vector3(0, 2.4, 0));
        const to = target.position.clone();
        const defeated = target.hit(2.15, to.subtract(from).normalize().scale(20));
        this.spawnBolt(from, to);
        this.player.registerHit(1.5);
        this.hud.flashAbility("ability-bolt");
        if (defeated) this.hud.toast("Circuit broken");
      } else {
        this.hud.toast("No target in arc");
      }
    }

    if (this.input.consume("KeyQ") && this.player.canPulse()) {
      this.player.usePulse();
      let hitCount = 0;
      for (const enemy of this.enemies) {
        const away = enemy.position.subtract(this.player.root.position);
        const distance = away.length();
        if (!enemy.alive || distance > 38 || distance < 0.01) continue;
        const defeated = enemy.hit(2.4, away.scale(58 / distance));
        hitCount += 1;
        this.player.registerHit(1.5);
        if (defeated) this.hud.toast("Pulse takedown");
      }
      this.spawnPulse(this.player.root.position, "#63f3ff", 18);
      this.hud.flashAbility("ability-pulse");
      if (hitCount === 0) this.hud.toast("Kinetic pulse");
    }
  }

  private handleEnemies(dt: number): void {
    const enemyDt = dt * (this.focusActive ? 0.13 : 1);
    for (const enemy of this.enemies) {
      const damage = enemy.update(enemyDt, this.player.root.position);
      if (damage > 0 && this.player.damage(damage, enemy.position)) {
        this.spawnPulse(this.player.root.position, "#ff416c", 4);
        this.hud.toast("Dampener strike");
      }
    }
  }

  private handleTrial(dt: number): void {
    const update = this.trial.update(dt, this.player.root.position);
    if (update.checkpoint && !update.finished) {
      this.player.charge = Math.min(100, this.player.charge + 12);
      this.hud.toast("Split captured");
    }
    if (update.finished) {
      this.hud.toast(
        update.newBest
          ? `New best · ${formatTime(this.trial.elapsed)}`
          : `Loop clear · ${formatTime(this.trial.elapsed)}`,
      );
    }
  }

  private updateCamera(dt: number): void {
    const look = this.input.takeLook();
    this.cameraYaw -= look.x * 0.00215;
    this.cameraPitch = clamp(this.cameraPitch - look.y * 0.0016, -0.08, 0.48);

    const forward = new Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));
    const speedRatio = this.player.speedRatio;
    const distance = 12 + speedRatio * 19;
    const height = 5.2 + speedRatio * 6 + this.cameraPitch * 16;
    const desired = this.player.root.position
      .subtract(forward.scale(distance))
      .addInPlaceFromFloats(0, height, 0);

    const smoothing = 1 - Math.exp(-(7.5 - speedRatio * 3.5) * dt);
    Vector3.LerpToRef(this.camera.position, desired, smoothing, this.camera.position);
    const target = this.player.root.position
      .add(forward.scale(5 + speedRatio * 24))
      .addInPlaceFromFloats(0, 2.1 + this.cameraPitch * 3, 0);
    this.camera.setTarget(target);
    this.camera.fov = 0.9 + speedRatio * 0.3 + (this.focusActive ? 0.06 : 0);
  }

  private updateEffects(dt: number): void {
    const survivors: Effect[] = [];
    for (const effect of this.effects) {
      effect.age += dt;
      const progress = Math.min(1, effect.age / effect.duration);
      effect.mesh.visibility = 1 - progress;
      if (effect.grow > 0) {
        effect.mesh.scaling.setAll(0.2 + progress * effect.grow);
      }
      if (progress >= 1) {
        effect.mesh.dispose();
      } else {
        survivors.push(effect);
      }
    }
    this.effects = survivors;
  }

  private findTarget(maxDistance: number, minDot: number): Enemy | null {
    const origin = this.player.root.position;
    const forward = this.forward();
    let best: Enemy | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const offset = enemy.position.subtract(origin);
      const distance = offset.length();
      if (distance > maxDistance || distance < 0.01) continue;
      const dot = Vector3.Dot(offset.scale(1 / distance), forward);
      if (dot < minDot) continue;
      const score = distance * (1.35 - dot);
      if (score < bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    return best;
  }

  private forward(): Vector3 {
    if (this.player.speed > 1) return this.player.velocity.normalizeToNew();
    return new Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));
  }

  private spawnPulse(position: Vector3, color: string, diameter: number): void {
    const ring = MeshBuilder.CreateTorus(
      "combat-pulse",
      { diameter, thickness: Math.max(0.08, diameter * 0.03), tessellation: 36 },
      this.scene,
    );
    ring.position.copyFrom(position);
    ring.position.y += 0.45;
    const pulseMaterial = new StandardMaterial("combat-pulse-material", this.scene);
    pulseMaterial.diffuseColor = Color3.FromHexString(color);
    pulseMaterial.emissiveColor = Color3.FromHexString(color);
    pulseMaterial.disableLighting = true;
    ring.material = pulseMaterial;
    this.effects.push({ mesh: ring, age: 0, duration: 0.45, grow: 2.8 });
  }

  private spawnBolt(from: Vector3, to: Vector3): void {
    const middle = Vector3.Lerp(from, to, 0.5);
    middle.addInPlaceFromFloats(
      (Math.random() - 0.5) * 4,
      2 + Math.random() * 3,
      (Math.random() - 0.5) * 4,
    );
    const bolt = MeshBuilder.CreateLines(
      "arc-bolt",
      { points: [from, Vector3.Lerp(from, middle, 0.55), middle, Vector3.Lerp(middle, to, 0.55), to] },
      this.scene,
    );
    bolt.color = Color3.FromHexString("#65f4ff");
    this.effects.push({ mesh: bolt, age: 0, duration: 0.18, grow: 0 });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
