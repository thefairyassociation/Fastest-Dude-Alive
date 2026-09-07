import { Vector3 } from "@babylonjs/core";
import type { City } from "../world/City";
import type { RouteDefinition, RouteGate } from "./RouteRun";

/**
 * Free-roam routes.
 *
 * Built against the live city rather than hard-coded, so gates always land on
 * a real road or a real roof. The three authored routes deliberately test
 * different skills: top speed, held pace across water, and verticality.
 */

function road(city: City, x: number, z: number): Vector3 {
  return city.nearestRoad(new Vector3(x, 0, z));
}

/** Highest surface at a point — used to drop gates onto rooftops. */
function roof(city: City, x: number, z: number, lift = 3): Vector3 {
  return new Vector3(x, city.groundHeight(x, z, 400) + lift, z);
}

export function buildRoutes(city: City): RouteDefinition[] {
  const edge = 1875 - 220; // Original course geometry keeps saved bests comparable.

  const loop: RouteGate[] = [
    { position: road(city, 75, -75) },
    { position: road(city, edge * 0.6, -75) },
    { position: road(city, edge * 0.6, edge * 0.6) },
    { position: road(city, -75, edge * 0.75) },
    { position: road(city, -edge * 0.7, edge * 0.5) },
    { position: road(city, -edge * 0.7, -edge * 0.6) },
    { position: road(city, 75, -edge * 0.75) },
    { position: road(city, 75, -75) },
  ];

  // The river run: two bridges and three long water crossings, all of which
  // punish you for dropping under the water-running threshold.
  const riverX = 7 * 150;
  const riverline: RouteGate[] = [
    { position: road(city, riverX - 150, -900), minSpeed: 40 },
    { position: new Vector3(riverX, 0.1, -600), minSpeed: 48, radius: 22 },
    { position: new Vector3(riverX, 0.1, -150), minSpeed: 52, radius: 22 },
    { position: road(city, riverX + 150, 0), minSpeed: 44 },
    { position: new Vector3(riverX, 0.1, 420), minSpeed: 56, radius: 22 },
    { position: new Vector3(riverX, 0.1, 900), minSpeed: 60, radius: 22 },
    { position: road(city, riverX - 150, 1200), minSpeed: 40 },
  ];

  // The ladder: every gate sits on a roof, so the only way through is wall
  // running and jump chaining.
  const ladder: RouteGate[] = [
    { position: road(city, -178, 178) },
    { position: roof(city, -178, 122), radius: 20 },
    { position: roof(city, -28, 122), radius: 20 },
    { position: roof(city, 122, 178), radius: 20 },
    { position: roof(city, 178, 28), radius: 20 },
    { position: roof(city, 122, -122), radius: 20 },
    { position: roof(city, -28, -178), radius: 20 },
    { position: roof(city, 150, 150, 90), radius: 26 },
  ];

  const docks: RouteGate[] = [
    { position: road(city, 1350, -600), minSpeed: 35 },
    { position: road(city, 1650, -300), minSpeed: 40 },
    { position: road(city, 1350, 150), minSpeed: 45 },
    { position: road(city, 1650, 600), minSpeed: 50 },
    { position: road(city, 1200, 900), minSpeed: 55 },
  ];

  return [
    {
      id: "northline-express", name: "Northline Express",
      summary: "A 4 km express delivery through the northern boroughs. Settle into the long straights.",
      par: 60,
      gates: [[-600, 1950], [-600, 2400], [450, 2400], [900, 2400], [900, 2100], [1500, 2100], [2100, 2100]].map(([x, z]) => ({ position: road(city, x!, z!), radius: 22 })),
    },
    {
      id: "westhaven-circuit", name: "Westhaven Circuit",
      summary: "Reservoir-side switchbacks. Brake before the corner and carry your exit speed.",
      par: 58,
      gates: [[-2250, 750], [-2550, 750], [-2550, 1500], [-2100, 1500], [-2100, 450], [-2550, 450], [-2550, -450], [-2100, -450]].map(([x, z]) => ({ position: road(city, x!, z!), radius: 20 })),
    },
    {
      id: "foundry-night-shift", name: "Foundry Night Shift",
      summary: "Six dispatches across the industrial belt. Each delivery needs more speed.",
      par: 55,
      gates: [[-1500, -2250], [-900, -2250], [-300, -2250], [300, -2250], [900, -2250], [1500, -2250]].map(([x, z], i) => ({ position: road(city, x!, z!), minSpeed: 30 + i * 10, radius: 22 })),
    },
    {
      id: "saltmere-coast", name: "Saltmere Coast",
      summary: "From freight terminal to lighthouse. Follow the east-bank avenues all the way north.",
      par: 65,
      gates: [[2250, -750], [2550, -750], [2550, 0], [2550, 900], [2550, 1500], [2400, 2100]].map(([x, z]) => ({ position: road(city, x!, z!), radius: 24 })),
    },
    {
      id: "five-bridges", name: "Five Bridges",
      summary: "Run the river from south to north. Five bridge approaches; one unbroken line.",
      par: 80,
      gates: [
        { position: road(city, 900, -2250), radius: 22 },
        ...[-1950, -1500, -750, -300, 300, 750, 1500, 1950].map(z => ({ position: new Vector3(1050, 0.1, z), minSpeed: 50, radius: 26 })),
        { position: road(city, 1200, 2250), radius: 22 },
      ],
    },
    {
      id: "meridian-loop",
      name: "Meridian Loop",
      summary: "The long way round the city. Pure top speed.",
      gates: loop,
      par: 62,
    },
    {
      id: "riverline-sprint",
      name: "Riverline Sprint",
      summary: "Down the Kestrel. Drop under the gate speed and you go swimming.",
      gates: riverline,
      par: 48,
    },
    {
      id: "crest-ladder",
      name: "The Crest Ladder",
      summary: "Rooftop to rooftop, finishing on the Spire deck. Wall running only.",
      gates: ladder,
      par: 75,
    },
    {
      id: "dock-chain",
      name: "Kestrel Courier",
      summary: "Five drops across the docks, each one faster than the last.",
      gates: docks,
      par: 44,
    },
  ];
}
