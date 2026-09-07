import {
  Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3, VertexBuffer,
} from "@babylonjs/core";
import { mulberry32 } from "../core/Rng";
import type { Quality } from "../core/Save";
import { BLOCK_PITCH, BLOCK_SIZE, KERB_Y, type City } from "./City";

/** Ambient actors never enter the combat/rescue pools or the collision grid. */
export const CITY_LIFE_BUDGETS = {
  low: { cars: 12, pedestrians: 20, radius: 240 },
  medium: { cars: 24, pedestrians: 36, radius: 310 },
  high: { cars: 36, pedestrians: 54, radius: 380 },
} as const;

interface PathPose { x: number; z: number; yaw: number }

/** A continuous rounded square, measured in metres, with a tangent heading. */
export function blockLoopLength(halfSide: number, corner: number): number {
  return 8 * (halfSide - corner) + Math.PI * 2 * corner;
}

export function blockLoopPose(distance: number, halfSide: number, corner: number, out: PathPose): void {
  const straight = 2 * (halfSide - corner);
  const quarter = straight + Math.PI * corner * 0.5;
  const length = quarter * 4;
  const d = ((distance % length) + length) % length;
  const side = Math.floor(d / quarter);
  const along = d - side * quarter;
  let x: number;
  let z: number;
  let yaw: number;
  if (along <= straight) {
    x = -halfSide + corner + along;
    z = -halfSide;
    yaw = Math.PI * 0.5;
  } else {
    const angle = (along - straight) / corner;
    x = halfSide - corner + Math.sin(angle) * corner;
    z = -halfSide + corner - Math.cos(angle) * corner;
    yaw = Math.PI * 0.5 - angle;
  }
  // Rotating the first edge gives four continuous corners without temporary vectors.
  if (side === 0) { out.x = x; out.z = z; }
  else if (side === 1) { out.x = -z; out.z = x; }
  else if (side === 2) { out.x = -x; out.z = -z; }
  else { out.x = z; out.z = -x; }
  out.yaw = yaw - side * Math.PI * 0.5;
}

interface Citizen {
  active: boolean;
  centerX: number;
  centerZ: number;
  x: number;
  z: number;
  y: number;
  distance: number;
  halfSide: number;
  corner: number;
  direction: number;
  speed: number;
  yaw: number;
  scale: number;
  fade: number;
}

interface Batch { mesh: Mesh; matrices: Float32Array }

/**
 * Seven instanced draw batches, fixed pools, deterministic placement. The
 * existing 150 m street grid is used at every map size. Whole routes are
 * validated before activation, so loops beside the river never cut through
 * water and landmark sidewalks never send citizens through a building.
 */
export class CityLife {
  private readonly rng = mulberry32(0xc17e11fe);
  private readonly cars: Citizen[] = [];
  private readonly pedestrians: Citizen[] = [];
  private readonly batches: Batch[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly carMatrices = new Float32Array(CITY_LIFE_BUDGETS.high.cars * 16);
  private readonly bodyMatrices = new Float32Array(CITY_LIFE_BUDGETS.high.pedestrians * 16);
  private readonly headMatrices = new Float32Array(CITY_LIFE_BUDGETS.high.pedestrians * 16);
  private readonly legMatrices = new Float32Array(CITY_LIFE_BUDGETS.high.pedestrians * 32);
  private readonly armMatrices = new Float32Array(CITY_LIFE_BUDGETS.high.pedestrians * 32);
  private readonly pose: PathPose = { x: 0, z: 0, yaw: 0 };
  private readonly matrix = Matrix.Identity();
  private readonly rotation = Quaternion.Identity();
  private readonly position = Vector3.Zero();
  private readonly scale = Vector3.One();
  private readonly routeValidity: Uint8Array;
  private readonly blockLimit: number;
  private readonly blockColumns: number;
  private quality: Quality;

  constructor(private readonly scene: Scene, private readonly city: City, quality: Quality) {
    this.quality = quality;
    this.blockLimit = Math.floor(city.extent / BLOCK_PITCH - 0.5);
    this.blockColumns = this.blockLimit * 2 + 1;
    // Three route kinds per city block, one byte each, including invalid
    // routes. The 37×37 city needs 4.1 KB and never revalidates a known loop.
    this.routeValidity = new Uint8Array(this.blockColumns * this.blockColumns * 3);
    for (let i = 0; i < CITY_LIFE_BUDGETS.high.cars; i += 1) this.cars.push(this.newActor(true));
    for (let i = 0; i < CITY_LIFE_BUDGETS.high.pedestrians; i += 1) this.pedestrians.push(this.newActor(false));
    this.buildCars();
    this.buildCitizens();
  }

  setQuality(quality: Quality): void { this.quality = quality; }

  /** Pass real frame dt; timeScale slows citizens along with focus time. */
  update(dt: number, focus: Vector3, timeScale = 1): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const realDt = Math.min(0.1, dt);
    const step = realDt * Math.min(1, Math.max(0, timeScale));
    const budget = CITY_LIFE_BUDGETS[this.quality];
    this.updatePool(this.cars, budget.cars, focus, budget.radius, step, realDt, true);
    this.updatePool(this.pedestrians, budget.pedestrians, focus, budget.radius, step, realDt, false);
    for (let i = 0; i < this.cars.length; i += 1) {
      const actor = this.cars[i]!;
      this.writeMatrix(this.carMatrices, i, actor.x, actor.y, actor.z, actor.yaw, 0, actor.active ? actor.fade : 0);
    }
    for (let i = 0; i < this.pedestrians.length; i += 1) this.poseCitizen(this.pedestrians[i]!, i);
    for (const batch of this.batches) batch.mesh.thinInstanceBufferUpdated("matrix");
  }

  dispose(): void {
    for (const batch of this.batches) batch.mesh.dispose();
    for (const material of this.materials) material.dispose();
  }

  private newActor(car: boolean): Citizen {
    return {
      active: false, centerX: 0, centerZ: 0, x: 0, z: 0, y: 0, distance: 0,
      halfSide: 0, corner: 0, direction: 1, speed: car ? 9 + this.rng() * 5 : 0.9 + this.rng() * 0.55,
      yaw: 0, scale: car ? 1 : 0.93 + this.rng() * 0.14, fade: 0,
    };
  }

  private updatePool(pool: Citizen[], count: number, focus: Vector3, radius: number, dt: number, realDt: number, car: boolean): void {
    let respawns = 0;
    for (let i = 0; i < pool.length; i += 1) {
      const actor = pool[i]!;
      if (i >= count) { actor.active = false; actor.fade = 0; continue; }
      const dx = actor.x - focus.x;
      const dz = actor.z - focus.z;
      if (actor.active && dx * dx + dz * dz > (radius + 90) ** 2) actor.active = false;
      if (!actor.active) {
        if (respawns >= (car ? 2 : 3)) continue;
        respawns += 1;
        if (!this.spawn(actor, pool, focus, radius, car)) continue;
      }
      let speed = actor.speed;
      if (car) {
        // Slow before corners and follow a same-lane car rather than
        // visually overtaking it. Ambient vehicles do not block the runner.
        const quarter = blockLoopLength(actor.halfSide, actor.corner) / 4;
        const within = ((actor.distance % quarter) + quarter) % quarter;
        const turnStart = 2 * (actor.halfSide - actor.corner);
        const beforeTurn = actor.direction > 0 ? turnStart - within : within;
        if (beforeTurn < 18 && beforeTurn > 0) speed *= 0.42;
        for (const other of pool) {
          if (other === actor || !other.active) continue;
          const aheadX = other.x - actor.x;
          const aheadZ = other.z - actor.z;
          const forward = aheadX * Math.sin(actor.yaw) + aheadZ * Math.cos(actor.yaw);
          const lateral = Math.abs(aheadX * Math.cos(actor.yaw) - aheadZ * Math.sin(actor.yaw));
          if (forward > 0 && forward < 9 && lateral < 2.1) speed *= Math.max(0, (forward - 5) / 4);
        }
      }
      actor.distance = (actor.distance + speed * dt * actor.direction) % blockLoopLength(actor.halfSide, actor.corner);
      blockLoopPose(actor.distance, actor.halfSide, actor.corner, this.pose);
      actor.x = actor.centerX + this.pose.x;
      actor.z = actor.centerZ + this.pose.z;
      actor.yaw = this.pose.yaw + (actor.direction < 0 ? Math.PI : 0);
      const distance = Math.hypot(actor.x - focus.x, actor.z - focus.z);
      const visible = Math.min(1, Math.max(0, (radius + 65 - distance) / 45));
      actor.fade += (visible - actor.fade) * Math.min(1, realDt * 5);
    }
  }

  private spawn(actor: Citizen, pool: Citizen[], focus: Vector3, radius: number, car: boolean): boolean {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const angle = this.rng() * Math.PI * 2;
      const range = 65 + this.rng() * Math.max(1, radius - 100);
      const gx = Math.max(-this.blockLimit, Math.min(this.blockLimit, Math.round((focus.x + Math.cos(angle) * range) / BLOCK_PITCH)));
      const gz = Math.max(-this.blockLimit, Math.min(this.blockLimit, Math.round((focus.z + Math.sin(angle) * range) / BLOCK_PITCH)));
      actor.centerX = gx * BLOCK_PITCH;
      actor.centerZ = gz * BLOCK_PITCH;
      actor.direction = this.rng() > 0.5 ? 1 : -1;
      actor.halfSide = car ? BLOCK_PITCH * 0.5 + actor.direction * 5.8 : BLOCK_SIZE * 0.5 - 0.7;
      actor.corner = car ? 9 : 2.5;
      actor.distance = this.rng() * blockLoopLength(actor.halfSide, actor.corner);
      blockLoopPose(actor.distance, actor.halfSide, actor.corner, this.pose);
      actor.x = actor.centerX + this.pose.x;
      actor.z = actor.centerZ + this.pose.z;
      if (Math.hypot(actor.x - focus.x, actor.z - focus.z) < 32) continue;
      if (pool.some(other => other !== actor && other.active && Math.hypot(other.x - actor.x, other.z - actor.z) < (car ? 15 : 3))) continue;
      const key = ((gz + this.blockLimit) * this.blockColumns + gx + this.blockLimit) * 3 + (car ? actor.direction > 0 ? 0 : 1 : 2);
      if (!this.routeValidity[key]) this.routeValidity[key] = this.routeClear(actor, car) ? 1 : 2;
      if (this.routeValidity[key] !== 1) continue;
      actor.y = car ? 0 : KERB_Y;
      actor.yaw = this.pose.yaw + (actor.direction < 0 ? Math.PI : 0);
      actor.fade = 0;
      actor.active = true;
      return true;
    }
    return false;
  }

  private routeClear(actor: Citizen, car: boolean): boolean {
    const length = blockLoopLength(actor.halfSide, actor.corner);
    const samples = Math.ceil(length / (car ? 5 : 2));
    const clearance = car ? 2.4 : 0.27;
    for (let i = 0; i < samples; i += 1) {
      blockLoopPose(i * length / samples, actor.halfSide, actor.corner, this.pose);
      const x = actor.centerX + this.pose.x;
      const z = actor.centerZ + this.pose.z;
      if (Math.abs(x) + clearance >= this.city.extent || Math.abs(z) + clearance >= this.city.extent) return false;
      if (this.city.isWater(x, z)) return false;
      const floor = this.city.groundHeight(x, z, 1);
      if (car ? floor > 0.12 : floor < KERB_Y - 0.05) return false;
      if (this.city.grid.overlaps(x, z, clearance, car ? 0 : KERB_Y, 1.9, 0.5)) return false;
    }
    return true;
  }

  private poseCitizen(actor: Citizen, index: number): void {
    const s = actor.active ? actor.scale * actor.fade : 0;
    const gait = Math.sin(actor.distance * 5.2) * 0.46;
    const bob = Math.abs(Math.sin(actor.distance * 5.2)) * 0.025;
    this.writeMatrix(this.bodyMatrices, index, actor.x, actor.y + bob * s, actor.z, actor.yaw, 0, s);
    this.writeMatrix(this.headMatrices, index, actor.x, actor.y + bob * s, actor.z, actor.yaw, 0, s);
    const cos = Math.cos(actor.yaw);
    const sin = Math.sin(actor.yaw);
    for (let side = 0; side < 2; side += 1) {
      const sign = side * 2 - 1;
      this.writeMatrix(this.legMatrices, index * 2 + side,
        actor.x + cos * sign * 0.115 * s, actor.y + 0.88 * s, actor.z - sin * sign * 0.115 * s,
        actor.yaw, gait * sign, s);
      this.writeMatrix(this.armMatrices, index * 2 + side,
        actor.x + cos * sign * 0.265 * s, actor.y + (1.39 + bob) * s, actor.z - sin * sign * 0.265 * s,
        actor.yaw, -gait * sign * 0.8, s);
    }
  }

  private writeMatrix(buffer: Float32Array, index: number, x: number, y: number, z: number, yaw: number, pitch: number, scale: number): void {
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.rotation);
    this.position.set(x, y, z);
    this.scale.setAll(scale);
    Matrix.ComposeToRef(this.scale, this.rotation, this.position, this.matrix);
    this.matrix.copyToArray(buffer, index * 16);
  }

  private material(name: string, color: string, emissive = false): StandardMaterial {
    const material = new StandardMaterial(`city-life-${name}`, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.setAll(emissive ? 0 : 0.2);
    if (emissive) material.emissiveColor.setAll(0.9);
    material.freeze();
    this.materials.push(material);
    return material;
  }

  private box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, color?: string): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.position.set(x, y, z);
    if (color) this.colorVertices(mesh, color);
    return mesh;
  }

  private colorVertices(mesh: Mesh, hex: string): void {
    const color = Color3.FromHexString(hex);
    const values = new Float32Array(mesh.getTotalVertices() * 4);
    for (let i = 0; i < values.length; i += 4) {
      values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b; values[i + 3] = 1;
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, values);
  }

  private batch(name: string, parts: Mesh[], material: StandardMaterial, matrices: Float32Array, colors?: Float32Array): void {
    const mesh = Mesh.MergeMeshes(parts, true, true)!;
    mesh.name = `city-life-${name}`;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
    if (colors) mesh.thinInstanceSetBuffer("color", colors, 4, true);
    this.batches.push({ mesh, matrices });
  }

  private palette(count: number, colors: string[], double = false): Float32Array {
    const out = new Float32Array(count * (double ? 8 : 4));
    for (let i = 0; i < count; i += 1) {
      const color = Color3.FromHexString(colors[i % colors.length]!);
      for (let side = 0; side < (double ? 2 : 1); side += 1) {
        const offset = (i * (double ? 2 : 1) + side) * 4;
        out[offset] = color.r; out[offset + 1] = color.g; out[offset + 2] = color.b; out[offset + 3] = 1;
      }
    }
    return out;
  }

  private buildCars(): void {
    const paints = this.palette(this.cars.length, ["#426775", "#c6c7bf", "#a24837", "#d9af59", "#404956", "#74866d", "#a7afb6"]);
    this.batch("car-paint", [
      this.box("sedan-body", 1.88, 0.52, 4.3, 0, 0.64, 0),
      this.box("sedan-hood", 1.78, 0.18, 1.2, 0, 0.96, 1.38),
      this.box("sedan-roof", 1.55, 0.1, 1.83, 0, 1.48, -0.15),
      this.box("sedan-trunk", 1.78, 0.17, 0.72, 0, 0.95, -1.68),
    ], this.material("paint", "#ffffff"), this.carMatrices, paints);
    const dark = [
      this.box("sedan-cabin", 1.58, 0.48, 2.04, 0, 1.2, -0.14),
      this.box("sedan-base", 1.7, 0.16, 4.28, 0, 0.34, 0),
      this.box("sedan-grille", 0.96, 0.22, 0.05, 0, 0.6, 2.17),
    ];
    for (const side of [-1, 1]) {
      for (const z of [-1.35, 1.3]) {
        const wheel = MeshBuilder.CreateCylinder("sedan-wheel", { height: 0.23, diameter: 0.66, tessellation: 12 }, this.scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.9, 0.34, z);
        dark.push(wheel);
      }
      dark.push(this.box("sedan-mirror", 0.21, 0.12, 0.26, side * 1.01, 1.13, 0.66));
    }
    this.batch("car-dark", dark, this.material("glass-rubber", "#18232a"), this.carMatrices);
    const lamps: Mesh[] = [];
    for (const side of [-1, 1]) {
      lamps.push(this.box("headlamp", 0.45, 0.14, 0.045, side * 0.61, 0.86, 2.17, "#fff0cf"));
      lamps.push(this.box("taillamp", 0.47, 0.12, 0.045, side * 0.6, 0.8, -2.17, "#b62518"));
    }
    this.batch("car-lamps", lamps, this.material("lamps", "#ffffff", true), this.carMatrices);
  }

  private buildCitizens(): void {
    const clothing = ["#9b6546", "#547a84", "#b3a394", "#694e6a", "#597051", "#bb8751", "#4d586f"];
    const count = this.pedestrians.length;
    this.batch("citizen-torso", [this.box("coat", 0.43, 0.55, 0.27, 0, 1.15, 0)],
      this.material("clothing", "#ffffff"), this.bodyMatrices, this.palette(count, clothing));
    const head = MeshBuilder.CreateSphere("citizen-head", { diameter: 0.26, segments: 8 }, this.scene);
    head.scaling.y = 1.18;
    head.position.y = 1.61;
    this.colorVertices(head, "#ffffff");
    const hair = MeshBuilder.CreateSphere("citizen-hair", { diameter: 0.27, segments: 8, slice: 0.42 }, this.scene);
    hair.position.y = 1.655;
    this.colorVertices(hair, "#302a27");
    const neck = this.box("citizen-neck", 0.13, 0.15, 0.13, 0, 1.46, 0, "#ffffff");
    this.batch("citizen-head", [head, hair, neck], this.material("skin", "#ffffff"), this.headMatrices,
      this.palette(count, ["#d2a37d", "#875b41", "#b7815f", "#e3b898", "#a77150"]));
    this.batch("citizen-leg", [
      this.box("trouser", 0.18, 0.72, 0.2, 0, -0.4, 0),
      this.box("shoe", 0.2, 0.13, 0.33, 0, -0.82, 0.055),
    ], this.material("trousers", "#293238"), this.legMatrices);
    this.batch("citizen-arm", [this.box("sleeve", 0.145, 0.56, 0.16, 0, -0.24, 0)],
      this.material("sleeves", "#ffffff"), this.armMatrices, this.palette(count, clothing, true));
  }
}
