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
  | "bridge"
  | "observatory"
  | "reservoir"
  | "foundry"
  | "terminal"
  | "lighthouse"
  | "station";

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
  /** Efficient axis-aligned static geometry, with center Y (not base Y). */
  box(key: string, x: number, y: number, z: number, width: number, height: number, depth: number, detail?: boolean, uv?: Vector4[]): void;
  /** Queues a mesh for chunk merging. Call before baking its transform. */
  push(materialKey: string, mesh: Mesh, detail?: boolean): void;
  shadowCaster(mesh: Mesh): void;
  /** A simplified far-distance volume. Base is an absolute world Y. */
  silhouette(x: number, z: number, width: number, depth: number, height: number, base?: number): void;
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
      case "observatory":
        buildObservatory(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "reservoir":
        buildReservoir(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "foundry":
        buildFoundry(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "terminal":
        buildTerminal(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "lighthouse":
        buildLighthouse(ctx, spec, cx, cz, blockSize, kerbY);
        break;
      case "station":
        buildNorthlineStation(ctx, spec, cx, cz, blockSize, kerbY);
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
    if (options.height >= 4) {
      ctx.silhouette(options.x, options.z, options.width, options.depth, options.height, options.base);
    }
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
  const backing = MeshBuilder.CreateBox(`sign-frame-${spec.id}`, {
    width: width + 0.8, height: width * 0.25 + 0.6, depth: 0.4,
  }, ctx.scene);
  // A plane's front points toward -Z before rotation. Keep its frame behind
  // it; south-facing signs must use rotation 0, otherwise lettering is culled.
  backing.position.set(x + Math.sin(rotationY) * 0.24, y, z + Math.cos(rotationY) * 0.24);
  backing.rotation.y = rotationY;
  ctx.push("steel", backing, true);
  plate.material = ctx.palette.emissiveTextured(`sign-material-${spec.id}`, texture, 1.35);
  plate.isPickable = false;
  ctx.push(`sign-material-${spec.id}`, plate, true);
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
  ctx.silhouette(cx, cz + 14, 30, 30, 39, kerbY);
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

  sign(ctx, spec, cx, kerbY + 19, cz - 41.2, 40, 0);
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

  sign(ctx, spec, cx, kerbY + 22, cz - 22.7, 34, 0);
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
  ctx.silhouette(cx, cz, 15, 15, 15, base + 1.5);
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

  sign(ctx, spec, cx, kerbY + 34, cz - 26.2, 44, 0);
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
  ctx.silhouette(cx, cz, 96, 40, 20, kerbY + 18);

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

  sign(ctx, spec, cx + 12, kerbY + 14, cz - 22.2, 40, 0);
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
  ctx.silhouette(cx, cz, 7, 7, 102, kerbY);

  const deck = MeshBuilder.CreateCylinder(
    "spire-deck",
    { height: 3, diameter: 13, tessellation: 20 },
    ctx.scene,
  );
  deck.position.set(cx, kerbY + 82, cz);
  ctx.push("concrete", deck);
  ctx.silhouette(cx, cz, 13, 13, 3, kerbY + 80.5);

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
    ctx.silhouette(x, z, 11, 11, 22, kerbY);

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

  sign(ctx, spec, cx, kerbY + 16, cz - 51, 38, 0);
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
      ctx.silhouette(x, z, 5, 5, 46, kerbY);
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

/* ------------------------------------------------------------------ */
/* Outer borough landmarks                                            */
/* ------------------------------------------------------------------ */

/** Local coordinates keep the authored buildings independent of grid pitch.
 * Box dimensions are width / height / depth; base heights are above the kerb.
 * Round structures use conservative AABBs, with square caps wherever there is
 * an intended landing. Trim has no collider; structural roofs always do.
 */
function landmarkKit(ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, kerbY: number) {
  const box = (
    name: string,
    at: [number, number],
    dimensions: [number, number, number],
    material: string,
    base = 0,
    solid = true,
  ) => slab(ctx, `${spec.id}-${name}`, {
    x: cx + at[0], z: cz + at[1],
    width: dimensions[0], height: dimensions[1], depth: dimensions[2],
    base: kerbY + base, material, solid,
  });

  const round = (
    name: string,
    at: [number, number],
    diameter: number,
    height: number,
    material: string,
    base = 0,
    diameterTop = diameter,
    solid = true,
  ) => {
    const mesh = MeshBuilder.CreateCylinder(`${spec.id}-${name}`, {
      diameterBottom: diameter, diameterTop, height, tessellation: 24,
    }, ctx.scene);
    mesh.position.set(cx + at[0], kerbY + base + height * 0.5, cz + at[1]);
    ctx.push(material, mesh);
    if (solid) {
      const radius = Math.max(diameter, diameterTop) * 0.5;
      ctx.solid({
        minX: cx + at[0] - radius, maxX: cx + at[0] + radius,
        minZ: cz + at[1] - radius, maxZ: cz + at[1] + radius,
        bottom: kerbY + base, top: kerbY + base + height, climbable: true,
      });
      if (height >= 4) {
        const footprint = Math.max(diameter, diameterTop);
        ctx.silhouette(cx + at[0], cz + at[1], footprint, footprint, height, kerbY + base);
      }
    }
    return mesh;
  };

  const light = (name: string, x: number, z: number, height = 7) => {
    box(`${name}-post`, [x, z], [0.35, height, 0.35], "steel");
    box(`${name}-lamp`, [x, z], [1.2, 0.65, 1.2], "warm-light", height, false);
  };

  return { box, round, light };
}

/** A civic terrace, offset telescope drum and exposed observation deck. */
function buildObservatory(
  ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, size: number, kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY, "park-path");
  const { box, round, light } = landmarkKit(ctx, spec, cx, cz, kerbY);

  // The south court stays open; two lower wings give the tower a stepped route.
  box("west-gallery", [-32, 5], [28, 15, 64], "facade:sandstone-deco");
  box("east-gallery", [32, 5], [28, 21, 64], "facade:sandstone-deco");
  box("west-roof", [-32, 5], [30, 0.8, 66], "oxidized-copper", 15);
  box("east-roof", [32, 5], [30, 0.8, 66], "oxidized-copper", 21);
  box("viewing-hall", [0, 19], [40, 32, 42], "facade:institute-white");
  box("viewing-deck", [0, 19], [44, 1, 46], "concrete", 32);

  // The telescope occupies the back half, leaving the deck's south edge clear.
  round("telescope-drum", [0, 28], 27, 8, "lab-white", 33);
  round("telescope-shell", [0, 28], 29, 12, "oxidized-copper", 41, 9);
  round("telescope-crown", [0, 28], 9, 0.8, "copper", 53);
  box("telescope-slot", [0, 28], [3, 0.12, 7], "glass", 53.8, false);
  const shutter = MeshBuilder.CreateBox(`${spec.id}-telescope-shutter`, {
    width: 3.2, height: Math.hypot(12, 10), depth: 0.16,
  }, ctx.scene);
  shutter.position.set(cx, kerbY + 47, cz + 18.4);
  shutter.rotation.x = Math.atan2(10, 12);
  ctx.push("glass", shutter);

  // Stone ribs and warm windows frame the long wings without obstructing roofs.
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i += 1) {
      const z = -20 + i * 12;
      box(`gallery-rib-${side}-${i}`, [side * 47, z], [0.5, 12, 1.4], "concrete", 1, false);
      box(`gallery-window-${side}-${i}`, [side * 46.3, z + 4], [0.2, 7, 5], "glass", 4, false);
    }
    box(`entry-canopy-${side}`, [side * 28, -30], [30, 0.8, 12], "copper", 7);
    box(`entry-post-${side}`, [side * 40, -35], [1, 7, 1], "concrete");
    light(`court-light-${side}`, side * 15, -43);
    box(`court-planter-${side}`, [side * 39, -44], [20, 0.8, 5], "terracotta");
    box(`court-hedge-${side}`, [side * 39, -44], [18, 1.2, 4], "leaf-sage", 0.8, false);
  }
  // An inlaid meridian line leads directly from the street to the entrance.
  box("meridian-inlay", [0, -29], [0.5, 0.03, 50], "copper", 0, false);
  box("entry-sign-backing", [0, -4], [27, 5.5, 0.5], "concrete-dark", 15, false);
  sign(ctx, spec, cx, kerbY + 17.75, cz - 4.3, 26, 0);
}

/** The waterworks is a public promenade with a cross-pool running line. */
function buildReservoir(
  ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, size: number, kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY, "park-path");
  const { box, round, light } = landmarkKit(ctx, spec, cx, cz, kerbY);

  box("basin-floor", [0, 4], [76, 0.25, 70], "concrete-dark");
  box("water", [0, 4], [74, 0.12, 68], "water", 0.25, false);
  for (const side of [-1, 1] as const) {
    box(`embankment-${side}`, [side * 42, 3], [9, 3, 80], "concrete");
    box(`embankment-cap-${side}`, [side * 42, 3], [10, 0.4, 82], "park-path", 3);
    box(`spillway-wall-${side}`, [0, side * 36 + 3], [76, 3, 4], "concrete");
    box(`crossing-pier-${side}`, [side * 22, 0], [4, 8, 7], "concrete");
    box(`crossing-cap-${side}`, [side * 22, 0], [8, 0.6, 10], "steel-bright", 8);
    light(`promenade-light-${side}`, side * 48, -42, 8);
    box(`bench-${side}`, [side * 27, -45], [12, 0.5, 2.4], "trunk", 0.8, false);
  }
  // Broad, flat upper crossing is a reliable landing at y = kerb + 9.
  box("crossing", [0, 0], [92, 1, 9], "concrete", 8);
  for (const side of [-1, 1] as const) {
    box(`crossing-edge-${side}`, [0, side * 4.3], [92, 0.12, 0.3], "copper", 9, false);
  }
  box("pump-house", [0, 40], [44, 17, 20], "facade:brick-mid");
  box("pump-roof", [0, 40], [46, 0.8, 22], "oxidized-copper", 17);
  for (const side of [-1, 1] as const) {
    round(`water-tower-${side}`, [side * 36, 35], 13, 25, "concrete");
    round(`header-tank-${side}`, [side * 36, 35], 18, 12, "harbor-blue", 25);
    box(`tank-landing-${side}`, [side * 36, 35], [19, 0.8, 19], "steel-bright", 37);
    for (let band = 0; band < 3; band += 1) {
      round(`tank-band-${side}-${band}`, [side * 36, 35], 18.3, 0.25, "steel-bright", 26 + band * 4, 18.3, false);
    }
    box(`inlet-${side}`, [side * 27, 33], [12, 2.4, 2.4], "oxidized-copper", 2, false);
  }
  box("entry-pylon", [-43, -45], [3, 9, 3], "concrete");
  box("entry-sign-backing", [-27, -45], [30, 6, 0.5], "harbor-blue", 4, false);
  sign(ctx, spec, cx - 27, kerbY + 7, cz - 45.3, 28, 0);
}

/** Brick mill, roof monitors, twin stacks and a gantry that can be crossed. */
function buildFoundry(
  ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, size: number, kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY, "concrete-dark");
  const { box, round, light } = landmarkKit(ctx, spec, cx, cz, kerbY);

  box("casting-hall", [0, 13], [76, 28, 62], "facade:brick-mid");
  box("hall-roof", [0, 13], [78, 0.8, 64], "terracotta", 28);
  for (let i = 0; i < 4; i += 1) {
    const x = -28 + i * 19;
    // Raised clerestories leave continuous roof lanes between them.
    box(`roof-monitor-${i}`, [x, 17], [9, 3.2, 48], "glass", 28.8);
    box(`monitor-cap-${i}`, [x, 17], [10, 0.5, 50], "steel", 32);
    box(`front-pier-${i}`, [x, -18.4], [1.5, 28, 0.8], "terracotta", 0, false);
    box(`loading-door-${i}`, [x, -18.9], [11, 10, 0.2], "steel", 1, false);
    box(`door-window-${i}`, [x, -19.05], [10, 1.8, 0.2], "glass", 7, false);
  }
  for (const side of [-1, 1] as const) {
    const x = side * 44;
    box(`stack-foot-${side}`, [x, 33], [12, 10, 16], "terracotta");
    round(`stack-${side}`, [x, 33], 9, 60, "terracotta", 10, 6.5);
    round(`stack-collar-${side}`, [x, 33], 7.4, 2, "steel", 70);
    // A square maintenance cap makes the chimney a supported landing.
    box(`stack-cap-${side}`, [x, 33], [8, 0.6, 8], "steel", 72);
    box(`gantry-leg-${side}`, [side * 38, -34], [3, 22, 4], "harbor-red");
    box(`gantry-foot-${side}`, [side * 38, -34], [8, 0.8, 10], "steel");
    box(`gantry-rail-${side}`, [side * 38, -32], [0.7, 0.12, 34], "steel-bright", 0.03, false);
    box(`pipe-rack-${side}`, [side * 39, -3], [6, 0.8, 60], "steel-bright", 19);
    light(`yard-light-${side}`, side * 48, -47, 10);
  }
  box("gantry-beam", [0, -34], [82, 2, 6], "harbor-red", 22);
  box("gantry-top", [0, -34], [82, 0.3, 7], "steel", 24);
  box("trolley", [10, -34], [7, 3, 7], "steel-bright", 24.3);
  box("crane-cable", [10, -34], [0.18, 9, 0.18], "steel", 13, false);
  box("crane-hook", [10, -34], [1.7, 1, 1], "steel-bright", 12, false);
  for (let i = 0; i < 5; i += 1) {
    box(`yard-stripe-${i}`, [-20 + i * 8, -46], [0.35, 0.03, 10], "road-marking", 0.03, false);
  }
  sign(ctx, spec, cx - 5, kerbY + 18.5, cz - 19.1, 39, 0);
}

/** A low ferry hall with boarding fingers and a glazed harbour control room. */
function buildTerminal(
  ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, size: number, kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY);
  const { box, round, light } = landmarkKit(ctx, spec, cx, cz, kerbY);

  box("passenger-hall", [0, 15], [74, 18, 46], "facade:institute-white");
  box("hall-roof", [0, 15], [80, 1, 50], "harbor-blue", 18);
  box("arrival-glass", [0, -8.2], [62, 10, 0.3], "glass", 2, false);
  box("arrival-canopy", [0, -17], [86, 1, 18], "lab-white", 11);
  for (const side of [-1, 1] as const) {
    box(`canopy-leg-${side}`, [side * 38, -24], [1.2, 11, 1.2], "steel-bright");
    box(`boarding-wing-${side}`, [side * 42, 22], [16, 9, 44], "facade:panel-dark");
    box(`boarding-wing-roof-${side}`, [side * 42, 22], [18, 0.6, 46], "lab-white", 9);
    light(`forecourt-light-${side}`, side * 46, -45, 8);
  }
  for (let i = 0; i < 3; i += 1) {
    const x = -28 + i * 28;
    box(`boarding-finger-${i}`, [x, -37], [13, 1.2, 28], "park-path");
    box(`boarding-roof-${i}`, [x, -36], [14, 0.5, 24], "oxidized-copper", 6);
    for (const side of [-1, 1] as const) {
      box(`boarding-post-${i}-${side}`, [x + side * 5.5, -45], [0.5, 6, 0.5], "steel");
    }
    box(`bay-stripe-${i}`, [x, -48], [8, 0.03, 0.45], "road-marking", 1.2, false);
  }
  box("control-core", [26, 26], [12, 15, 12], "lab-white", 19);
  box("control-room", [26, 26], [22, 7, 20], "glass", 34);
  box("control-roof", [26, 26], [25, 0.8, 23], "harbor-blue", 41);
  round("radar-mast", [26, 26], 0.8, 7, "steel-bright", 41.8);
  box("radar-array", [26, 26], [9, 0.8, 1], "steel-bright", 48.8, false);
  box("ferry-mark", [-22, 15], [14, 0.03, 2], "road-marking", 19, false);
  sign(ctx, spec, cx, kerbY + 15, cz - 10.3, 46, 0);
}

/** A striped coastal beacon; its lantern balcony is a proper landing. */
function buildLighthouse(
  ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, size: number, kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY, "park-path");
  const { box, round, light } = landmarkKit(ctx, spec, cx, cz, kerbY);

  box("keeper-house", [-24, -17], [34, 12, 32], "facade:institute-white");
  box("keeper-roof", [-24, -17], [36, 0.8, 34], "terracotta", 12);
  box("storehouse", [28, -20], [25, 7, 25], "facade:brick-mid");
  box("storehouse-roof", [28, -20], [27, 0.6, 27], "harbor-blue", 7);
  box("beacon-foot", [0, 16], [30, 4, 30], "concrete");
  round("beacon-base", [0, 16], 20, 8, "lab-white", 4);
  for (let band = 0; band < 6; band += 1) {
    round(`beacon-band-${band}`, [0, 16], 16 - band * 0.55, 7,
      band % 2 === 0 ? "harbor-red" : "lab-white", 12 + band * 7,
      16 - (band + 1) * 0.55);
  }
  box("lantern-balcony", [0, 16], [24, 1.2, 24], "lab-white", 54);
  round("lantern", [0, 16], 13, 8, "glass", 55.2);
  for (let side = 0; side < 8; side += 1) {
    const angle = (side / 8) * Math.PI * 2;
    box(`lantern-mullion-${side}`, [Math.cos(angle) * 6.2, 16 + Math.sin(angle) * 6.2],
      [0.4, 8, 0.4], "steel-bright", 55.2, false);
  }
  round("lamp", [0, 16], 5, 3.4, "warm-light", 57.4, 5, false);
  box("lantern-roof", [0, 16], [16, 1, 16], "copper", 63.2);
  round("lantern-cap", [0, 16], 15, 5, "oxidized-copper", 64.2, 4);
  round("lantern-crown", [0, 16], 4, 0.4, "copper", 69.2);
  // Railings are thin and split at the front so the balcony can be reached.
  for (const side of [-1, 1] as const) {
    box(`balcony-rail-${side}`, [side * 11.5, 16], [0.25, 1, 23], "steel", 55.2, false);
    box(`balcony-rear-${side}`, [side * 8, 27.5], [7, 1, 0.25], "steel", 55.2, false);
    light(`beacon-path-${side}`, side * 9, -41, 5);
    box(`coastal-bench-${side}`, [side * 32, 40], [14, 0.6, 2], "trunk", 0.9, false);
  }
  box("approach-inlay", [0, -22], [6, 0.03, 64], "concrete", 0, false);
  box("entry-sign-backing", [-24, -33.3], [30, 6, 0.3], "harbor-blue", 3, false);
  sign(ctx, spec, cx - 24, kerbY + 6, cz - 33.55, 29, 0);
}

/** Open-sided commuter platforms, a copper headhouse and an upper footbridge. */
function buildNorthlineStation(
  ctx: BuildContext, spec: LandmarkSpec, cx: number, cz: number, size: number, kerbY: number,
): void {
  plaza(ctx, cx, cz, size, kerbY, "concrete-dark");
  const { box, light } = landmarkKit(ctx, spec, cx, cz, kerbY);

  box("headhouse", [0, -33], [70, 20, 24], "facade:sandstone-deco");
  box("headhouse-roof", [0, -33], [74, 0.8, 28], "oxidized-copper", 20);
  box("entry-glass", [0, -45.3], [28, 12, 0.3], "glass", 1, false);
  box("entry-canopy", [0, -49], [42, 0.7, 10], "copper", 10);
  box("upper-crossing", [0, 4], [84, 1, 10], "concrete", 9);
  box("crossing-glass", [0, 8.8], [84, 2.4, 0.25], "glass", 10, false);

  for (const side of [-1, 1] as const) {
    const x = side * 22;
    box(`platform-${side}`, [x, 18], [18, 1.2, 72], "concrete");
    box(`platform-line-${side}`, [x - side * 8, 18], [0.6, 0.03, 70], "road-marking", 1.2, false);
    box(`platform-roof-${side}`, [x, 15], [22, 0.6, 62], "oxidized-copper", 16);
    box(`roof-edge-${side}`, [x - side * 10.5, 15], [0.3, 0.4, 62], "copper", 16.6, false);
    for (let i = 0; i < 4; i += 1) {
      const z = -12 + i * 17;
      box(`platform-column-${side}-${i}`, [x, z], [0.8, 14.8, 0.8], "steel-bright", 1.2);
      box(`platform-rib-${side}-${i}`, [x, z], [20, 0.55, 0.6], "steel-bright", 15.45, false);
    }
    box(`crossing-core-${side}`, [side * 41, 4], [8, 9, 10], "facade:panel-dark");
    box(`concourse-link-${side}`, [side * 22, -17], [12, 0.8, 12], "concrete", 9);
    box(`approach-paver-${side}`, [side * 45, -36], [15, 0.05, 35], "park-path", 0, false);
    light(`station-lamp-${side}`, side * 43, -47, 9);
  }
  // Tracks remain below step height. A stopped train adds a low traversal route.
  for (const x of [-7, -3, 3, 7]) {
    box(`track-${x}`, [x, 18], [0.16, 0.1, 70], "steel-bright", 0, false);
  }
  for (let i = 0; i < 18; i += 1) {
    box(`sleeper-${i}`, [0, -15 + i * 4], [18, 0.07, 0.45], "trunk", 0, false);
  }
  for (let car = 0; car < 2; car += 1) {
    const z = 19 + car * 19;
    box(`train-car-${car}`, [-5, z], [3.5, 3.7, 17], "harbor-blue", 0.5);
    box(`train-roof-${car}`, [-5, z], [3.7, 0.4, 17], "steel-bright", 4.2);
    for (const side of [-1, 1] as const) {
      box(`train-windows-${car}-${side}`, [-5 + side * 1.76, z], [0.08, 1.3, 14], "glass", 2.4, false);
      box(`train-stripe-${car}-${side}`, [-5 + side * 1.8, z], [0.08, 0.25, 16], "road-marking", 1.9, false);
    }
  }
  sign(ctx, spec, cx, kerbY + 16.5, cz - 45.6, 40, 0);
}
