import { Mesh, MeshBuilder, Scene, Vector3, Vector4 } from "@babylonjs/core";
import { clamp, mulberry32, pick, type Rng } from "../core/Rng";
import type { Quality } from "../core/Save";
import { CollisionGrid, type Solid } from "./Collision";
import { Palette } from "./Materials";
import { Sky } from "./Sky";
import { FACADE_TILE_METERS, GRASS_TILE_METERS, SIDEWALK_TILE_METERS } from "./Textures";
import { buildLandmarks, type BuildContext, type LandmarkSpec } from "./Landmarks";

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */

/** Blocks from the centre to the edge; 25 x 25 blocks ≈ 3.7 km across. */
const GRID_RADIUS = 12;
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
const BRIDGE_ROWS = [-7, 0, 7];

/* ------------------------------------------------------------------ */
/* Districts                                                           */
/* ------------------------------------------------------------------ */

export type DistrictId =
  | "crest"
  | "halcyon-row"
  | "old-meridian"
  | "kestrel-docks"
  | "marrow-hill"
  | "midtown";

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
  mergedBulk: Mesh[];
  mergedDetail: Mesh[];
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
  private detailRadius: number;
  private readonly scratchNormal = new Vector3();

  constructor(
    readonly scene: Scene,
    quality: Quality,
    seed = 0xfda2026,
  ) {
    this.rng = mulberry32(seed);
    this.detailRadius = quality === "low" ? 260 : quality === "medium" ? 420 : 620;
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

  /** Distance-based clutter culling; called once per frame with the camera. */
  updateStreaming(focus: Vector3): void {
    const radiusSq = this.detailRadius * this.detailRadius;
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      const dx = chunk.centerX - focus.x;
      const dz = chunk.centerZ - focus.z;
      const near = dx * dx + dz * dz < radiusSq;
      for (const mesh of chunk.mergedDetail) {
        if (mesh.isEnabled() !== near) mesh.setEnabled(near);
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

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx += 1) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz += 1) {
        if (gx === RIVER_COLUMN && !BRIDGE_ROWS.includes(gz)) continue;
        if (landmarkBlocks.has(`${gx},${gz}`)) continue;
        this.buildBlock(gx, gz, rng, quality);
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

    this.mergeChunks();
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
    water.material = this.palette.get("water");
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
    if (quality !== "low") this.buildParkedCars(rng, centerX, centerZ, district.carChance);

    if (isPark) {
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
      1 - Math.min(1, Math.hypot(gx, gz) / (GRID_RADIUS * 1.15));
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

  private buildBridgeDeck(centerX: number, centerZ: number): void {
    const deck = MeshBuilder.CreateBox(
      `bridge-deck-${centerZ}`,
      { width: BLOCK_PITCH + 6, depth: BLOCK_SIZE, height: 1.4 },
      this.scene,
    );
    deck.position.set(centerX, KERB_Y - 0.7, centerZ);
    this.addMesh("concrete", deck, false);

    for (const side of [-1, 1] as const) {
      const rail = MeshBuilder.CreateBox(
        `bridge-rail-${centerZ}-${side}`,
        { width: BLOCK_PITCH + 6, depth: 0.6, height: 1.3 },
        this.scene,
      );
      rail.position.set(centerX, KERB_Y + 0.65, centerZ + side * BLOCK_SIZE * 0.5);
      this.addMesh("steel", rail, false);
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
      this.addMesh("steel", head, true);

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

  private mergeChunks(): void {
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      for (const [materialKey, meshes] of chunk.bulk) {
        const merged = this.mergeGroup(materialKey, meshes);
        if (merged) chunk.mergedBulk.push(merged);
      }
      for (const [materialKey, meshes] of chunk.detail) {
        const merged = this.mergeGroup(materialKey, meshes);
        if (merged) chunk.mergedDetail.push(merged);
      }
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
