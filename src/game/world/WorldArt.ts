import { MeshBuilder, Vector4 } from "@babylonjs/core";
import type { Rng } from "../core/Rng";
import type { Quality } from "../core/Save";
import type { BuildContext } from "./Landmarks";
import { FACADE_TILE_METERS } from "./Textures";

const PITCH = 150;
const KERB = 0.42;

/** All occupied geometry goes through one visual/collision contract. */
function block(
  ctx: BuildContext, name: string, x: number, z: number,
  w: number, d: number, h: number, material: string, base = KERB,
  detail = false, solid = true,
): void {
  const uv = material.startsWith("facade:") ? [
    new Vector4(0, 0, w / FACADE_TILE_METERS, h / FACADE_TILE_METERS),
    new Vector4(0, 0, w / FACADE_TILE_METERS, h / FACADE_TILE_METERS),
    new Vector4(0, 0, d / FACADE_TILE_METERS, h / FACADE_TILE_METERS),
    new Vector4(0, 0, d / FACADE_TILE_METERS, h / FACADE_TILE_METERS),
    new Vector4(0.005, 0.005, 0.04, 0.04), new Vector4(0.005, 0.005, 0.04, 0.04),
  ] : (material === "grass" || material === "sidewalk") ? Array.from({ length: 6 }, () => new Vector4(0, 0, w / 8, d / 8)) : undefined;
  void name; // Authoring names stay at the call site; render nodes are cell batches.
  ctx.box(material, x, base + h / 2, z, w, h, d, detail, uv);
  if (solid) ctx.solid({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, bottom: base, top: base + h, climbable: h >= 4 });
  if (!detail && h >= 4) ctx.silhouette(x, z, w, d, h, base);
}

function tree(ctx: BuildContext, x: number, z: number, scale = 1, autumn = false): void {
  const trunk = MeshBuilder.CreateCylinder("outer-tree-trunk", { height: 4 * scale, diameter: 0.65 * scale, tessellation: 5 }, ctx.scene);
  trunk.position.set(x, KERB + 2 * scale, z);
  ctx.push("trunk", trunk, true);
  ctx.solid({ minX: x - 0.33 * scale, maxX: x + 0.33 * scale, minZ: z - 0.33 * scale, maxZ: z + 0.33 * scale, bottom: KERB, top: KERB + 4 * scale, climbable: false });
  const crown = MeshBuilder.CreateSphere("outer-tree-crown", { diameter: 7 * scale, segments: 6 }, ctx.scene);
  crown.position.set(x, KERB + 5.3 * scale, z);
  crown.scaling.set(0.85, 1.1, 0.85);
  ctx.push(autumn ? "leaf-autumn" : "leaf-sage", crown, true);
}

function planter(ctx: BuildContext, x: number, z: number, w = 8, d = 5): void {
  block(ctx, "garden-planter", x, z, w, d, 0.8, "warm-stone");
  block(ctx, "garden-planting", x, z, w - 0.8, d - 0.8, 0.25, "leaf-sage", KERB + 0.8, true, false);
}

function garden(ctx: BuildContext, cx: number, cz: number, rng: Rng, quality: Quality): void {
  block(ctx, "garden-lawn", cx, cz, 88, 88, 0.03, "grass", KERB, false, false);
  // The cross remains clear for traversing players and rescue objectives.
  block(ctx, "garden-walk-ew", cx, cz, 96, 8, 0.055, "park-path", KERB, false, false);
  block(ctx, "garden-walk-ns", cx, cz, 8, 96, 0.06, "park-path", KERB, false, false);
  for (const dx of [-29, 29]) for (const dz of [-29, 29]) {
    tree(ctx, cx + dx, cz + dz, 1 + rng() * 0.5, (dx + dz) === 0);
    if (quality !== "low") {
      tree(ctx, cx + dx + 13, cz + dz - 10, 0.85);
      block(ctx, "park-bench", cx + dx, cz + dz + 11, 5, 1.2, 0.65, "copper", KERB, true);
      block(ctx, "park-bench-back", cx + dx, cz + dz + 11.5, 5, 0.18, 0.6, "copper", KERB + 0.65, true);
    }
  }
  for (const dx of [-14, 14]) planter(ctx, cx + dx, cz + 16);
}

function campus(ctx: BuildContext, cx: number, cz: number, rng: Rng): void {
  // A three-level terraced slab gives Northline broad horizontal silhouettes.
  const height = 32 + rng() * 42;
  block(ctx, "campus-plinth", cx, cz + 14, 82, 52, 8, "warm-stone");
  block(ctx, "campus-main", cx - 14, cz + 14, 52, 42, height, "facade:institute-white", KERB + 8);
  block(ctx, "campus-high-wing", cx + 27, cz + 14, 24, 36, height * 0.7, "facade:glass-tower", KERB + 8);
  block(ctx, "campus-copper-roof", cx - 14, cz + 14, 54, 44, 0.9, "oxidized-copper", KERB + 8 + height);
  block(ctx, "campus-entrance", cx - 2, cz - 24, 44, 18, 5, "facade:panel-dark");
  block(ctx, "campus-canopy", cx - 2, cz - 32, 50, 12, 0.8, "lab-white", KERB + 5);
  for (const dx of [-32, 32]) planter(ctx, cx + dx, cz - 44, 17, 6);
  // Tall flush fins distinguish an institute from neighboring housing.
  for (const dx of [-35, -14, 7]) block(ctx, "campus-fin", cx + dx, cz - 7.2, 0.6, 0.6, height, "lab-white", KERB + 8, false, false);
}

function housing(ctx: BuildContext, cx: number, cz: number, rng: Rng): void {
  // Narrow connected terraces enclose a garden rather than repeating four towers.
  for (const side of [-1, 1]) for (let row = -2; row <= 2; row++) {
    const x = cx + row * 18, z = cz + side * 30;
    const h = 11 + Math.floor(rng() * 4) * 3.6;
    const material = row % 2 === 0 ? "facade:sandstone-deco" : "facade:brick-mid";
    block(ctx, "terrace-house", x, z, 17, 24, h, material);
    block(ctx, "terrace-cornice", x, z, 17.5, 24.5, 0.7, "warm-stone", KERB + h);
    block(ctx, "terrace-roof-room", x, z + side * 3, 10, 13, 3.2, "terracotta", KERB + h + 0.7);
    block(ctx, "terrace-door", x, z + side * 12.06, 2, 0.12, 3, "oxidized-copper", KERB, true, false);
    block(ctx, "terrace-awning", x, z + side * 13.1, 5, 2.2, 0.24, "oxidized-copper", KERB + 3.3, true);
  }
  for (const x of [-30, 30]) {
    tree(ctx, cx + x, cz, 1.1);
    planter(ctx, cx + x, cz + 9, 10, 4);
  }
  block(ctx, "terrace-garden-path", cx, cz, 94, 5, 0.06, "park-path", KERB, false, false);
}

function works(ctx: BuildContext, cx: number, cz: number, rng: Rng): void {
  const h = 13 + rng() * 11;
  block(ctx, "foundry-warehouse", cx - 7, cz + 7, 75, 66, h, "facade:brick-mid");
  // Alternating roof monitors are actual solid steps for a rooftop sprint.
  for (let row = -2; row <= 2; row++) {
    block(ctx, "warehouse-monitor", cx - 7, cz + 7 + row * 12, 68, 7, 3.4, "oxidized-copper", KERB + h);
    block(ctx, "warehouse-rooflight", cx - 7, cz + 3.4 + row * 12, 60, 0.25, 2.2, "car-glass", KERB + h + 0.5, false, false);
  }
  block(ctx, "foundry-service-tower", cx + 40, cz + 26, 13, 16, h + 23, "facade:panel-dark");
  block(ctx, "foundry-copper-cap", cx + 40, cz + 26, 15, 18, 1.2, "copper", KERB + h + 23);
  for (const dx of [-31, -7, 17]) {
    block(ctx, "warehouse-loading-door", cx + dx, cz - 26.1, 12, 0.15, 6, "steel", KERB, true, false);
    block(ctx, "loading-awning", cx + dx, cz - 29, 15, 6, 0.6, "copper", KERB + 6.4);
  }
  for (const dx of [-30, -12, 6]) block(ctx, "freight-pallet", cx + dx, cz - 43, 11, 5, 2.7, dx === -12 ? "harbor-blue" : "harbor-red");
}

function harbor(ctx: BuildContext, cx: number, cz: number, rng: Rng, gx: number, gz: number): void {
  if ((gx + gz) % 4 === 0) {
    const h = 50 + rng() * 32;
    block(ctx, "harbor-hotel-podium", cx, cz, 80, 62, 9, "lab-white");
    block(ctx, "harbor-hotel-wing", cx - 20, cz + 8, 32, 45, h, "facade:institute-white", KERB + 9);
    block(ctx, "harbor-hotel-wing", cx + 23, cz + 8, 24, 45, h * 0.75, "facade:glass-tower", KERB + 9);
    block(ctx, "harbor-hotel-cap", cx - 20, cz + 8, 34, 47, 1.2, "terracotta", KERB + 9 + h);
    for (const dx of [-27, 27]) planter(ctx, cx + dx, cz - 42, 14, 5);
    return;
  }
  block(ctx, "harbor-depot", cx, cz + 24, 88, 42, 14, "facade:panel-dark");
  block(ctx, "harbor-depot-roof", cx, cz + 24, 91, 45, 0.8, "lab-white", KERB + 14);
  for (const dx of [-34, -11, 12, 35]) for (const dz of [-29, -13]) {
    const stacks = 1 + Math.floor(rng() * 3);
    for (let layer = 0; layer < stacks; layer++) {
      block(ctx, "cargo-container", cx + dx, cz + dz, 18, 7, 3.1, (layer + dx) % 2 === 0 ? "harbor-blue" : "harbor-red", KERB + layer * 3.1);
      // Recessed painted end panels suggest corrugation at almost no cost.
      block(ctx, "cargo-door", cx + dx - 9.04, cz + dz, 0.1, 5.5, 2.4, "steel", KERB + layer * 3.1 + 0.3, true, false);
    }
  }
}

export function buildExpansionBlock(ctx: BuildContext, gx: number, gz: number, district: string, rng: Rng, quality: Quality): void {
  const cx = gx * PITCH, cz = gz * PITCH;
  block(ctx, `outer-plaza-${gx}-${gz}`, cx, cz, 110, 110, KERB * 2, "sidewalk", -KERB);
  const park = ((Math.abs(gx * 3 + gz * 7) % 11) === 0) || (district === "westhaven" && gz % 5 === 0 && gx % 3 === 0);
  if (park) garden(ctx, cx, cz, rng, quality);
  else if (district === "westhaven") housing(ctx, cx, cz, rng);
  else if (district === "foundry-belt") works(ctx, cx, cz, rng);
  else if (district === "saltmere") harbor(ctx, cx, cz, rng, gx, gz);
  else campus(ctx, cx, cz, rng);
  // Repeated street furniture is merged into its resident city cell.
  for (const dx of [-51, 51]) {
    block(ctx, "outer-light-post", cx + dx, cz - 12, 0.26, 0.26, 7, "steel", KERB, true);
    block(ctx, "outer-light-lantern", cx + dx, cz - 12, 0.7, 0.7, 0.3, "street-light", KERB + 7, true, false);
    if (quality !== "low") tree(ctx, cx + dx, cz + 33, 0.9, district === "westhaven");
  }
}

/** A continuous riverwalk with unobstructed bridge mouths and water access. */
export function buildRiverfront(ctx: BuildContext, extent: number, bridgeRows: number[]): void {
  for (let z = -extent + 75; z < extent; z += PITCH) {
    const crossing = bridgeRows.some(row => Math.abs(z - row * PITCH) < 90);
    for (const side of [-1, 1]) {
      const x = 1050 + side * 82;
      block(ctx, "riverwalk-paving", x, z, 12, PITCH, 0.16, "park-path", 0, false);
      if (crossing) continue;
      // Seat walls stay away from the channel itself so water runners may exit.
      for (const offset of [-43, 43]) {
        block(ctx, "riverwalk-seat", x + side * 3.7, z + offset, 1.2, 8, 0.65, "warm-stone", 0.16, true);
        block(ctx, "riverwalk-lamp", x + side * 3.7, z + offset + 12, 0.3, 0.3, 5, "steel", 0.16, true);
        block(ctx, "riverwalk-light", x + side * 3.7, z + offset + 12, 0.5, 0.5, 0.5, "street-light", 5.16, true, false);
      }
    }
  }
}

/** Low-poly, fog-softened scenery beyond the playable boundary. */
export function buildHorizon(ctx: BuildContext, extent: number): void {
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const radius = extent * 1.75;
    const ridge = MeshBuilder.CreateCylinder(`distant-ridge-${i}`, { height: 240 + (i % 5) * 65, diameterTop: 120, diameterBottom: 1150, tessellation: 7 }, ctx.scene);
    ridge.position.set(Math.cos(angle) * radius, -15, Math.sin(angle) * radius);
    ridge.material = ctx.palette.get("horizon");
    ridge.isPickable = false;
    ridge.freezeWorldMatrix();
    // These sit beyond the movement clamp, so they need no gameplay collider.
  }
}
