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
  const edge = city.extent - 220;

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
