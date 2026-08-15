import { Vector3 } from "@babylonjs/core";
import type { ActivityStatus } from "../activities/Activity";
import type { MarkerEntry } from "../fx/Markers";
import type { Player } from "../player/Player";
import type { Rogue } from "../npc/Rogue";
import type { City } from "../world/City";
import { BLOCK_PITCH } from "../world/City";
import type { FocusPlan } from "../navigation/FocusPlanner";

export interface HudState {
  modeLabel: string;
  objective: ActivityStatus;
  focusActive: boolean;
  focusPlan: FocusPlan | null;
  markers: MarkerEntry[];
  rogue: Rogue | null;
  prompt: { title: string; detail: string } | null;
  motesFound: number;
  motesTotal: number;
  showMph: boolean;
  /** A conversation owns the screen; the click-to-capture hint stands down. */
  dialogueActive: boolean;
}

const TRAVERSAL_LABEL: Record<string, string> = {
  wall: "Wall run",
  vertical: "Vertical run",
  slide: "Slide",
  air: "Airborne",
  ground: "",
};

export class Hud {
  private readonly speedValue = element("speed-value");
  private readonly speedUnit = element("speed-unit");
  private readonly speedFill = element("speed-fill");
  private readonly speedTier = element("speed-tier");
  private readonly healthLabel = element("health-label");
  private readonly healthFill = element("health-fill");
  private readonly chargeLabel = element("charge-label");
  private readonly chargeFill = element("charge-fill");
  private readonly combo = element("combo");
  private readonly modeLabel = element("mode-label");
  private readonly objectiveTitle = element("objective-title");
  private readonly objectiveDetail = element("objective-detail");
  private readonly objectiveProgress = element("objective-progress-fill");
  private readonly rendererBadge = element("renderer-badge");
  private readonly focusBanner = element("focus-banner");
  private readonly focusTarget = element("focus-target");
  private readonly focusRoute = element("focus-route");
  private readonly captureHint = element("capture-hint");
  private readonly toastElement = element("toast");
  private readonly traversal = element("traversal-state");
  private readonly districtBanner = element("district-banner");
  private readonly districtName = element("district-name");
  private readonly moteCount = element("mote-count");
  private readonly prompt = element("prompt");
  private readonly promptTitle = element("prompt-title");
  private readonly promptDetail = element("prompt-detail");
  private readonly rogueBar = element("rogue-bar");
  private readonly rogueCodename = element("rogue-codename");
  private readonly rogueReal = element("rogue-real");
  private readonly rogueFill = element("rogue-fill");
  private readonly rogueTell = element("rogue-tell");
  private readonly mapOverlay = element("map-overlay");

  private readonly minimap = canvas("minimap");
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly citymap = canvas("citymap");
  private readonly citymapCtx: CanvasRenderingContext2D;

  private toastTimer = 0;
  private districtTimer = 0;
  private lastDistrict = "";
  private mapOpen = false;

  constructor(private readonly city: City) {
    const mini = this.minimap.getContext("2d");
    const full = this.citymap.getContext("2d");
    if (!mini || !full) throw new Error("The map canvases are unavailable.");
    this.minimapCtx = mini;
    this.citymapCtx = full;

    document.addEventListener("pointerlockchange", () => {
      this.captureHint.classList.toggle("is-hidden", document.pointerLockElement !== null);
    });
  }

  setRenderer(name: string): void {
    this.rendererBadge.textContent = `${name} · Havok V2`;
  }

  setVisible(value: boolean): void {
    document.getElementById("hud")?.classList.toggle("is-hidden", !value);
  }

  toggleMap(): boolean {
    this.mapOpen = !this.mapOpen;
    this.mapOverlay.classList.toggle("is-hidden", !this.mapOpen);
    return this.mapOpen;
  }

  closeMap(): void {
    this.mapOpen = false;
    this.mapOverlay.classList.add("is-hidden");
  }

  get isMapOpen(): boolean {
    return this.mapOpen;
  }

  toast(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add("active");
    this.toastTimer = window.setTimeout(() => {
      this.toastElement.classList.remove("active");
    }, 1900);
  }

  flashAbility(id: string): void {
    const target = document.getElementById(id);
    target?.classList.add("flash");
    window.setTimeout(() => target?.classList.remove("flash"), 140);
  }

  update(dt: number, player: Player, state: HudState): void {
    const kph = player.speedKph;
    const shown = state.showMph ? kph * 0.621371 : kph;
    this.speedValue.textContent = Math.round(shown).toString();
    this.speedUnit.textContent = state.showMph ? "mph" : "km/h";
    this.speedFill.style.transform = `scaleX(${Math.min(1, player.speed / player.topSpeed)})`;
    this.speedTier.textContent = tier(kph);

    this.healthLabel.textContent = Math.ceil(player.health).toString();
    this.healthFill.style.transform = `scaleX(${player.health / 100})`;
    this.chargeLabel.textContent = Math.floor(player.charge).toString();
    this.chargeFill.style.transform = `scaleX(${player.charge / 100})`;

    this.combo.textContent = `×${player.combo} chain`;
    this.combo.classList.toggle("active", player.combo > 1);

    this.modeLabel.textContent = state.modeLabel;
    this.objectiveTitle.textContent = state.objective.title;
    this.objectiveDetail.textContent =
      state.objective.timer === undefined
        ? state.objective.detail
        : `${state.objective.detail} · ${Math.ceil(state.objective.timer)}s`;
    const progress = state.objective.progress ?? 0;
    this.objectiveProgress.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;

    this.focusBanner.classList.toggle("active", state.focusActive);
    this.focusTarget.textContent = state.focusPlan?.label ?? "No target read";
    this.focusRoute.textContent = state.focusPlan
      ? `${Math.round(state.focusPlan.distance)} m · ${state.focusPlan.targets.length} point route · G cycle`
      : "G cycles nearby signals";
    document.documentElement.style.setProperty("--focus-fx", state.focusActive ? "1" : "0");

    const label = TRAVERSAL_LABEL[player.state] ?? "";
    this.traversal.textContent = label;
    this.traversal.classList.toggle("active", label !== "");

    setReady("ability-dash", player.charge >= 18 && player.dashCooldown <= 0);
    setReady("ability-slide", player.speed > 20);
    setReady("ability-bolt", player.canBolt());
    setReady("ability-pulse", player.canPulse());
    setReady("ability-focus", player.charge > 0);

    this.moteCount.textContent = `${state.motesFound} / ${state.motesTotal}`;

    if (state.prompt) {
      this.prompt.classList.remove("is-hidden");
      this.promptTitle.textContent = state.prompt.title;
      this.promptDetail.textContent = state.prompt.detail;
    } else {
      this.prompt.classList.add("is-hidden");
    }

    this.captureHint.classList.toggle(
      "is-hidden",
      document.pointerLockElement !== null || state.dialogueActive,
    );

    this.updateRogue(state.rogue);
    this.updateDistrict(dt, player.position);

    document.documentElement.style.setProperty("--speed-fx", (player.speedRatio * 0.7).toFixed(2));

    this.drawMinimap(player, state);
    if (this.mapOpen) this.drawCityMap(player, state);
  }

  private updateRogue(rogue: Rogue | null): void {
    if (!rogue || !rogue.alive) {
      this.rogueBar.classList.add("is-hidden");
      return;
    }
    this.rogueBar.classList.remove("is-hidden");
    this.rogueCodename.textContent = rogue.definition.codename;
    this.rogueReal.textContent = rogue.definition.name;
    this.rogueFill.style.transform = `scaleX(${rogue.healthRatio})`;
    const open = rogue.vulnerable;
    this.rogueTell.textContent = rogue.phantom
      ? "Cannot be hurt — stay alive"
      : open
        ? "Open — hit them now"
        : "Guarded — wait for the recovery";
    this.rogueTell.classList.toggle("warn", !open && !rogue.phantom);
  }

  private updateDistrict(dt: number, position: Vector3): void {
    const district = this.city.districtNameAt(position.x, position.z);
    if (district !== this.lastDistrict) {
      this.lastDistrict = district;
      this.districtName.textContent = district;
      this.districtTimer = 2.6;
      this.districtBanner.classList.add("active");
    } else if (this.districtTimer > 0) {
      this.districtTimer -= dt;
      if (this.districtTimer <= 0) this.districtBanner.classList.remove("active");
    }
  }

  /* ---------------- maps ---------------- */

  private drawMinimap(player: Player, state: HudState): void {
    const ctx = this.minimapCtx;
    const size = this.minimap.width;
    const half = size / 2;
    const range = 320;
    const scale = half / range;
    const px = player.position.x;
    const pz = player.position.z;
    const toX = (x: number) => half + (x - px) * scale;
    const toY = (z: number) => half - (z - pz) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = "rgba(12, 13, 15, 0.74)";
    ctx.fillRect(0, 0, size, size);

    // Road strips: roads run along (k - 0.5) * BLOCK_PITCH on both axes.
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    const roadHalf = 20 * scale;
    for (let k = Math.floor((px - range) / BLOCK_PITCH + 0.5); k <= Math.ceil((px + range) / BLOCK_PITCH + 0.5); k += 1) {
      const road = (k - 0.5) * BLOCK_PITCH;
      if (Math.abs(road) > this.city.extent) continue;
      ctx.fillRect(toX(road) - roadHalf, 0, roadHalf * 2, size);
    }
    for (let k = Math.floor((pz - range) / BLOCK_PITCH + 0.5); k <= Math.ceil((pz + range) / BLOCK_PITCH + 0.5); k += 1) {
      const road = (k - 0.5) * BLOCK_PITCH;
      if (Math.abs(road) > this.city.extent) continue;
      ctx.fillRect(0, toY(road) - roadHalf, size, roadHalf * 2);
    }

    // The river.
    ctx.fillStyle = "rgba(76, 122, 148, 0.4)";
    const riverX = 7 * BLOCK_PITCH;
    ctx.fillRect(toX(riverX - BLOCK_PITCH * 0.5), 0, BLOCK_PITCH * scale, size);

    // Fade beyond the city bounds.
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    if (px - range < -this.city.extent) ctx.fillRect(0, 0, toX(-this.city.extent), size);
    if (px + range > this.city.extent) ctx.fillRect(toX(this.city.extent), 0, size, size);
    if (pz + range > this.city.extent) ctx.fillRect(0, 0, size, toY(this.city.extent));
    if (pz - range < -this.city.extent) ctx.fillRect(0, toY(-this.city.extent), size, size);

    // Landmarks in range.
    ctx.fillStyle = "rgba(238, 240, 241, 0.5)";
    ctx.font = "600 10px Inter, sans-serif";
    ctx.textAlign = "center";
    for (const landmark of this.city.landmarks) {
      const dx = landmark.position.x - px;
      const dz = landmark.position.z - pz;
      if (Math.hypot(dx, dz) > range) continue;
      ctx.beginPath();
      ctx.arc(toX(landmark.position.x), toY(landmark.position.z), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(landmark.name, toX(landmark.position.x), toY(landmark.position.z) - 7);
    }

    // Objective markers: in-range dots, out-of-range edge chevrons.
    if (state.focusPlan && state.focusPlan.targets.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(half, half);
      for (const target of state.focusPlan.targets) {
        ctx.lineTo(toX(target.position.x), toY(target.position.z));
      }
      ctx.strokeStyle = "rgba(104, 225, 223, 0.78)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 6]);
      ctx.stroke();
      ctx.restore();
    }

    for (const marker of state.markers) {
      const dx = marker.position.x - px;
      const dz = marker.position.z - pz;
      const distance = Math.hypot(dx, dz);
      const color = markerColor(marker.style);
      if (distance * scale < half - 16) {
        ctx.beginPath();
        ctx.arc(toX(marker.position.x), toY(marker.position.z), 6, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        const angle = Math.atan2(-dz, dx);
        ctx.save();
        ctx.translate(half + Math.cos(angle) * (half - 14), half + Math.sin(angle) * (half - 14));
        ctx.rotate(angle);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-4, -6);
        ctx.lineTo(-4, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    if (state.rogue?.alive) {
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.arc(toX(state.rogue.position.x), toY(state.rogue.position.z), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow at the centre, rotated to heading (north-up map).
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(player.root.rotation.y);
    ctx.fillStyle = "#f5c76a";
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(238, 240, 241, 0.5)";
    ctx.font = "600 13px Inter, sans-serif";
    ctx.fillText("N", half, 20);
    ctx.restore();
  }

  private drawCityMap(player: Player, state: HudState): void {
    const ctx = this.citymapCtx;
    const size = this.citymap.width;
    const extent = this.city.extent;
    const scale = size / (extent * 2);
    const toX = (x: number) => (x + extent) * scale;
    const toY = (z: number) => size - (z + extent) * scale;

    ctx.fillStyle = "#0f1114";
    ctx.fillRect(0, 0, size, size);

    // City blocks.
    ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
    for (let gx = -12; gx <= 12; gx += 1) {
      for (let gz = -12; gz <= 12; gz += 1) {
        ctx.fillRect(toX(gx * BLOCK_PITCH - 55), toY(gz * BLOCK_PITCH + 55), 110 * scale, 110 * scale);
      }
    }

    // River.
    ctx.fillStyle = "rgba(72, 118, 145, 0.55)";
    ctx.fillRect(toX(7 * BLOCK_PITCH - 75), 0, 150 * scale, size);

    ctx.font = "600 12px Inter, sans-serif";
    ctx.textAlign = "center";
    for (const landmark of this.city.landmarks) {
      ctx.fillStyle = landmark.accent;
      ctx.beginPath();
      ctx.arc(toX(landmark.position.x), toY(landmark.position.z), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(238, 240, 241, 0.8)";
      ctx.fillText(landmark.name, toX(landmark.position.x), toY(landmark.position.z) - 10);
    }

    if (state.focusPlan && state.focusPlan.targets.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(toX(player.position.x), toY(player.position.z));
      for (const target of state.focusPlan.targets) {
        ctx.lineTo(toX(target.position.x), toY(target.position.z));
      }
      ctx.strokeStyle = "rgba(104, 225, 223, 0.82)";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "800 12px Inter, sans-serif";
      for (let index = 0; index < state.focusPlan.targets.length; index += 1) {
        const target = state.focusPlan.targets[index];
        if (!target) continue;
        const x = toX(target.position.x);
        const y = toY(target.position.z);
        ctx.fillStyle = index === 0 ? "#fff08a" : "#68e1df";
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#101418";
        ctx.fillText((index + 1).toString(), x, y + 0.5);
      }
      ctx.restore();
    }

    for (const marker of state.markers) {
      ctx.strokeStyle = markerColor(marker.style);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(toX(marker.position.x), toY(marker.position.z), 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(toX(player.position.x), toY(player.position.z));
    ctx.rotate(player.root.rotation.y);
    ctx.fillStyle = "#f5c76a";
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing HUD element #${id}`);
  return value;
}

function canvas(id: string): HTMLCanvasElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLCanvasElement)) throw new Error(`Missing canvas #${id}`);
  return value;
}

function setReady(id: string, ready: boolean): void {
  document.getElementById(id)?.classList.toggle("ready", ready);
}

function markerColor(style: MarkerEntry["style"]): string {
  switch (style) {
    case "rescue":
      return "#6fd3a0";
    case "collectible":
      return "#9fd4ff";
    case "threat":
      return "#ff6a58";
    case "relay":
      return "#68e1df";
    case "planned":
      return "#fff08a";
    case "checkpoint":
    case "objective":
      return "#f2a33c";
  }
}

function tier(speedKph: number): string {
  if (speedKph < 5) return "Still";
  if (speedKph < 90) return "Street";
  if (speedKph < 300) return "Rapid";
  if (speedKph < 620) return "Supersonic";
  if (speedKph < 900) return "Overspeed";
  return "Resonant";
}
