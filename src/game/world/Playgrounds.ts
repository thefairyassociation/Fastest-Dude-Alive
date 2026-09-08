import { Vector3, Vector4 } from "@babylonjs/core";
import type { City } from "./City";
import type { BuildContext } from "./Landmarks";
import type { RouteDefinition, RouteGate } from "../activities/RouteRun";

export const PLAYGROUNDS = [
  { id: "crest-circuit", name: "Crest Circuit", x: 300, z: 300 },
  { id: "river-rush", name: "River Rush", x: 975, z: 525 },
  { id: "foundry-flow", name: "Foundry Flow", x: -450, z: -2250 },
] as const;

/** Small additions to existing roofs; original building/RNG streams stay intact. */
export function buildPlaygroundArt(ctx: BuildContext, city: City): void {
  const slab = (x: number, z: number, y: number, w: number, d: number): void => {
    const uv = Array.from({ length: 6 }, () => new Vector4(0, 0, w / 8, d / 8));
    ctx.box("concrete", x, y - 0.4, z, w, 0.8, d, false, uv);
    ctx.solid({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, bottom: y - 0.8, top: y, climbable: true });
    // Flush painted edges show the landing width without snagging the player.
    for (const side of [-1, 1]) ctx.box("cyan-light", x, y + 0.015, z + side * (d / 2 - 0.4), w, 0.03, 0.3, false);
  };
  // A maintenance bridge joins two Crest towers across their internal courtyard.
  const a = city.groundHeight(272, 328, 400), b = city.groundHeight(328, 328, 400);
  const crestY = Math.max(a, b) + 0.08;
  slab(300, 328, crestY, 68, 10);
  // Supports terminate on the existing roofs, making the height difference legible.
  for (const [x, roof] of [[272, a], [328, b]] as const) {
    if (crestY - roof > 0.1) {
      ctx.box("steel", x!, roof! + (crestY - roof!) / 2, 328, 4, crestY - roof!, 8);
      ctx.solid({ minX: x! - 2, maxX: x! + 2, minZ: 324, maxZ: 332, bottom: roof!, top: crestY, climbable: true });
    }
  }
  // Broad riverside takeoff pads remain below the auto-step height.
  for (const z of [525, 975]) slab(975, z, 0.24, 14, 24);
  // Low cargo platforms give the foundry courtyard an optional stepped line.
  for (let i = 0; i < 3; i++) {
    const x = -478 + i * 28, z = -2295;
    const y = 3 + i * 3;
    ctx.box(i % 2 ? "harbor-blue" : "harbor-red", x, y / 2 + 0.42, z, 18, y, 8);
    ctx.solid({ minX: x - 9, maxX: x + 9, minZ: z - 4, maxZ: z + 4, bottom: 0.42, top: y + 0.42, climbable: true });
    for (const side of [-1, 1]) ctx.box("warm-light", x, y + 0.44, z + side * 3.5, 16, 0.04, 0.25);
  }
  for (const p of PLAYGROUNDS) {
    // Broad road arrows, rather than pillars in the running corridor.
    const road = city.nearestRoad(new Vector3(p.x, 0, p.z - 75));
    for (let i = 0; i < 4; i++) ctx.box("cyan-light", road.x, road.y + 0.025, road.z + i * 5, 3 + i, 0.04, 0.6);
  }
}

export function buildPlaygroundRoutes(city: City): RouteDefinition[] {
  const road = (x: number, z: number): RouteGate => ({ position: city.nearestRoad(new Vector3(x, 0, z)), radius: 22 });
  const roof = (x: number, z: number): RouteGate => ({ position: new Vector3(x, city.groundHeight(x, z, 400) + 2, z), radius: 10 });
  const water = (z: number): RouteGate => ({ position: new Vector3(1050, 0.1, z), minSpeed: 40, radius: 24 });
  const laps = (gates: RouteGate[], count: number): RouteGate[] => Array.from({ length: count }, () => gates).flat();
  return [
    { id: "crest-circuit", name: "Crest Circuit", summary: "Two laps: carve the avenue, climb the marked towers and carry speed across the roof bridge.", par: 48,
      gates: laps([road(75, 225), road(225, 225), roof(272, 328), roof(328, 328), road(375, 525), road(-225, 525), road(-225, -225), road(75, -225), road(75, 225)], 2) },
    { id: "river-rush", name: "River Rush", summary: "Two laps: launch from the riverwalk, pass under the bridge and hold pace on the water.", par: 45,
      gates: laps([road(975, 525), water(600), water(900), road(1125, 1125), road(1425, 1125), road(1425, -375), water(-300), water(300), road(975, 525)], 2) },
    { id: "foundry-flow", name: "Foundry Flow", summary: "Three laps: climb the warehouse, link the roof monitors and choose a cargo-yard shortcut.", par: 50,
      gates: laps([road(-525, -2325), roof(-478, -2235), roof(-422, -2235), road(-375, -2175), road(75, -2175), road(75, -2475), road(-525, -2475), road(-525, -2325)], 3) },
  ];
}
