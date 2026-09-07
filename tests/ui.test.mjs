import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from '@babylonjs/core';
import { Menu } from '../src/game/ui/Menu.ts';
import { Dialogue } from '../src/game/ui/Dialogue.ts';
import { Hud } from '../src/game/ui/Hud.ts';
import { CHAPTERS } from '../src/game/story/script.ts';

// A small DOM double exercises controller/keyboard event ownership without
// bringing a browser or a second dependency tree into the game test runner.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attrs = new Map();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
      toggle: (name, force) => {
        const yes = force ?? !this.classList.contains(name);
        if (yes) this.classList.add(name); else this.classList.remove(name);
        return yes;
      },
    };
  }
  addEventListener(type, callback) { const all = this.listeners.get(type) ?? []; all.push(callback); this.listeners.set(type, all); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) ?? []) callback(event); return !event.defaultPrevented; }
  click() { if (this.type === 'checkbox') this.checked = !this.checked; this.dispatchEvent(new Event('click')); }
  focus() { document.activeElement = this; this.dispatchEvent(new Event('focus')); }
  scrollIntoView() {}
  setAttribute(name, value) { this.attrs.set(name, value); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  contains(other) { return this === other || this.children.some(child => child.contains(other)); }
  closest(selector) { if (selector === '.is-hidden' && this.classList.contains('is-hidden')) return this; return this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    const matches = (child) => {
      if (selector === '[data-back]') return child.dataset.back !== undefined;
      if (selector.startsWith('.')) return child.classList.contains(selector.slice(1));
      return ['BUTTON', 'INPUT', 'SELECT'].includes(child.tagName) && !child.disabled;
    };
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
class Button extends Element { constructor() { super('button'); } }
class Input extends Element {
  constructor() { super('input'); this.type = ''; this.step = '0.05'; this.min = '0'; this.max = '1'; this.checked = false; }
  stepUp() { this.value = String(Math.min(Number(this.max), Number(this.value) + Number(this.step))); }
  stepDown() { this.value = String(Math.max(Number(this.min), Number(this.value) - Number(this.step))); }
}
class Select extends Element { constructor() { super('select'); this.selectedIndex = 0; this.options = [{}, {}, {}]; } }
class Canvas extends Element {
  constructor() {
    super('canvas'); this.width = 1100; this.height = 1100;
    const events = [];
    this.context = { events, measureText: (text) => ({ width: text.length * 8 }) };
    for (const method of ['clearRect', 'save', 'beginPath', 'arc', 'clip', 'fillRect', 'fillText', 'stroke', 'fill', 'restore', 'translate', 'rotate', 'moveTo', 'lineTo', 'closePath', 'drawImage', 'strokeRect']) {
      this.context[method] = (...args) => events.push({ method, args, fill: this.context.fillStyle });
    }
  }
  getContext() { return this.context; }
}
function setupDOM() {
  const elements = new Map();
  const root = new Element('html');
  const stack = [root];
  const make = (tag) => tag === 'button' ? new Button() : tag === 'input' ? new Input() : tag === 'select' ? new Select() : tag === 'canvas' ? new Canvas() : new Element(tag);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, closing, tag, attrs] = match;
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const element = make(tag);
    for (const attr of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      const [, key, value] = attr;
      if (key === 'id') { assert.ok(!elements.has(value), `unique HTML id ${value}`); element.id = value; elements.set(value, element); }
      else if (key === 'class') element.className = value;
      else if (key === 'data-back') element.dataset.back = value;
      else element[key] = value;
    }
    stack.at(-1).append(element);
    if (!['meta', 'link', 'input', 'br', 'hr', 'img'].includes(tag)) stack.push(element);
  }
  const doc = new Element('document');
  doc.append(root);
  doc.documentElement = root;
  doc.activeElement = null;
  doc.pointerLockElement = null;
  doc.createElement = make;
  doc.getElementById = (id) => elements.get(id) ?? null;
  const win = new Element('window');
  win.setTimeout = () => 0;
  win.clearTimeout = () => {};
  win.confirm = () => true;
  let frame;
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.HTMLElement = Element;
  globalThis.HTMLButtonElement = Button;
  globalThis.HTMLInputElement = Input;
  globalThis.HTMLSelectElement = Select;
  globalThis.HTMLCanvasElement = Canvas;
  let pads = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  return { elements, doc, win, root, tick: (now) => frame?.(now), pad: (value) => { pads = value; } };
}
function key(code, key = code) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { code, key, repeat: false, shiftKey: false });
  return event;
}
function makeSave() {
  const settings = { quality: 'high', lookSensitivity: 1, reducedMotion: false, showSpeedInMph: false, masterVolume: 0.65, muted: false };
  const data = { settings, totalDistanceMeters: 1500, topSpeedKph: 500, collected: [], campaign: { unlocked: 2, completed: [CHAPTERS[0].id] } };
  return { settings, data, update(fn) { fn(data); }, reset() { settings.lookSensitivity = 1; settings.masterVolume = 0.65; settings.muted = false; } };
}

test('menu keeps chapters dynamic, isolates focus, and lets a controller enter settings and change volume', () => {
  const dom = setupDOM();
  const save = makeSave();
  let changed = 0;
  let launches = 0;
  const menu = new Menu(save, {
    onFreeRoam() { launches += 1; }, onChapter() {}, onResume() {}, onRestart() {}, onQuit() {}, onResultsPrimary() {},
    onSettingsChanged() { changed += 1; },
  });
  menu.show();
  assert.equal(document.activeElement.id, 'btn-free-roam');
  assert.match(dom.elements.get('campaign-chapter-count').textContent, new RegExp(`^${CHAPTERS.length} chapters`));
  dom.win.dispatchEvent(key('ArrowDown', 'ArrowDown'));
  assert.equal(document.activeElement.id, 'btn-story');
  document.activeElement.click();
  const cards = dom.elements.get('chapter-list').querySelectorAll('.chapter-card');
  assert.equal(cards.length, CHAPTERS.length);
  assert.equal(cards.filter(card => !card.disabled).length, 2);
  dom.win.dispatchEvent(key('Escape', 'Escape'));
  assert.equal(document.activeElement.id, 'btn-free-roam');
  dom.elements.get('btn-settings').click();
  assert.equal(document.activeElement.dataset.back, 'menu-root', 'focus starts at the actual Back control');
  const volume = dom.elements.get('setting-volume');
  volume.focus();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  buttons[15].pressed = true;
  dom.pad([{ connected: true, axes: [0, 0], buttons }]);
  dom.tick(1000);
  assert.ok(Math.abs(Number(volume.value) - 0.7) < 1e-10);
  assert.ok(Math.abs(save.settings.masterVolume - 0.7) < 1e-10);
  assert.equal(dom.elements.get('setting-volume-value').textContent, '70%');
  assert.equal(changed, 1);
  assert.equal(launches, 0, 'UI adjustments never launch gameplay');
  volume.value = '0.2';
  dom.elements.get('set-sensitivity-value').textContent = '2.50×';
  dom.elements.get('btn-reset-profile').click();
  assert.equal(volume.value, '0.65');
  assert.equal(dom.elements.get('set-sensitivity-value').textContent, '1.00×');
  menu.showPause('A pause');
  assert.equal(document.activeElement.id, 'pause-resume');
  dom.win.dispatchEvent(key('Tab', 'Tab'));
  // The browser advances intermediate tab stops. At the final stop the UI
  // traps Tab so focus cannot escape to a hidden menu or the game canvas.
  dom.elements.get('pause-quit').focus();
  const tab = key('Tab', 'Tab');
  dom.win.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.activeElement.id, 'pause-resume');
});

test('dialogue click, focused keyboard activation and decision selection each advance exactly once', () => {
  const dom = setupDOM();
  let discarded = 0;
  const dialogue = new Dialogue({ discard(action) { assert.equal(action, 'advance'); discarded += 1; } });
  dialogue.show([{ who: 'narration', text: 'First.' }, { who: 'narration', text: 'Second.' }, { who: 'narration', text: 'Third.' }]);
  dom.elements.get('dialogue-advance').click();
  assert.equal(dom.elements.get('dialogue-text').textContent, 'Second.');
  const space = key('Space', ' ');
  dom.elements.get('dialogue-advance').dispatchEvent(space);
  assert.equal(space.defaultPrevented, true, 'native keyup click suppressed');
  assert.equal(dom.elements.get('dialogue-text').textContent, 'Third.');
  assert.equal(discarded, 2);
  dialogue.ask('Choose a route.', [
    { id: 'north', label: 'North', outcome: [{ who: 'narration', text: 'North route.' }] },
    { id: 'south', label: 'South', outcome: [{ who: 'narration', text: 'South route.' }] },
  ]);
  const choices = dom.elements.get('dialogue-choices').children;
  choices[1].focus();
  assert.equal(choices[1].attrs.get('aria-pressed'), 'true');
  choices[1].dispatchEvent(key('Enter', 'Enter'));
  assert.equal(dialogue.chosen, 'south');
  assert.equal(dom.elements.get('dialogue-text').textContent, 'South route.');
  assert.equal(discarded, 3);
});

test('full map covers the expanded world, distinguishes activities, caches terrain and closes through the game callback', () => {
  const dom = setupDOM();
  let waterQueries = 0;
  let furthestQuery = 0;
  let closeCalls = 0;
  const city = {
    extent: 2775,
    landmarks: [{ name: 'Outer station', position: new Vector3(2250, 0, -2250), accent: '#fff' }],
    districtNameAt(x) { return x > 1800 ? 'New district' : 'Central district'; },
    isWater(x, z) { waterQueries += 1; furthestQuery = Math.max(furthestQuery, Math.abs(x), Math.abs(z)); return Math.abs(x - 1050) < 75 && Math.abs(z) > 55; },
  };
  const hud = new Hud(city, () => { closeCalls += 1; hud.closeMap(); });
  const player = {
    position: new Vector3(2200, 0, 2100), root: { rotation: { y: 0.3 } },
    speedKph: 500, speed: 139, topSpeed: 360, health: 100, charge: 50, combo: 1,
    state: 'ground', dashCooldown: 0, speedRatio: 0.4, canBolt: () => true, canPulse: () => true,
  };
  hud.update(0.016, player, {
    modeLabel: 'Free roam', objective: { title: 'Explore Meridian', detail: 'Find a route.' },
    focusActive: false, markers: [{ position: new Vector3(2400, 0, 2100), style: 'rescue' }],
    rogue: null, prompt: null, motesFound: 0, motesTotal: 144, showMph: false, dialogueActive: false,
    activitySites: [{ name: 'Northline Circuit', position: new Vector3(2400, 0, 2400), kind: 'route' }],
  });
  assert.equal(hud.toggleMap(), true);
  assert.ok(furthestQuery > 2700, 'outer districts are sampled instead of the old 3.75 km map');
  const context = dom.elements.get('citymap').context;
  assert.ok(context.events.some(event => event.method === 'fillText' && event.args[0] === 'Northline Circuit'));
  assert.equal(dom.elements.get('map-district').textContent, 'New district');
  assert.match(dom.elements.get('map-status').textContent, /200 m/);
  assert.equal(dom.elements.get('map-scale-label').textContent, '5.55 km across');
  assert.equal(document.activeElement.id, 'map-close');
  const queries = waterQueries;
  hud.closeMap();
  hud.toggleMap();
  assert.equal(waterQueries, queries, 'reopening while paused uses the cached terrain and last game state');
  dom.elements.get('map-close').click();
  assert.equal(closeCalls, 1);
  assert.equal(hud.isMapOpen, false);
});
