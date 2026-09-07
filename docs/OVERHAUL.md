# Meridian overhaul — Minutes Owed

This PR builds on the merged speedster revision (`7486b44`). `HeroModel.ts` is unchanged. The work replaces the city presentation and campaign, expands the world and its activities, and corrects handling/combat problems without replacing the momentum controller.

## Scope

| Area | Result |
| --- | --- |
| World | 37×37 blocks, 5.55 km width, 10 districts, 15 landmarks, five bridge rows |
| Architecture | Terraces/courtyards, campus slabs, sawtooth foundries, harbour blocks and bespoke civic landmarks |
| Rendering | Revised materials, street markings and sky; nearby full cells and distant skyline proxies |
| Activities | 9 routes, 6 rescue events, 6 opt-in duels, 112 motes |
| Story | 15 rewritten chapters, authored delivery stops, distinct emergency branches and saved choice callbacks |
| Handling | Countersteer braking, buffered landing jumps, analog walking, slide rearming and recovery reset |
| Combat | Early committed target warnings, dodgeable charge lanes, rate-limited body checks, jumpable Vantage ground sweeps |
| Population | Bounded local traffic and citizens in seven thin-instance batches |
| Sound | Procedural wind, ambience, movement and ability cues, capped voices, volume/mute and pause lifecycle |
| Replays | Locally stored personal-best recordings and a cyan pace runner |
| Interface | Menu, chapter select, HUD, map, dialogue, settings and results redesign; focus and controller navigation |

## Why the mechanics changed

The run/sprint speeds, momentum steering, wall/vertical/water-running thresholds, focus resource, air dash and slide remain. The changes address specific failures:

- Exactly reversed input produced no turning direction. Countersteer now brakes and selects a stable turning direction.
- Landing could discard a jump pressed just before contact. A short buffer makes the intended jump happen while retaining the air dash away from a landing.
- Held slide could repeatedly re-enter its boost. A fresh press now rearms it.
- Gamepad camera speed depended on the render rate. Look input now incorporates elapsed time.
- Ranged attacks committed their aim too close to impact. Warnings now show a committed target so moving away works.
- Contact checks could apply damage every simulation step. Per-target cooldowns make a pass one hit rather than a health deletion.
- Vantage's later phase changes what you do: jump an expanding ground sweep and punish recovery, then dodge the next committed charge.

## Compatibility and persistence

Profile version 3 migrates the original settings, chapter IDs, completed chapters, route times, distance, top speed and collectible IDs. New audio settings default to 65% and unmuted. Completed old chapter twelve unlocks chapter thirteen. The former runner never saved its ending decision; rebuilding chapters use explicitly authored fallback content when no decision exists.

The original four free-roam course geometries stay fixed even though `city.extent` grows. The original 64 motes retain their random sequence and legacy placement radius; an independent random stream adds 48 outer motes. Inner-city structural generation is checked against the old city to protect roof-based placement.

Recordings contain `[time, x, y, z, heading]` samples at roughly 5 Hz. They are bounded to 1,201 samples, 240 seconds and eight course recordings. Saving a faster time removes any obsolete ghost. Campaign deliveries do not consume the free-roam ghost quota. Invalid, non-finite, oversized, out-of-bounds or time-inconsistent recordings are rejected on load. Recovering or detecting a teleport makes a run practice-only; it can still be completed but cannot replace a personal best.

## Resource limits

- Low/medium/high ambient budgets: 12/24/36 cars and 20/36/54 citizens; 240/310/380 m population radii.
- Seven instanced draw batches for the population; validation results for immutable block loops are cached, including failures.
- Four persistent audio beds, twelve transient voices, cue rate limits and a compressor. Audio initialization is lazy and failure is nonfatal.
- One merged ghost mesh, no ghost colliders or shadow casters; reduced motion hides the ghost.
- City collision and full geometry remain resident. Skyline proxies reduce distant drawing; this PR does **not** implement asynchronous streaming or a floating origin.
- Existing fixed 120 Hz simulation and bounded catch-up are retained.

## Verification

Final local validation: **48 tests passed**, typecheck/build passed, dependency audit reported **0 vulnerabilities**, and `git diff --check` was clean. The expanded high-quality city plus 112 motes measured 1,884 meshes, 3,492,094 resident vertices and 32,034 static colliders in the CPU structural test.

Run `npm run audit`, `npm run typecheck`, `npm test` and `npm run build`. CI runs the complete regression suite. Tests include actual movement and attack state transitions, city collision/layout/LOD, save migration and corrupt recordings, route sweeps, story branching, population pooling and Web Audio lifecycle.

The browser returned `net::ERR_BLOCKED_BY_CLIENT` for the local Vite preview. No browser play-test, in-game screenshot, GPU frame-rate result or listening test is claimed. CPU geometry, NullEngine and mocked AudioContext tests verify structure and behavior; they cannot establish lighting appearance, shader output or the audible mix. The production build retains Babylon's existing large-chunk warning.

Before merging, play the following manual pass on a real browser:

1. Start free roam, sprint through the original centre and each outer district. Inspect facade scale, roads, riverwalk, landmarks, shadows and LOD transitions.
2. Run an original and an outer route twice. Check gate ordering, PB ghost playback, start/stop behavior and recovery-assisted practice scoring.
3. Open the map while sprinting, then close it by keyboard, button and controller Start. Confirm the player does not move while the map is open.
4. Test Vantage's low-health sweep with a standing jump and a sprint jump; check warning visibility at night and in focus.
5. Play chapter twelve with both plans, continue into chapter thirteen, reload the game and confirm later dialogue and tasks retain the choice.
6. Check the title/HUD/map/dialogue at desktop and narrow sizes; navigate chapters/settings without a mouse.
7. Listen at walking/top speed and during focus; change volume, mute, pause, switch tabs and return. Test reduced motion and Low/Medium/High.
8. Profile continuous top-speed travel at 1080p on target hardware. Structural budgets passing is not evidence of 60 fps.
