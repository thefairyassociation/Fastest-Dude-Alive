import { Enemy } from "./Enemy";
import { Player } from "./Player";
import { TimeTrial } from "./TimeTrial";

export class Hud {
  private readonly speedValue = element<HTMLElement>("speed-value");
  private readonly speedFill = element<HTMLElement>("speed-fill");
  private readonly speedTier = element<HTMLElement>("speed-tier");
  private readonly healthLabel = element<HTMLElement>("health-label");
  private readonly healthFill = element<HTMLElement>("health-fill");
  private readonly chargeLabel = element<HTMLElement>("charge-label");
  private readonly chargeFill = element<HTMLElement>("charge-fill");
  private readonly combo = element<HTMLElement>("combo");
  private readonly objectiveTitle = element<HTMLElement>("objective-title");
  private readonly objectiveDetail = element<HTMLElement>("objective-detail");
  private readonly rendererBadge = element<HTMLElement>("renderer-badge");
  private readonly focusBanner = element<HTMLElement>("focus-banner");
  private readonly captureHint = element<HTMLElement>("capture-hint");
  private readonly toastElement = element<HTMLElement>("toast");
  private readonly minimap = element<HTMLCanvasElement>("minimap");
  private readonly context: CanvasRenderingContext2D;
  private toastTimer = 0;

  constructor(private readonly cityExtent: number) {
    const context = this.minimap.getContext("2d");
    if (!context) throw new Error("The minimap canvas is unavailable.");
    this.context = context;

    document.addEventListener("pointerlockchange", () => {
      this.captureHint.classList.toggle("is-hidden", document.pointerLockElement !== null);
    });
  }

  setRenderer(name: string): void {
    this.rendererBadge.textContent = `${name} · HAVOK V2`;
  }

  update(
    player: Player,
    enemies: Enemy[],
    trial: TimeTrial,
    focusActive: boolean,
  ): void {
    const speedKph = Math.round(player.speed * 3.6);
    this.speedValue.textContent = speedKph.toString();
    this.speedFill.style.transform = `scaleX(${Math.min(1, speedKph / 780)})`;
    this.speedTier.textContent = tier(speedKph);

    this.healthLabel.textContent = Math.ceil(player.health).toString();
    this.healthFill.style.transform = `scaleX(${player.health / 100})`;
    this.chargeLabel.textContent = Math.floor(player.charge).toString();
    this.chargeFill.style.transform = `scaleX(${player.charge / 100})`;

    this.combo.textContent = `×${player.combo} chain`;
    this.combo.classList.toggle("active", player.combo > 1);

    const objective = trial.objective();
    this.objectiveTitle.textContent = objective.title;
    this.objectiveDetail.textContent = objective.detail;
    this.focusBanner.classList.toggle("active", focusActive);

    setReady("ability-dash", player.dashCooldown <= 0 && player.charge >= 20);
    setReady("ability-bolt", player.boltCooldown <= 0 && player.charge >= 15);
    setReady("ability-pulse", player.pulseCooldown <= 0 && player.charge >= 35);
    setReady("ability-focus", player.charge > 0);

    document.documentElement.style.setProperty("--speed-fx", (player.speedRatio * 0.6).toFixed(2));
    this.drawMap(player, enemies, trial);
  }

  toast(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add("active");
    this.toastTimer = window.setTimeout(() => {
      this.toastElement.classList.remove("active");
    }, 1550);
  }

  flashAbility(id: string): void {
    const target = document.getElementById(id);
    target?.classList.add("flash");
    window.setTimeout(() => target?.classList.remove("flash"), 140);
  }

  private drawMap(player: Player, enemies: Enemy[], trial: TimeTrial): void {
    const { context: ctx, minimap } = this;
    const size = minimap.width;
    const half = size / 2;
    const range = 290; // meters from the player to the map edge
    const scale = half / range;
    const px = player.root.position.x;
    const pz = player.root.position.z;
    const toX = (x: number) => half + (x - px) * scale;
    const toY = (z: number) => half - (z - pz) * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = "rgba(12, 13, 15, 0.72)";
    ctx.fillRect(0, 0, size, size);

    // Road strips around the player (roads run at (k - 0.5) * 150).
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    const roadHalf = 20 * scale;
    const kMin = Math.floor((px - range) / 150 + 0.5);
    const kMax = Math.ceil((px + range) / 150 + 0.5);
    for (let k = kMin; k <= kMax; k += 1) {
      const road = (k - 0.5) * 150;
      if (Math.abs(road) > this.cityExtent) continue;
      ctx.fillRect(toX(road) - roadHalf, 0, roadHalf * 2, size);
    }
    const kzMin = Math.floor((pz - range) / 150 + 0.5);
    const kzMax = Math.ceil((pz + range) / 150 + 0.5);
    for (let k = kzMin; k <= kzMax; k += 1) {
      const road = (k - 0.5) * 150;
      if (Math.abs(road) > this.cityExtent) continue;
      ctx.fillRect(0, toY(road) - roadHalf, size, roadHalf * 2);
    }

    // Fade everything beyond the city bounds.
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    if (px - range < -this.cityExtent) ctx.fillRect(0, 0, toX(-this.cityExtent), size);
    if (px + range > this.cityExtent) ctx.fillRect(toX(this.cityExtent), 0, size, size);
    if (pz + range > this.cityExtent) ctx.fillRect(0, 0, size, toY(this.cityExtent));
    if (pz - range < -this.cityExtent) ctx.fillRect(0, toY(-this.cityExtent), size, size);

    // Active checkpoint: marker in range, edge chevron when out of range.
    const checkpoint = trial.current;
    if (checkpoint) {
      const dx = checkpoint.x - px;
      const dz = checkpoint.z - pz;
      const distance = Math.hypot(dx, dz);
      if (distance * scale < half - 16) {
        ctx.beginPath();
        ctx.arc(toX(checkpoint.x), toY(checkpoint.z), 7, 0, Math.PI * 2);
        ctx.strokeStyle = "#f2a33c";
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        const angle = Math.atan2(-dz, dx);
        const ex = half + Math.cos(angle) * (half - 14);
        const ey = half + Math.sin(angle) * (half - 14);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(angle);
        ctx.fillStyle = "#f2a33c";
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-4, -6);
        ctx.lineTo(-4, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.fillStyle = "#e5484d";
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - px;
      const dz = enemy.position.z - pz;
      if (Math.hypot(dx, dz) > range) continue;
      ctx.beginPath();
      ctx.arc(toX(enemy.position.x), toY(enemy.position.z), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow at the center, rotated to heading (north-up map).
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
    ctx.textAlign = "center";
    ctx.fillText("N", half, 20);

    ctx.restore();
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing HUD element #${id}`);
  return value as T;
}

function setReady(id: string, ready: boolean): void {
  document.getElementById(id)?.classList.toggle("ready", ready);
}

function tier(speedKph: number): string {
  if (speedKph < 5) return "STILL";
  if (speedKph < 90) return "STREET";
  if (speedKph < 280) return "RAPID";
  if (speedKph < 540) return "SUPERSONIC";
  return "OVERSPEED";
}
