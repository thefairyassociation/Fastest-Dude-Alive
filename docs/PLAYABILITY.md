# Playability pass — September 2026

## Play

The local launcher serves the production build from `current/dist` at http://127.0.0.1:4173. Rebuild with `npm run build`, then reload an existing game tab.

- Mouse or IJKL looks around; V recenters behind the runner. Keyboard look remains usable if the browser refuses pointer capture.
- M pauses and opens destinations. Filter, select a marker or a list entry, then close the map and follow the bearing. Arrival within 28 metres clears the selection. The list is keyboard accessible with Tab/Enter; a controller can open/close the map but destination selection still needs keyboard/mouse.
- Free-roam momentum runs earn points from actual distance above 40 m/s. Each new traversal style increases the multiplier, capped at four. Every 600 points restores 12 energy. There is a 2.5-second slowdown grace period (the chain ends when remaining grace reaches zero, including inexact frame steps). Recovery resets the chain, while the session best is retained. Activities and story do not receive flow bonuses.
- Ability slots show cooldown seconds, minimum energy, activation conditions and short feedback. Bolt misses and pulse use no longer create central pop-ups.

## Implementation

The chase camera smooths its relative boom at a consistent rate and inherits player translation immediately. This removes the old speed-dependent world-space follow error, including on falls and recovery. Mouse and stick directions now agree with the movement coordinate system. Collision still constrains the final camera sightline after shake. Wall-run roll, chromatic aberration and vignette are reduced.

The city has a higher daytime sun, brighter ambient fill, softer facade normals, clearer crosswalks/cycle lanes and street-facing storefronts. Six batched decorative boxes per inner-city tower share a small set of generated sign materials; building footprints, collision and route gates stay stable. Existing foliage geometry is retained with a brighter palette to stay within the vertex budget. No new asset downloads or dependencies.

Maps render the actual static building footprints. The minimap expands its range from 280 to 620 metres with speed. Destination guidance gives a direct bearing, not a computed street route. Destination selection and flow records are session-only; the save schema is unchanged.

Sprint movement now depenetrates after a sequential X/Z sweep so a corner-cut cannot leave the runner overlapping a building on both axes. New profiles default to Medium graphics (High remains a setting and is preserved on existing saves) so first boot can finish before a High city is requested. Running out of health during a story objective fails the chapter; the panic recover teleport is free-roam only.

## Verification

Result: TypeScript and the production build pass. All 56 tests passed after the geometry optimization; 25 focused UI, movement and camera/scoring tests passed again after refining ability readiness. The high-quality city measures 3,811,774 vertices, 2,041 meshes and 32,034 colliders, within the existing ceilings. Browser layout checked at 1280×720 and 960×640.

Automated coverage includes camera framing at 20/60/144 Hz, heading reversal, elevation changes and recovery; fixed-distance reduced-motion behavior; flow milestone rewards, style reuse, stopping and teleport cancellation; map filtering, sorting, selection, clearing and keyboard focus; ability feedback expiry, cooldown and insufficient energy. Existing traversal, world geometry/LOD, save migration, campaign branches, audio and graphics suites remain required.

Browser checks cover entering free roam, Q pulse and E without a target, IJKL/V input, jumping, opening M, filtering time trials, selecting The Crest Ladder, closing the map and seeing its bearing/distance. Runtime console checked for errors. Sustained high-speed motion is covered by automated simulation tests; a human playtest with pointer-locked mouse and physical controller is still needed for feel and hardware frame rate.

The first full test run exposed excess vertices from denser tree spheres and too many storefront parts. Foliage density was restored and storefronts were reduced to two outward faces per lot. The existing 4,000,000-vertex ceiling was retained.
