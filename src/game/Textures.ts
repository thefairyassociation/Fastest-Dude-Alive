import { DynamicTexture, Scene, Texture } from "@babylonjs/core";

export type Rng = () => number;

/**
 * Procedural texture painters. Everything is drawn once at boot into
 * DynamicTextures so the game stays asset-free while still reading as a
 * real city: glass curtain walls, punched concrete windows, brick, asphalt
 * with lane markings, concrete sidewalk slabs, and grass.
 */

function createTexture(
  scene: Scene,
  name: string,
  width: number,
  height: number,
): { texture: DynamicTexture; ctx: CanvasRenderingContext2D } {
  const texture = new DynamicTexture(name, { width, height }, scene, true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  return { texture, ctx };
}

function speckle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number,
  colors: string[],
  maxAlpha: number,
  rng: Rng,
  maxSize = 3,
): void {
  for (let i = 0; i < count; i += 1) {
    const color = colors[Math.floor(rng() * colors.length)] ?? colors[0] ?? "#000000";
    ctx.globalAlpha = 0.02 + rng() * maxAlpha;
    ctx.fillStyle = color;
    ctx.fillRect(rng() * width, rng() * height, 1 + rng() * maxSize, 1 + rng() * maxSize);
  }
  ctx.globalAlpha = 1;
}

export interface FacadeStyle {
  name: string;
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
  spandrel?: string;
  brick?: boolean;
  ribbon?: boolean;
}

export const FACADE_STYLES: FacadeStyle[] = [
  {
    name: "glass-tower",
    wall: "#5a6570",
    streak: "#3f4952",
    glassTop: "#aac3d6",
    glassBottom: "#4a5c6c",
    frame: "#39424b",
    litColor: "#ffd9a0",
    litChance: 0.05,
    rows: 8,
    cols: 10,
    windowWidth: 0.92,
    windowHeight: 0.72,
    spandrel: "#333c44",
  },
  {
    name: "concrete-block",
    wall: "#aca28f",
    streak: "#8d8371",
    glassTop: "#5b6b78",
    glassBottom: "#2b333b",
    frame: "#6f6657",
    litColor: "#ffe3ae",
    litChance: 0.06,
    rows: 8,
    cols: 8,
    windowWidth: 0.58,
    windowHeight: 0.52,
  },
  {
    name: "brick-mid",
    wall: "#7c5242",
    streak: "#5f3d31",
    glassTop: "#4c5a64",
    glassBottom: "#262e35",
    frame: "#4a3229",
    litColor: "#ffdda2",
    litChance: 0.07,
    rows: 8,
    cols: 7,
    windowWidth: 0.52,
    windowHeight: 0.58,
    brick: true,
  },
  {
    name: "panel-dark",
    wall: "#43484e",
    streak: "#33383d",
    glassTop: "#7e97a8",
    glassBottom: "#232c34",
    frame: "#2b3238",
    litColor: "#ffd9a0",
    litChance: 0.04,
    rows: 8,
    cols: 1,
    windowWidth: 1,
    windowHeight: 0.55,
    ribbon: true,
  },
];

/** Meters covered by one facade texture tile in both directions (8 floors). */
export const FACADE_TILE_METERS = 28.8;

export function createFacadeTexture(scene: Scene, style: FacadeStyle, rng: Rng): DynamicTexture {
  const size = 512;
  const { texture, ctx } = createTexture(scene, `facade-${style.name}`, size, size);

  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, size, size);

  if (style.brick) {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = style.streak;
    for (let y = 0; y < size; y += 5) ctx.fillRect(0, y, size, 1);
    ctx.globalAlpha = 1;
  }

  // Weathering streaks.
  for (let i = 0; i < 26; i += 1) {
    ctx.globalAlpha = 0.03 + rng() * 0.05;
    ctx.fillStyle = rng() < 0.6 ? style.streak : "#ffffff";
    const x = rng() * size;
    ctx.fillRect(x, 0, 2 + rng() * 9, size);
  }
  ctx.globalAlpha = 1;

  const cellW = size / style.cols;
  const cellH = size / style.rows;

  for (let row = 0; row < style.rows; row += 1) {
    if (style.spandrel) {
      ctx.fillStyle = style.spandrel;
      ctx.fillRect(0, row * cellH, size, cellH * 0.24);
    }

    for (let col = 0; col < style.cols; col += 1) {
      const winW = cellW * style.windowWidth;
      const winH = cellH * style.windowHeight;
      const x = col * cellW + (cellW - winW) * 0.5;
      const y = row * cellH + cellH - winH - cellH * 0.14;

      ctx.fillStyle = style.frame;
      ctx.fillRect(x - 2, y - 2, winW + 4, winH + 4);

      const glass = ctx.createLinearGradient(0, y, 0, y + winH);
      glass.addColorStop(0, style.glassTop);
      glass.addColorStop(1, style.glassBottom);
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, winW, winH);

      // Slight per-window exposure variation sells "many separate panes".
      ctx.globalAlpha = rng() * 0.22;
      ctx.fillStyle = rng() < 0.5 ? "#0c1117" : "#dfe9ef";
      ctx.fillRect(x, y, winW, winH);
      ctx.globalAlpha = 1;

      if (rng() < style.litChance) {
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = style.litColor;
        ctx.fillRect(x, y, winW, winH);
        ctx.globalAlpha = 1;
      }

      if (style.ribbon) {
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = style.frame;
        for (let mx = 24; mx < size; mx += 32) ctx.fillRect(mx, y, 2, winH);
        ctx.globalAlpha = 1;
      }
    }
  }

  speckle(ctx, size, size, 900, [style.streak, "#000000", "#ffffff"], 0.05, rng, 2);

  // Plain corner patches; box roofs sample uv (0..0.03) so they read as
  // bare wall-colored concrete instead of a smear of windows.
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, 30, 30);
  ctx.fillRect(0, size - 30, 30, 30);

  texture.update();
  return texture;
}

/** Meters covered by one road tile: exactly one block pitch, roads on the edges. */
export const ROAD_TILE_METERS = 150;

export function createRoadTexture(scene: Scene, rng: Rng): DynamicTexture {
  const size = 1024;
  const pxPerM = size / ROAD_TILE_METERS;
  const { texture, ctx } = createTexture(scene, "road-tile", size, size);

  ctx.fillStyle = "#47494b";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 5200, ["#55585a", "#3d3f41", "#616567", "#363839"], 0.09, rng, 3);

  // Patches of repaired asphalt.
  for (let i = 0; i < 24; i += 1) {
    ctx.globalAlpha = 0.05 + rng() * 0.06;
    ctx.fillStyle = rng() < 0.5 ? "#202224" : "#3d4042";
    ctx.fillRect(rng() * size, rng() * size, 24 + rng() * 90, 18 + rng() * 70);
  }
  ctx.globalAlpha = 1;

  const roadHalf = 20 * pxPerM; // roads are 40 m wide, centered on tile edges
  const marking = "rgba(208, 210, 204, 0.6)";
  const dashW = Math.max(2, 0.35 * pxPerM);
  const clearOfIntersections = (fn: (at: number) => void): void => {
    for (let at = roadHalf + 10; at < size - roadHalf - 30; at += 62) fn(at);
  };

  // Center dashes along both vertical roads (tile edges wrap into one line).
  ctx.fillStyle = marking;
  clearOfIntersections((y) => {
    ctx.fillRect(0, y, dashW * 0.5, 22);
    ctx.fillRect(size - dashW * 0.5, y, dashW * 0.5, 22);
    ctx.fillRect(y, 0, 22, dashW * 0.5);
    ctx.fillRect(y, size - dashW * 0.5, 22, dashW * 0.5);
  });

  // Solid gutter lines 18.5 m out from each road center.
  const gutter = 18.5 * pxPerM;
  ctx.globalAlpha = 0.42;
  ctx.fillRect(gutter, roadHalf, 2, size - roadHalf * 2);
  ctx.fillRect(size - gutter, roadHalf, 2, size - roadHalf * 2);
  ctx.fillRect(roadHalf, gutter, size - roadHalf * 2, 2);
  ctx.fillRect(roadHalf, size - gutter, size - roadHalf * 2, 2);
  ctx.globalAlpha = 1;

  // Crosswalks at every intersection approach.
  const zebra = (x: number, y: number, w: number, h: number, vertical: boolean): void => {
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = "rgba(206, 208, 202, 0.8)";
    if (vertical) {
      for (let sy = y; sy < y + h - 3; sy += 9) ctx.fillRect(x, sy, w, 4.5);
    } else {
      for (let sx = x; sx < x + w - 3; sx += 9) ctx.fillRect(sx, y, 4.5, h);
    }
    ctx.globalAlpha = 1;
  };
  const depth = 3.2 * pxPerM;
  // Vertical roads (x near 0 / size): crosswalks just outside each intersection.
  zebra(0, roadHalf + 4, roadHalf, depth, false);
  zebra(size - roadHalf, roadHalf + 4, roadHalf, depth, false);
  zebra(0, size - roadHalf - depth - 4, roadHalf, depth, false);
  zebra(size - roadHalf, size - roadHalf - depth - 4, roadHalf, depth, false);
  // Horizontal roads.
  zebra(roadHalf + 4, 0, depth, roadHalf, true);
  zebra(roadHalf + 4, size - roadHalf, depth, roadHalf, true);
  zebra(size - roadHalf - depth - 4, 0, depth, roadHalf, true);
  zebra(size - roadHalf - depth - 4, size - roadHalf, depth, roadHalf, true);

  texture.update();
  return texture;
}

/** Meters covered by one sidewalk tile (four 2 m slabs). */
export const SIDEWALK_TILE_METERS = 8;

export function createSidewalkTexture(scene: Scene, rng: Rng): DynamicTexture {
  const size = 512;
  const { texture, ctx } = createTexture(scene, "sidewalk-tile", size, size);

  ctx.fillStyle = "#8f8d86";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 3200, ["#7d7b74", "#a09e96", "#6b6963"], 0.08, rng, 2);

  for (let i = 0; i < 18; i += 1) {
    ctx.globalAlpha = 0.03 + rng() * 0.04;
    ctx.fillStyle = "#5f5d57";
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 12 + rng() * 46, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(40, 40, 38, 0.32)";
  for (let line = 0; line <= size; line += size / 4) {
    ctx.fillRect(line - 1, 0, 2, size);
    ctx.fillRect(0, line - 1, size, 2);
  }

  texture.update();
  return texture;
}

export const GRASS_TILE_METERS = 8;

export function createGrassTexture(scene: Scene, rng: Rng): DynamicTexture {
  const size = 512;
  const { texture, ctx } = createTexture(scene, "grass-tile", size, size);

  ctx.fillStyle = "#4d6532";
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 6400, ["#41582a", "#5b7439", "#68804a", "#39501f"], 0.16, rng, 3);

  for (let i = 0; i < 14; i += 1) {
    ctx.globalAlpha = 0.04 + rng() * 0.05;
    ctx.fillStyle = rng() < 0.4 ? "#6f6a4a" : "#3a5122";
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 18 + rng() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  texture.update();
  return texture;
}

/** Vertical sky gradient sampled by the inverted sky dome. */
export function createSkyGradient(scene: Scene): DynamicTexture {
  const width = 64;
  const height = 512;
  const { texture, ctx } = createTexture(scene, "sky-gradient", width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#2f5c96");
  gradient.addColorStop(0.3, "#5c86b6");
  gradient.addColorStop(0.46, "#9fb9cd");
  gradient.addColorStop(0.53, "#d9dcd2");
  gradient.addColorStop(0.58, "#e4d9bd");
  gradient.addColorStop(0.66, "#c4cdd2");
  gradient.addColorStop(1, "#a9b6bf");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

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
  const { texture, ctx } = createTexture(scene, name, size, size);
  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(midStop, mid);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

export function createCloudSprite(scene: Scene, rng: Rng): DynamicTexture {
  const width = 512;
  const height = 256;
  const { texture, ctx } = createTexture(scene, "cloud-sprite", width, height);
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < 26; i += 1) {
    const x = width * (0.18 + rng() * 0.64);
    const y = height * (0.3 + rng() * 0.4);
    const radius = 26 + rng() * 66;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.05 + rng() * 0.1;
    gradient.addColorStop(0, `rgba(252, 252, 250, ${alpha})`);
    gradient.addColorStop(0.7, `rgba(244, 246, 246, ${alpha * 0.5})`);
    gradient.addColorStop(1, "rgba(244, 246, 246, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  texture.hasAlpha = true;
  texture.update();
  return texture;
}
