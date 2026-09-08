import HavokPhysics from "@babylonjs/havok";
import {
  Color4,
  DefaultRenderingPipeline,
  FreeCamera,
  HavokPlugin,
  ImageProcessingConfiguration,
  Matrix,
  PointLight,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { Input } from "./core/Input";
import { constrainChaseCamera } from "./core/ChaseCamera";
import { clamp, damp, mulberry32, type Rng } from "./core/Rng";
import { Save, type Quality } from "./core/Save";
import { createBestEngine } from "./core/engine";
import { CityLife } from "./world/CityLife";
import { Soundscape } from "./audio/Soundscape";
import { RouteGhost } from "./fx/RouteGhost";
import { City } from "./world/City";
import { Player } from "./player/Player";
import { Effects } from "./fx/Effects";
import { Markers, type MarkerEntry } from "./fx/Markers";
import { Rogue, rogueById } from "./npc/Rogue";
import { Bystander, createBystanderMaterials } from "./npc/Bystander";
import { Collectibles } from "./activities/Collectibles";
import { RouteRun } from "./activities/RouteRun";
import { RescueRun } from "./activities/RescueRun";
import { RogueDuel } from "./activities/RogueDuel";
import { buildRoutes } from "./activities/routes";
import type { Activity, ActivityStatus, ActivityWorld } from "./activities/Activity";
import { Campaign } from "./story/Campaign";
import type { Chapter } from "./story/script";
import { CHAPTERS } from "./story/script";
import { Hud, type HudState } from "./ui/Hud";
import { Dialogue } from "./ui/Dialogue";
import { Menu } from "./ui/Menu";

type Mode = "menu" | "free" | "story";

const STEP = 1 / 120;
const BYSTANDER_POOL = 14;

/**
 * The shell.
 *
 * Owns the engine, the scene and the fixed-step loop, and hosts exactly two
 * modes over one shared world: free roam and the campaign. Both drive the
 * same city, player, effects and HUD — the difference is only who is deciding
 * what the objective is.
 */
export class SpeedGame {
  private readonly input: Input;
  private readonly save = new Save();
  private readonly rng: Rng = mulberry32(0x5eed10);

  private scene!: Scene;
  private city!: City;
  private cityLife!: CityLife;
  private readonly sound = new Soundscape();
  private routeGhost!: RouteGhost;
  private player!: Player;
  private camera!: FreeCamera;
  private pipeline!: DefaultRenderingPipeline;
  private effects!: Effects;
  private heroFill!: PointLight;
  private menuClock = 0;
  private markers!: Markers;
  private collectibles!: Collectibles;
  private hud!: Hud;
  private dialogue!: Dialogue;
  private menu!: Menu;
  private world!: ActivityWorld;

  private readonly rogues: Rogue[] = [];
  private readonly bystanders: Bystander[] = [];
  private bystandersInUse = 0;

  private available: Activity[] = [];
  private activitySites: NonNullable<HudState["activitySites"]> = [];
  private activity: Activity | null = null;
  private campaign: Campaign | null = null;
  private chapter: Chapter | null = null;
  private mode: Mode = "menu";

  private accumulator = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.16;
  private cameraRoll = 0;
  private shake = 0;
  private focusActive = false;
  private saveClock = 0;
  private peakSpeed = 0;
  private paused = true;
  private nearestActivity: Activity | null = null;
  /** What the results card is reporting; the primary button branches on it. */
  private lastResult: "complete" | "failed" = "complete";

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
  }

  async boot(): Promise<void> {
    const status = document.getElementById("loading-status");
    const say = (message: string): void => {
      if (status) status.textContent = message;
    };

    say("Negotiating with the GPU…");
    const { engine, renderer } = await createBestEngine(this.canvas);
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.05, 0.06, 0.07, 1);

    say("Waking Havok Physics V2…");
    try {
      const havok = await HavokPhysics();
      this.scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    } catch (error) {
      console.warn("Havok failed to initialize; the kinematic controller remains playable.", error);
    }

    const quality = this.save.settings.quality;

    say("Opening the boroughs of Meridian…");
    this.city = new City(this.scene, quality);
    this.cityLife = new CityLife(this.scene, this.city, quality);
    this.routeGhost = new RouteGhost(this.scene);

    say("Suiting up…");
    this.player = new Player(this.scene, this.city.start);
    this.city.addShadowCaster(this.player.model.shadowCaster);

    this.effects = new Effects(this.scene, this.player.model.ghostSource, quality, this.player.model.trailAnchors);
    this.effects.setReducedMotion(this.save.settings.reducedMotion);
    this.markers = new Markers(this.scene);
    this.collectibles = new Collectibles(this.scene, this.city, this.rng, this.save);

    const bystanderMaterials = createBystanderMaterials(this.scene);
    for (let i = 0; i < BYSTANDER_POOL; i += 1) {
      const bystander = new Bystander(this.scene, this.rng, bystanderMaterials);
      bystander.setEnabled(false);
      this.bystanders.push(bystander);
    }

    this.setupCamera(quality);
    this.heroFill = new PointLight("hero-soft-fill", this.camera.position.clone(), this.scene);
    this.heroFill.diffuse.set(0.66, 0.8, 1);
    this.heroFill.intensity = 5;
    this.heroFill.range = 12;
    this.heroFill.includedOnlyMeshes = this.player.root.getChildMeshes();

    this.hud = new Hud(this.city, () => this.toggleMap());
    this.hud.setRenderer(renderer);
    this.dialogue = new Dialogue(this.input);
    this.menu = new Menu(this.save, {
      onFreeRoam: () => this.startFreeRoam(),
      onChapter: (chapter) => this.startChapter(chapter),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuit: () => this.returnToMenu(),
      onResultsPrimary: () => this.continueFromResults(),
      onSettingsChanged: () => this.applySettings(),
    });

    this.world = this.createWorld();
    this.available = this.buildFreeRoamActivities();
    this.activitySites = this.available.map(activity => ({ name: activity.name, position: activity.anchor, kind: activity instanceof RouteRun ? "route" : activity instanceof RescueRun ? "rescue" : "duel" }));
    this.applySettings();

    this.wireGlobalInput();
    this.finishBoot(engine);
  }

  /* ------------------------------------------------------------------ */
  /* Boot helpers                                                        */
  /* ------------------------------------------------------------------ */

  private setupCamera(quality: Quality): void {
    this.camera = new FreeCamera("chase-camera", this.city.start.add(new Vector3(0, 4, -9)), this.scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = this.city.extent * 3.2;
    this.camera.fov = 0.95;
    this.scene.activeCamera = this.camera;

    // Filmic stack: ACES tone mapping, bloom for glass and emissives, FXAA,
    // and a speed-driven chromatic aberration that only shows up at pace.
    this.pipeline = new DefaultRenderingPipeline("photographic", true, this.scene, [this.camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomEnabled = quality !== "low";
    this.pipeline.bloomThreshold = 1.1;
    this.pipeline.bloomWeight = 0.16;
    this.pipeline.bloomKernel = 48;
    this.pipeline.bloomScale = 0.5;
    this.pipeline.chromaticAberrationEnabled = quality !== "low";
    this.pipeline.chromaticAberration.aberrationAmount = 0;
    this.pipeline.grainEnabled = false;
    this.pipeline.sharpenEnabled = quality === "high";
    this.pipeline.sharpen.edgeAmount = 0.12;

    const processing = this.scene.imageProcessingConfiguration;
    processing.toneMappingEnabled = true;
    processing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    processing.exposure = 1.1;
    processing.contrast = 1.12;
    processing.vignetteEnabled = true;
    processing.vignetteWeight = 0.8;
    processing.vignetteColor = new Color4(0.03, 0.03, 0.04, 0);
  }

  private finishBoot(engine: {
    resize(): void;
    getDeltaTime(): number;
    runRenderLoop(fn: () => void): void;
  }): void {
    this.scene.executeWhenReady(() => {
      document.getElementById("loading")?.classList.add("is-hidden");
      this.input.setEnabled(false);
      this.menu.show();
    });

    window.addEventListener("resize", () => engine.resize());

    engine.runRenderLoop(() => {
      const frameDt = Math.min(0.05, engine.getDeltaTime() / 1000);

      const gamepadMap = this.input.pollMap();
      if (gamepadMap && this.mode !== "menu" && !this.menu.resultsVisible && (!this.paused || this.hud.isMapOpen)) this.toggleMap();
      const gamepadPause = this.input.pollPause();
      if (gamepadPause && this.mode !== "menu" && !this.menu.resultsVisible) {
        if (this.hud.isMapOpen) this.toggleMap();
        else if (this.paused) this.resume();
        else this.pauseGame();
      }

      if (!this.paused) {
        this.accumulator = Math.min(0.12, this.accumulator + frameDt);
        let steps = 0;
        // Bounded catch-up: a long stall must not spiral into a freeze.
        while (this.accumulator >= STEP && steps < 12) {
          this.fixedUpdate(STEP);
          this.accumulator -= STEP;
          steps += 1;
          if (this.paused) { this.accumulator = 0; break; }
        }
        this.updateCamera(frameDt);
        this.effects.update(frameDt, this.player, this.focusActive);
        this.markers.update(frameDt, this.player.position);
        this.city.sky.update(frameDt);
        this.city.palette.update(frameDt, this.city.sky.nightAmount);
        this.city.updateStreaming(this.player.position);
        this.cityLife.update(frameDt, this.player.position, this.focusActive ? 0.16 : 1);
        this.routeGhost.update(this.activity instanceof RouteRun ? this.activity.replayPose() : null, this.player.position, !this.save.settings.reducedMotion);
        this.sound.update(frameDt, this.player.speedRatio, this.focusActive, this.city.sky.nightAmount);
        this.scene.imageProcessingConfiguration.exposure = this.city.sky.exposure;
        this.hud.update(frameDt, this.player, this.hudState());
      }

      this.sound.setPaused(this.paused || this.dialogue.active || document.hidden);
      if (this.mode === "menu") this.updateShowcase(frameDt);
      this.heroFill.position.copyFrom(this.camera.position);
      this.scene.render();
    });
  }

  private wireGlobalInput(): void {
    window.addEventListener("blur", () => {
      if (this.mode !== "menu" && !this.paused && !this.menu.resultsVisible) this.pauseGame();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.sound.setPaused(true);
        if (this.mode !== "menu" && !this.paused && !this.menu.resultsVisible) this.pauseGame();
        this.save.flush();
      }
    });
    window.addEventListener("pagehide", () => this.save.flush());
    this.canvas.addEventListener("click", () => {
      if (this.mode !== "menu" && !this.paused && !this.dialogue.active) {
        this.input.requestPointerLock();
        void this.sound.unlock();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      if (event.code === "KeyM" && this.hud.isMapOpen) {
        event.preventDefault();
        this.toggleMap();
        return;
      }
      if (event.code === "Escape") {
        if (this.mode === "menu") return;
        if (this.menu.resultsVisible) return;
        if (this.hud.isMapOpen) this.toggleMap();
        else if (this.paused) this.resume();
        else this.pauseGame();
      }
    });
  }

  private createWorld(): ActivityWorld {
    return {
      city: this.city,
      player: this.player,
      effects: this.effects,
      save: this.save,
      rng: this.rng,
      toast: (message: string) => this.hud.toast(message),
      spawnRogue: (id: string, position: Vector3) => {
        const rogue = new Rogue(this.scene, rogueById(id), position);
        this.city.addShadowCaster(rogue.shadowCaster);
        this.rogues.push(rogue);
        return rogue;
      },
      clearRogues: () => {
        for (const rogue of this.rogues) rogue.dispose();
        this.rogues.length = 0;
      },
      activeRogues: () => this.rogues,
      takeBystander: () => {
        const bystander = this.bystanders[this.bystandersInUse];
        if (!bystander) return null;
        this.bystandersInUse += 1;
        return bystander;
      },
      releaseBystanders: () => {
        for (const bystander of this.bystanders) {
          bystander.setEnabled(false);
          bystander.mood = "idle";
        }
        this.bystandersInUse = 0;
      },
    };
  }

  private buildFreeRoamActivities(): Activity[] {
    const activities: Activity[] = [];
    for (const route of buildRoutes(this.city)) activities.push(new RouteRun(route));

    activities.push(
      new RescueRun(
        "rescue-old-meridian",
        "Warehouse Collapse",
        this.city.nearestRoad(new Vector3(-450, 0, -900)),
        7,
        70,
        340,
      ),
      new RescueRun("rescue-northline", "Last Train Out", this.city.landmark("northline-station").position.clone(), 8, 75, 400),
      new RescueRun("rescue-westhaven", "Reservoir Evacuation", this.city.landmark("westhaven-reservoir").position.clone(), 9, 80, 420),
      new RescueRun("rescue-foundry", "Shift Change", this.city.landmark("foundry-exchange").position.clone(), 8, 70, 360),
      new RescueRun("rescue-saltmere", "The Stranded Ferry", this.city.landmark("saltmere-terminal").position.clone(), 7, 65, 320),
      new RescueRun(
        "rescue-docks",
        "Container Stack Failure",
        this.city.nearestRoad(new Vector3(1350, 0, 300)),
        6,
        62,
        300,
      ),
    );

    // Duels are parked at landmarks so the city itself tells you where a
    // fight lives, and they only spawn anybody once you say go.
    const duelSpots: Array<[string, string]> = [
      ["kiln", "sable-arena"],
      ["gale", "ledger-tower"],
      ["coldsnap", "ridgeline-transit"],
      ["ricochet", "kestrel-bridge"],
      ["hollow", "corbin-green"],
      ["vantage", "beacon-point"],
    ];
    for (const [rogue, landmark] of duelSpots) {
      activities.push(new RogueDuel(rogue, this.city.landmark(landmark).position.clone()));
    }

    return activities;
  }

  private applySettings(): void {
    const settings = this.save.settings;
    this.input.lookSensitivity = settings.lookSensitivity;
    this.sound.setVolume(settings.muted ? 0 : settings.masterVolume);
    this.cityLife.setQuality(settings.quality);
    this.effects.setReducedMotion(settings.reducedMotion);
    this.city.sky.setReducedMotion(settings.reducedMotion);
    document.documentElement.classList.toggle("reduced-motion", settings.reducedMotion);
    this.city.setDetailRadius(
      settings.quality === "low" ? 260 : settings.quality === "medium" ? 420 : 620,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Mode control                                                        */
  /* ------------------------------------------------------------------ */

  private startFreeRoam(): void {
    this.teardownRun();
    this.collectibles.syncFromSave();
    this.mode = "free";
    this.chapter = null;
    this.city.sky.setAtmosphere("golden", true);
    this.input.releaseAll();
    this.player.teleport(this.city.start);
    this.resetChaseCamera();
    this.player.health = 100;
    this.player.charge = 50;
    this.hud.setVisible(true);
    this.hud.toast("Meridian City — open");
    this.resume();
  }

  private startChapter(chapter: Chapter): void {
    this.teardownRun();
    this.collectibles.syncFromSave();
    this.mode = "story";
    this.chapter = chapter;
    this.player.health = 100;
    this.player.charge = 60;
    this.campaign = new Campaign(chapter, this.world, this.dialogue, this.save.data.campaign.choices);
    this.campaign.start();
    this.resetChaseCamera();
    this.input.releaseAll();
    this.save.update((profile) => {
      profile.campaign.current = chapter.id;
    });
    this.hud.setVisible(true);
    this.hud.toast(`${chapter.title}`);
    this.resume();
  }

  private restart(): void {
    if (this.mode === "story" && this.chapter) {
      const chapter = this.chapter;
      this.menu.hidePause();
      this.startChapter(chapter);
      return;
    }
    this.menu.hidePause();
    this.startFreeRoam();
  }

  private returnToMenu(): void {
    this.teardownRun();
    this.collectibles.syncFromSave();
    this.mode = "menu";
    this.paused = true;
    this.hud.setVisible(false);
    this.hud.closeMap();
    this.menu.hidePause();
    this.menu.hideResults();
    this.input.releasePointerLock();
    this.input.setEnabled(false);
    this.save.flush();
    this.city.sky.setAtmosphere("golden", true);
    this.player.teleport(this.city.start);
    this.player.model.resetPose();
    this.menu.show();
  }

  private teardownRun(): void {
    this.trackProfile(2);
    this.activity?.stop(this.world);
    this.activity = null;
    this.campaign?.stop();
    this.campaign = null;
    this.world.clearRogues();
    this.world.releaseBystanders();
    this.markers.clear();
    this.effects.reset();
    this.routeGhost.update(null, this.player.position, false);
    this.focusActive = false;
    this.dialogue.hide();
    this.peakSpeed = 0;
    this.accumulator = 0;
  }

  private toggleMap(): void {
    if (this.mode === "menu" || this.menu.resultsVisible) return;
    if (this.hud.isMapOpen) {
      this.hud.closeMap();
      this.resume();
      return;
    }
    if (this.paused) return;
    this.hud.update(0, this.player, this.hudState());
    this.hud.toggleMap();
    this.paused = true;
    this.accumulator = 0;
    this.sound.setPaused(true);
    this.input.setEnabled(false);
    this.input.releasePointerLock();
  }

  private pauseGame(): void {
    if (this.mode === "menu") return;
    this.paused = true;
    this.sound.setPaused(true);
    this.input.setEnabled(false);
    this.input.releasePointerLock();
    this.menu.showPause(this.chapter ? this.chapter.title : "Meridian City");
  }

  private resume(): void {
    void this.sound.unlock();
    this.sound.setPaused(false);
    this.hud.closeMap();
    this.menu.hidePause();
    this.menu.hideResults();
    this.paused = false;
    this.input.setEnabled(true);
    this.accumulator = 0;
  }

  private continueFromResults(): void {
    this.menu.hideResults();

    if (this.mode === "story" && this.chapter) {
      // The button says "Retry chapter" on a failure and "Next chapter" on a
      // win. One handler serves both, so it has to know which it is.
      if (this.lastResult === "failed") {
        this.startChapter(this.chapter);
        return;
      }
      const next = CHAPTERS[CHAPTERS.indexOf(this.chapter) + 1];
      if (next && next.number <= this.save.data.campaign.unlocked) {
        this.startChapter(next);
        return;
      }
      this.returnToMenu();
      return;
    }
    this.resume();
  }

  /* ------------------------------------------------------------------ */
  /* Simulation                                                          */
  /* ------------------------------------------------------------------ */

  private fixedUpdate(dt: number): void {
    // Sample pad edges once per step, alongside the keyboard's.
    this.input.poll();
    const talking = this.dialogue.active;

    if (this.input.consume("map")) { this.toggleMap(); return; }
    if (this.activity instanceof RouteRun && this.input.peek("recover")) this.activity.noteRecovery();
    if (talking) {
      // The dialogue shares its advance key with jump, so the player must not
      // read input at all while a conversation is up — it would eat the press.
      this.focusActive = false;
      this.player.idle(dt, this.city);
    } else {
      const events = this.player.update(dt, this.input, this.cameraYaw, this.city);
      this.focusActive = this.input.down("focus") && this.player.useFocus(dt);
      this.player.focusHeld = this.focusActive;
      this.handlePlayerEvents(events);
      this.handleCombat();
    }

    const npcDt = this.focusActive ? dt * 0.16 : dt;
    this.updateRogues(npcDt);
    for (const bystander of this.bystanders) bystander.update(npcDt);

    if (this.collectibles.update(dt, this.player.position, this.effects)) {
      this.hud.toast(`Resonance mote · ${this.collectibles.found}/${this.collectibles.total}`);
      this.player.charge = Math.min(100, this.player.charge + 8);
      this.sound.play("pickup");
    }

    if (this.mode === "story") this.updateStory(dt);
    else this.updateFreeRoam(dt);

    if (this.player.health <= 0) this.handleDown();

    this.markers.set(this.currentMarkers());
    this.trackProfile(dt);
  }

  private updateStory(dt: number): void {
    const campaign = this.campaign;
    if (!campaign) return;
    const result = campaign.update(dt, this.input);
    if (result === "complete") {
      const chapter = campaign.chapter;
      const index = CHAPTERS.indexOf(chapter);
      if (campaign.choice !== null) this.save.update(profile => { profile.campaign.choices[chapter.id] = campaign.choice!; });
      this.save.completeChapter(chapter.id, index);
      const next = CHAPTERS[index + 1];
      campaign.stop();
      this.campaign = null;
      this.paused = true;
      this.input.releasePointerLock();
      this.input.setEnabled(false);
      this.lastResult = "complete";
      this.menu.showResults(
        `Chapter ${chapter.number} complete`,
        chapter.title,
        next
          ? `${chapter.subtitle}. Next: ${next.title} — ${next.subtitle}.`
          : "Every address is back on the map. Meridian is yours to explore.",
        next ? "Next chapter" : "Back to menu",
      );
    } else if (result === "failed") {
      campaign.stop();
      this.campaign = null;
      this.paused = true;
      this.input.releasePointerLock();
      this.input.setEnabled(false);
      this.lastResult = "failed";
      this.menu.showResults(
        "Chapter failed",
        campaign.chapter.title,
        "Meridian is still standing. Take it again from the top of the chapter.",
        "Retry chapter",
      );
    }
  }

  private updateFreeRoam(dt: number): void {
    // Offer whatever is closest; T starts it, or abandons a running one.
    this.nearestActivity = this.activity ? null : this.findNearestActivity();

    if (this.input.consume("activity")) {
      if (this.activity) {
        this.activity.stop(this.world);
        this.activity = null;
        this.hud.toast("Activity abandoned");
      } else if (this.nearestActivity) {
        this.activity = this.nearestActivity;
        this.activity.start(this.world);
      } else {
        this.hud.toast("Nothing to start here — look for a marker");
      }
    }

    const activity = this.activity;
    if (!activity) return;

    const result = activity.update(dt, this.world);
    if (result === "complete") {
      this.hud.toast(activity.successMessage());
      this.sound.play("success");
      activity.stop(this.world);
      this.activity = null;
    } else if (result === "failed") {
      this.hud.toast(`${activity.name} failed`);
      this.sound.play("failure");
      activity.stop(this.world);
      this.activity = null;
    }
  }

  private findNearestActivity(): Activity | null {
    let best: Activity | null = null;
    let bestSq = 150 * 150;
    for (const candidate of this.available) {
      const distanceSq = Vector3.DistanceSquared(candidate.anchor, this.player.position);
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        best = candidate;
      }
    }
    return best;
  }

  private handleDown(): void {
    this.player.health = 45;
    this.player.recover(this.city);
    this.effects.pulse(this.player.position, "danger", 12);
    this.hud.toast("Pulled out — you are not invincible");
    if (this.activity) {
      this.activity.stop(this.world);
      this.activity = null;
    }
  }

  private handlePlayerEvents(events: ReturnType<Player["update"]>): void {
    const position = this.player.position;
    if (events.landed) {
      this.sound.play("land");
      this.effects.burst(position, 14, "pale");
      this.shake = Math.max(this.shake, 0.35);
    }
    if (events.jumped) { this.effects.pulse(position, "pale", 4, 0.3); this.sound.play("jump"); }
    if (events.wallJumped) {
      this.sound.play("jump");
      this.effects.pulse(position, "cool", 6, 0.3);
      this.effects.burst(position, 12, "cool");
    }
    if (events.dashed) {
      this.sound.play("dash");
      this.effects.pulse(position, "warm", 9, 0.32);
      this.shake = Math.max(this.shake, 0.5);
    }
    if (events.footstep) this.sound.play("step");
    if (events.footstep && this.player.speed > 60) this.effects.burst(position, 4, "pale");
    if (events.waterSpray) { this.effects.burst(position, 6, "cool"); this.sound.play("water"); }
    if (events.sank) this.hud.toast("Too slow across the river");
    if (events.struck) this.hud.flashAbility("ability-dash");
  }

  /* ---------------- combat ---------------- */

  private handleCombat(): void {
    const player = this.player;
    const position = player.position;

    // Body checks: at pace, contact is the attack.
    if (player.speed > 85 || player.dashing) {
      for (const rogue of this.rogues) {
        if (!rogue.alive) continue;
        if (Vector3.DistanceSquared(rogue.position, position) > 5 * 5) continue;
        const accepted = rogue.vulnerable;
        const power = 1.5 + player.speedRatio * 2.5;
        const heading = player.velocity.normalizeToNew();
        if (rogue.hit(power, heading.x * 30, heading.z * 30)) this.onRogueDefeated(rogue);
        else this.effects.pulse(rogue.position, "warm", 6);
        if (accepted) player.registerHit(2);
      }
    }

    if (this.input.consume("strike") && player.canStrike()) {
      player.useStrike();
      this.sound.play("strike");
      const target = this.findTarget(14, -0.3);
      if (target) {
        const accepted = target.vulnerable;
        const damage = 1.4 + player.speedRatio * 1.8;
        const heading = this.headingVector();
        if (target.hit(damage, heading.x * 22, heading.z * 22)) this.onRogueDefeated(target);
        else this.effects.pulse(target.position, "warm", 4);
        this.effects.burst(target.position, 16, "warm");
        if (accepted) player.registerHit();
      } else {
        this.effects.pulse(position, "pale", 2, 0.25);
      }
    }

    if (this.input.consume("bolt") && player.canBolt()) {
      const target = this.findTarget(120, 0.1);
      if (target) {
        player.useBolt();
        this.sound.play("bolt");
        const from = position.add(new Vector3(0, 1.2, 0));
        this.effects.bolt(from, target.position.add(new Vector3(0, 1, 0)));
        const away = target.position.subtract(position).normalize();
        const accepted = target.vulnerable;
        if (target.hit(2.2, away.x * 14, away.z * 14)) this.onRogueDefeated(target);
        if (accepted) player.registerHit(1.5);
        this.hud.flashAbility("ability-bolt");
      } else {
        this.hud.toast("No target in arc");
      }
    }

    if (this.input.consume("pulse") && player.canPulse()) {
      player.usePulse();
      this.sound.play("pulse");
      let hits = 0;
      for (const rogue of this.rogues) {
        if (!rogue.alive) continue;
        const away = rogue.position.subtract(position);
        const distance = away.length();
        if (distance > 34 || distance < 0.01) continue;
        const scale = 44 / distance;
        const accepted = rogue.vulnerable;
        if (rogue.hit(2.4, away.x * scale, away.z * scale)) this.onRogueDefeated(rogue);
        if (accepted) {
          hits += 1;
          player.registerHit(1.5);
        }
      }
      this.effects.pulse(position, "pale", 30, 0.5);
      this.hud.flashAbility("ability-pulse");
      if (hits === 0) this.hud.toast("Kinetic pulse");
    }
  }

  private updateRogues(dt: number): void {
    const player = this.player;
    for (const rogue of this.rogues) {
      const groundY = this.city.groundHeight(rogue.position.x, rogue.position.z, rogue.position.y + 3);
      const outcome = rogue.update(dt, player.position, groundY);

      if (outcome.telegraph) this.effects.pulse(rogue.position, "danger", 5, 0.3);
      if (outcome.projectile) {
        this.effects.bolt(rogue.position.add(new Vector3(0, 1.4, 0)), outcome.projectile);
        this.effects.pulse(outcome.projectile, "danger", 14, 0.4);
      }
      if (outcome.damage > 0 && player.damage(outcome.damage, rogue.position)) {
        this.effects.burst(player.position, 20, "danger");
        this.shake = Math.max(this.shake, 0.7);
        this.hud.toast(`${rogue.definition.codename} connected`);
      }
      if (outcome.defeated) this.onRogueDefeated(rogue);

      // Dampening fields bleed momentum off anyone standing in them.
      for (const field of rogue.fields) {
        if (Vector3.DistanceSquared(field.position, player.position) > field.radius * field.radius) continue;
        player.velocity.scaleInPlace(Math.exp(-3.4 * dt));
      }
    }
  }

  private onRogueDefeated(rogue: Rogue): void {
    this.effects.pulse(rogue.position, "warm", 20, 0.6);
    this.effects.burst(rogue.position, 40, "warm");
    this.hud.toast(`${rogue.definition.codename} is down`);
  }

  private findTarget(maxDistance: number, minDot: number): Rogue | null {
    const origin = this.player.position;
    const forward = this.headingVector();
    let best: Rogue | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const rogue of this.rogues) {
      if (!rogue.alive) continue;
      const offset = rogue.position.subtract(origin);
      const distance = offset.length();
      if (distance > maxDistance || distance < 0.01) continue;
      const dot = (offset.x * forward.x + offset.z * forward.z) / distance;
      if (dot < minDot) continue;
      const score = distance * (1.35 - dot);
      if (score < bestScore) {
        best = rogue;
        bestScore = score;
      }
    }
    return best;
  }

  private headingVector(): Vector3 {
    if (this.player.speed > 1) return this.player.velocity.normalizeToNew();
    return new Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));
  }

  /* ------------------------------------------------------------------ */
  /* Presentation                                                        */
  /* ------------------------------------------------------------------ */

  private resetChaseCamera(): void {
    this.player.resetPresentation();
    this.cameraYaw = 0;
    this.cameraPitch = 0.16;
    this.cameraRoll = 0;
    this.shake = 0;
    this.camera.upVector.set(0, 1, 0);
    this.camera.position.copyFrom(this.player.position).addInPlaceFromFloats(0, 2.6, -4.4);
    const anchor = this.player.position.add(new Vector3(0, 1.4, 0));
    constrainChaseCamera(this.city.grid, anchor, this.camera.position, this.camera.position);
    this.camera.setTarget(anchor.add(new Vector3(0, 0, 4)));
    this.camera.fov = 0.88;
  }

  /** The playable rig doubles as the title-screen portrait; no separate art. */
  private updateShowcase(dt: number): void {
    const reduced = this.save.settings.reducedMotion;
    if (!reduced) this.menuClock += dt;
    this.player.model.pose({ dt: reduced ? 0 : dt, speed: 0, speedRatio: 0, grounded: true,
      wallSide: 0, verticalRun: false, sliding: false, strike: 0, turn: 0 });
    this.player.model.setCharge(0.15, false);
    this.player.root.rotation.y = -0.25 + Math.sin(this.menuClock * 0.18) * 0.16;
    const p = this.player.position;
    const aspect = this.scene.getEngine().getAspectRatio(this.camera);
    // At narrow widths the interface uses a solid backdrop; keep the portrait
    // centred behind it instead of cropping a head at the edge of the screen.
    const offset = aspect > 1.2 ? Math.min(0.9, aspect * 0.43) : 0;
    this.camera.position.set(p.x + 1.8, p.y + 1.23, p.z + 2.8);
    this.camera.upVector.set(0, 1, 0);
    this.camera.setTarget(new Vector3(p.x + offset * 0.84, p.y + 0.94, p.z - offset * 0.54));
    this.camera.fov = 0.62;
    this.pipeline.chromaticAberration.aberrationAmount = 0;
    this.city.sky.update(dt);
    this.city.palette.update(dt, this.city.sky.nightAmount);
    this.city.updateStreaming(p);
    this.cityLife.update(dt, p, 1);
    this.scene.imageProcessingConfiguration.exposure = this.city.sky.exposure;
  }

  private updateCamera(dt: number): void {
    if (!this.dialogue.active) {
      const look = this.input.takeLook(dt);
      this.cameraYaw -= look.x * 0.0022;
      this.cameraPitch = clamp(this.cameraPitch - look.y * 0.0017, -0.22, 0.5);
    }

    const player = this.player;
    const ratio = player.speedRatio;
    const forward = new Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));

    // Pull back and drop low as speed rises; the horizon does the work.
    const distance = 4.4 + ratio * 5.8;
    const height = 1.8 + ratio * 1.1 + this.cameraPitch * 5;
    const desired = player.position
      .subtract(forward.scale(distance))
      .addInPlaceFromFloats(0, height, 0);

    // Keep above walkable surfaces; the sightline sweep below handles walls.
    const surface = this.city.groundHeight(desired.x, desired.z, desired.y) + 1.4;
    if (desired.y < surface) desired.y = surface;

    const smoothing = damp(9 - ratio * 4, dt);
    Vector3.LerpToRef(this.camera.position, desired, smoothing, this.camera.position);

    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.shake > 0 && !this.save.settings.reducedMotion) {
      const amount = this.shake * this.shake * 0.5;
      this.camera.position.addInPlaceFromFloats(
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount,
      );
    }

    // Constrain after smoothing and shake, so neither can re-enter a facade.
    const anchor = player.position.add(new Vector3(0, 1.4, 0));
    constrainChaseCamera(this.city.grid, anchor, this.camera.position, this.camera.position);

    // Roll the horizon during wall runs — the single clearest read that the
    // player is no longer on the ground.
    const targetRoll = !this.save.settings.reducedMotion && player.state === "wall" ? player.wallSide * 0.42 : 0;
    this.cameraRoll += (targetRoll - this.cameraRoll) * damp(6, dt);
    const up = Vector3.TransformNormal(
      Vector3.Up(),
      Matrix.RotationAxis(forward, this.cameraRoll),
    );
    this.camera.upVector.copyFrom(up);

    const target = player.position
      .add(forward.scale(4 + ratio * 12))
      .addInPlaceFromFloats(0, 1.4 + this.cameraPitch * 2.5, 0);
    this.camera.setTarget(target);
    const targetFov = this.save.settings.reducedMotion ? 0.92 : 0.88 + ratio * 0.28 + (this.focusActive ? 0.03 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * damp(7, dt);

    if (this.pipeline.chromaticAberrationEnabled) {
      this.pipeline.chromaticAberration.aberrationAmount = this.save.settings.reducedMotion ? 0 : ratio * ratio * 3;
    }
  }

  private currentMarkers(): MarkerEntry[] {
    if (this.campaign) return this.campaign.markers();
    if (this.activity) return this.activity.markers();

    const entries: MarkerEntry[] = [];
    const mote = this.collectibles.nearest(this.player.position, 220);
    if (mote) entries.push({ position: mote, style: "collectible", radius: 5 });
    if (this.nearestActivity) {
      entries.push({ position: this.nearestActivity.anchor, style: "objective", radius: 14 });
    }
    return entries;
  }

  private hudState(): HudState {
    const objective = this.currentObjective();
    const rogue = this.rogues.find((candidate) => candidate.alive) ?? null;
    return {
      modeLabel: this.mode === "story" ? `Story · ${this.chapter?.title ?? ""}` : "Free roam",
      objective,
      activitySites: this.mode === "free" ? this.activitySites : undefined,
      focusActive: this.focusActive,
      markers: this.currentMarkers(),
      rogue,
      prompt:
        this.mode === "free" && this.nearestActivity
          ? { title: this.nearestActivity.name, detail: this.nearestActivity.summary }
          : null,
      motesFound: this.collectibles.found,
      motesTotal: this.collectibles.total,
      showMph: this.save.settings.showSpeedInMph,
      dialogueActive: this.dialogue.active,
    };
  }

  private currentObjective(): ActivityStatus {
    if (this.campaign) {
      const status = this.campaign.status();
      return {
        title: status.title,
        detail: `${status.detail} · objective ${this.campaign.beatNumber}/${this.campaign.beatCount}`,
        progress: status.progress,
        timer: status.timer,
      };
    }
    if (this.activity) return this.activity.status();
    return {
      title: "Free roam",
      detail: `${this.city.districtNameAt(this.player.position.x, this.player.position.z)} · press T at a marker`,
    };
  }

  private trackProfile(dt: number): void {
    // Sample the peak every step; only write to the profile every couple of
    // seconds, so a personal best is never missed between flushes.
    this.peakSpeed = Math.max(this.peakSpeed, this.player.speedKph);

    this.saveClock += dt;
    if (this.saveClock < 2) return;
    this.saveClock = 0;
    const distance = this.player.distance;
    const top = this.peakSpeed;
    this.save.update((profile) => {
      profile.totalDistanceMeters += distance;
      profile.topSpeedKph = Math.max(profile.topSpeedKph, top);
    });
    this.player.distance = 0;
  }
}
