# Asset inventory and licences

Every asset shipped in this repository is listed here. Nothing is added to `public/` or `src/` without an entry.

## Policy

Fastest Dude Alive is an original work. It does **not** use characters, names, logos, storylines, models, sounds or other assets from DC Comics or any other rights holder, and it never will. The campaign is deliberately structured like a serialised superhero drama, but every name, organisation and power in it was written for this project.

Before adding anything:

1. Confirm the licence permits redistribution inside an MIT-licensed repository.
2. Add a row below with the source URL, version and licence.
3. Keep the original licence text alongside the file where the licence requires it.
4. Large binaries (`.blend`, `.glb`, `.exr`, `.wav`, video) go through Git LFS — see the patterns in the README.

## Fonts

Both families are self-hosted rather than fetched from a CDN, so the game has no third-party runtime requests and works offline.

| File | Family | Source | Licence |
| --- | --- | --- | --- |
| `public/fonts/barlow-condensed-400.woff2` | Barlow Condensed 400 | [Barlow](https://github.com/jpt/barlow) by Jeremy Tribby | SIL Open Font License 1.1 |
| `public/fonts/barlow-condensed-600.woff2` | Barlow Condensed 600 | as above | SIL Open Font License 1.1 |
| `public/fonts/barlow-condensed-700.woff2` | Barlow Condensed 700 | as above | SIL Open Font License 1.1 |
| `public/fonts/barlow-condensed-800.woff2` | Barlow Condensed 800 | as above | SIL Open Font License 1.1 |
| `public/fonts/inter-latin.woff2` | Inter, variable, Latin subset, weights 400–700 | [Inter](https://github.com/rsms/inter) by Rasmus Andersson | SIL Open Font License 1.1 |

The OFL permits bundling and redistribution, including in commercial work, provided the fonts are not sold on their own and any derivative font is not released under a reserved name. Both requirements are met: the files are shipped unmodified apart from subsetting and WOFF2 compression, and neither is renamed.

## Everything else

There is currently no other binary asset in the repository.

| Category | Status |
| --- | --- |
| 3D models | None. Every mesh is built at runtime from Babylon primitives — see `src/game/world/Landmarks.ts` and `src/game/player/HeroModel.ts`. |
| Textures | None. Facades, roads, sidewalks, grass, water, metal, sky gradients, sprites and normal maps are all painted into canvases at boot in `src/game/world/Textures.ts`. |
| Environment maps | None. Image-based lighting comes from a cube painted from the active sky gradient in `src/game/world/Sky.ts`. |
| Audio | None yet. When audio arrives it belongs in Git LFS with rows in this table. |
| Icons | The favicon is an inline SVG data URI in `index.html`, drawn for this project. |

## Third-party code

Runtime dependencies are listed in `package.json` and pinned by `package-lock.json`.

| Package | Licence |
| --- | --- |
| `@babylonjs/core` | Apache-2.0 |
| `@babylonjs/havok` | See the Babylon.js Havok distribution terms; free for commercial and non-commercial use in Babylon.js projects |
| `vite`, `typescript` (dev only) | MIT / Apache-2.0 |
