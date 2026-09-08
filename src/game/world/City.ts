import { Mesh, MeshBuilder, Scene, Vector3, Vector4 } from "@babylonjs/core";
import { clamp, mulberry32, pick, type Rng } from "../core/Rng";
import type { Quality } from "../core/Save";
import { CollisionGrid, type Solid } from "./Collision";
import { Palette } from "./Materials";
import { Sky } from "./Sky";
import { StaticBoxBatch } from "./StaticGeometry";
import { createSignTexture, FACADE_TILE_METERS, GRASS_TILE_METERS, SIDEWALK_TILE_METERS } from "./Textures";
import { buildLandmarks, type BuildContext, type LandmarkSpec } from "./Landmarks";
import { buildExpansionBlock, buildRiverfront, buildHorizon } from "./WorldArt";

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */

/** 37 × 37 blocks; the original 25 × 25 city remains at its original coordinates. */
const GRID_RADIUS = 18;
export const LEGACY_GRID_RADIUS = 12;
const BLOCK_PITCH = 150;
const BLOCK_SIZE = 110;
export const ROAD_HALF = 20;
const LOT_OFFSET = 28;
/** Blocks per merged chunk. Chunks are the unit of frustum culling. */
const CHUNK_BLOCKS = 5;

export const ROAD_Y = 0;
export const KERB_Y = 0.42;
const WATER_Y = 0.06;

/** The river runs down this block column; bridges cross at these rows. */
const RIVER_COLUMN = 7;
export const BRIDGE_ROWS = [-14, -7, 0, 7, 14];

/* ------------------------------------------------------------------ */
/* Districts                                                           */
/* ------------------------------------------------------------------ */

export type DistrictId =
  | "crest"
  | "halcyon-row"
  | "old-meridian"
  | "kestrel-docks"
  | "marrow-hill"
  | "midtown"
  | "northline"
  | "westhaven"
  | "foundry-belt"
  | "saltmere";

interface District {
  id: DistrictId;
  name: string;
  blurb: string;
  /** Facade style ids weighted for this district. */
  styles: string[];
  minHeight: number;
  maxHeight: number;
  /** Extra height multiplier applied near the city centre. */
  centrality: number;
  parkChance: number;
  carChance: number;
}

export const DISTRICTS: Record<DistrictId, District> = {
  northline: { id: "northline", name: "Northline", blurb: "Copper observatories, transit halls and the city’s open northern sky.", styles: ["institute-white", "glass-tower"], minHeight: 20, maxHeight: 90, centrality: 0.2, parkChance: 0.2, carChance: 0.15 },
  westhaven: { id: "westhaven", name: "Westhaven", blurb: "Garden terraces, courtyards and the reservoir that keeps Meridian running.", styles: ["sandstone-deco", "brick-mid"], minHeight: 10, maxHeight: 32, centrality: 0, parkChance: 0.25, carChance: 0.18 },
  "foundry-belt": { id: "foundry-belt", name: "The Foundry Belt", blurb: "Working yards, smokestacks and long roads between the old industries.", styles: ["brick-mid", "panel-dark"], minHeight: 12, maxHeight: 40, centrality: 0, parkChance: 0.08, carChance: 0.12 },
  saltmere: { id: "saltmere", name: "Saltmere", blurb: "Ferry halls, painted freight stacks and a lighthouse above the eastern city.", styles: ["institute-white", "concrete-block"], minHeight: 12, maxHeight: 56, centrality: 0, parkChance: 0.12, carChance: 0.12 },
  crest: {
    id: "crest",
    name: "The Crest",
    blurb: "Glass, money, and the longest sightlines in Meridian.",
    styles: ["glass-tower", "panel-dark", "glass-tower", "concrete-block"],
    minHeight: 60,
    maxHeight: 210,
    centrality: 1,
    parkChance: 0.03,
    carChance: 0.36,
  },
  "halcyon-row": {
    id: "halcyon-row",
    name: "Halcyon Row",
    blurb: "Research campuses, clean rooms, and a very well-funded skyline.",
    styles: ["institute-white", "glass-tower", "institute-white", "panel-dark"],
    minHeight: 34,
    maxHeight: 110,
    centrality: 0.5,
    parkChance: 0.1,
    carChance: 0.28,
  },
  "old-meridian": {
    id: "old-meridian",
    name: "Old Meridian",
    blurb: "Brick warehouses and fire escapes. The city before the money.",
    styles: ["brick-mid", "sandstone-deco", "brick-mid", "concrete-block"],
    minHeight: 20,
    maxHeight: 62,
    centrality: 0.25,
    parkChance: 0.08,
    carChance: 0.34,
  },
  "kestrel-docks": {
    id: "kestrel-docks",
    name: "Kestrel Docks",
    blurb: "Container stacks, cranes, and nobody who wants to be recognised.",
    styles: ["concrete-block", "panel-dark", "brick-mid"],
    minHeight: 12,
    maxHeight: 40,
    centrality: 0.1,
    parkChance: 0.04,
    carChance: 0.2,
  },
  "marrow-hill": {
    id: "marrow-hill",
    name: "Marrow Hill",
    blurb: "Row houses, corner shops, and the block you grew up on.",
    styles: ["brick-mid", "sandstone-deco", "brick-mid"],
    minHeight: 14,
    maxHeight: 44,
    centrality: 0.15,
    parkChance: 0.16,
    carChance: 0.4,
  },
  midtown: {
    id: "midtown",
    name: "Midtown",
    blurb: "Offices, transit, and enough straight road to open up.",
    styles: ["concrete-block", "glass-tower", "panel-dark", "sandstone-deco"],
    minHeight: 26,
    maxHeight: 96,
    centrality: 0.6,
    parkChance: 0.09,
    carChance: 0.34,
  },
};

export function districtAt(gx: number, gz: number): District {
  if (Math.abs(gx) > LEGACY_GRID_RADIUS || Math.abs(gz) > LEGACY_GRID_RADIUS) {
    if (gx > LEGACY_GRID_RADIUS) return DISTRICTS.saltmere;
    if (gx < -LEGACY_GRID_RADIUS) return DISTRICTS.westhaven;
    if (gz > LEGACY_GRID_RADIUS) return DISTRICTS.northline;
    return DISTRICTS["foundry-belt"];
  }
  if (gx > RIVER_COLUMN) return DISTRICTS["kestrel-docks"];
  if (Math.abs(gx) <= 3 && Math.abs(gz) <= 3) return DISTRICTS.crest;
  if (gz >= 4 && gx <= 4) return DISTRICTS["halcyon-row"];
  if (gz <= -4) return DISTRICTS["old-meridian"];
  if (gx <= -6) return DISTRICTS["marrow-hill"];
  return DISTRICTS.midtown;
}

/* ------------------------------------------------------------------ */
/* Landmarks                                                           */
/* ------------------------------------------------------------------ */

export interface Landmark extends LandmarkSpec {
  district: string;
  /** Street-level position, for objectives, waypoints and the minimap. */
  position: Vector3;
  /** Radius that counts as "arrived". */
  radius: number;
}

const LANDMARK_SPECS: LandmarkSpec[] = [
  {
    id: "halcyon-labs",
    name: "Halcyon Labs",
    subtitle: "Applied Resonance Division",
    kind: "lab",
    block: [-4, 6],
    accent: "#66c6e8",
  },
  {
    id: "precinct-seven",
    name: "MCPD Precinct Seven",
    subtitle: "Meridian City Police",
    kind: "police",
    block: [2, -4],
    accent: "#4e79c4",
  },
  {
    id: "ledger-tower",
    name: "The Meridian Ledger",
    subtitle: "Est. 1911",
    kind: "press",
    block: [-2, -2],
    accent: "#e8a53c",
  },
  {
    id: "corbin-green",
    name: "Corbin Green",
    subtitle: "City Park",
    kind: "park",
    block: [-6, 2],
    accent: "#7fb04a",
  },
  {
    id: "ridgeline-transit",
    name: "Ridgeline Transit",
    subtitle: "Central Concourse",
    kind: "transit",
    block: [4, 4],
    accent: "#c8d0d6",
  },
  {
    id: "broadcast-spire",
    name: "Meridian Spire",
    subtitle: "Broadcast Mast",
    kind: "spire",
    block: [1, 1],
    accent: "#ff4338",
  },
  {
    id: "sable-arena",
    name: "Sable Arena",
    subtitle: "Home of the Meridian Kestrels",
    kind: "arena",
    block: [5, -7],
    accent: "#d2542f",
  },
  {
    id: "kade-house",
    name: "The Kade House",
    subtitle: "Marrow Hill",
    kind: "home",
    block: [-8, -6],
    accent: "#d08a4a",
  },
  {
    id: "kestrel-bridge",
    name: "Kestrel Bridge",
    subtitle: "River Crossing",
    kind: "bridge",
    block: [RIVER_COLUMN, 0],
    accent: "#9aa4ab",
  },
  { id: "northline-observatory", name: "Northline Observatory", subtitle: "Meridian Sky Survey", kind: "observatory", block: [-5, 16], accent: "#6edac3" },
  { id: "westhaven-reservoir", name: "Westhaven Reservoir", subtitle: "Water for Every Block", kind: "reservoir", block: [-16, 5], accent: "#7ac8d1" },
  { id: "foundry-exchange", name: "Foundry Exchange", subtitle: "The City Works Here", kind: "foundry", block: [-5, -16], accent: "#e9a162" },
  { id: "saltmere-terminal", name: "Saltmere Terminal", subtitle: "Eastbound / Homebound", kind: "terminal", block: [15, -4], accent: "#e89c72" },
  { id: "beacon-point", name: "Beacon Point", subtitle: "A Light for the Last Ferry", kind: "lighthouse", block: [16, 14], accent: "#f8c974" },
  { id: "northline-station", name: "Northline Station", subtitle: "The Outer Loop", kind: "station", block: [3, 15], accent: "#71c9b5" },
];

/* ------------------------------------------------------------------ */
/* Chunks                                                              */
/* ------------------------------------------------------------------ */

interface Chunk {
  centerX: number;
  centerZ: number;
  /** Structure: always drawn while the chunk is in frustum. */
  bulk: Map<string, Mesh[]>;
  /** Clutter: cars, lamps, trees. Hidden past the detail radius. */
  detail: Map<string, Mesh[]>;
  silhouettes: Mesh[];
  mergedSilhouettes: Mesh[];
  mergedBulk: Mesh[];
  mergedDetail: Mesh[];
  fullVisible?: boolean;
  horizonVisible?: boolean;
  detailVisible?: boolean;
}

export interface MoveResult {
  grounded: boolean;
  groundY: number;
  hitWall: boolean;
  /** Outward normal of the wall that stopped lateral motion. */
  wallX: number;
  wallZ: number;
  /** 0 when fully blocked, 1 when the whole requested move happened. */
  progress: number;
  onWater: boolean;
}

/* ------------------------------------------------------------------ */
/* City                                                                */
/* ------------------------------------------------------------------ */

export class City {
  readonly extent = (GRID_RADIUS + 0.5) * BLOCK_PITCH;
  readonly start = new Vector3(75, KERB_Y, -75);
  readonly landmarks: Landmark[] = [];
  readonly grid = new CollisionGrid();
  readonly palette: Palette;
  readonly sky: Sky;

  private readonly chunks: Chunk[] = [];
  private readonly rng: Rng;
  // Art detail must never perturb the layout RNG used by saved routes/motes.
  private readonly artRng = mulberry32(0xa47d37);
  private detailRadius: number;
  private readonly structureRadius: number;
  private readonly horizonRadius: number;
  private readonly expansionRng = mulberry32(0x4e574349);
  private readonly districtSignKeys = new Set<string>();
  private readonly boxBatches = new Map<string, { batch: StaticBoxBatch; x: number; z: number; material: string; detail: boolean }>();
  private readonly scratchNormal = new Vector3();
  private readonly scratchResolve = { x: 0, z: 0 };

  constructor(
    readonly scene: Scene,
    quality: Quality,
    seed = 0xfda2026,
  ) {
    this.rng = mulberry32(seed);
    this.detailRadius = quality === "low" ? 260 : quality === "medium" ? 420 : 620;
    this.structureRadius = quality === "low" ? 850 : quality === "medium" ? 1150 : 1450;
    this.horizonRadius = quality === "low" ? 2300 : 3100;
    this.palette = new Palette(scene, this.rng, ROAD_HALF);
    this.sky = new Sky(scene, this.rng, quality, this.extent);
    this.build(quality);
  }

  /* ---------------- queries ---------------- */

  addShadowCaster(mesh: Mesh): void {
    this.sky.shadows.addShadowCaster(mesh);
  }

  /** True inside the river channel, where only a fast runner stays up. */
  isWater(x: number, z: number): boolean {
    if (Math.abs(z) > this.extent) return false;
    const centerX = RIVER_COLUMN * BLOCK_PITCH;
    if (Math.abs(x - centerX) > BLOCK_PITCH * 0.5) return false;
    // Bridge decks are solid ground, not water.
    for (const row of BRIDGE_ROWS) {
      if (Math.abs(z - row * BLOCK_PITCH) < BLOCK_SIZE * 0.5) return false;
    }
    return true;
  }

  /**
   * Highest walkable surface under (x, z) that is not above `ceiling`.
   * Rooftops, kerbs, bridge decks and the river surface all come from here.
   */
  groundHeight(x: number, z: number, ceiling: number): number {
    const floor = this.isWater(x, z) ? WATER_Y : ROAD_Y;
    return this.grid.surfaceHeight(x, z, ceiling, floor);
  }

  districtNameAt(x: number, z: number): string {
    const gx = Math.round(x / BLOCK_PITCH);
    const gz = Math.round(z / BLOCK_PITCH);
    return districtAt(gx, gz).name;
  }

  landmark(id: string): Landmark {
    const found = this.landmarks.find((entry) => entry.id === id);
    if (!found) throw new Error(`Unknown landmark "${id}".`);
    return found;
  }

  /**
   * Sweeps a vertical cylinder through the world.
   *
   * Axes resolve independently so sliding along a facade stays smooth at
   * 700 km/h, and the sweep is subdivided so a single 2 m/frame step cannot
   * tunnel through a building.
   */
  move(
    position: Vector3,
    delta: Vector3,
    radius: number,
    height: number,
    stepHeight: number,
    out: MoveResult,
  ): void {
    const distance = Math.hypot(delta.x, delta.z);
    const steps = Math.max(1, Math.min(24, Math.ceil(distance / (radius * 0.8))));
    const stepX = delta.x / steps;
    const stepZ = delta.z / steps;

    out.hitWall = false;
    out.wallX = 0;
    out.wallZ = 0;

    let moved = 0;
    for (let i = 0; i < steps; i += 1) {
      const feet = position.y;
      const head = position.y + height;

      const nextX = clamp(position.x + stepX, -this.extent + 4, this.extent - 4);
      if (!this.grid.overlaps(nextX, position.z, radius, feet, head, stepHeight)) {
        moved += Math.abs(nextX - position.x);
        position.x = nextX;
      } else if (stepX !== 0) {
        out.hitWall = true;
        out.wallX = stepX > 0 ? -1 : 1;
        out.wallZ = 0;
      }

      const nextZ = clamp(position.z + stepZ, -this.extent + 4, this.extent - 4);
      if (!this.grid.overlaps(position.x, nextZ, radius, feet, head, stepHeight)) {
        moved += Math.abs(nextZ - position.z);
        position.z = nextZ;
      } else if (stepZ !== 0) {
        out.hitWall = true;
        out.wallX = 0;
        out.wallZ = stepZ > 0 ? -1 : 1;
      }
    }

    const feet = position.y;
    const head = position.y + height;
    if (this.grid.overlaps(position.x, position.z, radius, feet, head, stepHeight)) {
      if (this.grid.depenetrate(position.x, position.z, radius, feet, head, stepHeight, this.scratchResolve)) {
        position.x = clamp(this.scratchResolve.x, -this.extent + 4, this.extent - 4);
        position.z = clamp(this.scratchResolve.z, -this.extent + 4, this.extent - 4);
        out.hitWall = true;
      }
    }

    const requested = Math.abs(delta.x) + Math.abs(delta.z);
    out.progress = requested < 1e-4 ? 1 : Math.min(1, moved / requested);
    out.groundY = this.groundHeight(position.x, position.z, position.y + stepHeight);
    out.grounded = position.y <= out.groundY + 0.06;
    out.onWater = this.isWater(position.x, position.z) && out.groundY <= WATER_Y + 0.01;
  }

  /** Nearest climbable wall face, for latching into a wall run. */
  probeWall(position: Vector3, radius: number, height: number, reach: number): Vector3 | null {
    const found = this.grid.probeWall(
      position.x,
      position.z,
      radius,
      position.y,
      position.y + height,
      reach,
      this.scratchNormal,
    );
    return found ? this.scratchNormal : null;
  }

  /** Snaps to the middle of the closest road; the panic-button respawn. */
  nearestRoad(position: Vector3): Vector3 {
    const roadX = snapRoad(position.x);
    const roadZ = snapRoad(position.z);
    const safe = position.clone();
    if (Math.abs(roadX - position.x) < Math.abs(roadZ - position.z)) safe.x = roadX;
    else safe.z = roadZ;

    safe.x = clamp(safe.x, -this.extent + 20, this.extent - 20);
    safe.z = clamp(safe.z, -this.extent + 20, this.extent - 20);
    if (this.isWater(safe.x, safe.z)) safe.x = (RIVER_COLUMN - 1) * BLOCK_PITCH;
    safe.y = this.groundHeight(safe.x, safe.z, 400) + 0.02;
    return safe;
  }

  /**
   * A road-centred point at least `minDistance` from `from`, used to place
   * activity markers, rescues and story objectives without burying them
   * inside a building.
   */
  roadPointNear(from: Vector3, minDistance: number, maxDistance: number, rng: Rng = this.rng): Vector3 {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = minDistance + rng() * Math.max(1, maxDistance - minDistance);
      const candidate = new Vector3(
        clamp(from.x + Math.cos(angle) * radius, -this.extent + 120, this.extent - 120),
        0,
        clamp(from.z + Math.sin(angle) * radius, -this.extent + 120, this.extent - 120),
      );
      const point = this.nearestRoad(candidate);
      if (Vector3.Distance(point, from) >= minDistance * 0.7) return point;
    }
    return this.nearestRoad(from.add(new Vector3(minDistance, 0, 0)));
  }

  /**
   * Resident city cells: full architecture nearby, one low-poly skyline mesh
   * per distant cell, and no render work beyond the horizon. Collision uses
   * its independent spatial hash and remains available during fast travel.
   */
  updateStreaming(focus: Vector3): void {
    const radiusSq = this.detailRadius * this.detailRadius;
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      // Distance to the chunk bounds, not its centre: nearby props must not
      // disappear merely because the player is at a 750 m chunk corner.
      const halfSpan = CHUNK_BLOCKS * BLOCK_PITCH * 0.5;
      const dx = Math.max(0, Math.abs(chunk.centerX - focus.x) - halfSpan);
      const dz = Math.max(0, Math.abs(chunk.centerZ - focus.z) - halfSpan);
      const distanceSq = dx * dx + dz * dz;
      const near = distanceSq < radiusSq;
      const full = distanceSq < this.structureRadius * this.structureRadius;
      const horizon = !full && distanceSq < this.horizonRadius * this.horizonRadius;
      // Most frames stay in the same LOD bands. Touch meshes only when a
      // band changes; keep distance checks current even during fast travel.
      if (chunk.fullVisible !== full) {
        for (const mesh of chunk.mergedBulk) mesh.setEnabled(full);
        chunk.fullVisible = full;
      }
      if (chunk.horizonVisible !== horizon) {
        for (const mesh of chunk.mergedSilhouettes) mesh.setEnabled(horizon);
        chunk.horizonVisible = horizon;
      }
      if (chunk.detailVisible !== near) {
        for (const mesh of chunk.mergedDetail) mesh.setEnabled(near);
        chunk.detailVisible = near;
      }
    }
  }

  setDetailRadius(meters: number): void {
    this.detailRadius = meters;
  }

  /* ---------------- construction ---------------- */

  private build(quality: Quality): void {
    const rng = this.rng;

    this.buildGround();
    this.buildRiver();

    const landmarkBlocks = new Set(LANDMARK_SPECS.map((spec) => `${spec.block[0]},${spec.block[1]}`));

    for (let gx = -LEGACY_GRID_RADIUS; gx <= LEGACY_GRID_RADIUS; gx += 1) {
      for (let gz = -LEGACY_GRID_RADIUS; gz <= LEGACY_GRID_RADIUS; gz += 1) {
        if (gx === RIVER_COLUMN && !BRIDGE_ROWS.includes(gz)) continue;
        if (landmarkBlocks.has(`${gx},${gz}`)) continue;
        this.buildBlock(gx, gz, rng, quality);
      }
    }

    // Append the outer neighborhoods only after consuming the original layout
    // stream. Expansion art never moves a saved rooftop or changes a mote ID.
    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx += 1) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz += 1) {
        if (Math.abs(gx) <= LEGACY_GRID_RADIUS && Math.abs(gz) <= LEGACY_GRID_RADIUS) continue;
        if (gx === RIVER_COLUMN && !BRIDGE_ROWS.includes(gz)) continue;
        if (landmarkBlocks.has(`${gx},${gz}`)) continue;
        if (gx === RIVER_COLUMN) this.buildBlock(gx, gz, this.expansionRng, quality);
        else buildExpansionBlock(this.buildContext(), gx, gz, districtAt(gx, gz).id, this.expansionRng, quality);
      }
    }

    for (const spec of LANDMARK_SPECS) {
      this.landmarks.push({
        ...spec,
        district: districtAt(spec.block[0], spec.block[1]).name,
        // Objectives sit on the street outside the entrance, never inside a wall.
        position: new Vector3(
          spec.block[0] * BLOCK_PITCH,
          KERB_Y,
          spec.block[1] * BLOCK_PITCH - BLOCK_SIZE * 0.5 - 12,
        ),
        radius: 26,
      });
    }
    buildLandmarks(this.buildContext(), LANDMARK_SPECS, BLOCK_PITCH, BLOCK_SIZE, KERB_Y);

    buildRiverfront(this.buildContext(), this.extent, BRIDGE_ROWS);
    buildHorizon(this.buildContext(), this.extent);
    this.flushBoxes();
    this.mergeChunks();
    this.updateStreaming(this.start);
    this.palette.freeze();
  }

  private buildContext(): BuildContext {
    return {
      scene: this.scene,
      rng: this.rng,
      palette: this.palette,
      solid: (solid: Solid) => this.grid.add(solid),
      push: (materialKey: string, mesh: Mesh, detail = false) => this.addMesh(materialKey, mesh, detail),
      shadowCaster: (mesh: Mesh) => this.sky.shadows.addShadowCaster(mesh),
      silhouette: (x, z, width, depth, height, base = KERB_Y) => this.addSilhouette(x, z, width, depth, height, base),
      box: (key, x, y, z, width, height, depth, detail = false, uv) => this.queueBox(key, x, y, z, width, height, depth, detail, uv),
    };
  }

  private buildGround(): void {
    const width = this.extent * 2 + 400;
    const material = this.palette.get("road");
    const albedo = material.albedoTexture;
    const bump = material.bumpTexture;
    // Align tile edges with road centrelines at (i - 0.5) * BLOCK_PITCH.
    const scale = width / BLOCK_PITCH;
    const shift = (width * 0.5 + BLOCK_PITCH * 0.5) / BLOCK_PITCH;
    const offset = Math.ceil(shift) - shift;
    for (const texture of [albedo, bump]) {
      if (!texture || !("uScale" in texture)) continue;
      const tiled = texture as unknown as { uScale: number; vScale: number; uOffset: number; vOffset: number };
      tiled.uScale = scale;
      tiled.vScale = scale;
      tiled.uOffset = offset;
      tiled.vOffset = offset;
    }

    const ground = MeshBuilder.CreateGround(
      "city-ground",
      { width, height: width, subdivisions: 1 },
      this.scene,
    );
    ground.position.y = ROAD_Y - 0.02;
    ground.material = material;
    ground.receiveShadows = true;
    ground.freezeWorldMatrix();
    ground.isPickable = false;
  }

  private buildRiver(): void {
    const centerX = RIVER_COLUMN * BLOCK_PITCH;
    const length = this.extent * 2 + 200;
    const water = MeshBuilder.CreateGround(
      "river",
      { width: BLOCK_PITCH, height: length, subdivisions: 1 },
      this.scene,
    );
    water.position.set(centerX, WATER_Y, 0);
    const waterMaterial = this.palette.get("water");
    for (const texture of [waterMaterial.albedoTexture, waterMaterial.bumpTexture]) {
      if (texture && "uScale" in texture) {
        const tiled = texture as import("@babylonjs/core").Texture;
        tiled.uScale = BLOCK_PITCH / 40;
        tiled.vScale = length / 40;
      }
    }
    water.material = waterMaterial;
    water.isPickable = false;
    water.freezeWorldMatrix();

    // Quay walls on both banks so the river reads as cut into the city.
    for (const side of [-1, 1] as const) {
      const wall = MeshBuilder.CreateBox(
        `quay-${side}`,
        { width: 6, depth: length, height: 3 },
        this.scene,
      );
      wall.position.set(centerX + side * (BLOCK_PITCH * 0.5 + 3), ROAD_Y - 1.2, 0);
      wall.material = this.palette.get("concrete-dark");
      wall.freezeWorldMatrix();
      wall.isPickable = false;
      wall.receiveShadows = true;
    }
  }

  private buildBlock(gx: number, gz: number, rng: Rng, quality: Quality): void {
    const district = districtAt(gx, gz);
    const centerX = gx * BLOCK_PITCH;
    const centerZ = gz * BLOCK_PITCH;
    const isBridge = gx === RIVER_COLUMN;
    const isPark = !isBridge && rng() < district.parkChance && Math.abs(gx) + Math.abs(gz) > 2;

    // Block platform (kerb + pavement, or grass in a park).
    const uvSide = new Vector4(0, 0, BLOCK_SIZE / SIDEWALK_TILE_METERS, 0.12);
    const tile = isPark ? GRASS_TILE_METERS : SIDEWALK_TILE_METERS;
    const uvTop = new Vector4(0, 0, BLOCK_SIZE / tile, BLOCK_SIZE / tile);
    const platform = MeshBuilder.CreateBox(
      `block-${gx}-${gz}`,
      {
        width: BLOCK_SIZE,
        depth: BLOCK_SIZE,
        height: KERB_Y * 2,
        faceUV: [uvSide, uvSide, uvSide, uvSide, uvTop, uvTop],
      },
      this.scene,
    );
    platform.position.set(centerX, 0, centerZ);
    this.addMesh(isPark ? "grass" : "sidewalk", platform, false);

    this.grid.add({
      minX: centerX - BLOCK_SIZE * 0.5,
      maxX: centerX + BLOCK_SIZE * 0.5,
      minZ: centerZ - BLOCK_SIZE * 0.5,
      maxZ: centerZ + BLOCK_SIZE * 0.5,
      top: KERB_Y,
      bottom: ROAD_Y - 1,
      climbable: false,
    });

    if (isBridge) {
      this.buildBridgeDeck(centerX, centerZ);
      return;
    }

    this.buildStreetlights(gx, gz, centerX, centerZ);
    if (gx % 4 === 0 && gz % 4 === 0) this.buildDistrictSign(district, centerX + 52, centerZ + 30);
    if (quality !== "low") {
      // Street trees frame the avenues while leaving their full width clear.
      for (const side of [-1, 1]) this.buildTree(this.artRng, centerX + side * 51, centerZ - 38);
    }
    if (quality !== "low") this.buildParkedCars(rng, centerX, centerZ, district.carChance);

    if (isPark) {
      this.dressPark(centerX, centerZ);
      const trees = quality === "low" ? 5 : 9;
      for (let i = 0; i < trees; i += 1) {
        this.buildTree(rng, centerX + (rng() - 0.5) * 84, centerZ + (rng() - 0.5) * 84);
      }
      return;
    }

    for (const ox of [-LOT_OFFSET, LOT_OFFSET]) {
      for (const oz of [-LOT_OFFSET, LOT_OFFSET]) {
        this.buildTower(rng, district, gx, gz, centerX + ox, centerZ + oz);
      }
    }
  }

  private buildTower(
    rng: Rng,
    district: District,
    gx: number,
    gz: number,
    x: number,
    z: number,
  ): void {
    const width = 40 + rng() * 8;
    const depth = 40 + rng() * 8;
    const centrality =
      1 - Math.min(1, Math.hypot(gx, gz) / (LEGACY_GRID_RADIUS * 1.15));
    const height =
      district.minHeight +
      rng() * (district.maxHeight - district.minHeight) * (0.45 + centrality * district.centrality);
    const styleId = pick(rng, district.styles);
    const materialKey = `facade:${styleId}`;

    const tower = MeshBuilder.CreateBox(
      `tower-${gx}-${gz}-${x}-${z}`,
      { width, depth, height, faceUV: facadeUv(width, depth, height) },
      this.scene,
    );
    tower.position.set(x, height * 0.5 + KERB_Y, z);
    this.addMesh(materialKey, tower, false);

    this.dressTower(x, z, width, depth, height, styleId);
    this.addSilhouette(x, z, width, depth, height + 1.1);

    // Parapet lip: gives the roof an edge to mantle onto and reads at range.
    const parapet = MeshBuilder.CreateBox(
      `parapet-${gx}-${gz}-${x}-${z}`,
      { width: width + 1.2, depth: depth + 1.2, height: 1.1, faceUV: plainUv() },
      this.scene,
    );
    parapet.position.set(x, height + KERB_Y + 0.55, z);
    this.addMesh("concrete", parapet, false);

    if (height > 48 && rng() < 0.75) {
      const boxW = width * (0.24 + rng() * 0.22);
      const boxD = depth * (0.24 + rng() * 0.22);
      const boxH = 3 + rng() * 4;
      const penthouse = MeshBuilder.CreateBox(
        `roofbox-${gx}-${gz}-${x}-${z}`,
        { width: boxW, depth: boxD, height: boxH, faceUV: plainUv() },
        this.scene,
      );
      penthouse.position.set(
        x + (rng() - 0.5) * width * 0.3,
        height + KERB_Y + boxH * 0.5,
        z + (rng() - 0.5) * depth * 0.3,
      );
      this.addMesh("concrete", penthouse, false);
    }

    if (height > 90 && rng() < 0.5) {
      const mast = MeshBuilder.CreateCylinder(
        `mast-${gx}-${gz}-${x}-${z}`,
        { height: 10 + rng() * 12, diameterTop: 0.18, diameterBottom: 0.5, tessellation: 6 },
        this.scene,
      );
      mast.position.set(x, height + KERB_Y + 6, z);
      this.addMesh("steel", mast, true);
    }

    this.grid.add({
      minX: x - width * 0.5,
      maxX: x + width * 0.5,
      minZ: z - depth * 0.5,
      maxZ: z + depth * 0.5,
      top: height + KERB_Y + 1.1,
      bottom: ROAD_Y - 1,
      climbable: true,
    });
  }

  /** Layered architecture inside the existing footprints and roof heights. */
  private dressTower(x: number, z: number, w: number, d: number, h: number, style: string): void {
    const glass = style === "glass-tower" || style === "panel-dark";
    const art = this.artRng;
    const box = (key: string, dx: number, y: number, dz: number, width: number, height: number, depth: number, detail = false): void => {
      this.queueBox(key, x + dx, KERB_Y + y, z + dz, width, height, depth, detail);
    };
    const trim = glass ? (art() < 0.45 ? "copper" : "steel-bright") : "warm-stone";
    // Two facade languages: curtain-wall fins and masonry cornices. Slender
    // visual relief keeps the existing collision envelope and routes stable.
    if (glass) {
      for (const offset of [-0.42, 0, 0.42]) {
        for (const side of [-1, 1]) {
          box(trim, offset * w, h / 2, side * d / 2, 0.48, h, 0.38);
          box(trim, side * w / 2, h / 2, offset * d, 0.38, h, 0.48);
        }
      }
      const bandY = h * (0.6 + art() * 0.18);
      box("steel", 0, bandY, 0, w + 0.3, 1.2, d + 0.3);
      box(style === "glass-tower" ? "cyan-light" : "warm-light", 0, h - 0.4, -d / 2 - 0.12, w * 0.92, 0.18, 0.1);
      // Contrasting opaque spandrels make the crown read as a designed tier.
      for (const side of [-1, 1]) box(trim, side * (w / 2 - 1.4), h - 3, 0, 2.8, 6, d + 0.16);
    } else {
      for (let y = 5; y < h; y += 12) box(trim, 0, y, 0, w + 0.4, 0.42, d + 0.4);
      for (const side of [-1, 1]) {
        box(trim, side * (w / 2 - 0.4), h / 2, -d / 2, 0.85, h, 0.4);
        box(trim, side * (w / 2 - 0.4), h / 2, d / 2, 0.85, h, 0.4);
      }
    }
    const shop = style === "glass-tower" ? ["MERIDIAN TRANSIT", "NEXT STOP / EVERYWHERE", "#75d9cc"]
      : style === "brick-mid" ? ["CORNER COFFEE", "OPEN EARLY / STAY LATE", "#edb47a"]
      : style === "panel-dark" ? ["NORTHLINE RUNNING", "FIND YOUR PACE", "#a9e0ef"]
      : ["MERIDIAN MARKET", "YOUR NEIGHBOURHOOD / EVERY DAY", "#e7c28b"];
    const signKey = `shopfront:${style}`;
    if (!this.districtSignKeys.has(signKey)) {
      this.palette.emissiveTextured(signKey, createSignTexture(this.scene, signKey, shop[0]!, shop[1]!, shop[2]!), 0.85);
      this.districtSignKeys.add(signKey);
    }
    // Two outward street faces per lot; shared sign textures supply the detail.
    const streetX = Math.sign(x - Math.round(x / BLOCK_PITCH) * BLOCK_PITCH) || 1;
    const streetZ = Math.sign(z - Math.round(z / BLOCK_PITCH) * BLOCK_PITCH) || 1;
    box("car-glass", 0, 3.1, streetZ * (d / 2 + 0.12), w * 0.82, 4.4, 0.12, true);
    box(signKey, 0, 6.2, streetZ * (d / 2 + 0.16), 16, 2.2, 0.16, true);
    box("warm-light", 0, 5.35, streetZ * (d / 2 + 0.25), w * 0.82, 0.1, 0.12, true);
    box("car-glass", streetX * (w / 2 + 0.12), 3.1, 0, 0.12, 4.4, d * 0.82, true);
    box(signKey, streetX * (w / 2 + 0.16), 6.2, 0, 0.16, 2.2, 16, true);
    box("warm-light", streetX * (w / 2 + 0.25), 5.35, 0, 0.12, 0.1, d * 0.82, true);
    // A distinct ground-floor plinth and door bays establish human scale.
    box(glass ? "steel" : "warm-stone", 0, 0.8, 0, w + 0.15, 1.6, d + 0.15);
    for (const side of [-1, 1]) {
      box("car-glass", 0, 2.3, side * (d / 2 + 0.1), 3.2, 4, 0.12, true);
      box(trim, 0, 4.4, side * (d / 2 + 0.18), 4, 0.28, 0.4, true);
      box("street-light", 0, 3.85, side * (d / 2 + 0.22), 2.6, 0.08, 0.05, true);
    }
    if (!glass) {
      // Occupied storefront bays belong at street level, never repeated up a tower.
      const awning = style === "brick-mid" ? "oxidized-copper" : "terracotta";
      for (const side of [-1, 1]) for (const offset of [-0.3, 0.3]) {
        box("car-glass", offset * w, 2.05, side * (d / 2 + 0.12), w * 0.23, 3.1, 0.12, true);
        box(awning, offset * w, 4.05, side * (d / 2 + 0.95), w * 0.29, 0.3, 2.1, true);
        this.grid.add({ minX: x + offset * w - w * 0.145, maxX: x + offset * w + w * 0.145, minZ: z + side * (d / 2 + 0.95) - 1.05, maxZ: z + side * (d / 2 + 0.95) + 1.05, bottom: KERB_Y + 3.9, top: KERB_Y + 4.2, climbable: false });
      }
    }
    // Roof equipment stays below the unchanged parapet collision surface.
    box("steel", 0, h + 0.3, 0, w * 0.38, 0.6, d * 0.24, true);
  }

  private dressPark(cx: number, cz: number): void {
    for (const vertical of [false, true]) {
      const path = MeshBuilder.CreateBox("pocket-park-path", { width: vertical ? 7 : 108, depth: vertical ? 108 : 7, height: 0.04 }, this.scene);
      path.position.set(cx, KERB_Y + 0.02, cz);
      this.addMesh("park-path", path, false);
    }
    for (const side of [-1, 1]) {
      const seat = MeshBuilder.CreateBox("pocket-park-seat", { width: 7, depth: 1.4, height: 0.65 }, this.scene);
      seat.position.set(cx + side * 16, KERB_Y + 0.325, cz - 11);
      this.addMesh("copper", seat, true);
      this.grid.add({ minX: cx + side * 16 - 3.5, maxX: cx + side * 16 + 3.5, minZ: cz - 11.7, maxZ: cz - 10.3, bottom: KERB_Y, top: KERB_Y + 0.65, climbable: false });
    }
  }

  private buildDistrictSign(district: District, x: number, z: number): void {
    const key = `district-sign:${district.id}`;
    if (!this.districtSignKeys.has(key)) {
      const texture = createSignTexture(this.scene, key, district.name.toUpperCase(), "MERIDIAN / KEEP MOVING", district.id === "old-meridian" ? "#cb8967" : "#71c5c4");
      this.palette.emissiveTextured(key, texture, 0.68);
      this.districtSignKeys.add(key);
    }
    const plate = MeshBuilder.CreateBox(key, { width: 0.18, depth: 4.8, height: 1.4 }, this.scene);
    plate.position.set(x, KERB_Y + 4.7, z);
    this.addMesh(key, plate, true);
    const post = MeshBuilder.CreateBox("district-sign-post", { width: 0.25, depth: 0.25, height: 5.4 }, this.scene);
    post.position.set(x, KERB_Y + 2.7, z);
    this.addMesh("steel", post, true);
    this.grid.add({ minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15, bottom: KERB_Y, top: KERB_Y + 5.4, climbable: false });
  }

  private buildBridgeDeck(centerX: number, centerZ: number): void {
    const deck = MeshBuilder.CreateBox(
      `bridge-deck-${centerZ}`,
      { width: BLOCK_PITCH + 6, depth: BLOCK_SIZE, height: 1.4 },
      this.scene,
    );
    deck.position.set(centerX, KERB_Y - 0.7, centerZ);
    this.addMesh("concrete", deck, false);
    this.grid.add({ minX: centerX - (BLOCK_PITCH + 6) / 2, maxX: centerX + (BLOCK_PITCH + 6) / 2, minZ: centerZ - BLOCK_SIZE / 2, maxZ: centerZ + BLOCK_SIZE / 2, bottom: KERB_Y - 1.4, top: KERB_Y, climbable: false });

    for (const side of [-1, 1] as const) {
      const rail = MeshBuilder.CreateBox(
        `bridge-rail-${centerZ}-${side}`,
        { width: BLOCK_PITCH + 6, depth: 0.6, height: 1.3 },
        this.scene,
      );
      rail.position.set(centerX, KERB_Y + 0.65, centerZ + side * BLOCK_SIZE * 0.5);
      this.addMesh("steel", rail, false);
      this.grid.add({ minX: centerX - (BLOCK_PITCH + 6) / 2, maxX: centerX + (BLOCK_PITCH + 6) / 2, minZ: centerZ + side * BLOCK_SIZE / 2 - 0.3, maxZ: centerZ + side * BLOCK_SIZE / 2 + 0.3, bottom: KERB_Y, top: KERB_Y + 1.3, climbable: false });
    }
  }

  private buildTree(rng: Rng, x: number, z: number): void {
    const scale = 0.85 + rng() * 0.6;
    const trunk = MeshBuilder.CreateCylinder(
      `tree-trunk-${x.toFixed(1)}-${z.toFixed(1)}`,
      { height: 4.8 * scale, diameterTop: 0.62, diameterBottom: 1.15, tessellation: 7 },
      this.scene,
    );
    trunk.position.set(x, KERB_Y + 2.4 * scale, z);
    this.addMesh("trunk", trunk, true);

    const leafKey = rng() < 0.22 ? "leaf-autumn" : "leaf";
    const clusters = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < clusters; i += 1) {
      const crown = MeshBuilder.CreateSphere(
        `tree-crown-${x.toFixed(1)}-${z.toFixed(1)}-${i}`,
        { diameter: (3.8 + rng() * 2.8) * scale, segments: 6 },
        this.scene,
      );
      crown.position.set(
        x + (rng() - 0.5) * 2.4 * scale,
        KERB_Y + (4.8 + rng() * 1.8) * scale,
        z + (rng() - 0.5) * 2.4 * scale,
      );
      crown.scaling.y = 0.82 + rng() * 0.3;
      this.addMesh(leafKey, crown, true);
    }
  }

  private buildStreetlights(gx: number, gz: number, centerX: number, centerZ: number): void {
    const sides: Array<[number, number]> =
      (gx + gz) % 2 === 0
        ? [[1, 0], [-1, 0]]
        : [[0, 1], [0, -1]];

    for (const [dx, dz] of sides) {
      const x = centerX + dx * 53.5;
      const z = centerZ + dz * 53.5;

      const pole = MeshBuilder.CreateCylinder(
        `lamp-pole-${gx}-${gz}-${dx}-${dz}`,
        { height: 9, diameter: 0.3, tessellation: 6 },
        this.scene,
      );
      pole.position.set(x, KERB_Y + 4.5, z);
      this.addMesh("steel", pole, true);

      const arm = MeshBuilder.CreateBox(
        `lamp-arm-${gx}-${gz}-${dx}-${dz}`,
        { width: 0.14, height: 0.14, depth: 2.4 },
        this.scene,
      );
      arm.position.set(x + dx * 1.1, KERB_Y + 8.85, z + dz * 1.1);
      arm.rotation.y = Math.atan2(dx, dz);
      this.addMesh("steel", arm, true);

      const head = MeshBuilder.CreateBox(
        `lamp-head-${gx}-${gz}-${dx}-${dz}`,
        { width: 0.42, height: 0.16, depth: 0.9 },
        this.scene,
      );
      head.position.set(x + dx * 2.3, KERB_Y + 8.72, z + dz * 2.3);
      head.rotation.y = Math.atan2(dx, dz);
      this.addMesh("street-light", head, true);

      // Compact footprint: the arm and head are visual only.
      this.grid.add({
        minX: x - 0.45,
        maxX: x + 0.45,
        minZ: z - 0.45,
        maxZ: z + 0.45,
        top: KERB_Y + 9,
        bottom: ROAD_Y,
        climbable: false,
      });
    }
  }

  private buildParkedCars(rng: Rng, centerX: number, centerZ: number, chance: number): void {
    const sides: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (const [dx, dz] of sides) {
      for (const slot of [-34, 0, 34]) {
        if (rng() > chance) continue;

        const along = slot + (rng() - 0.5) * 14;
        const x = centerX + dx * 58.2 + (dx === 0 ? along : 0);
        const z = centerZ + dz * 58.2 + (dz === 0 ? along : 0);
        const alongX = dx === 0;
        const length = 4.3 + rng() * 0.7;
        const width = 1.9;
        const paintKey = `car-${Math.floor(rng() * 6)}`;

        const body = MeshBuilder.CreateBox(
          `car-body-${x.toFixed(1)}-${z.toFixed(1)}`,
          { width: alongX ? length : width, depth: alongX ? width : length, height: 0.55 },
          this.scene,
        );
        body.position.set(x, ROAD_Y + 0.72, z);
        this.addMesh(paintKey, body, true);

        const cabin = MeshBuilder.CreateBox(
          `car-cabin-${x.toFixed(1)}-${z.toFixed(1)}`,
          {
            width: alongX ? length * 0.52 : width * 0.9,
            depth: alongX ? width * 0.9 : length * 0.52,
            height: 0.52,
          },
          this.scene,
        );
        cabin.position.set(
          x - (alongX ? length * 0.06 : 0),
          ROAD_Y + 1.24,
          z - (alongX ? 0 : length * 0.06),
        );
        this.addMesh("car-glass", cabin, true);

        const under = MeshBuilder.CreateBox(
          `car-under-${x.toFixed(1)}-${z.toFixed(1)}`,
          {
            width: alongX ? length * 0.94 : width * 0.92,
            depth: alongX ? width * 0.92 : length * 0.94,
            height: 0.48,
          },
          this.scene,
        );
        under.position.set(x, ROAD_Y + 0.22, z);
        this.addMesh("rubber", under, true);

        this.grid.add({
          minX: x - (alongX ? length : width) * 0.5,
          maxX: x + (alongX ? length : width) * 0.5,
          minZ: z - (alongX ? width : length) * 0.5,
          maxZ: z + (alongX ? width : length) * 0.5,
          top: ROAD_Y + 1.5,
          bottom: ROAD_Y,
          climbable: false,
        });
      }
    }
  }

  /* ---------------- chunking ---------------- */

  private chunkIndex(x: number, z: number): number {
    const span = CHUNK_BLOCKS * BLOCK_PITCH;
    const columns = Math.ceil((GRID_RADIUS * 2 + 1) / CHUNK_BLOCKS) + 1;
    const cx = Math.floor((x + this.extent) / span);
    const cz = Math.floor((z + this.extent) / span);
    return clamp(cz, 0, columns - 1) * columns + clamp(cx, 0, columns - 1);
  }

  /**
   * Bakes a freshly positioned mesh into its chunk's merge queue.
   * Must be called before the transform is baked, since the mesh's position
   * is what decides which chunk owns it.
   */
  private addMesh(materialKey: string, mesh: Mesh, detail: boolean): void {
    const x = mesh.position.x;
    const z = mesh.position.z;
    mesh.bakeCurrentTransformIntoVertices();
    this.pushToChunk(x, z, materialKey, mesh, detail);
  }

  private pushToChunk(x: number, z: number, materialKey: string, mesh: Mesh, detail: boolean): void {
    const index = this.chunkIndex(x, z);
    let chunk = this.chunks[index];
    if (!chunk) {
      const span = CHUNK_BLOCKS * BLOCK_PITCH;
      const columns = Math.ceil((GRID_RADIUS * 2 + 1) / CHUNK_BLOCKS) + 1;
      const cx = index % columns;
      const cz = Math.floor(index / columns);
      chunk = {
        centerX: (cx + 0.5) * span - this.extent,
        centerZ: (cz + 0.5) * span - this.extent,
        silhouettes: [],
        mergedSilhouettes: [],
        bulk: new Map(),
        detail: new Map(),
        mergedBulk: [],
        mergedDetail: [],
      };
      this.chunks[index] = chunk;
    }

    const target = detail ? chunk.detail : chunk.bulk;
    let list = target.get(materialKey);
    if (!list) {
      list = [];
      target.set(materialKey, list);
    }
    list.push(mesh);
  }

  private queueBox(material: string, x: number, y: number, z: number, width: number, height: number, depth: number, detail = false, uv?: Vector4[]): void {
    const key = `${this.chunkIndex(x, z)}:${detail ? 1 : 0}:${material}`;
    let item = this.boxBatches.get(key);
    if (!item) {
      item = { batch: new StaticBoxBatch(), x, z, material, detail };
      this.boxBatches.set(key, item);
    }
    item.batch.add(x, y, z, width, height, depth, uv);
  }

  private flushBoxes(): void {
    // Structural batches create their chunks before skyline-only batches attach.
    for (const item of this.boxBatches.values()) {
      if (item.material === "__skyline") continue;
      this.pushToChunk(item.x, item.z, item.material, item.batch.build(this.scene, "static-cell-boxes"), item.detail);
    }
    for (const item of this.boxBatches.values()) {
      if (item.material !== "__skyline") continue;
      const mesh = item.batch.build(this.scene, "skyline-cell-boxes");
      const chunk = this.chunks[this.chunkIndex(item.x, item.z)];
      if (chunk) chunk.silhouettes.push(mesh);
      else mesh.dispose();
    }
    this.boxBatches.clear();
  }

  private addSilhouette(x: number, z: number, width: number, depth: number, height: number, base = KERB_Y): void {
    this.queueBox("__skyline", x, base + height * 0.5, z, width, height, depth);
  }

  private mergeChunks(): void {
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      for (const [materialKey, meshes] of chunk.bulk) {
        const merged = this.mergeGroup(materialKey, meshes);
        if (merged) {
          chunk.mergedBulk.push(merged);
          // The prototype only registered actors/landmarks. Without these
          // casters, every avenue stayed uniformly lit under 200 m towers.
          if (materialKey !== "grass" && materialKey !== "sidewalk") {
            this.sky.shadows.addShadowCaster(merged, false);
          }
        }
      }
      for (const [materialKey, meshes] of chunk.detail) {
        const merged = this.mergeGroup(materialKey, meshes);
        if (merged) {
          chunk.mergedDetail.push(merged);
          if (materialKey === "trunk" || materialKey.startsWith("leaf")) this.sky.shadows.addShadowCaster(merged, false);
        }
      }
      const skyline = this.mergeGroup("skyline", chunk.silhouettes);
      if (skyline) chunk.mergedSilhouettes.push(skyline);
      chunk.silhouettes.length = 0;
      chunk.bulk.clear();
      chunk.detail.clear();
    }
  }

  private mergeGroup(materialKey: string, meshes: Mesh[]): Mesh | null {
    if (meshes.length === 0) return null;
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (!merged) return null;
    merged.name = `${materialKey}-merged`;
    merged.material = this.palette.get(materialKey);
    merged.receiveShadows = true;
    merged.isPickable = false;
    merged.alwaysSelectAsActiveMesh = false;
    merged.freezeWorldMatrix();
    return merged;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Per-face UV repeats so windows keep real-world scale on any box size. */
function facadeUv(width: number, depth: number, height: number): Vector4[] {
  const w = width / FACADE_TILE_METERS;
  const d = depth / FACADE_TILE_METERS;
  const h = height / FACADE_TILE_METERS;
  const front = new Vector4(0, 0, w, h);
  const side = new Vector4(0, 0, d, h);
  const roof = new Vector4(0.005, 0.005, 0.04, 0.04);
  return [front, front, side, side, roof, roof];
}

function plainUv(): Vector4[] {
  const roof = new Vector4(0.005, 0.005, 0.04, 0.04);
  return [roof, roof, roof, roof, roof, roof];
}

function snapRoad(value: number): number {
  return (Math.round(value / BLOCK_PITCH - 0.5) + 0.5) * BLOCK_PITCH;
}

export { BLOCK_PITCH, BLOCK_SIZE, GRID_RADIUS };
