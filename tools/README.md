# tools

## `browser-verify.mjs`

Headless browser verification for a built bundle. The suite in `tests/` runs
against Babylon's `NullEngine` and proves structure and behaviour; this proves
the part that cannot: a real browser boots the bundle, renders it, and
survives being played.

```sh
npm run build
npx vite preview --port 4173 &
node tools/browser-verify.mjs http://127.0.0.1:4173/index.html \
  --shots ./shots --json ./verify.json
```

Exit code is `0` when every check passes and nothing faulted, `1` otherwise,
so it can gate CI.

### What it reports

| Class | Contents |
| --- | --- |
| **Faults** | console errors, page exceptions, failed requests, unhandled rejections |
| **Play-test** | free roam and a story chapter driven with real key events, asserting the HUD responds |
| **Cost** | draw calls per frame, GPU buffer and texture bytes, JS heap |

Checks currently asserted: sprinting reaches a running speed, the volume
slider scales the master bus, mute silences and restores it, a hidden tab
both silences audio and parks the game in pause, resuming restores audio, and
a story chapter loads an objective. Builds with no sound settings skip the
audio checks rather than failing them, so the tool can be pointed at an older
revision as a baseline.

### What it deliberately does not claim

**A frame rate.** CI and sandboxes render through SwiftShader, a software
rasterizer, where wall-clock timing says nothing about GPU hardware. The
cost numbers come from patched WebGL entry points, so they are independent of
the rasterizer underneath and are comparable between two builds measured on
the same machine — but any FPS target stays unverified until it is profiled
on real hardware.

Likewise it cannot judge how the audio *sounds*. It verifies the graph, the
volume law and the mute/pause transitions; timbre and mix remain a listening
test.

### Requirements

Playwright is intentionally not a dependency of this package — it pulls a
browser download that the shipped bundle has no use for. Install it on demand:

```sh
npx --yes playwright install chromium
```

The script resolves `playwright` locally first, then falls back to a global
install.
