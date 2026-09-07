import { Vector3 } from "@babylonjs/core";
import type { ActivityStatus } from "../activities/Activity";
import type { MarkerEntry } from "../fx/Markers";
import type { Player } from "../player/Player";
import type { Rogue } from "../npc/Rogue";
import type { City } from "../world/City";
import { BLOCK_PITCH } from "../world/City";

export interface HudState {
  modeLabel: string;
  objective: ActivityStatus;
  focusActive: boolean;
  markers: MarkerEntry[];
  rogue: Rogue | null;
  prompt: { title: string; detail: string } | null;
  motesFound: number;
  motesTotal: number;
  showMph: boolean;
  /** A conversation owns the screen; the click-to-capture hint stands down. */
  dialogueActive: boolean;
  activitySites?: Array<{ name: string; position: Vector3; kind: "route" | "rescue" | "duel" }>;
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
  private lastPlayer: Player | null = null;
  private lastState: HudState | null = null;
  private readonly mapBase = document.createElement("canvas");
  private mapBaseReady = false;
  private readonly miniLocation = element("minimap-location");
  private readonly mapDistrict = element("map-district");
  private readonly mapStatus = element("map-status");

  constructor(private readonly city: City, private readonly onMapClose?: () => void) {
    const mini = this.minimap.getContext("2d");
    const full = this.citymap.getContext("2d");
    if (!mini || !full) throw new Error("The map canvases are unavailable.");
    this.minimapCtx = mini;
    this.citymapCtx = full;
    element("map-close").addEventListener("click", () => {
      if (this.onMapClose) this.onMapClose();
      else this.closeMap();
    });
    this.mapOverlay.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        element("map-close").focus();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.captureHint.classList.toggle("is-hidden", document.pointerLockElement !== null);
    });
  }

  setRenderer(name: string): void {
    // Kept in the DOM for diagnostics without intruding on the game HUD.
    this.rendererBadge.textContent = name;
  }

  setVisible(value: boolean): void {
    document.getElementById("hud")?.classList.toggle("is-hidden", !value);
    if (!value) {
      document.documentElement.style.setProperty("--speed-fx", "0");
      document.documentElement.style.setProperty("--focus-fx", "0");
    }
  }

  toggleMap(): boolean {
    this.mapOpen = !this.mapOpen;
    this.mapOverlay.classList.toggle("is-hidden", !this.mapOpen);
    if (this.mapOpen) {
      if (this.lastPlayer && this.lastState) this.drawCityMap(this.lastPlayer, this.lastState);
      element("map-close").focus({ preventScroll: true });
    }
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
    this.lastPlayer = player;
    this.lastState = state;
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
      document.pointerLockElement !== null || state.dialogueActive || this.mapOpen ||
        (typeof navigator.getGamepads === "function" && Array.from(navigator.getGamepads()).some((pad) => pad?.connected)),
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
    this.rogueTell.textContent = rogue.phantom ? "Stay moving. Survive the encounter." : rogue.tacticHint;
    this.rogueTell.classList.toggle("warn", !open && !rogue.phantom);
  }

  private updateDistrict(dt: number, position: Vector3): void {
    const district = this.city.districtNameAt(position.x, position.z);
    if (district !== this.lastDistrict) {
      this.lastDistrict = district;
      this.districtName.textContent = district;
      this.miniLocation.textContent = district;
      this.mapDistrict.textContent = district;
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

    // Sample the world's water query so bridges and any expanded waterfront agree.
    ctx.fillStyle = "rgba(73, 130, 149, 0.58)";
    const tile = 30;
    for (let x = Math.floor((px - range) / tile) * tile; x < px + range; x += tile) {
      for (let z = Math.floor((pz - range) / tile) * tile; z < pz + range; z += tile) {
        if (this.city.isWater(x + tile / 2, z + tile / 2)) {
          ctx.fillRect(toX(x), toY(z + tile), tile * scale + 1, tile * scale + 1);
        }
      }
    }

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

    // Nearby optional activities use diamonds, objectives keep their rings.
    for (const site of state.activitySites ?? []) {
      if (Math.hypot(site.position.x - px, site.position.z - pz) > range - 15) continue;
      drawMapSymbol(ctx, toX(site.position.x), toY(site.position.z), 4.5, activityColor(site.kind), true);
    }

    // Objective markers: in-range dots, out-of-range edge chevrons.
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
    const inset = 28;
    const scale = (size - inset * 2) / (extent * 2);
    const toX = (x: number) => inset + (x + extent) * scale;
    const toY = (z: number) => size - inset - (z + extent) * scale;
    if (!this.mapBaseReady) this.buildMapBase(size, inset, scale);
    ctx.drawImage(this.mapBase, 0, 0);

    // Labels get a dark backing for legibility over roads and district tints.
    const labels: Array<{ x: number; y: number; width: number; height: number }> = [];
    const label = (name: string, x: number, y: number, color: string, priority = false) => {
      ctx.font = "500 16px Inter, sans-serif";
      const width = ctx.measureText(name).width + 10;
      const bx = Math.max(5, Math.min(size - width - 5, x - width / 2));
      const by = Math.max(5, y - 31);
      if (!priority && labels.some((other) => bx < other.x + other.width && bx + width > other.x && by < other.y + other.height && by + 22 > other.y)) return;
      labels.push({ x: bx, y: by, width, height: 22 });
      ctx.fillStyle = "rgba(9, 21, 29, 0.91)";
      ctx.fillRect(bx, by, width, 22);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(name, bx + 5, by + 16);
    };

    for (const site of state.activitySites ?? []) {
      const x = toX(site.position.x);
      const y = toY(site.position.z);
      const color = activityColor(site.kind);
      drawMapSymbol(ctx, x, y, 7, color, true);
      label(site.name, x, y, color);
    }
    for (const landmark of this.city.landmarks) {
      const x = toX(landmark.position.x);
      const y = toY(landmark.position.z);
      drawMapSymbol(ctx, x, y, 3.5, "#a9bbc5", false, true);
      label(landmark.name, x, y, "#b9c9d0");
    }
    for (const marker of state.markers) {
      drawMapSymbol(ctx, toX(marker.position.x), toY(marker.position.z), 10, markerColor(marker.style), marker.style === "threat");
    }
    if (state.rogue?.alive) drawMapSymbol(ctx, toX(state.rogue.position.x), toY(state.rogue.position.z), 9, "#f67b70", true, true);

    const playerX = toX(player.position.x);
    const playerY = toY(player.position.z);
    ctx.strokeStyle = "rgba(239, 189, 121, .36)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(playerX, playerY, 23, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(playerX, playerY);
    ctx.rotate(player.root.rotation.y);
    ctx.fillStyle = "#fff3ce";
    ctx.strokeStyle = "#101b25";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    this.mapDistrict.textContent = this.city.districtNameAt(player.position.x, player.position.z);
    const nearest = state.markers.reduce<{ distance: number } | null>((best, marker) => {
      const distance = Math.hypot(marker.position.x - player.position.x, marker.position.z - player.position.z);
      return !best || distance < best.distance ? { distance } : best;
    }, null);
    this.mapStatus.textContent = `${state.objective.title}. ${nearest ? `${formatDistance(nearest.distance)} to your closest objective.` : "Pick a marked activity or find your own way."}`;
    const scaleElement = element("map-scale-label");
    scaleElement.textContent = `${(extent * 2 / 1000).toFixed(2)} km across`;
    scaleElement.parentElement?.setAttribute("aria-label", `City width ${(extent * 2 / 1000).toFixed(2)} kilometres`);
  }

  /** The expanded world is sampled once; each frame draws only changing markers. */
  private buildMapBase(size: number, inset: number, scale: number): void {
    this.mapBase.width = size;
    this.mapBase.height = size;
    const ctx = this.mapBase.getContext("2d");
    if (!ctx) return;
    const extent = this.city.extent;
    const toX = (x: number) => inset + (x + extent) * scale;
    const toY = (z: number) => size - inset - (z + extent) * scale;
    ctx.fillStyle = "#0a151e";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#20313a";
    ctx.fillRect(inset, inset, size - 2 * inset, size - 2 * inset);
    const radius = Math.floor(extent / BLOCK_PITCH);
    const districts = new Map<string, { x: number; z: number; count: number; color: string }>();
    const colors = ["#304952", "#38434a", "#3c4144", "#263f48", "#354a45", "#3d4641", "#45453f", "#344552", "#3e454b"];
    for (let gx = -radius; gx <= radius; gx += 1) {
      for (let gz = -radius; gz <= radius; gz += 1) {
        const x = gx * BLOCK_PITCH;
        const z = gz * BLOCK_PITCH;
        const name = this.city.districtNameAt(x, z);
        let district = districts.get(name);
        if (!district) {
          district = { x: 0, z: 0, count: 0, color: colors[districts.size % colors.length] ?? "#34414a" };
          districts.set(name, district);
        }
        district.x += x;
        district.z += z;
        district.count += 1;
        ctx.fillStyle = district.color;
        ctx.fillRect(toX(x - 56), toY(z + 56), 112 * scale, 112 * scale);
      }
    }
    // Query actual water so the map includes bridge breaks without a second layout.
    const tile = BLOCK_PITCH / 3;
    ctx.fillStyle = "#1b4859";
    for (let x = -extent; x < extent; x += tile) {
      for (let z = -extent; z < extent; z += tile) {
        if (this.city.isWater(x + tile / 2, z + tile / 2)) ctx.fillRect(toX(x), toY(z + tile), tile * scale + .5, tile * scale + .5);
      }
    }
    ctx.textAlign = "center";
    ctx.font = "600 21px Barlow Condensed, sans-serif";
    ctx.fillStyle = "rgba(210, 225, 231, .44)";
    for (const [name, district] of districts) {
      ctx.fillText(name.toUpperCase(), toX(district.x / district.count), toY(district.z / district.count) + 35);
    }
    ctx.strokeStyle = "#7796a14a";
    ctx.lineWidth = 1;
    ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    this.mapBaseReady = true;
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

function tier(speedKph: number): string {
  if (speedKph < 5) return "Still";
  if (speedKph < 90) return "Street";
  if (speedKph < 300) return "Rapid";
  if (speedKph < 620) return "Express";
  if (speedKph < 900) return "Overdrive";
  if (speedKph < 1235) return "Resonant";
  return "Supersonic";
}

function markerColor(style: MarkerEntry["style"]): string {
  if (style === "rescue") return "#8bc9a5";
  if (style === "collectible") return "#8fcedf";
  if (style === "threat") return "#f67b70";
  return "#efbd79";
}

function activityColor(kind: "route" | "rescue" | "duel"): string {
  return kind === "rescue" ? "#8bc9a5" : kind === "duel" ? "#f67b70" : "#efbd79";
}

function drawMapSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, diamond = false, fill = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#0a151e";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (diamond) {
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius, 0);
    ctx.lineTo(0, radius);
    ctx.lineTo(-radius, 0);
    ctx.closePath();
  } else ctx.arc(0, 0, radius, 0, Math.PI * 2);
  if (fill) ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}
