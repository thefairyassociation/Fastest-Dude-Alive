import type { MarkerStyle } from "../fx/Markers";

export interface PlanPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FocusTarget {
  id: string;
  label: string;
  position: PlanPoint;
  style: MarkerStyle;
}

export interface FocusPlan {
  selectedId: string;
  label: string;
  distance: number;
  /** Selected target first, then a greedy short route through the rest. */
  targets: FocusTarget[];
}

/**
 * Ephemeral Speed Sense route state.
 *
 * The planner intentionally chooses an order rather than pretending to be a
 * street navmesh. Meridian's best line often uses a wall, roof or river, so
 * the HUD draws a traversal sequence and leaves the exact line to the player.
 */
export class FocusPlanner {
  private selectedId: string | null = null;

  clear(): void {
    this.selectedId = null;
  }

  cycle(targets: readonly FocusTarget[], origin: PlanPoint): FocusPlan | null {
    if (targets.length === 0) {
      this.clear();
      return null;
    }
    const ordered = [...targets].sort((a, b) => distanceSquared(a.position, origin) - distanceSquared(b.position, origin));
    const current = ordered.findIndex((target) => target.id === this.selectedId);
    this.selectedId = ordered[(current + 1) % ordered.length]?.id ?? ordered[0]?.id ?? null;
    return this.plan(targets, origin);
  }

  plan(targets: readonly FocusTarget[], origin: PlanPoint): FocusPlan | null {
    if (targets.length === 0) {
      this.clear();
      return null;
    }

    let selected = targets.find((target) => target.id === this.selectedId);
    if (!selected) {
      selected = nearest(targets, origin);
      this.selectedId = selected.id;
    }

    const remaining = targets.filter((target) => target.id !== selected.id);
    const route: FocusTarget[] = [selected];
    let cursor = selected.position;
    while (remaining.length > 0) {
      const next = nearest(remaining, cursor);
      route.push(next);
      remaining.splice(remaining.indexOf(next), 1);
      cursor = next.position;
    }

    return {
      selectedId: selected.id,
      label: selected.label,
      distance: Math.sqrt(distanceSquared(selected.position, origin)),
      targets: route,
    };
  }
}

function nearest<T extends { position: PlanPoint }>(targets: readonly T[], from: PlanPoint): T {
  let best = targets[0];
  if (!best) throw new Error("Cannot choose from an empty focus target list.");
  let bestDistance = distanceSquared(best.position, from);
  for (let index = 1; index < targets.length; index += 1) {
    const candidate = targets[index];
    if (!candidate) continue;
    const distance = distanceSquared(candidate.position, from);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function distanceSquared(a: PlanPoint, b: PlanPoint): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}
