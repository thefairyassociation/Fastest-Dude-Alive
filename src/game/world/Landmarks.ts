import { Mesh, MeshBuilder, Scene, Vector4 } from "@babylonjs/core";
import type { Rng } from "../core/Rng";
import type { Solid } from "./Collision";
import type { Palette } from "./Materials";
import { createSignTexture } from "./Textures";

export type LandmarkKind =
  | "lab"
  | "police"
  | "press"
  | "park"
  | "transit"
  | "spire"
  | "arena"
  | "home"
  | "bridge";

export interface LandmarkSpec {
  id: string;
  name: string;
  subtitle: string;
  kind: LandmarkKind;
  /** Grid block the landmark occupies. */
  block: [number, number];
  accent: string;
}

export interface BuildContext {
  scene: Scene;
  rng: Rng;
  palette: Palette;
  solid(solid: Solid): void;
  /** Queues a mesh for chunk merging. Call before baking its transform. */
  push(materialKey: string, mesh: Mesh, detail?: boolean): void;
  shadowCaster(mesh: Mesh): void;
}

/**
 * Hand-placed set pieces.
 *
 * The procedural grid gives Meridian its bulk; these give it a memory. Every
 * one of them is a story location, a navigation anchor and a minimap icon, so
 * "meet me at the Ledger" means something specific to the player.
 */
export function buildLandmarks(
  ctx: BuildContext,
  specs: LandmarkSpec[],
  blockPitch: number,
  blockSize: number,
  kerbY: number,
): void {
  for (const spec of specs) {
    const cx = spec.block[0] * blockPitch;
    const cz = spec.block[1] * blockPitch;
    switch (spec.kind) {
      case "lab":
        buildLab(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "police":
        buildPrecinct(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "press":
        buildPressTower(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "park":
        buildPark(ctx, cx, cz, blockSize, kerbY);
        break;
      case "transit":
        buildTransit(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "spire":
        buildSpire(ctx, cx, cz, blockSize, kerbY);
        break;
      case "arena":
        buildArena(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "home":
        buildRowHouses(ctx, cx, cz, blockSize, kerbY);
        break;
      case "bridge":
        buildBridge(ctx, cx, cz, blockPitch, blockSize, kerbY);
        break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/** The kerbed block platform every landmark sits on. */
function plaza(
  ctx: BuildContext,
  cx: number,
  cz: number,
  size: number,
  kerbY: number,
  materialKey = "sidewalk",
): void {
  const uvSide = new Vector4(0, 0, size / 8, 0.12);
  const uvTop = new Vector4(0, 0, size / 8, size / 8);
  const platform = MeshBuilder.CreateBox(
    `landmark-plaza-${cx}-${cz}`,
    {
      width: size,
      depth: size,
      height: kerbY * 2,
      faceUV: [uvSide, uvSide, uvSide, uvSide, uvTop, uvTop],
    },
    ctx.scene,
  );
  platform.position.set(cx, 0, cz);
  ctx.push(materialKey, platform);

  ctx.solid({
    minX: cx - size * 0.5,
    maxX: cx + size * 0.5,
    minZ: cz - size * 0.5,
    maxZ: cz + size * 0.5,
    top: kerbY,
    bottom: -1,
    climbable: false,
  });
}

interface BoxOptions {
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  /** Base of the box; defaults to the kerb. */
  base: number;
  material: string;
  climbable?: boolean;
  solid?: boolean;
}

function slab(ctx: BuildContext, name: string, options: BoxOptions): Mesh {
  const mesh = MeshBuilder.CreateBox(
    name,
    { width: options.width, depth: options.depth, height: options.height },
    ctx.scene,
  );
  mesh.position.set(options.x, options.base + options.height * 0.5, options.z);
  ctx.push(options.material, mesh);

  if (options.solid !== false) {
    ctx.solid({
      minX: options.x - options.width * 0.5,
      maxX: options.x + options.width * 0.5,
      minZ: options.z - options.depth * 0.5,
      maxZ: options.z + options.depth * 0.5,
      top: options.base + options.height,
      bottom: options.base,
      climbable: options.climbable ?? true,
    });
  }
  return mesh;
}

/** A lit sign plate on a facade. */
function sign(
  ctx: BuildContext,
  spec: LandmarkSpec,
  x: number,
  y: number,
  z: number,
  width: number,
  rotationY: number,
): void {
  const texture = createSignTexture(
    ctx.scene,
    `sign-${spec.id}`,
    spec.name,
    spec.subtitle,
    spec.accent,
  );
  const plate = MeshBuilder.CreatePlane(
    `sign-plate-${spec.id}`,
    { width, height: width * 0.25 },
    ctx.scene,
  );
  plate.position.set(x, y, z);
  plate.rotation.y = rotationY;
  plate.material = ctx.palette.emissiveTextured(`sign-material-${spec.id}`, texture, 1.35);
  plate.isPickable = false;
  plate.freezeWorldMatrix();
}

/* ------------------------------------------------------------------ */
/* Halcyon Labs                                                        */
/* ------------------------------------------------------------------ */

/**
 * The place where it happened: a low white campus wrapped around the
 * resonance ring, with the containment drum at the centre. The ring is
 * climbable and makes a natural rooftop route across the block.
 */
function buildLab(
  ctx: BuildContext,
  spec: LandmarkSpec,
  cx: number,
  cz: number,
  size: number,
  kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY);

  // Two office wings flanking a glass atrium.
  for (const side of [-1, 1] as const) {
    slab(ctx, `lab-wing-${side}`, {
      width: 30,
      depth: 78,
      height: 24,
      x: cx + side * 36,
      z: cz,
      base: kerbY,
      material: "facade:institute-white",
    });
  }

  slab(ctx, "lab-atrium", {
    width: 44,
    depth: 30,
    height: 15,
    x: cx,
    z: cz - 26,
    base: kerbY,
    material: "glass",
  });

  // Containment drum.
  const drum = MeshBuilder.CreateCylinder(
    "lab-drum",
    { height: 36, diameter: 30, tessellation: 28 },
    ctx.scene,
  );
  drum.position.set(cx, kerbY + 18, cz + 14);
  ctx.push("lab-white", drum);
  ctx.solid({
    minX: cx - 15,
    maxX: cx + 15,
    minZ: cz - 1,
    maxZ: cz + 29,
    top: kerbY + 36,
    bottom: kerbY,
    climbable: true,
  });

  const cap = MeshBuilder.CreateCylinder(
    "lab-drum-cap",
    { height: 3, diameterTop: 22, diameterBottom: 31, tessellation: 28 },
    ctx.scene,
  );
  cap.position.set(cx, kerbY + 37.5, cz + 14);
  ctx.push("lab-trim", cap);

  // The resonance ring: a torus of segmented housings around the drum.
  const segments = 22;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const radius = 40;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + 14 + Math.sin(angle) * radius;
    const housing = MeshBuilder.CreateBox(
      `lab-ring-${i}`,
      { width: 6.5, depth: 4.4, height: 5.2 },
      ctx.scene,
    );
    housing.position.set(x, kerbY + 6.4, z);
    housing.rotation.y = -angle;
    ctx.push(i % 3 === 0 ? "lab-trim" : "steel-bright", housing);

    if (i % 2 === 0) {
      const pylon = MeshBuilder.CreateBox(`lab-pylon-${i}`, { width: 2, depth: 2, height: 3.8 }, ctx.scene);
      pylon.position.set(x, kerbY + 1.9, z);
      ctx.push("concrete", pylon);
    }
  }

  // A continuous emissive band reading as the beam line.
  const beam = MeshBuilder.CreateTorus(
    "lab-beamline",
    { diameter: 80, thickness: 0.7, tessellation: 48 },
    ctx.scene,
  );
  beam.position.set(cx, kerbY + 6.4, cz + 14);
  beam.rotation.x = Math.PI * 0.5;
  beam.material = ctx.palette.emissive("lab-beam-material", spec.accent, 1.6);
  beam.isPickable = false;
  beam.freezeWorldMatrix();

  sign(ctx, spec, cx, kerbY + 19, cz - 41.2, 40, Math.PI);
}

/* ------------------------------------------------------------------ */
/* MCPD Precinct Seven                                                 */
/* ------------------------------------------------------------------ */

function buildPrecinct(
  ctx: BuildContext,
  spec: LandmarkSpec,
  cx: number,
  cz: number,
  size: number,
  kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY);

  slab(ctx, "precinct-body", {
    width: 70,
    depth: 52,
    height: 26,
    x: cx,
    z: cz + 6,
    base: kerbY,
    material: "facade:sandstone-deco",
  });

  // Civic steps and a colonnade at the entrance.
  for (let step = 0; step < 4; step += 1) {
    slab(ctx, `precinct-step-${step}`, {
      width: 34 - step * 2,
      depth: 3,
      height: 0.45,
      x: cx,
      z: cz - 22 - step * 2.6,
      base: kerbY + step * 0.45,
      material: "concrete",
      solid: false,
    });
  }

  for (let i = -3; i <= 3; i += 1) {
    const column = MeshBuilder.CreateCylinder(
      `precinct-column-${i}`,
      { height: 15, diameter: 2.2, tessellation: 12 },
      ctx.scene,
    );
    column.position.set(cx + i * 5.2, kerbY + 9.3, cz - 20);
    ctx.push("concrete", column);
  }

  slab(ctx, "precinct-pediment", {
    width: 38,
    depth: 5,
    height: 3.4,
    x: cx,
    z: cz - 20,
    base: kerbY + 16.8,
    material: "concrete",
    solid: false,
  });

  // Rooftop antenna farm.
  for (let i = 0; i < 5; i += 1) {
    const mast = MeshBuilder.CreateCylinder(
      `precinct-mast-${i}`,
      { height: 6 + ctx.rng() * 5, diameterTop: 0.1, diameterBottom: 0.3, tessellation: 6 },
      ctx.scene,
    );
    mast.position.set(cx - 24 + i * 12, kerbY + 30, cz + 18);
    ctx.push("steel", mast, true);
  }

  const beacon = MeshBuilder.CreateSphere("precinct-beacon", { diameter: 1.4, segments: 10 }, ctx.scene);
  beacon.position.set(cx, kerbY + 28.5, cz - 14);
  beacon.material = ctx.palette.emissive("precinct-beacon-material", spec.accent, 2.2);
  beacon.isPickable = false;
  beacon.freezeWorldMatrix();

  sign(ctx, spec, cx, kerbY + 22, cz - 17.2, 34, Math.PI);
}

/* ------------------------------------------------------------------ */
/* The Meridian Ledger                                                 */
/* ------------------------------------------------------------------ */

function buildPressTower(
  ctx: BuildContext,
  spec: LandmarkSpec,
  cx: number,
  cz: number,
  size: number,
  kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY);

  // Deco setbacks: three stacked volumes.
  const tiers: Array<[number, number, number]> = [
    [52, 52, 46],
    [38, 38, 40],
    [24, 24, 34],
  ];
  let base = kerbY;
  tiers.forEach(([width, depth, height], index) => {
    slab(ctx, `ledger-tier-${index}`, {
      width,
      depth,
      height,
      x: cx,
      z: cz,
      base,
      material: index === 2 ? "facade:sandstone-deco" : "facade:panel-dark",
    });
    base += height;
  });

  // Corner fins running the full height of the lower tier.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const fin = MeshBuilder.CreateBox(
        `ledger-fin-${sx}-${sz}`,
        { width: 2.4, depth: 2.4, height: 88 },
        ctx.scene,
      );
      fin.position.set(cx + sx * 25, kerbY + 44, cz + sz * 25);
      ctx.push("concrete", fin);
    }
  }

  // Rooftop globe: the paper's mark, visible from most of the Crest.
  const globe = MeshBuilder.CreateSphere("ledger-globe", { diameter: 15, segments: 18 }, ctx.scene);
  globe.position.set(cx, base + 9, cz);
  ctx.push("steel-bright", globe);
  ctx.solid({
    minX: cx - 7.5,
    maxX: cx + 7.5,
    minZ: cz - 7.5,
    maxZ: cz + 7.5,
    top: base + 16,
    bottom: base,
    climbable: true,
  });

  const ring = MeshBuilder.CreateTorus(
    "ledger-globe-ring",
    { diameter: 18, thickness: 0.5, tessellation: 36 },
    ctx.scene,
  );
  ring.position.set(cx, base + 9, cz);
  ring.rotation.x = 0.4;
  ring.material = ctx.palette.emissive("ledger-ring-material", spec.accent, 1.4);
  ring.isPickable = false;
  ring.freezeWorldMatrix();

  sign(ctx, spec, cx, kerbY + 34, cz - 26.2, 44, Math.PI);
}

/* ------------------------------------------------------------------ */
/* Corbin Green                                                        */
/* ------------------------------------------------------------------ */

function buildPark(ctx: BuildContext, cx: number, cz: number, size: number, kerbY: number): void {
  plaza(ctx, cx, cz, size, kerbY, "grass");

  // Crossed gravel paths.
  for (const rotated of [false, true]) {
    const path = MeshBuilder.CreateBox(
      `park-path-${rotated ? "z" : "x"}`,
      {
        width: rotated ? 7 : size,
        depth: rotated ? size : 7,
        height: 0.12,
      },
      ctx.scene,
    );
    path.position.set(cx, kerbY + 0.06, cz);
    ctx.push("sidewalk", path);
  }

  // Pond.
  const pond = MeshBuilder.CreateCylinder("park-pond", { height: 0.4, diameter: 34, tessellation: 28 }, ctx.scene);
  pond.position.set(cx + 22, kerbY - 0.1, cz - 20);
  ctx.push("water", pond);

  // Bandstand: a raised platform you can land on.
  const deck = MeshBuilder.CreateCylinder("park-bandstand", { height: 1.6, diameter: 16, tessellation: 16 }, ctx.scene);
  deck.position.set(cx - 24, kerbY + 0.8, cz + 20);
  ctx.push("concrete", deck);
  ctx.solid({
    minX: cx - 32,
    maxX: cx - 16,
    minZ: cz + 12,
    maxZ: cz + 28,
    top: kerbY + 1.6,
    bottom: kerbY,
    climbable: false,
  });

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const post = MeshBuilder.CreateCylinder(`park-post-${i}`, { height: 5, diameter: 0.5, tessellation: 8 }, ctx.scene);
    post.position.set(cx - 24 + Math.cos(angle) * 6.6, kerbY + 4.1, cz + 20 + Math.sin(angle) * 6.6);
    ctx.push("steel", post, true);
  }
  const roof = MeshBuilder.CreateCylinder(
    "park-bandstand-roof",
    { height: 2.4, diameterTop: 1, diameterBottom: 16, tessellation: 16 },
    ctx.scene,
  );
  roof.position.set(cx - 24, kerbY + 7.8, cz + 20);
  ctx.push("concrete-dark", roof);

  for (let i = 0; i < 14; i += 1) {
    const x = cx + (ctx.rng() - 0.5) * (size - 16);
    const z = cz + (ctx.rng() - 0.5) * (size - 16);
    if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue;
    const scale = 0.9 + ctx.rng() * 0.7;
    const trunk = MeshBuilder.CreateCylinder(
      `park-trunk-${i}`,
      { height: 5.4 * scale, diameterTop: 0.7, diameterBottom: 1.3, tessellation: 7 },
      ctx.scene,
    );
    trunk.position.set(x, kerbY + 2.7 * scale, z);
    ctx.push("trunk", trunk, true);
    for (let c = 0; c < 3; c += 1) {
      const crown = MeshBuilder.CreateSphere(
        `park-crown-${i}-${c}`,
        { diameter: (4.4 + ctx.rng() * 3) * scale, segments: 6 },
        ctx.scene,
      );
      crown.position.set(
        x + (ctx.rng() - 0.5) * 3 * scale,
        kerbY + (5.6 + ctx.rng() * 2) * scale,
        z + (ctx.rng() - 0.5) * 3 * scale,
      );
      ctx.push(ctx.rng() < 0.25 ? "leaf-autumn" : "leaf", crown, true);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ridgeline Transit                                                   */
/* ------------------------------------------------------------------ */

function buildTransit(
  ctx: BuildContext,
  spec: LandmarkSpec,
  cx: number,
  cz: number,
  size: number,
  kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY);

  slab(ctx, "transit-concourse", {
    width: 96,
    depth: 44,
    height: 18,
    x: cx,
    z: cz,
    base: kerbY,
    material: "facade:concrete-block",
  });

  // Barrel-vaulted train shed above the concourse.
  const vault = MeshBuilder.CreateCylinder(
    "transit-vault",
    { height: 96, diameter: 40, tessellation: 24, arc: 0.5 },
    ctx.scene,
  );
  vault.rotation.z = Math.PI * 0.5;
  vault.rotation.y = Math.PI * 0.5;
  vault.position.set(cx, kerbY + 18, cz);
  ctx.push("steel-bright", vault);

  // Clock tower.
  slab(ctx, "transit-tower", {
    width: 16,
    depth: 16,
    height: 54,
    x: cx - 40,
    z: cz - 16,
    base: kerbY,
    material: "facade:sandstone-deco",
  });
  const clock = MeshBuilder.CreateCylinder(
    "transit-clock",
    { height: 1, diameter: 10, tessellation: 24 },
    ctx.scene,
  );
  clock.rotation.x = Math.PI * 0.5;
  clock.position.set(cx - 40, kerbY + 46, cz - 24.4);
  clock.material = ctx.palette.emissive("transit-clock-material", "#f4ead2", 1.1);
  clock.isPickable = false;
  clock.freezeWorldMatrix();

  const cap = MeshBuilder.CreateCylinder(
    "transit-tower-cap",
    { height: 8, diameterTop: 0.4, diameterBottom: 17, tessellation: 4 },
    ctx.scene,
  );
  cap.position.set(cx - 40, kerbY + 58, cz - 16);
  cap.rotation.y = Math.PI * 0.25;
  ctx.push("concrete-dark", cap);

  sign(ctx, spec, cx + 12, kerbY + 14, cz - 22.2, 40, Math.PI);
}

/* ------------------------------------------------------------------ */
/* Meridian Spire                                                      */
/* ------------------------------------------------------------------ */

function buildSpire(ctx: BuildContext, cx: number, cz: number, size: number, kerbY: number): void {
  plaza(ctx, cx, cz, size, kerbY);

  const base = MeshBuilder.CreateCylinder(
    "spire-base",
    { height: 6, diameterBottom: 22, diameterTop: 15, tessellation: 24 },
    ctx.scene,
  );
  base.position.set(cx, kerbY + 3, cz);
  ctx.push("concrete", base);

  const shaft = MeshBuilder.CreateCylinder(
    "spire-shaft",
    { height: 96, diameterBottom: 7, diameterTop: 2, tessellation: 18 },
    ctx.scene,
  );
  shaft.position.set(cx, kerbY + 54, cz);
  ctx.push("steel-bright", shaft);

  const deck = MeshBuilder.CreateCylinder(
    "spire-deck",
    { height: 3, diameter: 13, tessellation: 20 },
    ctx.scene,
  );
  deck.position.set(cx, kerbY + 82, cz);
  ctx.push("concrete", deck);

  const antenna = MeshBuilder.CreateCylinder(
    "spire-antenna",
    { height: 28, diameterBottom: 0.6, diameterTop: 0.1, tessellation: 6 },
    ctx.scene,
  );
  antenna.position.set(cx, kerbY + 116, cz);
  ctx.push("steel", antenna);

  const beacon = MeshBuilder.CreateSphere("spire-beacon", { diameter: 1.4, segments: 10 }, ctx.scene);
  beacon.position.set(cx, kerbY + 131, cz);
  beacon.material = ctx.palette.emissive("spire-beacon-material", "#ff4338", 3);
  beacon.isPickable = false;
  beacon.freezeWorldMatrix();

  // The whole mast is one climbable column: the highest point in Meridian.
  ctx.solid({
    minX: cx - 11,
    maxX: cx + 11,
    minZ: cz - 11,
    maxZ: cz + 11,
    top: kerbY + 83.5,
    bottom: kerbY,
    climbable: true,
  });
}

/* ------------------------------------------------------------------ */
/* Sable Arena                                                         */
/* ------------------------------------------------------------------ */

function buildArena(
  ctx: BuildContext,
  spec: LandmarkSpec,
  cx: number,
  cz: number,
  size: number,
  kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY);

  // Bowl built from a ring of angled facade panels.
  const segments = 28;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const radius = 44;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius * 0.86;
    const panel = MeshBuilder.CreateBox(
      `arena-panel-${i}`,
      { width: 11, depth: 9, height: 22 },
      ctx.scene,
    );
    panel.position.set(x, kerbY + 11, z);
    panel.rotation.y = -angle;
    ctx.push(i % 4 === 0 ? "concrete" : "facade:panel-dark", panel);

    ctx.solid({
      minX: x - 5.5,
      maxX: x + 5.5,
      minZ: z - 5.5,
      maxZ: z + 5.5,
      top: kerbY + 22,
      bottom: kerbY,
      climbable: true,
    });

    if (i % 4 === 0) {
      const mast = MeshBuilder.CreateBox(`arena-light-${i}`, { width: 1, depth: 1, height: 10 }, ctx.scene);
      mast.position.set(x, kerbY + 27, z);
      ctx.push("steel", mast, true);
      const rig = MeshBuilder.CreateBox(`arena-rig-${i}`, { width: 6, depth: 1.4, height: 2.4 }, ctx.scene);
      rig.position.set(x, kerbY + 33, z);
      rig.rotation.y = -angle;
      ctx.push("steel-bright", rig, true);
    }
  }

  // Pitch.
  const pitch = MeshBuilder.CreateCylinder("arena-pitch", { height: 0.3, diameter: 74, tessellation: 32 }, ctx.scene);
  pitch.scaling.z = 0.86;
  pitch.position.set(cx, kerbY + 0.15, cz);
  ctx.push("grass", pitch);

  sign(ctx, spec, cx, kerbY + 16, cz - 51, 38, Math.PI);
}

/* ------------------------------------------------------------------ */
/* Marrow Hill row houses                                              */
/* ------------------------------------------------------------------ */

function buildRowHouses(ctx: BuildContext, cx: number, cz: number, size: number, kerbY: number): void {
  plaza(ctx, cx, cz, size, kerbY);

  for (const row of [-1, 1] as const) {
    for (let i = -3; i <= 3; i += 1) {
      const height = 9 + ctx.rng() * 4;
      const x = cx + i * 13;
      const z = cz + row * 30;
      slab(ctx, `row-house-${row}-${i}`, {
        width: 12,
        depth: 20,
        height,
        x,
        z,
        base: kerbY,
        material: "facade:brick-mid",
      });

      // Pitched roof reads as domestic even from the air.
      const roof = MeshBuilder.CreateCylinder(
        `row-roof-${row}-${i}`,
        { height: 12, diameter: 13, tessellation: 3 },
        ctx.scene,
      );
      roof.rotation.z = Math.PI * 0.5;
      roof.rotation.y = Math.PI * 0.5;
      roof.position.set(x, kerbY + height + 2.4, z);
      ctx.push("concrete-dark", roof);

      const stoop = MeshBuilder.CreateBox(`row-stoop-${row}-${i}`, { width: 4, depth: 2.4, height: 0.9 }, ctx.scene);
      stoop.position.set(x, kerbY + 0.45, z - row * 11);
      ctx.push("concrete", stoop, true);
    }
  }

  // A single street tree line down the middle of the block.
  for (let i = -4; i <= 4; i += 1) {
    const trunk = MeshBuilder.CreateCylinder(
      `row-trunk-${i}`,
      { height: 5, diameterTop: 0.6, diameterBottom: 1, tessellation: 6 },
      ctx.scene,
    );
    trunk.position.set(cx + i * 12, kerbY + 2.5, cz);
    ctx.push("trunk", trunk, true);
    const crown = MeshBuilder.CreateSphere(`row-crown-${i}`, { diameter: 5.6, segments: 6 }, ctx.scene);
    crown.position.set(cx + i * 12, kerbY + 6.4, cz);
    ctx.push("leaf", crown, true);
  }
}

/* ------------------------------------------------------------------ */
/* Kestrel Bridge                                                      */
/* ------------------------------------------------------------------ */

function buildBridge(
  ctx: BuildContext,
  cx: number,
  cz: number,
  blockPitch: number,
  blockSize: number,
  kerbY: number,
): void {
  const span = blockPitch + 8;

  const deck = MeshBuilder.CreateBox("kestrel-deck", { width: span, depth: blockSize, height: 1.6 }, ctx.scene);
  deck.position.set(cx, kerbY - 0.8, cz);
  ctx.push("concrete", deck);
  ctx.solid({
    minX: cx - span * 0.5,
    maxX: cx + span * 0.5,
    minZ: cz - blockSize * 0.5,
    maxZ: cz + blockSize * 0.5,
    top: kerbY,
    bottom: -2,
    climbable: false,
  });

  for (const side of [-1, 1] as const) {
    // Towers.
    for (const end of [-1, 1] as const) {
      const x = cx + end * (span * 0.32);
      const z = cz + side * (blockSize * 0.5 - 3);
      const tower = MeshBuilder.CreateBox(
        `kestrel-tower-${side}-${end}`,
        { width: 5, depth: 5, height: 46 },
        ctx.scene,
      );
      tower.position.set(x, kerbY + 23, z);
      ctx.push("steel-bright", tower);
      ctx.solid({
        minX: x - 2.5,
        maxX: x + 2.5,
        minZ: z - 2.5,
        maxZ: z + 2.5,
        top: kerbY + 46,
        bottom: kerbY,
        climbable: true,
      });
    }

    // Main cable, approximated by a chain of short segments.
    const steps = 14;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const x = cx + (t - 0.5) * span * 0.64;
      // Catenary-ish sag between the two towers.
      const sag = Math.cos((t - 0.5) * Math.PI) * 22;
      const y = kerbY + 46 - sag;
      const link = MeshBuilder.CreateBox(
        `kestrel-cable-${side}-${i}`,
        { width: span * 0.056, depth: 0.5, height: 0.5 },
        ctx.scene,
      );
      link.position.set(x, y, cz + side * (blockSize * 0.5 - 3));
      link.rotation.z = Math.sin((t - 0.5) * Math.PI) * 0.85;
      ctx.push("steel", link, true);

      const hanger = MeshBuilder.CreateBox(
        `kestrel-hanger-${side}-${i}`,
        { width: 0.22, depth: 0.22, height: Math.max(1, y - kerbY) },
        ctx.scene,
      );
      hanger.position.set(x, kerbY + (y - kerbY) * 0.5, cz + side * (blockSize * 0.5 - 3));
      ctx.push("steel", hanger, true);
    }

    const rail = MeshBuilder.CreateBox(`kestrel-rail-${side}`, { width: span, depth: 0.6, height: 1.4 }, ctx.scene);
    rail.position.set(cx, kerbY + 0.7, cz + side * blockSize * 0.5);
    ctx.push("steel", rail);
  }
}
