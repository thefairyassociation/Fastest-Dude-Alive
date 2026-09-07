# Fastest Dude Alive

> A browser-first, original speedster game built with TypeScript and Babylon.js.

**Status:** two playable modes over one city. **Free Roam** is an open 3.7 km sandbox with routes, rescues, collectibles and opt-in rogue duels. **Story Mode** is a twelve-chapter, three-act campaign with an authored cast, dialogue and set pieces.

This project is inspired by the broad fantasy of comic-book super speed. It does **not** use characters, names, logos, storylines, models, sounds or other assets from DC Comics or any other rights holder. The campaign is deliberately built in the shape of a serialised superhero drama — the lab accident, the team in the basement, the detective who raised him, the reporter who names him, the mentor with a secret — but every name, organisation and power in it is original to this project. Keep it that way.

## The two modes

### Free Roam

The city, open, with no story gates.

- 25 × 25 blocks of Meridian City (~3.7 km across) split into six named districts, a river with three bridges, and nine hand-placed landmarks.
- Four checkpoint routes with saved personal bests: the **Meridian Loop** (pure top speed), the **Riverline Sprint** (speed-gated water running), **The Crest Ladder** (rooftop-only, wall running required) and the **Kestrel Courier** chain.
- Two rescue runs — reach every stranded person before the clock runs out; each save buys you time back.
- 64 **resonance motes** scattered across rooftops, bridge cables and back alleys, persisted in your profile. Roughly two thirds are only reachable by wall running.
- Five opt-in **rogue duels** parked at landmarks. Combat is a minigame you choose to start, not something that chases you across the map.
- Walk up to any activity and press <kbd>T</kbd>.

### Story Mode

Twelve chapters in three acts, each with its own atmosphere, cast and objectives.

| Act | Chapters |
| --- | --- |
| **I — First Light** | The Longest Second · Eleven Months · A Man Who Runs Hot · The Streak |
| **II — Rogues** | Dead Seconds · Pressure Systems · The Cold Equation · What Wren Knows |
| **III — Vantage** | Negative Resonance · Twenty-Two Years · The Man in the Chair · The Fastest Dude Alive |

The premise: Halcyon Labs' resonance ring was built to bend local time. The night it failed, the front crossed the city in eleven seconds and found a forensic technician on a precinct roof. Eleven months later he wakes up in the building that killed him, and the people who kept him alive would like a word. Meanwhile the city starts losing whole minutes at a time, and someone else is moving inside them.

Chapters unlock in order, are replayable from the chapter-select screen, and the final chapter ends on a choice.

Story beats are authored as data in `src/game/story/script.ts`; the runner in `Campaign.ts` is mechanical. Adding a new objective type means one case in the runner and one entry in the script union.

## Graphics: the resonance suit and Meridian

Nolan now wears an authored **1.80 m athletic rig** with a continuous crimson suit, flush graphite panels, shaped thighs/calves, fitted gloves, low running boots and a curved visor. Smooth body contours and subtle woven normals replace floating armour pieces; linear material colours keep the red from washing out toward pink. Amber inlays on the back, wrists and heels turn cold blue during focus. Actual animated limbs cast the character shadow.

The title screen presents the playable character against the live city. The closer chase camera keeps the suit readable; smoother pose transitions, restrained bloom and age-faded wrist/heel ribbons carry the sense of speed. Reduced motion suppresses ribbons, afterimages, camera roll, speed zoom, chromatic aberration and storm flashes.

Meridian gains facade fins and cornices, entrance bays, street trees, illuminated lamps, real building shadows, separate window-emission/roughness masks, and an animated, correctly tiled river. Art detail uses its own random stream to preserve the layout, rooftop heights, activities and saves.

`npm run test:graphics` runs CPU geometry, animation, texture-mask, trail-lifecycle and city/traversal checks. It uses Babylon's NullEngine and a development-only native canvas package; it does **not** validate GPU shader output or frame rate. See [graphics implementation and validation](docs/GRAPHICS.md) for budgets and the visual review checklist.

## Movement

The whole game is the handling model.

| Move | How |
| --- | --- |
| Run · sprint | WASD, hold Shift toward ~215 m/s (775 km/h) |
| Jump | Space — jump distance scales with speed |
| Phase dash | Space again in mid-air; costs momentum, grants brief invulnerability |
| Slide | Ctrl or C above 20 m/s; low friction, carries you through corners |
| **Vertical run** | Run head-on into a facade above ~48 m/s and your momentum becomes altitude. Crest the parapet and you mantle onto the roof. |
| **Wall run** | Hit a wall at an angle instead and you stick to it, gravity cut to a fifth. Space kicks off. |
| **Water running** | The river holds you above ~34 m/s. Drop under and it remembers you weigh something. |
| Focus time | Hold F — everyone else slows, you don't; drains momentum |

Turning gets heavier the faster you go, which is the entire handling model in one sentence.

## Controls

| Input | Action |
| --- | --- |
| WASD | Run and steer |
| Shift | Sprint |
| Space | Jump · in the air, phase dash · on a wall, wall jump |
| Ctrl / C | Slide |
| Mouse | Look |
| Left click | Speed strike |
| E | Arc bolt |
| Q | Kinetic pulse |
| F (hold) | Focus time |
| T | Start the nearest activity |
| R | Recover at the nearest road |
| M | City map |
| Esc | Pause |

Gamepad is supported: sticks to move and look, A jump, B slide, X strike, Y bolt, bumpers for focus and pulse.

## Run it

Vite 8 requires Node.js 20.19+ or 22.12+.

```bash
npm ci
npm run dev
```

Production checks:

```bash
npm run audit
npm run typecheck
npm run test:graphics
npm run build
npm run preview
```

### Dependency safety

Dependencies are pinned by `package-lock.json`, and CI installs that exact dependency tree with `npm ci --ignore-scripts`. CI also audits the complete dependency graph and fails when npm reports a high- or critical-severity advisory.

When intentionally upgrading a dependency, run `npm install`, review both `package.json` and `package-lock.json`, and commit them together. Avoid hand-editing the lockfile.

## Technology decisions

| Area | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript | Useful contracts for gameplay systems without slowing iteration |
| Engine | Babylon.js 9 | Mature browser 3D, WebGPU/WebGL support, glTF pipeline |
| Renderer | WebGPU first, WebGL 2 fallback | Best available path without excluding older hardware |
| Materials | PBR with canvas-painted albedo + normal maps | Energy-conserving specular and real roughness variation, with zero binary assets |
| Lighting | Directional sun + hemispheric ambient + cascaded shadows, plus a painted sky cube for IBL | Image-based lighting without shipping an HDR |
| Physics | A custom kinematic speed controller; Havok Physics V2 initialised for future props | A speedster cannot survive one discrete rigid-body step per frame without tunnelling |
| Broadphase | Uniform 48 m spatial hash | The old linear collider scan was O(n) per substep at 120 Hz |
| UI | Semantic HTML + CSS | Accessible, responsive, cheap to render |
| Saves | Versioned profile in localStorage, IndexedDB-shaped | Campaign state, settings, route bests and collectibles |
| Modeling | Blender to glTF/GLB | Open workflow with excellent Babylon support |
| Source | Git + GitHub; Git LFS for large binaries only | Text stays reviewable; future models, textures and audio belong in LFS |
| Desktop later | Tauri 2 wrapper | Reuses the web game and is lighter than bundling a full browser stack |

Everything you see is generated at boot from authored character geometry, Babylon primitives and canvas-painted procedural textures. There are no external art or audio assets, which keeps the build lightweight and legally clean.

### High-speed architecture

Very fast characters expose collision tunnelling, unstable camera motion, coordinate precision problems and excessive draw distance. The architecture is hybrid:

1. Simulate player intent at a fixed 120 Hz with bounded frame catch-up.
2. Sweep a kinematic cylinder through a spatial hash, subdividing so a single frame's motion cannot tunnel a building.
3. Resolve axes independently, so sliding along a facade at 700 km/h stays smooth.
4. Merge the city into per-chunk meshes so frustum culling works, and distance-cull clutter separately from structure.
5. Decouple camera and effect smoothing from simulation velocity.
6. Scale effects by perceptual speed from fixed pools instead of spawning thousands of emitters.

City-cell streaming and floating-origin rebasing remain roadmap work.

## Project layout

```text
src/
  game/
    core/        Rng, Input (actions + gamepad), Save (versioned profile), engine selection
    world/       City, Collision (spatial hash), Landmarks, Materials, Sky (atmospheres), Textures
    player/      Player (traversal state machine), HeroModel (rig + procedural animation)
    npc/         Rogue (encounter opponents), Bystander (rescue targets)
    fx/          Effects (pooled rings, arcs, afterimages, particles), SpeedTrails (bounded ribbons), Markers (waypoints)
    activities/  Activity contract, RouteRun, RescueRun, RogueDuel, Collectibles, routes
    story/       script (the authored campaign), Campaign (chapter runner), cast
    ui/          Hud, Menu, Dialogue
    SpeedGame.ts orchestration: loop, camera, combat, mode switching
  main.ts
  styles.css
```

Gameplay stays asset-agnostic. Replace primitives through factories rather than coupling mechanics to a specific Blender hierarchy.

## Roadmap

### Done

- [x] Typed browser build, fixed-step loop, WebGPU/WebGL selection
- [x] 3.7 km procedural city with districts, a river and authored landmarks
- [x] Spatial-hash broadphase, chunked merging, distance LOD
- [x] Full 3D traversal: gravity, jump, air dash, slide, wall run, vertical run, water running
- [x] PBR materials with procedural normal maps, drivable atmospheres, pooled speed FX
- [x] Free-roam activity suite and opt-in rogue encounters
- [x] Twelve-chapter campaign with dialogue, objectives and a final choice
- [x] Menu, chapter select, settings (quality, sensitivity, reduced motion, units), versioned saves

### Next

- Traffic and civilians at city scale, not just around encounters.
- City-cell streaming and floating-origin rebasing for a larger map.
- Authored animation clips and foot placement IK beyond the current blended procedural rig: acceleration, braking, cornering, impacts.
- Focus time that slows selected simulation layers rather than a single multiplier, with target marking and route planning.
- Audio: footsteps, wind, cloth, impacts, electricity, ambience, dialogue and adaptive music.
- Bosses that change traversal rules instead of gaining health.
- Replay ghosts and asynchronous leaderboards.
- Automated performance budgets, key rebinding UI, and further accessibility work.

## Performance budgets

- Target 60 fps at 1080p on a midrange desktop; graceful 30 fps mode on integrated graphics.
- No per-frame garbage in core movement, combat or effect loops — pools use index scans, not `Array.find`.
- Cap fixed simulation catch-up to avoid a spiral of death.
- Track hard budgets for meshes, materials, textures, physics bodies, audio voices and particles.
- Avoid permanent full-city physics bodies; only nearby cells should participate.
- Profile while moving at top speed, not while standing still.

## Asset and repository policy

- Keep code, config, small SVGs and docs in normal Git.
- Add Git LFS before large `.blend`, `.glb`, texture, animation-cache, video or lossless-audio files.
- Keep source assets and documented export presets. **Never commit copyrighted DC/Flash assets.**
- Record asset licences in `docs/ASSETS.md`.
- Keep generated build output out of Git.

Suggested LFS patterns when assets arrive:

```gitattributes
*.blend filter=lfs diff=lfs merge=lfs -text
*.glb filter=lfs diff=lfs merge=lfs -text
*.exr filter=lfs diff=lfs merge=lfs -text
*.wav filter=lfs diff=lfs merge=lfs -text
```

## Notes for future coding agents

- Free roam and the campaign must stay independently playable. Neither may gate the other.
- Keep the hero, setting, powers, UI and terminology original. See the note at the top of `src/game/story/cast.ts`.
- Test movement at top speed and under simulated slow frames.
- Do not solve tunnelling by making every city mesh a high-frequency dynamic body.
- Prefer spatial queries, pooling, instancing/merging, LOD and chunked culling.
- Keep the WebGL fallback working when adding WebGPU-only effects.
- Treat save schemas as versioned public data; route changes through `migrate` in `core/Save.ts`.
- Add features in vertical slices: mechanic, feedback, failure state, performance check, documentation.

## Licence

Code is MIT licensed. No rights are granted to third-party characters, brands or properties.
