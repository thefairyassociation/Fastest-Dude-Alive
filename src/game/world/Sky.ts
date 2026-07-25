import {
  CascadedShadowGenerator,
  Color3,
  Color4,
  CubeTexture,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Quality } from "../core/Save";
import { damp, lerp, type Rng } from "../core/Rng";
import { createCloudSprite, createGlowSprite, createSkyGradient, type SkyStop } from "./Textures";

/**
 * Sky, sun, ambient light and cascaded shadows in one driveable unit.
 *
 * Story chapters set an atmosphere by id ("storm", "night", "dawn") and the
 * transition is interpolated, so a mission can turn the sky over on the
 * player without a reload. Free roam sits on the default late-afternoon
 * preset.
 */

export type AtmosphereId = "golden" | "noon" | "dusk" | "night" | "storm" | "dawn";

interface Atmosphere {
  /** Direction the sunlight travels (normalised). */
  sun: Vector3;
  sunColor: Color3;
  sunIntensity: number;
  skyColor: Color3;
  groundColor: Color3;
  ambientIntensity: number;
  fogColor: Color3;
  fogDensity: number;
  exposure: number;
  cloudAlpha: number;
  cloudTint: Color3;
  sunGlow: number;
  stops: SkyStop[];
}

const ATMOSPHERES: Record<AtmosphereId, Atmosphere> = {
  golden: {
    sun: new Vector3(-0.46, -0.72, 0.34).normalize(),
    sunColor: new Color3(1, 0.87, 0.7),
    sunIntensity: 3.6,
    skyColor: new Color3(0.68, 0.74, 0.84),
    groundColor: new Color3(0.44, 0.41, 0.37),
    ambientIntensity: 0.85,
    fogColor: new Color3(0.74, 0.78, 0.81),
    fogDensity: 0.00024,
    exposure: 1.1,
    cloudAlpha: 0.62,
    cloudTint: new Color3(1, 0.96, 0.9),
    sunGlow: 1,
    stops: [
      { at: 0, color: "#2f5c96" },
      { at: 0.3, color: "#5c86b6" },
      { at: 0.46, color: "#9fb9cd" },
      { at: 0.53, color: "#d9dcd2" },
      { at: 0.58, color: "#e4d9bd" },
      { at: 0.66, color: "#c4cdd2" },
      { at: 1, color: "#a9b6bf" },
    ],
  },
  noon: {
    sun: new Vector3(-0.18, -0.95, 0.16).normalize(),
    sunColor: new Color3(1, 0.97, 0.92),
    sunIntensity: 4.2,
    skyColor: new Color3(0.72, 0.8, 0.92),
    groundColor: new Color3(0.5, 0.49, 0.46),
    ambientIntensity: 0.95,
    fogColor: new Color3(0.79, 0.84, 0.89),
    fogDensity: 0.00018,
    exposure: 1.05,
    cloudAlpha: 0.5,
    cloudTint: new Color3(1, 1, 1),
    sunGlow: 0.8,
    stops: [
      { at: 0, color: "#2a63ae" },
      { at: 0.34, color: "#5f95cc" },
      { at: 0.5, color: "#a8c6da" },
      { at: 0.62, color: "#d5e0e6" },
      { at: 1, color: "#b9c6ce" },
    ],
  },
  dusk: {
    sun: new Vector3(-0.62, -0.28, 0.28).normalize(),
    sunColor: new Color3(1, 0.62, 0.4),
    sunIntensity: 2.6,
    skyColor: new Color3(0.44, 0.44, 0.6),
    groundColor: new Color3(0.3, 0.26, 0.28),
    ambientIntensity: 0.72,
    fogColor: new Color3(0.5, 0.44, 0.47),
    fogDensity: 0.00036,
    exposure: 1.16,
    cloudAlpha: 0.75,
    cloudTint: new Color3(1, 0.74, 0.6),
    sunGlow: 1.5,
    stops: [
      { at: 0, color: "#152346" },
      { at: 0.28, color: "#39406f" },
      { at: 0.45, color: "#7a5a7b" },
      { at: 0.55, color: "#c8785c" },
      { at: 0.63, color: "#e2a05f" },
      { at: 0.74, color: "#8a7480" },
      { at: 1, color: "#4b4a5c" },
    ],
  },
  night: {
    sun: new Vector3(-0.3, -0.86, 0.42).normalize(),
    sunColor: new Color3(0.5, 0.6, 0.86),
    sunIntensity: 0.55,
    skyColor: new Color3(0.2, 0.25, 0.4),
    groundColor: new Color3(0.11, 0.11, 0.15),
    ambientIntensity: 0.5,
    fogColor: new Color3(0.12, 0.14, 0.2),
    fogDensity: 0.00052,
    exposure: 1.5,
    cloudAlpha: 0.42,
    cloudTint: new Color3(0.42, 0.48, 0.66),
    sunGlow: 0.5,
    stops: [
      { at: 0, color: "#05070f" },
      { at: 0.35, color: "#0b1120" },
      { at: 0.52, color: "#16203a" },
      { at: 0.62, color: "#243352" },
      { at: 0.78, color: "#2d3a55" },
      { at: 1, color: "#1a2233" },
    ],
  },
  storm: {
    sun: new Vector3(-0.35, -0.6, 0.5).normalize(),
    sunColor: new Color3(0.62, 0.66, 0.78),
    sunIntensity: 1.1,
    skyColor: new Color3(0.34, 0.37, 0.44),
    groundColor: new Color3(0.19, 0.2, 0.22),
    ambientIntensity: 0.66,
    fogColor: new Color3(0.32, 0.35, 0.4),
    fogDensity: 0.00088,
    exposure: 1.3,
    cloudAlpha: 0.95,
    cloudTint: new Color3(0.55, 0.58, 0.66),
    sunGlow: 0.35,
    stops: [
      { at: 0, color: "#171b24" },
      { at: 0.32, color: "#242b36" },
      { at: 0.5, color: "#3a424e" },
      { at: 0.6, color: "#525b66" },
      { at: 0.75, color: "#3f4750" },
      { at: 1, color: "#282e36" },
    ],
  },
  dawn: {
    sun: new Vector3(0.58, -0.34, -0.36).normalize(),
    sunColor: new Color3(1, 0.82, 0.68),
    sunIntensity: 2.3,
    skyColor: new Color3(0.56, 0.6, 0.74),
    groundColor: new Color3(0.34, 0.33, 0.34),
    ambientIntensity: 0.78,
    fogColor: new Color3(0.62, 0.62, 0.68),
    fogDensity: 0.0004,
    exposure: 1.14,
    cloudAlpha: 0.68,
    cloudTint: new Color3(1, 0.86, 0.82),
    sunGlow: 1.2,
    stops: [
      { at: 0, color: "#1c2b52" },
      { at: 0.3, color: "#456087" },
      { at: 0.48, color: "#8f8fa5" },
      { at: 0.58, color: "#dba98c" },
      { at: 0.68, color: "#c9b39c" },
      { at: 1, color: "#93a0ac" },
    ],
  },
};

interface CloudLayer {
  mesh: Mesh;
  material: StandardMaterial;
  baseAlpha: number;
  drift: number;
  azimuth: number;
  elevation: number;
}

export class Sky {
  readonly shadows: CascadedShadowGenerator;

  private readonly sun: DirectionalLight;
  private readonly ambient: HemisphericLight;
  private readonly dome: Mesh;
  private readonly domeMaterial: StandardMaterial;
  private readonly sunPlane: Mesh;
  private readonly sunMaterial: StandardMaterial;
  private readonly clouds: CloudLayer[] = [];
  private readonly gradients = new Map<AtmosphereId, ReturnType<typeof createSkyGradient>>();
  private readonly environments = new Map<AtmosphereId, CubeTexture>();

  private current: AtmosphereId = "golden";
  private blend: Atmosphere;
  private target: Atmosphere;
  private transition = 1;
  private lightningTimer = 4;
  private lightningFlash = 0;
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    rng: Rng,
    quality: Quality,
    /** Furthest visible distance; the dome and shadow range key off it. */
    private readonly worldExtent: number,
  ) {
    const base = ATMOSPHERES.golden;
    this.blend = cloneAtmosphere(base);
    this.target = cloneAtmosphere(base);

    this.ambient = new HemisphericLight("sky-ambient", new Vector3(0.1, 1, -0.05), scene);
    this.ambient.specular = Color3.Black();

    this.sun = new DirectionalLight("sun", base.sun.clone(), scene);
    this.sun.position = base.sun.scale(-worldExtent);

    const mapSize = quality === "low" ? 1024 : quality === "medium" ? 1536 : 2048;
    this.shadows = new CascadedShadowGenerator(mapSize, this.sun);
    this.shadows.numCascades = quality === "low" ? 2 : 3;
    this.shadows.lambda = 0.88;
    this.shadows.shadowMaxZ = quality === "low" ? 320 : 520;
    this.shadows.stabilizeCascades = true;
    this.shadows.bias = 0.008;
    this.shadows.normalBias = 0.02;
    this.shadows.setDarkness(0.28);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality =
      quality === "high" ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.autoCalcDepthBounds = true;

    scene.fogMode = Scene.FOGMODE_EXP2;

    // Dome
    this.dome = MeshBuilder.CreateSphere(
      "sky-dome",
      { diameter: worldExtent * 3.4, segments: 24, sideOrientation: Mesh.BACKSIDE },
      scene,
    );
    this.domeMaterial = new StandardMaterial("sky-dome-material", scene);
    this.domeMaterial.diffuseColor = Color3.Black();
    this.domeMaterial.specularColor = Color3.Black();
    this.domeMaterial.disableLighting = true;
    this.domeMaterial.disableDepthWrite = true;
    this.dome.material = this.domeMaterial;
    this.dome.infiniteDistance = true;
    this.dome.applyFog = false;
    this.dome.isPickable = false;

    // Sun disc
    const sunSprite = createGlowSprite(
      scene,
      "sun-sprite",
      "rgba(255, 252, 240, 1)",
      "rgba(255, 232, 178, 0.55)",
      0.22,
    );
    this.sunPlane = MeshBuilder.CreatePlane("sun-disc", { size: worldExtent * 0.42 }, scene);
    this.sunMaterial = new StandardMaterial("sun-disc-material", scene);
    this.sunMaterial.diffuseTexture = sunSprite;
    this.sunMaterial.emissiveTexture = sunSprite;
    this.sunMaterial.useAlphaFromDiffuseTexture = true;
    this.sunMaterial.disableLighting = true;
    this.sunMaterial.disableDepthWrite = true;
    this.sunMaterial.alphaMode = 1; // additive: brightens the sky, never dims it
    this.sunPlane.material = this.sunMaterial;
    this.sunPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.sunPlane.infiniteDistance = true;
    this.sunPlane.applyFog = false;
    this.sunPlane.isPickable = false;

    // Cloud banks
    const cloudSprite = createCloudSprite(scene, rng);
    const cloudCount = quality === "low" ? 6 : 12;
    for (let i = 0; i < cloudCount; i += 1) {
      const azimuth = rng() * Math.PI * 2;
      const elevation = 0.1 + rng() * 0.38;
      const mesh = MeshBuilder.CreatePlane(
        `cloud-${i}`,
        { width: 900 + rng() * 1100, height: 240 + rng() * 260 },
        scene,
      );
      const material = new StandardMaterial(`cloud-material-${i}`, scene);
      material.diffuseTexture = cloudSprite;
      material.emissiveTexture = cloudSprite;
      material.useAlphaFromDiffuseTexture = true;
      material.disableLighting = true;
      material.disableDepthWrite = true;
      material.alphaMode = 1;
      mesh.material = material;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.infiniteDistance = true;
      mesh.applyFog = false;
      mesh.isPickable = false;
      this.clouds.push({
        mesh,
        material,
        baseAlpha: 0.4 + rng() * 0.5,
        drift: (0.004 + rng() * 0.01) * (rng() < 0.5 ? -1 : 1),
        azimuth,
        elevation,
      });
    }

    this.applyImmediate("golden");
  }

  get atmosphere(): AtmosphereId {
    return this.current;
  }

  /** Screen exposure the post pipeline should currently use. */
  get exposure(): number {
    return this.blend.exposure * (1 + this.lightningFlash * 0.5);
  }

  /** True while a storm flash is lighting the city, for FX to react to. */
  get flashing(): boolean {
    return this.lightningFlash > 0.25;
  }

  get sunDirection(): Vector3 {
    return this.blend.sun;
  }

  setAtmosphere(id: AtmosphereId, immediate = false): void {
    if (this.current === id && !immediate) return;
    this.current = id;
    this.target = cloneAtmosphere(ATMOSPHERES[id]);
    this.transition = immediate ? 1 : 0;
    if (immediate) this.applyImmediate(id);
    this.domeMaterial.emissiveTexture = this.gradientFor(id);
    this.scene.environmentTexture = this.environmentFor(id);
  }

  update(dt: number): void {
    this.elapsed += dt;

    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt * 0.45);
      // Exponential approach: `transition` only decides when we stop.
      const t = damp(2.2, dt);
      const from = this.blend;
      const to = this.target;
      // Lerp in place so the transition is allocation-free per frame.
      Vector3.LerpToRef(from.sun, to.sun, t, from.sun);
      from.sun.normalize();
      lerpColor(from.sunColor, to.sunColor, t);
      lerpColor(from.skyColor, to.skyColor, t);
      lerpColor(from.groundColor, to.groundColor, t);
      lerpColor(from.fogColor, to.fogColor, t);
      lerpColor(from.cloudTint, to.cloudTint, t);
      from.sunIntensity = lerp(from.sunIntensity, to.sunIntensity, t);
      from.ambientIntensity = lerp(from.ambientIntensity, to.ambientIntensity, t);
      from.fogDensity = lerp(from.fogDensity, to.fogDensity, t);
      from.exposure = lerp(from.exposure, to.exposure, t);
      from.cloudAlpha = lerp(from.cloudAlpha, to.cloudAlpha, t);
      from.sunGlow = lerp(from.sunGlow, to.sunGlow, t);
      this.push();
    }

    // Storms crack; everything else stays quiet.
    if (this.current === "storm") {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 2.5 + Math.random() * 6;
        this.lightningFlash = 1;
      }
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.4);
      const boost = 1 + this.lightningFlash * this.lightningFlash * 2.6;
      this.sun.intensity = this.blend.sunIntensity * boost;
      this.ambient.intensity = this.blend.ambientIntensity * (1 + this.lightningFlash * 1.4);
    }

    for (const cloud of this.clouds) {
      cloud.azimuth += cloud.drift * dt;
      const cos = Math.cos(cloud.elevation);
      cloud.mesh.position.set(
        cos * Math.sin(cloud.azimuth),
        Math.sin(cloud.elevation),
        cos * Math.cos(cloud.azimuth),
      );
      cloud.mesh.position.scaleInPlace(this.worldExtent * 1.5);
      cloud.material.alpha = cloud.baseAlpha * this.blend.cloudAlpha;
      cloud.material.emissiveColor = this.blend.cloudTint;
    }
  }

  private applyImmediate(id: AtmosphereId): void {
    this.blend = cloneAtmosphere(ATMOSPHERES[id]);
    this.target = cloneAtmosphere(ATMOSPHERES[id]);
    this.transition = 1;
    this.domeMaterial.emissiveTexture = this.gradientFor(id);
    this.scene.environmentTexture = this.environmentFor(id);
    this.push();
  }

  private push(): void {
    const a = this.blend;
    this.sun.direction.copyFrom(a.sun);
    this.sun.position.copyFrom(a.sun).scaleInPlace(-this.worldExtent);
    this.sun.diffuse = a.sunColor;
    this.sun.specular = a.sunColor;
    this.sun.intensity = a.sunIntensity;

    this.ambient.diffuse = a.skyColor;
    this.ambient.groundColor = a.groundColor;
    this.ambient.intensity = a.ambientIntensity;

    this.scene.fogColor = a.fogColor;
    this.scene.fogDensity = a.fogDensity;
    this.scene.clearColor = new Color4(a.fogColor.r, a.fogColor.g, a.fogColor.b, 1);

    this.sunPlane.position.copyFrom(a.sun).scaleInPlace(-this.worldExtent * 1.6);
    this.sunMaterial.alpha = a.sunGlow;
  }

  private gradientFor(id: AtmosphereId) {
    const existing = this.gradients.get(id);
    if (existing) return existing;
    const created = createSkyGradient(this.scene, ATMOSPHERES[id].stops, `sky-gradient-${id}`);
    this.gradients.set(id, created);
    return created;
  }

  /**
   * Image-based lighting without shipping an HDR.
   *
   * The six cube faces are painted from the same gradient the dome uses, so
   * PBR reflections and ambient tint always agree with the visible sky. It is
   * an approximation — no prefiltered mip chain — but a sky-coloured
   * reflection beats the black one an environment-less PBR scene gets.
   */
  private environmentFor(id: AtmosphereId): CubeTexture {
    const existing = this.environments.get(id);
    if (existing) return existing;

    const atmosphere = ATMOSPHERES[id];
    const column = document.createElement("canvas");
    column.width = 1;
    column.height = 256;
    const columnCtx = column.getContext("2d", { willReadFrequently: true });
    if (!columnCtx) throw new Error("2D canvas is unavailable; the sky cube cannot be painted.");
    const gradient = columnCtx.createLinearGradient(0, 0, 0, 256);
    for (const stop of atmosphere.stops) gradient.addColorStop(stop.at, stop.color);
    columnCtx.fillStyle = gradient;
    columnCtx.fillRect(0, 0, 1, 256);
    const pixels = columnCtx.getImageData(0, 0, 1, 256).data;

    const sample = (t: number): string => {
      const index = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
      return `rgb(${pixels[index] ?? 0}, ${pixels[index + 1] ?? 0}, ${pixels[index + 2] ?? 0})`;
    };

    const size = 128;
    const face = (paint: (ctx: CanvasRenderingContext2D) => void): string => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas is unavailable; the sky cube cannot be painted.");
      paint(ctx);
      return canvas.toDataURL();
    };

    // Side faces span roughly ±45° of elevation around the horizon.
    const side = face((ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, size);
      for (let i = 0; i <= 8; i += 1) {
        g.addColorStop(i / 8, sample(0.25 + (i / 8) * 0.5));
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
    const up = face((ctx) => {
      ctx.fillStyle = sample(0.04);
      ctx.fillRect(0, 0, size, size);
    });
    const down = face((ctx) => {
      const g = atmosphere.groundColor;
      ctx.fillStyle = `rgb(${Math.round(g.r * 255)}, ${Math.round(g.g * 255)}, ${Math.round(g.b * 255)})`;
      ctx.fillRect(0, 0, size, size);
    });

    const cube = CubeTexture.CreateFromImages([side, up, side, side, down, side], this.scene);
    cube.gammaSpace = true;
    cube.level = 1;
    this.environments.set(id, cube);
    return cube;
  }
}

function cloneAtmosphere(source: Atmosphere): Atmosphere {
  return {
    sun: source.sun.clone(),
    sunColor: source.sunColor.clone(),
    sunIntensity: source.sunIntensity,
    skyColor: source.skyColor.clone(),
    groundColor: source.groundColor.clone(),
    ambientIntensity: source.ambientIntensity,
    fogColor: source.fogColor.clone(),
    fogDensity: source.fogDensity,
    exposure: source.exposure,
    cloudAlpha: source.cloudAlpha,
    cloudTint: source.cloudTint.clone(),
    sunGlow: source.sunGlow,
    stops: source.stops,
  };
}

function lerpColor(target: Color3, to: Color3, t: number): void {
  target.r = lerp(target.r, to.r, t);
  target.g = lerp(target.g, to.g, t);
  target.b = lerp(target.b, to.b, t);
}
