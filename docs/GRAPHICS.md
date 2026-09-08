# Resonance suit / Meridian graphics overhaul

> This page records the retained speedster revision and its visual checklist. For the expanded city, new rendering budgets, UI, population and current validation limits, see [the Meridian overhaul](OVERHAUL.md).

## Art direction

The speedster is the focal point. Nolan's suit combines continuous matte crimson fabric, flush graphite stretch panels and restrained bronze trim. The screenshot-feedback revision removes floating chest/abdominal pieces and pale joint pads, slims the shoulders, and reshapes the gloves and boots into fitted running gear. A closed helmet and curved visor create a continuous head silhouette. Split amber chevrons across the scapulae continue down the spine; wrist/calf/heel inlays keep the character recognisable from behind. Focus changes the energy colour to blue.

The character is constructed from explicit elliptical cross-sections, interpolated with shared monotone-cubic tangents into capped meshes with welded UV-seam normals. Panels, visor and inlays follow those same body contours. Authored sRGB material swatches are converted to linear PBR colours to avoid washed-out pink highlights. Separate pieces sit on the existing named joint hierarchy. This preserves the traversal controller while replacing its visible body. Actual animated descendants replace the upright capsule shadow proxy. Idle stops cycling the limbs and angles the arms away from the torso; running cadence, banking and the transitions into airborne, slide and wall poses are blended.

The menu uses this same rig in a live portrait, and gameplay uses a closer chase camera. Play starts and restarts reset the portrait heading and traversal pose. The chase camera sweeps its sightline against expanded collision boxes after smoothing and shake, pulling in before walls and overhead solids. The portrait is obscured by a solid menu background on narrow displays to prioritise controls and legibility.

## World and rendering

- Glass buildings have facade fins and technical bands; masonry gets cornices and corner piers. Entrance bays and street trees establish human scale.
- New detail uses a separate seeded random stream. Existing collision footprints, roof heights, river logic, route data and save schema are retained. Facade relief is decorative, like the existing parapet overhangs.
- Merged structure now enters the cascaded-shadow caster list. Shadows are received by both the environment and character.
- Facades have independent black-background window-emission masks, rather than glowing entire albedo maps. Linear roughness masks distinguish glass from masonry. Normal maps are also explicitly linear data.
- River textures repeat in metres rather than stretching one tile along 3.7 km; normal UVs animate. Opaque water avoids large transparent-plane sorting problems.
- Golden-hour light has a lower angle. Window/lamp emission follows the atmosphere's light intensity through chapter transitions. Clouds use alpha compositing rather than additive brightening.
- ACES and FXAA remain. Bloom is restrained and disabled on Low; grain is removed; sharpening and chromatic aberration are reduced. No custom GPU shaders or external runtime asset requests were added.

## Effect and geometry budgets

| Item | Bound / behaviour |
| --- | --- |
| Main character | 38,067 vertices, 61 meshes including the empty shadow root |
| Continuous trails | Four ribbons on Medium/High; two on Low |
| Ribbon geometry | 32 samples / 64 vertices per ribbon; fixed typed buffers |
| Trail lifetime | 0.24 seconds, age-based fade |
| Teleports | More than 40 m in one frame clears ribbon history |
| Scene transitions | Explicitly reset ribbons, particles, rings, bolts and ghosts |
| City | 712 meshes including the test hero; 208 structure shadow casters in the High test fixture |
| Detail culling | Distance to chunk bounds; a nearby chunk no longer disappears at its corners |
| Materials | Shared city materials; only atmosphere/water materials remain mutable |

These are structural counts, **not measured GPU performance**. The increased number of building/character shadow casters needs hardware profiling. City merging bounds draw calls, but construction and shadows are still material costs. The test fixture constructed and checked the city in approximately 17 seconds on this environment's CPU; this is not a browser loading-time benchmark.

## Automated validation

Run with Node 20.19+ (CI uses Node 22):

```sh
npm ci --ignore-scripts
npm run audit
npm run typecheck
npm run test:graphics
npm run build
```

The graphics suite covers:

- Finite positions/normals, outward torso normals, valid indices, standing proportions, character vertex budget and shadow descendants.
- Sprint, slide, jump, both wall directions, vertical running and strike animation at 120, 60 and 20 Hz.
- Continuous suit material, linear colour values, outward idle arm pose, low boot toe boxes and matching normals at the torso UV seam.
- Bounded trail geometry through sustained movement, fade at rest, teleport resets and reduced motion.
- Play-start heading/pose reset and first-movement banking; camera sightline clipping against thin walls, diagonal approaches and bridge undersides.
- Actual CPU-painted emissive/roughness masks, dark/matte roof patches, linear normal data and moving water UVs.
- City construction, registered structural casters, corner culling, sprinting above 200 m/s at normal and slow steps without building overlap, river scale and reduced-motion storm behaviour.

Tests use Babylon's NullEngine, with data-only texture adapters for inspecting the city's shadow graph. They do not render shadows, execute WebGL/WebGPU shaders, or test browser input/menu interactions. `@napi-rs/canvas` is development-only and uses prebuilt platform packages; installation scripts remain disabled.

For offline model inspection, export the settled idle geometry, world-space normals and material colours:

```sh
node --import ./tests/register.mjs tests/export-character.mjs /tmp/hero.json
```

The revision was inspected from the front, three-quarter and back using a CPU triangle renderer with illustrative lighting. This checks silhouette and panel placement; it does not reproduce Babylon materials, normal maps, shadows or tone mapping.

## Visual review still required

Local browser preview access was rejected by the browser permission check during this change. No in-game screenshots, browser play-test results, GPU compatibility results or FPS claims are supplied.

Before merging, run the preview and inspect:

1. Title-screen character framing at desktop and narrow aspect ratios; all mode/settings/chapter controls remain reachable.
2. Free Roam: idle front/back, acceleration, full sprint, cornering, jump/dash, slide, both wall runs and vertical mantle. Check the closer camera near facades.
3. Story Mode: chapter start, dialogue, pause/resume/restart, results and return to menu. Verify the portrait and chase camera reset cleanly.
4. Golden, night and storm scenes: visor/armour readability, window emission, shadow acne/peter-panning, cloud compositing and water motion.
5. Low/Medium/High on reload, reduced motion during movement and storm, and both WebGL 2 and WebGPU. Profile at full sprint with shadows enabled.
