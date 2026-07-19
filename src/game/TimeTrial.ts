import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

export interface TrialUpdate {
  checkpoint: boolean;
  finished: boolean;
  newBest: boolean;
}

const BEST_KEY = "fastest-dude-alive:meridian-loop-best";

export class TimeTrial {
  active = false;
  elapsed = 0;
  index = 0;
  best = loadBest();

  private readonly marker: Mesh;
  private readonly halo: Mesh;

  constructor(
    scene: Scene,
    private readonly route: Vector3[],
  ) {
    const material = new StandardMaterial("trial-marker", scene);
    material.diffuseColor = Color3.FromHexString("#53f6ff");
    material.emissiveColor = Color3.FromHexString("#35e6ff");
    material.disableLighting = true;

    this.marker = MeshBuilder.CreateTorus(
      "trial-checkpoint",
      { diameter: 15, thickness: 0.55, tessellation: 48 },
      scene,
    );
    this.marker.rotation.x = Math.PI * 0.5;
    this.marker.material = material;
    this.marker.setEnabled(false);

    this.halo = MeshBuilder.CreateTorus(
      "trial-checkpoint-halo",
      { diameter: 19, thickness: 0.12, tessellation: 48 },
      scene,
    );
    this.halo.rotation.x = Math.PI * 0.5;
    this.halo.material = material;
    this.halo.parent = this.marker;
  }

  get current(): Vector3 | null {
    return this.active ? this.route[this.index] ?? null : null;
  }

  start(): void {
    this.active = true;
    this.elapsed = 0;
    this.index = 0;
    this.marker.setEnabled(true);
    this.placeMarker();
  }

  update(dt: number, playerPosition: Vector3): TrialUpdate {
    const update = { checkpoint: false, finished: false, newBest: false };
    if (!this.active) return update;

    this.elapsed += dt;
    this.marker.rotation.z += dt * 1.6;
    this.halo.rotation.z -= dt * 2.4;
    this.marker.scaling.setAll(1 + Math.sin(this.elapsed * 5) * 0.04);

    const target = this.route[this.index];
    if (target && Vector3.DistanceSquared(playerPosition, target) < 15 * 15) {
      update.checkpoint = true;
      this.index += 1;

      if (this.index >= this.route.length) {
        this.active = false;
        this.marker.setEnabled(false);
        update.finished = true;
        if (this.best === null || this.elapsed < this.best) {
          this.best = this.elapsed;
          localStorage.setItem(BEST_KEY, this.elapsed.toString());
          update.newBest = true;
        }
      } else {
        this.placeMarker();
      }
    }

    return update;
  }

  objective(): { title: string; detail: string } {
    if (!this.active) {
      const best = this.best === null ? "No time recorded" : `Best: ${formatTime(this.best)}`;
      return { title: "Free roam", detail: `Press T for the Meridian Loop · ${best}` };
    }

    return {
      title: `Meridian Loop · ${this.index + 1}/${this.route.length}`,
      detail: `${formatTime(this.elapsed)} · Follow the cyan gate`,
    };
  }

  private placeMarker(): void {
    const target = this.route[this.index];
    if (!target) return;
    this.marker.position.copyFrom(target);
    this.marker.position.y = 5;
  }
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function loadBest(): number | null {
  const value = localStorage.getItem(BEST_KEY);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
