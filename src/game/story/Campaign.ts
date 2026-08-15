import { Vector3 } from "@babylonjs/core";
import type { Input } from "../core/Input";
import type { MarkerEntry } from "../fx/Markers";
import type { Activity, ActivityStatus, ActivityWorld } from "../activities/Activity";
import { RescueRun } from "../activities/RescueRun";
import { RogueDuel } from "../activities/RogueDuel";
import { RouteRun, type RouteGate } from "../activities/RouteRun";
import type { Anchor, Chapter, ChoiceOption, Line, Objective } from "./script";

/**
 * The chapter runner.
 *
 * Walks a chapter's beats in order. Dialogue beats hand their lines to the
 * view and wait; objective beats either delegate to the same activity classes
 * free roam uses, or run a small piece of inline logic (travel there, hold
 * this speed, get that high). Adding a new objective kind means one case here
 * and one entry in the script's union — nothing else changes.
 */

export interface DialogueView {
  show(lines: Line[]): void;
  ask(prompt: string, options: [ChoiceOption, ChoiceOption]): void;
  /** Advances one line or confirms the highlighted choice. */
  advance(): void;
  /** Moves the choice highlight; ignored while plain lines are showing. */
  cycle(direction: number): void;
  hide(): void;
  readonly active: boolean;
  /** Set once a choice resolves; cleared by `hide`. */
  readonly chosen: string | null;
}

export type CampaignResult = "running" | "complete" | "failed";

interface InlineState {
  /** Points still to reach, for travel and investigate beats. */
  points: Vector3[];
  visited: boolean[];
  hold: number;
  baseY: number;
  timer: number;
}

export class Campaign {
  private beatIndex = -1;
  private activity: Activity | null = null;
  private inline: InlineState = { points: [], visited: [], hold: 0, baseY: 0, timer: 0 };
  private title = "";
  private detail = "";
  private failed = false;
  private choiceId: string | null = null;
  private surviveRogueId: string | null = null;
  /** Last sign of the movement axis, so held left/right moves the highlight once. */
  private choiceAxis = 0;

  constructor(
    readonly chapter: Chapter,
    private readonly world: ActivityWorld,
    private readonly dialogue: DialogueView,
  ) {}

  /** The chapter's chosen ending, once one has been made. */
  get choice(): string | null {
    return this.choiceId;
  }

  get beatNumber(): number {
    return Math.max(1, this.beatIndex + 1);
  }

  get beatCount(): number {
    return this.chapter.beats.length;
  }

  start(): void {
    this.world.city.sky.setAtmosphere(this.chapter.atmosphere);
    const spawn = this.resolve(this.chapter.spawn);
    this.world.player.teleport(this.world.city.nearestRoad(spawn));
    this.advanceBeat();
  }

  update(dt: number, input: Input): CampaignResult {
    if (this.failed) return "failed";

    if (this.dialogue.active) {
      if (input.consume("advance")) this.dialogue.advance();
      // Edge-triggered: `movement.x` is non-zero on every one of the 120
      // steps a second while the key is held, which strobed the highlight.
      const axis = Math.sign(input.movement().x);
      if (axis !== 0 && axis !== this.choiceAxis) this.dialogue.cycle(axis);
      this.choiceAxis = axis;
      if (!this.dialogue.active) {
        const chosen = this.dialogue.chosen;
        if (chosen !== null) this.choiceId = chosen;
        this.dialogue.hide();
        this.advanceBeat();
      }
      return this.beatIndex >= this.chapter.beats.length ? "complete" : "running";
    }

    const beat = this.chapter.beats[this.beatIndex];
    if (!beat) return "complete";

    const result = this.activity ? this.updateActivity(dt) : this.updateInline(dt, beat);
    if (result === "failed") {
      this.failed = true;
      return "failed";
    }
    if (result === "complete") {
      this.advanceBeat();
      return this.beatIndex >= this.chapter.beats.length ? "complete" : "running";
    }
    return "running";
  }

  status(): ActivityStatus {
    if (this.activity) {
      const status = this.activity.status();
      // Story routes have a chapter-level limit in addition to their activity
      // timer. Expose that deadline through `timer` so the HUD prints it once.
      if (this.inline.timer > 0) {
        return {
          ...status,
          timer: this.inline.timer,
        };
      }
      return status;
    }
    return {
      title: this.title || this.chapter.title,
      detail: this.detail,
      progress: this.inline.points.length
        ? this.inline.visited.filter(Boolean).length / this.inline.points.length
        : undefined,
      timer: this.inline.timer > 0 ? this.inline.timer : undefined,
    };
  }

  markers(): MarkerEntry[] {
    if (this.activity) return this.activity.markers();
    const entries: MarkerEntry[] = [];
    for (let i = 0; i < this.inline.points.length; i += 1) {
      if (this.inline.visited[i]) continue;
      const point = this.inline.points[i];
      if (point) {
        entries.push({
          id: `story:${this.chapter.id}:${this.beatIndex}:${i}`,
          label: `Objective ${i + 1}`,
          position: point,
          style: "objective",
          radius: 16,
        });
      }
    }
    return entries;
  }

  stop(): void {
    this.activity?.stop(this.world);
    this.activity = null;
    this.world.clearRogues();
    this.world.releaseBystanders();
    this.dialogue.hide();
  }

  /* ---------------- beats ---------------- */

  private advanceBeat(): void {
    this.activity?.stop(this.world);
    this.activity = null;
    this.inline = { points: [], visited: [], hold: 0, baseY: 0, timer: 0 };
    this.surviveRogueId = null;
    this.beatIndex += 1;

    const beat = this.chapter.beats[this.beatIndex];
    if (!beat) return;
    this.begin(beat);
  }

  private begin(beat: Objective): void {
    const world = this.world;
    switch (beat.kind) {
      case "talk":
        this.dialogue.show(beat.lines);
        break;

      case "choice":
        this.title = beat.title;
        this.detail = beat.detail;
        this.dialogue.ask(beat.prompt, beat.options);
        break;

      case "travel": {
        this.title = beat.title;
        this.detail = beat.detail;
        const target = this.resolve(beat.anchor);
        this.inline.points = [target];
        this.inline.visited = [false];
        this.inline.hold = beat.radius ?? 26;
        break;
      }

      case "reach-speed":
        this.title = beat.title;
        this.detail = beat.detail;
        this.inline.hold = beat.hold;
        this.inline.timer = 0;
        break;

      case "climb":
        this.title = beat.title;
        this.detail = beat.detail;
        this.inline.baseY = world.player.position.y;
        this.inline.hold = beat.height;
        this.inline.points = [this.resolve(beat.anchor)];
        this.inline.visited = [false];
        break;

      case "investigate": {
        this.title = beat.title;
        this.detail = beat.detail;
        const centre = this.resolve(beat.anchor);
        this.inline.points = [];
        this.inline.visited = [];
        for (let i = 0; i < beat.sites; i += 1) {
          this.inline.points.push(world.city.roadPointNear(centre, 140, beat.spread, world.rng));
          this.inline.visited.push(false);
        }
        break;
      }

      case "route": {
        const centre = this.resolve(beat.anchor);
        const gates: RouteGate[] = [];
        // Gates ring the anchor so the route always comes back to where it started.
        for (let i = 0; i < beat.gates; i += 1) {
          const angle = (i / beat.gates) * Math.PI * 2 + world.rng() * 0.4;
          const radius = beat.spread * (0.55 + world.rng() * 0.45);
          const point = world.city.nearestRoad(
            new Vector3(centre.x + Math.cos(angle) * radius, 0, centre.z + Math.sin(angle) * radius),
          );
          gates.push({
            position: point,
            minSpeed: beat.minKph === undefined ? undefined : beat.minKph / 3.6,
            radius: 22,
          });
        }
        const run = new RouteRun({
          id: `story-${this.chapter.id}-${this.beatIndex}`,
          name: beat.title,
          summary: beat.detail,
          gates,
        });
        this.inline.timer = beat.seconds ?? 0;
        this.activity = run;
        run.start(world);
        break;
      }

      case "rescue": {
        const centre = this.resolve(beat.anchor);
        const run = new RescueRun(
          `story-${this.chapter.id}-${this.beatIndex}`,
          beat.title,
          centre,
          beat.count,
          beat.seconds,
        );
        this.activity = run;
        run.start(world);
        break;
      }

      case "duel": {
        const duel = new RogueDuel(beat.rogue, this.resolve(beat.anchor), 400);
        this.activity = duel;
        duel.start(world);
        break;
      }

      case "survive": {
        this.title = beat.title;
        this.detail = beat.detail;
        this.inline.timer = beat.seconds;
        this.surviveRogueId = beat.rogue;
        world.clearRogues();
        const spawn = world.city.nearestRoad(this.resolve(beat.anchor).add(new Vector3(46, 0, 30)));
        const rogue = world.spawnRogue(beat.rogue, spawn);
        // This encounter is a survival test, not a fight you can win.
        rogue.phantom = true;
        break;
      }
    }
  }

  private updateActivity(dt: number): CampaignResult {
    const activity = this.activity;
    if (!activity) return "complete";

    // Story routes can carry their own hard time limit on top of the run.
    // The activity resolves first: banking the final gate on the same step
    // the clock expires should be a win, not a loss.
    const expired = this.inline.timer > 0 && (this.inline.timer -= dt) <= 0;

    const result = activity.update(dt, this.world);
    if (result === "complete") {
      this.world.toast(activity.successMessage());
      return "complete";
    }
    if (result === "failed") return "failed";
    return expired ? "failed" : "running";
  }

  private updateInline(dt: number, beat: Objective): CampaignResult {
    const world = this.world;
    const player = world.player;

    switch (beat.kind) {
      case "travel": {
        const target = this.inline.points[0];
        if (!target) return "complete";
        const radius = this.inline.hold;
        if (Vector3.DistanceSquared(player.position, target) < radius * radius) {
          world.effects.pulse(target, "warm", 20);
          return "complete";
        }
        return "running";
      }

      case "reach-speed": {
        if (player.speedKph >= beat.kph) {
          this.inline.timer += dt;
          if (this.inline.timer >= this.inline.hold) return "complete";
        } else {
          this.inline.timer = Math.max(0, this.inline.timer - dt * 1.6);
        }
        this.detail = `${beat.detail} · ${Math.round(player.speedKph)} / ${beat.kph} km/h`;
        return "running";
      }

      case "climb": {
        const gained = player.position.y - this.inline.baseY;
        this.detail = `${beat.detail} · ${Math.max(0, Math.round(gained))} m of ${beat.height} m`;
        return gained >= beat.height ? "complete" : "running";
      }

      case "investigate": {
        let remaining = 0;
        for (let i = 0; i < this.inline.points.length; i += 1) {
          if (this.inline.visited[i]) continue;
          const point = this.inline.points[i];
          if (!point) continue;
          if (Vector3.DistanceSquared(player.position, point) < 18 * 18) {
            this.inline.visited[i] = true;
            world.effects.pulse(point, "cool", 18);
            world.toast("Site logged");
          } else {
            remaining += 1;
          }
        }
        return remaining === 0 ? "complete" : "running";
      }

      case "survive": {
        this.inline.timer -= dt;
        if (player.health <= 0) return "failed";
        if (this.inline.timer <= 0) {
          world.clearRogues();
          return "complete";
        }
        // Keep the countdown on `timer` only; the HUD appends seconds itself.
        this.detail = beat.detail;
        void this.surviveRogueId;
        return "running";
      }

      default:
        return "running";
    }
  }

  private resolve(anchor: Anchor): Vector3 {
    switch (anchor.at) {
      case "landmark":
        return this.world.city.landmark(anchor.id).position.clone();
      case "point":
        return new Vector3(anchor.x, 0, anchor.z);
      case "player":
        return this.world.player.position.clone();
    }
  }
}
