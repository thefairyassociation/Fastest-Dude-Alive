/**
 * Headless browser verification for a built Fastest Dude Alive bundle.
 *
 * The CPU test suite in `tests/` proves structure and behaviour against a
 * NullEngine. This proves the thing that suite cannot: that a real browser
 * boots the bundle, renders it, and survives being played.
 *
 * It reports three classes of result:
 *
 *   1. Faults      — console errors, page exceptions, failed requests,
 *                    unhandled rejections. Any of these fails the run.
 *   2. Play-test   — free roam and a story chapter driven through real key
 *                    events, asserting the HUD actually responds.
 *   3. Cost        — draw calls per frame, GPU buffer and texture bytes, JS
 *                    heap. These come from patched WebGL entry points, so
 *                    they are independent of the rasterizer underneath and
 *                    are comparable between two builds on the same machine.
 *
 * What it deliberately does NOT claim: a frame rate. Under a software
 * rasterizer (SwiftShader, which is what CI and sandboxes have) wall-clock
 * timing says nothing about GPU hardware. Draw calls and resident bytes are
 * the portable proxies; treat any FPS target as unverified until profiled
 * on real hardware.
 *
 * Usage:  node tools/browser-verify.mjs <url> [--shots <dir>] [--json <file>]
 *
 * Requires Playwright's chromium on PATH or resolvable, e.g.
 *   npx --yes playwright@1.56.1 install chromium   (once)
 *   node tools/browser-verify.mjs http://127.0.0.1:4173/index.html
 *
 * Playwright is intentionally not a dependency of this package: it is a
 * heavyweight browser download and the production bundle does not need it.
 */

const args = process.argv.slice(2);
const url = args[0];
if (!url || url.startsWith("-")) {
  console.error("usage: node tools/browser-verify.mjs <url> [--shots <dir>] [--json <file>]");
  process.exit(2);
}
const optionOf = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};
const shotDir = optionOf("--shots");
const jsonOut = optionOf("--json");

const { chromium } = await import("playwright").catch(async () => {
  // Fall back to a globally installed Playwright when it is not a local dep.
  const { execSync } = await import("node:child_process");
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  return import(`${root}/playwright/index.js`).then((m) => m.default ?? m);
});

/* ------------------------------------------------------------------ */
/* Instrumentation installed before any bundle code runs               */
/* ------------------------------------------------------------------ */

const instrument = () => {
  const S = {
    frames: 0, draws: 0, bufBytes: 0, texBytes: 0,
    perFrame: [], unhandled: [],
    audio: { gains: [], peakVoices: 0, liveVoices: 0 },
  };
  window.__verify = S;
  addEventListener("unhandledrejection", (e) => S.unhandled.push(String(e.reason)));

  const patchGl = (proto) => {
    if (!proto) return;
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const original = proto[name];
      if (!original) continue;
      proto[name] = function (...a) { S.draws += 1; return original.apply(this, a); };
    }
    const bufferData = proto.bufferData;
    if (bufferData) proto.bufferData = function (target, src, ...rest) {
      S.bufBytes += typeof src === "number" ? src : (src && src.byteLength) || 0;
      return bufferData.call(this, target, src, ...rest);
    };
    const texStorage2D = proto.texStorage2D;
    if (texStorage2D) proto.texStorage2D = function (t, levels, fmt, w, h, ...rest) {
      S.texBytes += w * h * 4;
      return texStorage2D.call(this, t, levels, fmt, w, h, ...rest);
    };
    const texImage2D = proto.texImage2D;
    if (texImage2D) proto.texImage2D = function (...a) {
      // 9-arg form carries width/height at 3/4; the 6-arg DOM-source form
      // carries format/type there instead, so only the source has a size.
      if (a.length >= 9 && typeof a[3] === "number" && typeof a[4] === "number") S.texBytes += a[3] * a[4] * 4;
      else if (a[5] && a[5].width) S.texBytes += a[5].width * a[5].height * 4;
      return texImage2D.apply(this, a);
    };
  };
  patchGl(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patchGl(window.WebGLRenderingContext && WebGLRenderingContext.prototype);

  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    return raf.call(window, (t) => {
      const before = S.draws;
      try { return cb(t); } finally {
        S.frames += 1;
        S.perFrame.push(S.draws - before);
        if (S.perFrame.length > 4000) S.perFrame.shift();
      }
    });
  };

  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) window.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      const gain = this.createGain.bind(this);
      this.createGain = (...x) => { const n = gain(...x); S.audio.gains.push(n); return n; };
      const source = this.createBufferSource.bind(this);
      this.createBufferSource = (...x) => {
        const n = source(...x);
        const start = n.start.bind(n);
        n.start = (...y) => {
          S.audio.liveVoices += 1;
          S.audio.peakVoices = Math.max(S.audio.peakVoices, S.audio.liveVoices);
          return start(...y);
        };
        n.addEventListener("ended", () => { S.audio.liveVoices = Math.max(0, S.audio.liveVoices - 1); });
        return n;
      };
    }
  };
};

/* ------------------------------------------------------------------ */

const browser = await chromium.launch({
  args: [
    "--no-proxy-server", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
    "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const faults = [];
page.on("pageerror", (e) => faults.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") faults.push(`console.error: ${m.text()}`); });
page.on("requestfailed", (r) => faults.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.addInitScript(instrument);

const shot = async (name) => {
  if (!shotDir) return;
  try { await page.screenshot({ path: `${shotDir}/${name}.png`, timeout: 120_000 }); }
  catch (e) { faults.push(`screenshot ${name}: ${e.message.split("\n")[0]}`); }
};
const sample = (label) => page.evaluate((tag) => {
  const S = window.__verify;
  const sorted = [...S.perFrame].sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.floor(sorted.length * q)] : 0);
  const out = {
    phase: tag,
    drawCallsMedian: at(0.5),
    drawCallsP95: at(0.95),
    bufferMB: +(S.bufBytes / 1048576).toFixed(1),
    textureMB: +(S.texBytes / 1048576).toFixed(1),
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    hud: {
      speed: document.getElementById("speed-value")?.textContent ?? null,
      district: document.getElementById("district-name")?.textContent ?? null,
      objective: document.getElementById("objective-title")?.textContent ?? null,
    },
  };
  S.perFrame.length = 0;
  return out;
}, label);
const masterGain = () => page.evaluate(() => {
  const g = window.__verify.audio.gains;
  return g.length ? +g[0].gain.value.toFixed(4) : null;
});
const setAudio = async (id, apply) => {
  await page.evaluate(({ id, apply }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (apply.value !== undefined) { el.value = String(apply.value); el.dispatchEvent(new Event("input", { bubbles: true })); }
    if (apply.checked !== undefined) { el.checked = apply.checked; el.dispatchEvent(new Event("change", { bubbles: true })); }
  }, { id, apply });
  await page.waitForTimeout(1500);
};

const report = { url, phases: [], checks: {}, faults: [] };
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  report.checks[name] = { pass, actual, expected };
  if (!pass) faults.push(`check ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction(
  () => document.getElementById("loading")?.classList.contains("is-hidden"),
  null, { timeout: 120_000 },
);
await page.waitForTimeout(4000);
report.phases.push(await sample("menu"));
await shot("01-title");

/* ---- free roam ---- */
await page.click("#btn-free-roam");
await page.waitForTimeout(4000);
await page.mouse.click(640, 360);           // user gesture unlocks WebAudio
await page.waitForTimeout(3000);
report.phases.push(await sample("free-roam-idle"));

// Poll the HUD while sprinting and keep the peak. A single sample lands at
// an arbitrary point in the acceleration curve, and under a software
// rasterizer the frame rate is low enough that the arbitrary point is often
// still near zero -- the peak is what actually says "the player can run".
await page.keyboard.down("KeyW");
await page.keyboard.down("ShiftLeft");
let peakSpeed = 0;
for (let i = 0; i < 50; i += 1) {
  await page.waitForTimeout(500);
  const v = Number(await page.evaluate(() => document.getElementById("speed-value")?.textContent ?? "0"));
  if (Number.isFinite(v)) peakSpeed = Math.max(peakSpeed, v);
}
const sprint = await sample("sprint");
sprint.peakSpeed = peakSpeed;
report.phases.push(sprint);
await shot("02-sprint");
check("sprint reaches a running speed", peakSpeed > 100, true);

await page.keyboard.press("Space");
await page.waitForTimeout(1200);
report.phases.push(await sample("airborne"));
await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyW");
await page.waitForTimeout(2000);

/* ---- audio contract ---- */
// Builds without a soundscape have no volume controls; skip rather than fail,
// so this tool can be pointed at any revision as a baseline.
const hasAudioControls = await page.evaluate(() =>
  Boolean(document.getElementById("setting-volume") && document.getElementById("setting-muted")));
const audio = { present: hasAudioControls };
if (hasAudioControls) {
audio.defaultGain = await masterGain();
await setAudio("setting-volume", { value: 0.2 }); audio.volume20 = await masterGain();
await setAudio("setting-volume", { value: 1 });   audio.volume100 = await masterGain();
await setAudio("setting-volume", { value: 0 });   audio.volume0 = await masterGain();
await setAudio("setting-volume", { value: 0.65 });
await setAudio("setting-muted", { checked: true });  audio.muted = await masterGain();
await setAudio("setting-muted", { checked: false }); audio.unmuted = await masterGain();
// The master bus is volume * 0.65, so these are exact, not approximate.
check("volume slider scales the master bus", [audio.volume20, audio.volume100, audio.volume0], [0.13, 0.65, 0]);
check("mute silences and restores the master bus", [audio.muted, audio.unmuted], [0, 0.4225]);

await page.evaluate(() => {
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(2500);
audio.tabHidden = await masterGain();
await page.evaluate(() => {
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(2000);
audio.pauseMenuShown = await page.evaluate(() => !document.getElementById("pause")?.classList.contains("is-hidden"));
check("a hidden tab parks the game in pause", audio.pauseMenuShown, true);
check("a hidden tab silences audio", audio.tabHidden, 0);
await page.click("#pause-resume").catch(() => {});
await page.waitForTimeout(2000);
audio.afterResume = await masterGain();
check("resuming restores audio", audio.afterResume, 0.4225);
audio.peakConcurrentVoices = await page.evaluate(() => window.__verify.audio.peakVoices);
} else {
  report.checks["audio checks"] = { pass: true, actual: "skipped: build has no sound settings", expected: "skipped" };
}
report.audio = audio;

/* ---- story ---- */
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);
await page.click("#pause-quit").catch(() => {});
await page.waitForTimeout(2500);
await page.click("#btn-story");
await page.waitForTimeout(1500);
await page.locator("#chapter-list button:not([disabled])").first().click({ timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(6000);
for (let i = 0; i < 25; i += 1) { await page.keyboard.press("Space"); await page.waitForTimeout(500); }
const story = await sample("story-chapter-1");
report.phases.push(story);
await shot("03-story");
check("a story chapter loads an objective", typeof story.hud.objective === "string" && story.hud.objective.length > 0, true);

report.unhandled = await page.evaluate(() => window.__verify.unhandled);
report.faults = faults;
report.ok = faults.length === 0 && report.unhandled.length === 0;

console.log(JSON.stringify(report, null, 2));
if (jsonOut) (await import("node:fs")).writeFileSync(jsonOut, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
