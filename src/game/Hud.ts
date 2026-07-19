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

    this.combo.textContent = `CHAIN ×${player.combo}`;
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
    const width = minimap.width;
    const height = minimap.height;
    const map = (value: number) => (value / (this.cityExtent * 2) + 0.5) * width;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(7, 8, 18, 0.96)";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(116, 222, 239, 0.12)";
    ctx.lineWidth = 1;
    for (let road = -1275; road <= 1275; road += 150) {
      const pixel = map(road + 75);
      ctx.beginPath();
      ctx.moveTo(pixel, 0);
      ctx.lineTo(pixel, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pixel);
      ctx.lineTo(width, pixel);
      ctx.stroke();
    }

    const checkpoint = trial.current;
    if (checkpoint) {
      ctx.beginPath();
      ctx.arc(map(checkpoint.x), map(checkpoint.z), 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#5df6ff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = "#ff4f8b";
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      ctx.beginPath();
      ctx.arc(map(enemy.position.x), map(enemy.position.z), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const playerX = map(player.root.position.x);
    const playerY = map(player.root.position.z);
    const yaw = player.root.rotation.y;
    ctx.save();
    ctx.translate(playerX, playerY);
    ctx.rotate(-yaw);
    ctx.fillStyle = "#ffc857";
    ctx.shadowColor = "#ffc857";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
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
