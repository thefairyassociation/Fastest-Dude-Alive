import { Color3, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import type { Rng } from "../core/Rng";
import {
  FACADE_STYLES,
  createFacadeMaps,
  createGrassMaps,
  createMetalMaps,
  createRoadMaps,
  createSidewalkMaps,
  createWaterMaps,
  type SurfaceMaps,
} from "./Textures";

/**
 * Every material the city wears, built once and shared.
 *
 * The prototype used StandardMaterial with flat diffuse colours. Moving to
 * PBR buys energy-conserving specular, real roughness variation between
 * glass/brick/asphalt, and image-based lighting from the sky cube — which is
 * most of the difference between "coloured boxes" and "a photographed city".
 */
export class Palette {
  private readonly materials = new Map<string, PBRMaterial>();
  readonly facadeKeys: string[] = [];

  constructor(
    private readonly scene: Scene,
    rng: Rng,
    roadHalfMeters: number,
  ) {
    for (const style of FACADE_STYLES) {
      const key = `facade:${style.id}`;
      const maps = createFacadeMaps(scene, style, rng);
      const material = this.surface(key, maps, style.roughness, style.metallic);
      // Lit windows should not go pitch black at night.
      material.emissiveTexture = maps.albedo;
      material.emissiveColor = new Color3(0.045, 0.042, 0.036);
      this.facadeKeys.push(key);
    }

    this.surface("road", createRoadMaps(scene, rng, roadHalfMeters), 0.78, 0.02);
    this.surface("sidewalk", createSidewalkMaps(scene, rng), 0.86, 0.01);
    this.surface("grass", createGrassMaps(scene, rng), 0.95, 0);
    this.surface("metal", createMetalMaps(scene, rng), 0.42, 0.72);

    const water = this.surface("water", createWaterMaps(scene, rng), 0.12, 0.1);
    water.albedoColor = new Color3(0.42, 0.55, 0.62);
    water.alpha = 0.88;
    water.environmentIntensity = 1.5;

    this.flat("concrete", "#9d9a92", 0.88, 0.02);
    this.flat("concrete-dark", "#6d6b66", 0.9, 0.02);
    this.flat("trunk", "#4c3a2c", 0.94, 0);
    this.flat("leaf", "#44582f", 0.96, 0);
    this.flat("leaf-autumn", "#7d6a2e", 0.96, 0);
    this.flat("steel", "#3a3d40", 0.4, 0.8);
    this.flat("steel-bright", "#8f979d", 0.3, 0.85);
    this.flat("rubber", "#141517", 0.95, 0);
    this.flat("lab-white", "#dde1e3", 0.35, 0.06);
    this.flat("lab-trim", "#7fa8c4", 0.28, 0.4);
    this.flat("police-blue", "#1d3352", 0.6, 0.05);

    const glass = this.flat("glass", "#4c6272", 0.06, 0.2);
    glass.alpha = 0.42;
    glass.environmentIntensity = 1.8;

    for (const [index, hex] of ["#b9bdc1", "#24272b", "#d6d7d3", "#6e2822", "#2c3d57", "#565b60"].entries()) {
      this.flat(`car-${index}`, hex, 0.28, 0.15);
    }
    this.flat("car-glass", "#161c22", 0.08, 0.2);
  }

  get(key: string): PBRMaterial {
    const material = this.materials.get(key);
    if (!material) throw new Error(`Unknown material "${key}".`);
    return material;
  }

  /** Emissive sign/beacon material; created on demand per landmark. */
  emissive(key: string, hex: string, intensity: number): PBRMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new PBRMaterial(key, this.scene);
    material.albedoColor = Color3.Black();
    material.metallic = 0;
    material.roughness = 1;
    material.emissiveColor = Color3.FromHexString(hex).scale(intensity);
    material.unlit = false;
    this.materials.set(key, material);
    return material;
  }

  emissiveTextured(key: string, texture: Texture, intensity: number): PBRMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new PBRMaterial(key, this.scene);
    material.albedoColor = Color3.Black();
    material.metallic = 0;
    material.roughness = 1;
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(intensity, intensity, intensity);
    this.materials.set(key, material);
    return material;
  }

  /** Freezes every material once the world stops changing. */
  freeze(): void {
    for (const material of this.materials.values()) material.freeze();
  }

  private surface(key: string, maps: SurfaceMaps, roughness: number, metallic: number): PBRMaterial {
    const material = new PBRMaterial(key, this.scene);
    material.albedoTexture = maps.albedo;
    maps.normal.level = 0.85;
    material.bumpTexture = maps.normal;
    material.roughness = roughness;
    material.metallic = metallic;
    material.environmentIntensity = 0.85;
    material.specularIntensity = 0.9;
    this.materials.set(key, material);
    return material;
  }

  private flat(key: string, hex: string, roughness: number, metallic: number): PBRMaterial {
    const material = new PBRMaterial(key, this.scene);
    material.albedoColor = Color3.FromHexString(hex);
    material.roughness = roughness;
    material.metallic = metallic;
    material.environmentIntensity = 0.85;
    this.materials.set(key, material);
    return material;
  }
}
