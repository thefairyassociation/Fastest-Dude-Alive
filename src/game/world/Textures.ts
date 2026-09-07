import { Constants, DynamicTexture, Scene, Texture } from "@babylonjs/core";
import type { Rng } from "../core/Rng";

/**
 * Procedural texture painters.
 *
 * Everything the city wears is drawn once at boot into canvases, so the game
 * ships with no binary art. Each surface produces a matched pair: an albedo
 * map and a normal map derived from a grayscale height pass. The normals are
 * what make the PBR pass read as brick, glass mullions and worn asphalt
 * rather than flat printed colour.
 */

export interface SurfaceMaps {
  albedo: DynamicTexture;
  normal: DynamicTexture;
  emissive?: DynamicTexture;
  roughness?: DynamicTexture;
  /** Metres covered by one tile, so UVs can be scaled to real-world size. */
  tileMeters: number;
}

interface Painter {
  albedo: CanvasRenderingContext2D;
  height: CanvasRenderingContext2D;
  size: number;
}

function scratch(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is unavailable; textures cannot be painted.");
  return ctx;
}

function beginPaint(size: number): Painter {
  const albedo = scratch(size, size);
  const height = scratch(size, size);
  height.fillStyle = "#808080";
  height.fillRect(0, 0, size, size);
  return { albedo, height, size };
}

function publish(
  scene: Scene,
  name: string,
  painter: Painter,
  tileMeters: number,
  normalStrength: number,
): SurfaceMaps {
  const albedo = new DynamicTexture(`${name}-albedo`, { width: painter.size, height: painter.size }, scene, true);
  const albedoCtx = albedo.getContext() as unknown as CanvasRenderingContext2D;
  albedoCtx.drawImage(painter.albedo.canvas, 0, 0);
  albedo.update(true);
  configure(albedo);

  const normal = heightToNormal(scene, `${name}-normal`, painter.height, normalStrength);
  configure(normal);

  return { albedo, normal, tileMeters };
}

function configure(texture: DynamicTexture): void {
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
}

/** Sobel the grayscale height pass into a tangent-space normal map. */
function heightToNormal(
  scene: Scene,
  name: string,
  source: CanvasRenderingContext2D,
  strength: number,
): DynamicTexture {
  const size = source.canvas.width;
  const src = source.getImageData(0, 0, size, size).data;
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const out = ctx.createImageData(size, size);
  const data = out.data;

  const at = (x: number, y: number): number => {
    // Wrap so tiling seams stay invisible.
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return (src[(wy * size + wx) * 4] ?? 128) / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;

      const index = (y * size + x) * 4;
      data[index] = (nx * 0.5 + 0.5) * 255;
      data[index + 1] = (ny * 0.5 + 0.5) * 255;
      data[index + 2] = (nz / length) * 0.5 * 255 + 127.5;
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  texture.update(true);
  texture.gammaSpace = false;
  return texture;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  colors: string[],
  maxAlpha: number,
  rng: Rng,
  maxSize = 3,
): void {
  for (let i = 0; i < count; i += 1) {
    const color = colors[Math.floor(rng() * colors.length)] ?? "#000000";
    ctx.globalAlpha = 0.02 + rng() * maxAlpha;
    ctx.fillStyle = color;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * maxSize, 1 + rng() * maxSize);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* Facades                                                             */
/* ------------------------------------------------------------------ */

export interface FacadeStyle {
  id: string;
  wall: string;
  streak: string;
  glassTop: string;
  glassBottom: string;
  frame: string;
  litColor: string;
  litChance: number;
  rows: number;
  cols: number;
  windowWidth: number;
  windowHeight: number;
  /** PBR roughness for the whole facade; glass towers read much sharper. */
  roughness: number;
  metallic: number;
  spandrel?: string;
  brick?: boolean;
  ribbon?: boolean;
  /** Ground-floor awnings and shopfront colour, for low-rise blocks. */
  storefront?: string;
}

export const FACADE_STYLES: FacadeStyle[] = [
  {
    id: "glass-tower",
    wall: "#477b84",
    streak: "#284f5b",
    glassTop: "#9ec6ce",
    glassBottom: "#305965",
    frame: "#364f58",
    litColor: "#ffd9a0",
    litChance: 0.06,
    rows: 8,
    cols: 10,
    windowWidth: 0.94,
    windowHeight: 0.74,
    roughness: 0.16,
    metallic: 0.28,
    spandrel: "#314c57",
  },
  {
    id: "concrete-block",
    wall: "#b8b3a3",
    streak: "#8b8170",
    glassTop: "#5b6b78",
    glassBottom: "#2b333b",
    frame: "#6f6657",
    litColor: "#ffe3ae",
    litChance: 0.07,
    rows: 8,
    cols: 8,
    windowWidth: 0.56,
    windowHeight: 0.52,
    roughness: 0.84,
    metallic: 0.02,
  },
  {
    id: "brick-mid",
    wall: "#985b46",
    streak: "#683c32",
    glassTop: "#4c5a64",
    glassBottom: "#262e35",
    frame: "#4a3229",
    litColor: "#ffdda2",
    litChance: 0.09,
    rows: 8,
    cols: 7,
    windowWidth: 0.5,
    windowHeight: 0.58,
    roughness: 0.92,
    metallic: 0,
    brick: true,
    storefront: "#2f3a35",
  },
  {
    id: "panel-dark",
    wall: "#344e61",
    streak: "#33383d",
    glassTop: "#7e97a8",
    glassBottom: "#233b4b",
    frame: "#2b3238",
    litColor: "#ffd9a0",
    litChance: 0.05,
    rows: 8,
    cols: 1,
    windowWidth: 1,
    windowHeight: 0.55,
    roughness: 0.42,
    metallic: 0.16,
    ribbon: true,
  },
  {
    id: "sandstone-deco",
    wall: "#b9a184",
    streak: "#98815f",
    glassTop: "#5d6b72",
    glassBottom: "#2a3238",
    frame: "#7d6b4f",
    litColor: "#ffe6b6",
    litChance: 0.08,
    rows: 8,
    cols: 6,
    windowWidth: 0.44,
    windowHeight: 0.62,
    roughness: 0.88,
    metallic: 0.01,
    storefront: "#3a3128",
  },
  {
    id: "institute-white",
    wall: "#d3d6d8",
    streak: "#b0b6b9",
    glassTop: "#9fc4d8",
    glassBottom: "#3f5c6d",
    frame: "#8d9498",
    litColor: "#cfe9ff",
    litChance: 0.22,
    rows: 6,
    cols: 9,
    windowWidth: 0.96,
    windowHeight: 0.66,
    roughness: 0.3,
    metallic: 0.1,
    spandrel: "#b9bfc2",
  },
];

/** Metres covered by one facade tile in both directions (8 floors at 3.6 m). */
export const FACADE_TILE_METERS = 28.8;

export function createFacadeMaps(scene: Scene, style: FacadeStyle, rng: Rng): SurfaceMaps {
  const painter = beginPaint(512);
  const { albedo: ctx, height: hgt, size } = painter;

  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, size, size);

  if (style.brick) {
    // Running-bond courses: alternate rows offset by half a brick.
    const course = 7;
    const brick = 26;
    for (let y = 0, row = 0; y < size; y += course, row += 1) {
      const offset = row % 2 === 0 ? 0 : brick * 0.5;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = style.streak;
      ctx.fillRect(0, y, size, 1.2);
      hgt.fillStyle = "#4c4c4c";
      hgt.fillRect(0, y, size, 1.6);
      ctx.globalAlpha = 1;
      for (let x = offset; x < size; x += brick) {
        hgt.fillStyle = "#4c4c4c";
        hgt.fillRect(x, y, 1.4, course);
        ctx.globalAlpha = 0.05 + rng() * 0.09;
        ctx.fillStyle = rng() < 0.5 ? "#000000" : "#ffffff";
        ctx.fillRect(x + 1, y + 1, brick - 2, course - 2);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Weathering streaks running down from the window heads.
  for (let i = 0; i < 30; i += 1) {
    ctx.globalAlpha = 0.03 + rng() * 0.05;
    ctx.fillStyle = rng() < 0.62 ? style.streak : "#ffffff";
    const x = rng() * size;
    ctx.fillRect(x, 0, 2 + rng() * 9, size);
  }
  ctx.globalAlpha = 1;

  // Separate masks keep masonry dark and matte while windows reflect the sky.
  const emission = scratch(size, size);
  emission.fillStyle = "#000000"; emission.fillRect(0, 0, size, size);
  const roughness = scratch(size, size);
  roughness.fillStyle = "#dddddd"; roughness.fillRect(0, 0, size, size);
  const cellW = size / style.cols;
  const cellH = size / style.rows;

  for (let row = 0; row < style.rows; row += 1) {
    if (style.spandrel) {
      ctx.fillStyle = style.spandrel;
      ctx.fillRect(0, row * cellH, size, cellH * 0.24);
      hgt.fillStyle = "#9a9a9a";
      hgt.fillRect(0, row * cellH, size, cellH * 0.24);
    }

    for (let col = 0; col < style.cols; col += 1) {
      const winW = cellW * style.windowWidth;
      const winH = cellH * style.windowHeight;
      const x = col * cellW + (cellW - winW) * 0.5;
      const y = row * cellH + cellH - winH - cellH * 0.14;

      // Frames sit proud of the wall; glass sits recessed.
      ctx.fillStyle = style.frame;
      ctx.fillRect(x - 2.5, y - 2.5, winW + 5, winH + 5);
      hgt.fillStyle = "#a8a8a8";
      hgt.fillRect(x - 2.5, y - 2.5, winW + 5, winH + 5);

      const glass = ctx.createLinearGradient(0, y, 0, y + winH);
      glass.addColorStop(0, style.glassTop);
      glass.addColorStop(1, style.glassBottom);
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, winW, winH);
      hgt.fillStyle = "#5a5a5a";
      hgt.fillRect(x, y, winW, winH);

      roughness.fillStyle = "#303030";
      roughness.fillRect(x, y, winW, winH);

      // Per-pane exposure variation sells "many separate windows".
      ctx.globalAlpha = rng() * 0.24;
      ctx.fillStyle = rng() < 0.5 ? "#0c1117" : "#dfe9ef";
      ctx.fillRect(x, y, winW, winH);
      ctx.globalAlpha = 1;

      if (rng() < style.litChance) {
        ctx.globalAlpha = 0.85;
        emission.fillStyle = style.litColor;
        emission.fillRect(x, y, winW, winH);
        // A dark lower strip suggests an occupied room behind the glass.
        emission.fillStyle = "#000000";
        emission.fillRect(x, y + winH * 0.72, winW, winH * 0.08);
        ctx.fillStyle = style.litColor;
        ctx.fillRect(x, y, winW, winH);
        ctx.globalAlpha = 1;
      }

      // Mullions inside wide panes.
      const mullions = style.ribbon ? 16 : Math.max(0, Math.round(winW / 26) - 1);
      for (let m = 1; m <= mullions; m += 1) {
        const mx = x + (winW * m) / (mullions + 1);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = style.frame;
        ctx.fillRect(mx - 1, y, 2, winH);
        ctx.globalAlpha = 1;
        hgt.fillStyle = "#8e8e8e";
        hgt.fillRect(mx - 1, y, 2, winH);
        emission.fillStyle = "#000000";
        emission.fillRect(mx - 1, y, 2, winH);
      }
    }
  }

  if (style.storefront) {
    // Bottom eighth of the tile becomes a shopfront band with awnings.
    const bandY = size - cellH;
    ctx.fillStyle = style.storefront;
    ctx.fillRect(0, bandY, size, cellH);
    hgt.fillStyle = "#8c8c8c";
    hgt.fillRect(0, bandY, size, cellH * 0.2);
    for (let x = 0; x < size; x += 64) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = rng() < 0.5 ? "#8d3a34" : "#2f4a55";
      ctx.fillRect(x + 4, bandY + 4, 56, 12);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "#111619";
      ctx.fillRect(x + 8, bandY + 20, 48, cellH - 28);
      ctx.globalAlpha = 1;
    }
  }

  speckle(ctx, size, 1100, [style.streak, "#000000", "#ffffff"], 0.05, rng, 2);
  speckle(hgt, size, 2400, ["#7a7a7a", "#868686"], 0.35, rng, 2);

  // Plain corner patches: box roofs sample uv (0..0.035) so they read as bare
  // concrete instead of a smear of windows.
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(0, size - 32, 32, 32);
  hgt.fillStyle = "#808080";
  hgt.fillRect(0, 0, 32, 32);
  hgt.fillRect(0, size - 32, 32, 32);

  const maps = publish(scene, `facade-${style.id}`, painter, FACADE_TILE_METERS, 1.25);
  for (const ctx of [emission, roughness]) {
    ctx.fillStyle = ctx === emission ? "#000000" : "#dddddd";
    ctx.fillRect(0, 0, 32, 32); ctx.fillRect(0, size - 32, 32, 32);
  }
  maps.emissive = publishMask(scene, `facade-${style.id}-emission`, emission, true);
  maps.roughness = publishMask(scene, `facade-${style.id}-roughness`, roughness, false);
  return maps;
}

/* ------------------------------------------------------------------ */
/* Ground surfaces                                                     */
/* ------------------------------------------------------------------ */

/** Metres covered by one road tile: exactly one block pitch, roads on the edges. */
export const ROAD_TILE_METERS = 150;

export function createRoadMaps(scene: Scene, rng: Rng, roadHalfMeters: number): SurfaceMaps {
  const painter = beginPaint(1024);
  const { albedo: ctx, height: hgt, size } = painter;
  const pxPerM = size / ROAD_TILE_METERS;

  ctx.fillStyle = "#353e45";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 6400, ["#54575a", "#3b3d40", "#616567", "#343638"], 0.09, rng, 3);
  speckle(hgt, size, 9000, ["#6e6e6e", "#8e8e8e", "#767676"], 0.5, rng, 3);

  // Patches of repaired asphalt and long crack lines.
  for (let i = 0; i < 30; i += 1) {
    ctx.globalAlpha = 0.05 + rng() * 0.07;
    ctx.fillStyle = rng() < 0.5 ? "#202224" : "#3d4042";
    ctx.fillRect(rng() * size, rng() * size, 24 + rng() * 96, 18 + rng() * 74);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "rgba(24, 25, 27, 0.5)";
  hgt.strokeStyle = "#5c5c5c";
  for (let i = 0; i < 22; i += 1) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    hgt.beginPath();
    ctx.moveTo(x, y);
    hgt.moveTo(x, y);
    for (let step = 0; step < 6; step += 1) {
      x += (rng() - 0.5) * 90;
      y += (rng() - 0.5) * 90;
      ctx.lineTo(x, y);
      hgt.lineTo(x, y);
    }
    ctx.lineWidth = 1 + rng();
    hgt.lineWidth = 1.5 + rng();
    ctx.stroke();
    hgt.stroke();
  }

  const roadHalf = roadHalfMeters * pxPerM;
  const marking = "rgba(214, 216, 210, 0.62)";
  const dashW = Math.max(2, 0.35 * pxPerM);

  // Centre dashes on both road axes; tile edges wrap into one continuous line.
  ctx.fillStyle = marking;
  for (let at = roadHalf + 10; at < size - roadHalf - 30; at += 62) {
    ctx.fillRect(0, at, dashW * 0.5, 22);
    ctx.fillRect(size - dashW * 0.5, at, dashW * 0.5, 22);
    ctx.fillRect(at, 0, 22, dashW * 0.5);
    ctx.fillRect(at, size - dashW * 0.5, 22, dashW * 0.5);
  }

  // Solid gutter lines just inside each kerb.
  const gutter = (roadHalfMeters - 1.5) * pxPerM;
  ctx.globalAlpha = 0.42;
  ctx.fillRect(gutter, roadHalf, 2, size - roadHalf * 2);
  ctx.fillRect(size - gutter, roadHalf, 2, size - roadHalf * 2);
  ctx.fillRect(roadHalf, gutter, size - roadHalf * 2, 2);
  ctx.fillRect(roadHalf, size - gutter, size - roadHalf * 2, 2);
  ctx.globalAlpha = 1;

  // Crosswalks on every intersection approach.
  const zebra = (x: number, y: number, w: number, h: number, vertical: boolean): void => {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "rgba(208, 210, 204, 0.82)";
    if (vertical) {
      for (let sy = y; sy < y + h - 3; sy += 9) {
        ctx.fillRect(x, sy, w, 4.5);
        hgt.fillStyle = "#8a8a8a";
        hgt.fillRect(x, sy, w, 4.5);
      }
    } else {
      for (let sx = x; sx < x + w - 3; sx += 9) {
        ctx.fillRect(sx, y, 4.5, h);
        hgt.fillStyle = "#8a8a8a";
        hgt.fillRect(sx, y, 4.5, h);
      }
    }
    ctx.globalAlpha = 1;
  };
  const depth = 3.2 * pxPerM;
  zebra(0, roadHalf + 4, roadHalf, depth, false);
  zebra(size - roadHalf, roadHalf + 4, roadHalf, depth, false);
  zebra(0, size - roadHalf - depth - 4, roadHalf, depth, false);
  zebra(size - roadHalf, size - roadHalf - depth - 4, roadHalf, depth, false);
  zebra(roadHalf + 4, 0, depth, roadHalf, true);
  zebra(roadHalf + 4, size - roadHalf, depth, roadHalf, true);
  zebra(size - roadHalf - depth - 4, 0, depth, roadHalf, true);
  zebra(size - roadHalf - depth - 4, size - roadHalf, depth, roadHalf, true);

  // Paint lanes at real metre scale; no extra RNG is consumed, keeping the
  // legacy city’s seeded layout stable. Amber paired centrelines separate
  // the carriageways; blue-green edge lanes establish a legible road hierarchy.
  ctx.fillStyle = "rgba(226,180,87,0.8)";
  for (const offset of [1.2, size - 3.2]) {
    ctx.fillRect(offset, roadHalf + 42, 2, size - roadHalf * 2 - 84);
    ctx.fillRect(roadHalf + 42, offset, size - roadHalf * 2 - 84, 2);
  }
  ctx.fillStyle = "rgba(67,115,114,0.48)";
  const cycle = 2.2 * pxPerM;
  for (const edge of [roadHalf - cycle - 8, size - roadHalf + 8]) {
    ctx.fillRect(edge, roadHalf + 42, cycle, size - roadHalf * 2 - 84);
    ctx.fillRect(roadHalf + 42, edge, size - roadHalf * 2 - 84, cycle);
  }
  ctx.fillStyle = "rgba(226,229,215,0.72)";
  for (const x of [roadHalf * 0.4, size - roadHalf * 0.4]) {
    for (const y of [size * 0.3, size * 0.7]) {
      ctx.fillRect(x - 1.5, y - 11, 3, 22);
      ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x - 5, y - 8); ctx.lineTo(x + 5, y - 8); ctx.fill();
    }
  }
  return publish(scene, "road", painter, ROAD_TILE_METERS, 0.65);
}

export const SIDEWALK_TILE_METERS = 8;

export function createSidewalkMaps(scene: Scene, rng: Rng): SurfaceMaps {
  const painter = beginPaint(512);
  const { albedo: ctx, height: hgt, size } = painter;

  ctx.fillStyle = "#b2b0a4";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 4000, ["#7d7b74", "#a09e96", "#6b6963"], 0.08, rng, 2);
  speckle(hgt, size, 5200, ["#787878", "#8a8a8a"], 0.4, rng, 2);

  for (let i = 0; i < 22; i += 1) {
    ctx.globalAlpha = 0.03 + rng() * 0.045;
    ctx.fillStyle = "#5f5d57";
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 12 + rng() * 46, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 2 m slab joints, cut into both albedo and height.
  ctx.fillStyle = "rgba(40, 40, 38, 0.34)";
  hgt.fillStyle = "#4a4a4a";
  for (let line = 0; line <= size; line += size / 4) {
    ctx.fillRect(line - 1, 0, 2, size);
    ctx.fillRect(0, line - 1, size, 2);
    hgt.fillRect(line - 1.5, 0, 3, size);
    hgt.fillRect(0, line - 1.5, size, 3);
  }

  return publish(scene, "sidewalk", painter, SIDEWALK_TILE_METERS, 1.5);
}

export const GRASS_TILE_METERS = 8;

export function createGrassMaps(scene: Scene, rng: Rng): SurfaceMaps {
  const painter = beginPaint(512);
  const { albedo: ctx, height: hgt, size } = painter;

  ctx.fillStyle = "#596f42";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 7600, ["#41582a", "#5b7439", "#68804a", "#39501f"], 0.16, rng, 3);
  speckle(hgt, size, 9000, ["#6a6a6a", "#969696"], 0.55, rng, 3);

  for (let i = 0; i < 16; i += 1) {
    ctx.globalAlpha = 0.04 + rng() * 0.05;
    ctx.fillStyle = rng() < 0.4 ? "#6f6a4a" : "#3a5122";
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 18 + rng() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  return publish(scene, "grass", painter, GRASS_TILE_METERS, 1.1);
}

export const WATER_TILE_METERS = 40;

export function createWaterMaps(scene: Scene, rng: Rng): SurfaceMaps {
  const painter = beginPaint(512);
  const { albedo: ctx, height: hgt, size } = painter;

  ctx.fillStyle = "#335c68";
  ctx.fillRect(0, 0, size, size);

  // Overlapping sine bands make a cheap but convincing chop.
  for (let i = 0; i < 220; i += 1) {
    const y = rng() * size;
    const amplitude = 3 + rng() * 9;
    const wavelength = 40 + rng() * 120;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    hgt.beginPath();
    for (let x = 0; x <= size; x += 4) {
      const wy = y + Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude;
      if (x === 0) {
        ctx.moveTo(x, wy);
        hgt.moveTo(x, wy);
      } else {
        ctx.lineTo(x, wy);
        hgt.lineTo(x, wy);
      }
    }
    ctx.strokeStyle = rng() < 0.5 ? "rgba(150, 178, 194, 0.12)" : "rgba(18, 26, 33, 0.18)";
    ctx.lineWidth = 1 + rng() * 2;
    ctx.stroke();
    hgt.strokeStyle = rng() < 0.5 ? "#9c9c9c" : "#606060";
    hgt.lineWidth = 2 + rng() * 3;
    hgt.stroke();
  }

  return publish(scene, "water", painter, WATER_TILE_METERS, 2.2);
}

export const METAL_TILE_METERS = 4;

export function createMetalMaps(scene: Scene, rng: Rng): SurfaceMaps {
  const painter = beginPaint(256);
  const { albedo: ctx, height: hgt, size } = painter;

  ctx.fillStyle = "#3c4045";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 2600, ["#4a4f55", "#2f3338", "#565b61"], 0.12, rng, 2);
  speckle(hgt, size, 3400, ["#767676", "#8c8c8c"], 0.4, rng, 2);

  // Panel seams and rivet lines.
  for (let x = 0; x <= size; x += size / 4) {
    hgt.fillStyle = "#525252";
    hgt.fillRect(x - 1, 0, 2, size);
    ctx.fillStyle = "rgba(20, 22, 24, 0.35)";
    ctx.fillRect(x - 1, 0, 2, size);
    for (let y = 8; y < size; y += 18) {
      hgt.fillStyle = "#b4b4b4";
      hgt.beginPath();
      hgt.arc(x + 5, y, 1.8, 0, Math.PI * 2);
      hgt.fill();
    }
  }

  return publish(scene, "metal", painter, METAL_TILE_METERS, 1.6);
}

/* ------------------------------------------------------------------ */
/* Sky and sprites                                                     */
/* ------------------------------------------------------------------ */

export interface SkyStop {
  at: number;
  color: string;
}

/** Vertical sky gradient sampled by the inverted sky dome. */
export function createSkyGradient(scene: Scene, stops: SkyStop[], name = "sky-gradient"): DynamicTexture {
  const width = 64;
  const height = 512;
  const texture = new DynamicTexture(name, { width, height }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  for (const stop of stops) gradient.addColorStop(stop.at, stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

export function createGlowSprite(
  scene: Scene,
  name: string,
  inner: string,
  mid: string,
  midStop: number,
): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(midStop, mid);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

export function createCloudSprite(scene: Scene, rng: Rng): DynamicTexture {
  const width = 512;
  const height = 256;
  const texture = new DynamicTexture("cloud-sprite", { width, height }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < 30; i += 1) {
    const x = width * (0.18 + rng() * 0.64);
    const y = height * (0.3 + rng() * 0.4);
    const radius = 26 + rng() * 70;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.05 + rng() * 0.1;
    gradient.addColorStop(0, `rgba(252, 252, 250, ${alpha})`);
    gradient.addColorStop(0.7, `rgba(244, 246, 246, ${alpha * 0.5})`);
    gradient.addColorStop(1, "rgba(244, 246, 246, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

/** Soft radial blob used for ground contact shading and impact decals. */
export function createSoftDisc(scene: Scene, name: string, color: string): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.55, color.replace(/[\d.]+\)$/, "0.35)"));
  gradient.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

/**
 * Vertical light-beam sprite for objective markers: bright and wide at the
 * base, fading out with height and softly at the edges. A billboarded quad
 * carrying this never shows interior geometry the way a cylinder does.
 */
export function createBeamSprite(scene: Scene): DynamicTexture {
  const width = 128;
  const height = 256;
  const texture = new DynamicTexture("beam-sprite", { width, height }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, width, height);

  for (let y = 0; y < height; y += 1) {
    // Falls off toward the top of the beam.
    const vertical = Math.pow(1 - y / height, 1.7);
    const gradient = ctx.createLinearGradient(0, y, width, y);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${(0.85 * vertical).toFixed(3)})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, width, 1);
  }

  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

/** Streaky spark texture for the speed trail and lightning particles. */
export function createSparkSprite(scene: Scene): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture("spark-sprite", { width: size, height: size }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);

  const gradient = ctx.createLinearGradient(0, size / 2, size, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(0.35, "rgba(255, 236, 196, 0.85)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.68, "rgba(255, 214, 140, 0.7)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, size * 0.42, size, size * 0.16);

  const halo = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  halo.addColorStop(0, "rgba(255, 240, 210, 0.5)");
  halo.addColorStop(1, "rgba(255, 240, 210, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

/** Emissive signage painted for a named landmark facade. */
export function createSignTexture(
  scene: Scene,
  name: string,
  label: string,
  sub: string,
  accent: string,
): DynamicTexture {
  const width = 1024;
  const height = 256;
  const texture = new DynamicTexture(name, { width, height }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  ctx.fillStyle = "#0d1013";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, height - 12, width, 12);

  ctx.fillStyle = "#f2f4f5";
  ctx.font = "800 108px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.toUpperCase(), width / 2, height * 0.42);

  ctx.fillStyle = accent;
  ctx.font = "600 34px Inter, system-ui, sans-serif";
  ctx.fillText(sub.toUpperCase(), width / 2, height * 0.74);

  texture.coordinatesMode = Constants.TEXTURE_EXPLICIT_MODE;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.update();
  return texture;
}

function publishMask(scene: Scene, name: string, source: CanvasRenderingContext2D, gamma: boolean): DynamicTexture {
  const texture = new DynamicTexture(name, source.canvas.width, scene, true);
  texture.getContext().drawImage(source.canvas, 0, 0);
  texture.update(true);
  configure(texture);
  texture.gammaSpace = gamma;
  return texture;
}
