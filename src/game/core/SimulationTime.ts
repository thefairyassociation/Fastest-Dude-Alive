/**
 * Explicit simulation domains.
 *
 * Focus is a player advantage, not a pause button: traversal and objective
 * clocks stay honest while threats, hazards and civilians opt into slower
 * domains. Keeping the policy here prevents every new city system from
 * inventing its own focus multiplier.
 */
export interface SimulationTime {
  player: number;
  objective: number;
  threat: number;
  hazard: number;
  civilian: number;
  ambient: number;
}

export function simulationTime(dt: number, focusActive: boolean): SimulationTime {
  if (!focusActive) {
    return {
      player: dt,
      objective: dt,
      threat: dt,
      hazard: dt,
      civilian: dt,
      ambient: dt,
    };
  }

  return {
    player: dt,
    objective: dt,
    threat: dt * 0.16,
    hazard: dt * 0.32,
    civilian: dt * 0.28,
    ambient: dt * 0.4,
  };
}
