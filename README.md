# Fastest Dude Alive

> A browser-first, original speedster sandbox built with TypeScript and Babylon.js.

**Status:** playable first-iteration prototype. Run across a large procedural city, chase a time trial, fight pursuit drones, chain momentum abilities, and briefly enter Focus Time.

This project is inspired by the broad fantasy of comic-book super speed, but it does not use characters, names, logos, storylines, models, sounds, or other assets from DC Comics. Future contributors should keep the game and its identity original.

## Playable in this iteration

- A roughly 2.5 km-wide procedural city with long roads, varied buildings, parks, landmarks, and enough runway to sustain speed.
- Third-person free roaming from a jog to about 780 km/h.
- A 120 Hz fixed-step player simulation, bounded frame catch-up, speed-sensitive steering, and substep collision resolution.
- WebGPU when supported, with automatic WebGL 2 fallback.
- Momentum combat: high-speed body checks, Phase Dash, targeted Arc Bolt, radial Kinetic Pulse, close-range speed strikes, combo rewards, and overdrive.
- Pursuit drones with chase, orbit, telegraph, attack, knockback, defeat, and respawn behavior.
- Focus Time: enemies slow while the player retains most of their speed; momentum drains while active.
- An optional checkpoint time trial with a saved personal best.
- Responsive HUD, renderer badge, speedometer, objectives, ability prompts, and a live minimap.
- Keyboard/mouse input with a pointer-lock camera.
- A grounded late-afternoon presentation: procedurally textured facades (glass, concrete, brick, panel), asphalt with lane markings and crosswalks, sidewalk slabs, streetlights, parked cars, a landmark broadcast spire, a gradient sky with sun and clouds, cascaded sun shadows, and an ACES tone-mapped filmic post pipeline.
- An articulated hero model (shoulders, elbows, hips, knees) with a procedural run cycle, and quad-rotor pursuit drones with spinning rotors and nav lights.

Everything is generated from Babylon primitives and canvas-painted procedural textures. There are no external art or audio assets yet, which keeps the prototype lightweight and legally clean.

## Controls

| Input | Action |
| --- | --- |
| WASD | Run and steer |
| Shift | Sprint toward top speed |
| Mouse | Look |
| Left click | Speed strike |
| Space | Phase Dash |
| E | Arc Bolt |
| Q | Kinetic Pulse |
| F (hold) | Focus Time |
| T | Start/restart the time trial |
| R | Recover at the nearest road |
| Esc | Release the mouse |

Click the game to capture the mouse.

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
| Tooling | Vite 8.1 | Fast development and production bundling |
| Physics | Babylon Physics V2 + Havok, plus a custom kinematic speed controller | Havok suits props and ordinary actors; a speedster cannot rely on one discrete rigid-body step without tunneling |
| UI | Semantic HTML + CSS | Accessible, responsive, cheap to render |
| Audio | Babylon audio / Web Audio | Spatial sound and speed-layer mixing without a second engine |
| Saves | IndexedDB | Planned for campaign state, settings, collectibles, and replays; the prototype currently saves the trial best with browser storage |
| Modeling | Blender to glTF/GLB | Open workflow with excellent Babylon support |
| Source | Git + GitHub; Git LFS for large binaries only | Text remains reviewable; future models, textures, and audio belong in LFS |
| Desktop later | Tauri 2 wrapper | Reuses the web game and is lighter than bundling a full browser stack |

### High-speed architecture

Very fast characters expose collision tunneling, unstable camera motion, coordinate precision problems, and excessive draw distance. The intended architecture is hybrid:

1. Simulate player intent at a fixed 120 Hz.
2. Sweep/substep a kinematic capsule through nearby static collision volumes.
3. Use Havok for ordinary dynamic props, debris, traffic, enemies, and interactive set pieces.
4. Stream city cells around the player and shift the world origin before coordinates become imprecise.
5. Decouple camera/effects smoothing from simulation velocity.
6. Scale effects by perceptual speed instead of spawning thousands of particles.

The prototype implements the first, second, and fifth items. City streaming and floating-origin rebasing are roadmap work.

## Project layout

```text
src/
  game/
    City.ts          procedural city and collision queries
    Enemy.ts         pursuit-drone behavior
    Hud.ts           DOM HUD and minimap
    Input.ts         keyboard, mouse, and pointer lock
    Player.ts        speed controller, resources, and visuals
    SpeedGame.ts     loop, combat, effects, and orchestration
    TimeTrial.ts     checkpoint activity and persistence
    engine.ts        WebGPU/WebGL engine selection
  main.ts
  styles.css
```

Gameplay should stay asset-agnostic. Replace primitives through factories instead of coupling mechanics to a specific Blender hierarchy.

## Roadmap

### 1. Speed foundation (current)

- [x] Typed browser build and fixed-step game loop
- [x] Large procedural city
- [x] High-speed movement and collision
- [x] Chase camera, speed FOV, trails, HUD, and minimap
- [x] Combat sandbox and time trial
- [x] WebGPU/WebGL renderer selection
- [x] Havok initialization
- [ ] Automated performance budgets, gamepad/rebinding, accessibility, reduced motion

### 2. Make speed extraordinary

- Surface-aware running, wall-running, water-running, vaults, rail grinding, rooftop traversal, and safe auto-step.
- City-cell streaming, hierarchical LOD, pooled effects, occlusion strategy, and floating origin.
- A real animation state machine for acceleration, braking, cornering, impacts, and procedural lean.
- An original visual/fantasy identity for the source of the character's speed.
- Traffic and civilians at ordinary scale while the player moves at extreme scale.
- Replay ghosts and asynchronous leaderboards.

### 3. Speedster combat

- Directional melee where route choice matters more than button mashing.
- Mark several targets during Focus Time, then execute the route at full speed.
- Rescue encounters, disarming, interception, vortex control, environmental throws, and non-lethal takedowns.
- Enemies built around prediction, area denial, decoys, dampening fields, and vertical pressure.
- Bosses that change traversal rules instead of merely gaining health.
- Havok-driven props/debris with strict pooling and simulation-distance limits.

### 4. Focus Time

The prototype has a small playable version. The full system should slow selected simulation layers instead of the render loop, preserve input/camera responsiveness, support target marking and path planning, alter layered audio, expose readable resource costs, and offer a reduced-motion alternative.

### 5. Story campaign (separate from free roam)

Do not rush story into the sandbox. Build it as a separate campaign mode that shares the city and mechanics while free roam remains independently available.

Working premise: a courier bonded to an experimental transit field becomes the only person able to move during citywide "dead seconds." Each episode investigates who is stealing fractions of time from the population. The campaign should have authored missions, conversations, rescues, set pieces, consequences, and a beginning/middle/end.

Before implementation, write a narrative bible covering the original hero, supporting cast, antagonists, districts, mission pillars, tone, and rules of the time-field fiction.

### 6. Content and production

- Blender-authored modular city kit, original hero, NPCs, vehicles, props, and animations exported as glTF/GLB.
- Audio layers for footsteps, wind, cloth, impacts, electricity, ambience, dialogue, and adaptive music.
- IndexedDB profiles with versioned migrations, slots, settings, campaign state, collectibles, and replay data.
- PWA/offline support, install prompt, touch experiments, deployment, and telemetry that respects privacy.
- Tests for movement math, save migrations, encounters, and deterministic replay slices.
- Optional Tauri 2 desktop packaging only after the browser version is stable. Keep platform services behind adapters so web remains first-class.

## Performance budgets

- Target 60 fps at 1080p on a midrange desktop; graceful 30 fps mode on integrated graphics.
- No per-frame garbage in core movement/combat loops.
- Cap fixed simulation catch-up to avoid a spiral of death.
- Track hard budgets for meshes, materials, textures, physics bodies, audio voices, and particles.
- Avoid permanent full-city physics bodies; only nearby/active cells should participate.
- Profile while moving at top speed, not while standing still.

## Asset and repository policy

- Keep code, config, small SVGs, and docs in normal Git.
- Add Git LFS before large `.blend`, `.glb`, texture, animation-cache, video, or lossless-audio files.
- Keep source assets and documented export presets. Never commit copyrighted DC/Flash assets.
- Record asset licenses in `docs/ASSETS.md`.
- Keep generated build output out of Git.

Suggested LFS patterns when assets arrive:

```gitattributes
*.blend filter=lfs diff=lfs merge=lfs -text
*.glb filter=lfs diff=lfs merge=lfs -text
*.exr filter=lfs diff=lfs merge=lfs -text
*.wav filter=lfs diff=lfs merge=lfs -text
```

## Notes for future coding agents

- Preserve free roam independently from the eventual campaign.
- Keep the hero, setting, powers, UI, and terminology original.
- Test movement at top speed and under simulated slow frames.
- Do not solve tunneling by making every city mesh a high-frequency dynamic body.
- Prefer spatial queries, pooling, instancing/merging, LOD, and streamed chunks.
- Keep WebGL fallback working when adding WebGPU-only effects.
- Treat save schemas as versioned public data.
- Add features in vertical slices: mechanic, feedback, failure state, performance check, and documentation.

## License

Code is MIT licensed. No rights are granted to third-party characters, brands, or properties.
