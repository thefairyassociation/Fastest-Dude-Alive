import { Vector3 } from "@babylonjs/core";
import type { City } from "../world/City";
import type { RelayDefinition } from "./HarmonicRelay";

function roof(city: City, x: number, z: number): Vector3 {
  return new Vector3(x, city.groundHeight(x, z, 400) + 3, z);
}

export function buildRelays(city: City): RelayDefinition[] {
  const spire = city.landmark("broadcast-spire").position;
  const labs = city.landmark("halcyon-labs").position;
  const ledger = city.landmark("ledger-tower").position;
  const docks = city.landmark("ridgeline-transit").position;
  const riverX = 7 * 150;

  return [
    {
      id: "relay-gridfall",
      name: "Harmonic Relay: Gridfall",
      summary: "Choose a line through five unstable relays. Arrive at speed, then hold Focus to tune.",
      anchor: city.nearestRoad(spire),
      seconds: 92,
      nodes: [
        {
          id: "precinct-feed",
          label: "Precinct feed",
          position: city.nearestRoad(new Vector3(-450, 0, -300)),
          minSpeed: 45,
        },
        {
          id: "halcyon-roof",
          label: "Halcyon roof relay",
          position: roof(city, labs.x + 26, labs.z - 18),
          minSpeed: 25,
        },
        {
          id: "kestrel-channel",
          label: "Kestrel channel relay",
          position: new Vector3(riverX, 0.15, -450),
          minSpeed: 38,
        },
        {
          id: "ledger-crown",
          label: "Ledger crown relay",
          position: roof(city, ledger.x - 24, ledger.z + 16),
          minSpeed: 28,
        },
        {
          id: "transit-return",
          label: "Ridgeline return",
          position: city.nearestRoad(docks.add(new Vector3(120, 0, -80))),
          minSpeed: 52,
        },
      ],
    },
  ];
}
