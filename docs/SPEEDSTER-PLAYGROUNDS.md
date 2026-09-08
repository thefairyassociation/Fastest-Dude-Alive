# Speedster playgrounds — September 2026

## Intended play loop

Accelerate, carve a corner, climb to the roofs, cross the water and answer a call. This pass deepens the existing map and retains the fifteen-chapter campaign, original hero, free-roam independence and browser rendering architecture.

## Handling

- Run/sprint acceleration: 95/130 m/s². Sprint reaches 193.5 m/s (90% of 215) in 1.49 s; absolute cap remains 280 m/s.
- Steering authority falls gently from 13 to 9 with speed. Focus multiplies it by 1.7 and is resolved before movement. Air authority rises to 0.7. Opposite input brakes at 260 m/s².
- Ctrl/C (controller B) holds a drift with 18 m/s² drag. Releasing after 0.35–2.5 seconds, at least 0.55 radians of cornering, at least 45 m/s and no wall collision earns 22 m/s and six energy. Entry, taps, straight slides and holding until expiry earn nothing.
- Roof exits retain 85% of wall-entry speed, at least 45 m/s, and sweep over the lip. Wall running tolerates 0.1-second facade seams. Collision-step wall attachment preserves the approach speed.
- Running audio follows the rig's half-stride count; sliding does not produce footsteps. Acceleration, braking and drifting change body lean. Manual look immediately removes the bounded travel anticipation; reduced motion disables it.

## Activities and world additions

| Activity | Layout and goal | Gold / silver / bronze |
| --- | --- | --- |
| Crest Circuit | Two laps of avenues, a vertical approach and a supported maintenance bridge across the Crest courtyard | 48 / 64.8 / 86.4 s |
| River Rush | Two laps through riverwalk launch pads, water gates and a road return | 45 / 60.75 / 81 s |
| Foundry Flow | Three warehouse/road laps with optional stepped cargo-yard shortcuts | 50 / 67.5 / 90 s |

These are initial tuning targets; route geometry is structurally checked, but timings still need a human playtest. Slower runs still complete and record a best, without earning a medal. Recovering makes a race practice-only. Ghosts retain the existing bounded eight-run pool.

**Cascade Rescue:** four authored roadside targets, reached in any order, within 65 real seconds. Swept pickups work at sprint speed. Each save restores 18 energy. A red ring grows around the next threatened target over three hazard seconds; its discharge damages a player within 24 m. Focus advances that hazard at 16% speed without changing the deadline. Targets already saved cannot be threatened. Actor exhaustion fails cleanly; abandonment/retry releases the pool.

**Courier Interception:** Switchback follows an axis-aligned foundry road loop at 110 m/s. Every 4.5 NPC seconds the runner warns a jumpable ground sweep, followed by a two-second recovery window. Focus slows the runner and warnings. Defeat the 16-health courier before 90 real seconds expire. The activity owns and releases its rogue.

Press T to accept an activity; T again abandons it. Emergencies are offered within 650 m when no ordinary activity is within 150 m. Enter restarts the active or last activity at its anchor with fresh health/energy; controller players use Pause → Restart. Completion/failure suggests a different nearby destination without replacing a destination the player already chose.

## Art and compatibility

Storefront artwork is placed at ground level instead of repeating through facade tiles. Glass has softer normal depth, less exposure variation and fewer mullions. Facade fins and cornices are simpler; roof boxes and masts sit on the roof. Concrete roofs gain a tiled surface and waypoint beams are narrower, shorter and fade away nearby. The idle flow panel is hidden.

New geometry is limited to a supported Crest roof bridge, low riverwalk pads, three cargo platforms and flush painted cues. Original building layout, nine route definitions and 112 collectible IDs remain intact. Legacy mote positions are checked against saved fixtures. The original layout consumes texture RNG before construction: removed storefront painting still consumes its legacy draws, and new concrete texture generation uses its own RNG.

Profile v4 adds `routeMedals` (0–3) and `legacyRouteReplays`. Earlier route times keep their original IDs; new free-roam records use `flow2-<route-id>`. Prior ghosts migrate into the separate bounded archive rather than competing with the revised handling or consuming its live ghost budget. Existing campaign choices, settings and collectibles survive migration.

The PR also carries the preceding local camera/map/momentum commits and existing rendering changes: directional LOD lookahead/hysteresis, nearby shadow casters, per-block submesh culling, opaque NPC shadow proxies and disabled pointer-move picking. Local pnpm files and dependency caches are excluded.

## Validation

- Baseline: 61 passing tests. The test command runs files sequentially to avoid overlapping memory-heavy NullEngine city builds. Final local suite: 71 tests passed. CI results are reported in the PR.
- High city, before → after: 2,041 → 1,971 meshes; 3,811,774 → 3,684,274 vertices; 32,034 → 32,041 static colliders. Existing ceilings remain unchanged.
- An eight-second sprint through actual city collision was simulated at both 120 Hz and 20 Hz, checking finite positions and no building overlaps throughout. Isolated run cost: 28 / 2 ms CPU respectively. This is simulation cost, not GPU frame time.
- New tests cover acceleration, steering/Focus, drift farming, collision-swept roof exits, facade seams, courier route/telegraph/recovery, rescue clocks and Focus hazards, pool cleanup, retries, destination ownership, migration, medals and archived ghosts.
- TypeScript and production build pass. Dependency audit found no known vulnerabilities in the installed lockfile.
- **Browser limitation:** T3 preview automation timed out while checking the baseline at sustained sprint, and subsequent snapshot/navigation/open calls also failed, including a fresh tab, the development server and a 60-second retry. Final GPU appearance, actual frame rate, audible mix and physical-controller feel are unverified. A demonstration recording could not be captured. Do not interpret CPU tests as visual or hardware-performance approval.

## Reproduce the remaining playtest

Build and use the normal local launcher. Alternatively run the dev server and open `/?playtest`; only development builds expose `window.fda` for repeatable state inspection. `?renderer=webgl` explicitly selects the fallback renderer; the default still tries WebGPU first.

1. Start free roam and follow the Crest Circuit bearing. Test a standing sprint, a 90° corner, held/released drift, opposite braking and Focus steering with mouse and controller.
2. Complete each new course through its required roof/water gates, then retry with Enter and Pause → Restart. Confirm medals and ghosts persist after reload; use R and verify that practice does not replace them.
3. Complete and fail both emergencies. Test Focus during warnings, jumping over the courier sweep, striking during recovery, abandoning, and retrying without orphaned actors.
4. Compare street/roof appearances and sprint frame times on low/medium/high, WebGPU and WebGL; check reduced motion, camera collision, map selection and existing story objectives.
5. Record a short continuous run showing a drift, roof crest, water crossing and an emergency. Tune medal targets from completed runs before treating them as final balance.
