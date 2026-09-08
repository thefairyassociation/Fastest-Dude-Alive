/**
 * Versioned player profile.
 *
 * Saves are treated as public data: every field is optional on read, every
 * unknown shape falls back to defaults, and a version bump routes through
 * `migrate` rather than silently discarding progress. The prototype uses
 * localStorage; the shape is deliberately IndexedDB-ready.
 */

const KEY = "fastest-dude-alive:profile";
const VERSION = 3;

/**
 * Bounds for anything read back from storage. A profile is user-editable, so
 * treat it as untrusted input: a hand-written `unlocked: 9999` or a
 * million-entry `collected` array should cost nothing at parse time.
 */
const MAX_CHAPTERS = 15;
const MAX_IDS = 512;

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > 64) continue;
    seen.add(entry);
    if (seen.size >= MAX_IDS) break;
  }
  return [...seen];
}

export type Quality = "low" | "medium" | "high";

export interface Settings {
  quality: Quality;
  lookSensitivity: number;
  /** Trims camera shake, speed-line density and screen pulses. */
  reducedMotion: boolean;
  showSpeedInMph: boolean;
  masterVolume: number;
  muted: boolean;
}

export interface CampaignSave {
  /** Highest chapter unlocked (1-based). */
  unlocked: number;
  /** Chapter ids the player has finished. */
  completed: string[];
  /** Chapter the player is midway through, if any. */
  current: string | null;
  /** Decisions by chapter id, retained for rebuilding chapters. */
  choices: Record<string, string>;
}

/** A bounded 5 Hz personal-best recording. Samples are [seconds, x, y, z, heading]. */
export interface RouteReplay {
  duration: number;
  frames: Array<[number, number, number, number, number]>;
}
export const MAX_REPLAY_FRAMES = 1201;
export const MAX_REPLAYS = 8;

export interface Profile {
  version: number;
  settings: Settings;
  campaign: CampaignSave;
  /** Best time in seconds per free-roam route id. */
  routeBests: Record<string, number>;
  routeReplays: Record<string, RouteReplay>;
  /** Collectible ids the player has picked up. */
  collected: string[];
  /** Rogue ids beaten at least once in free roam. */
  roguesBeaten: string[];
  totalDistanceMeters: number;
  topSpeedKph: number;
}

export const DEFAULT_PROFILE: Profile = {
  version: VERSION,
  settings: {
    quality: "medium",
    lookSensitivity: 1,
    reducedMotion: false,
    showSpeedInMph: false,
    masterVolume: 0.65,
    muted: false,
  },
  campaign: { unlocked: 1, completed: [], current: null, choices: {} },
  routeBests: {},
  routeReplays: {},
  collected: [],
  roguesBeaten: [],
  totalDistanceMeters: 0,
  topSpeedKph: 0,
};

export class Save {
  private profile: Profile = DEFAULT_PROFILE;
  private flushHandle = 0;

  constructor() {
    this.profile = this.read();
  }

  get data(): Profile {
    return this.profile;
  }

  get settings(): Settings {
    return this.profile.settings;
  }

  /** Mutate through here so every write is debounced and persisted. */
  update(mutator: (profile: Profile) => void): void {
    mutator(this.profile);
    this.scheduleFlush();
  }

  recordRoute(id: string, seconds: number, replay?: RouteReplay): boolean {
    if (!safeId(id) || !Number.isFinite(seconds) || seconds <= 0) return false;
    const previous = this.profile.routeBests[id];
    if (previous !== undefined && previous <= seconds) return false;
    this.profile.routeBests[id] = seconds;
    delete this.profile.routeReplays[id];
    const checked = validateReplay(replay);
    if (checked && Math.abs(checked.duration - seconds) < 0.02) {
      const ids = Object.keys(this.profile.routeReplays);
      if (ids.length >= MAX_REPLAYS) delete this.profile.routeReplays[ids[0]!];
      this.profile.routeReplays[id] = checked;
    }
    this.scheduleFlush();
    return true;
  }

  bestFor(id: string): number | null {
    return this.profile.routeBests[id] ?? null;
  }

  collect(id: string): boolean {
    if (this.profile.collected.includes(id)) return false;
    this.profile.collected.push(id);
    this.scheduleFlush();
    return true;
  }

  hasCollected(id: string): boolean {
    return this.profile.collected.includes(id);
  }

  completeChapter(id: string, index: number): void {
    if (!this.profile.campaign.completed.includes(id)) {
      this.profile.campaign.completed.push(id);
    }
    this.profile.campaign.unlocked = Math.min(
      MAX_CHAPTERS,
      Math.max(this.profile.campaign.unlocked, index + 2),
    );
    this.profile.campaign.current = null;
    this.scheduleFlush();
  }

  reset(): void {
    this.profile = structuredClone(DEFAULT_PROFILE);
    this.flush();
  }

  flush(): void {
    window.clearTimeout(this.flushHandle);
    this.flushHandle = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.profile));
    } catch (error) {
      console.warn("Could not persist the profile.", error);
    }
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== 0) return;
    this.flushHandle = window.setTimeout(() => this.flush(), 400);
  }

  private read(): Profile {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (error) {
      console.warn("Storage is unavailable; playing without a profile.", error);
      return structuredClone(DEFAULT_PROFILE);
    }
    if (raw === null) return this.adoptLegacyKeys(structuredClone(DEFAULT_PROFILE));

    try {
      const parsed: unknown = JSON.parse(raw);
      return migrate(parsed);
    } catch (error) {
      console.warn("The stored profile was unreadable and has been reset.", error);
      return structuredClone(DEFAULT_PROFILE);
    }
  }

  /** v1 of the prototype stored only the loop best under its own key. */
  private adoptLegacyKeys(profile: Profile): Profile {
    try {
      const legacy = localStorage.getItem("fastest-dude-alive:meridian-loop-best");
      const parsed = legacy === null ? Number.NaN : Number(legacy);
      if (Number.isFinite(parsed)) profile.routeBests["meridian-loop"] = parsed;
    } catch {
      // Nothing to adopt.
    }
    return profile;
  }
}

export function migrate(raw: unknown): Profile {
  const profile = structuredClone(DEFAULT_PROFILE);
  if (typeof raw !== "object" || raw === null) return profile;
  const source = raw as Partial<Profile>;

  if (typeof source.settings === "object" && source.settings !== null) {
    const s = source.settings as Partial<Settings>;
    if (s.quality === "low" || s.quality === "medium" || s.quality === "high") {
      profile.settings.quality = s.quality;
    }
    if (typeof s.lookSensitivity === "number" && Number.isFinite(s.lookSensitivity)) {
      profile.settings.lookSensitivity = Math.min(3, Math.max(0.2, s.lookSensitivity));
    }
    if (typeof s.masterVolume === "number" && Number.isFinite(s.masterVolume)) {
      profile.settings.masterVolume = Math.min(1, Math.max(0, s.masterVolume));
    }
    profile.settings.muted = s.muted === true;
    profile.settings.reducedMotion = s.reducedMotion === true;
    profile.settings.showSpeedInMph = s.showSpeedInMph === true;
  }

  if (typeof source.campaign === "object" && source.campaign !== null) {
    const c = source.campaign as Partial<CampaignSave>;
    if (typeof c.unlocked === "number" && Number.isFinite(c.unlocked)) {
      profile.campaign.unlocked = Math.min(MAX_CHAPTERS, Math.max(1, Math.floor(c.unlocked)));
    }
    profile.campaign.completed = idList(c.completed);
    profile.campaign.current = typeof c.current === "string" && safeId(c.current) ? c.current : null;
    if (c.choices && typeof c.choices === "object") {
      for (const [id, decision] of Object.entries(c.choices).slice(0, MAX_CHAPTERS)) {
        if (safeId(id) && typeof decision === "string" && safeId(decision)) profile.campaign.choices[id] = decision;
      }
    }
    // Completing the old finale should immediately unlock the new epilogue.
    if (profile.campaign.completed.includes("ch12-fastest-dude-alive")) {
      profile.campaign.unlocked = Math.max(13, profile.campaign.unlocked);
    }
  }

  if (typeof source.routeBests === "object" && source.routeBests !== null) {
    let kept = 0;
    for (const [id, value] of Object.entries(source.routeBests)) {
      if (kept >= MAX_IDS) break;
      if (!safeId(id) || typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      profile.routeBests[id] = value;
      kept += 1;
    }
  }

  if (source.routeReplays && typeof source.routeReplays === "object") {
    for (const [id, data] of Object.entries(source.routeReplays).slice(0, MAX_REPLAYS)) {
      if (!safeId(id)) continue;
      const replay = validateReplay(data);
      if (replay && Math.abs(replay.duration - (profile.routeBests[id] ?? -1)) < 0.02) profile.routeReplays[id] = replay;
    }
  }

  profile.collected = idList(source.collected);
  profile.roguesBeaten = idList(source.roguesBeaten);
  if (typeof source.totalDistanceMeters === "number" && Number.isFinite(source.totalDistanceMeters)) {
    profile.totalDistanceMeters = source.totalDistanceMeters;
  }
  if (typeof source.topSpeedKph === "number" && Number.isFinite(source.topSpeedKph)) {
    profile.topSpeedKph = source.topSpeedKph;
  }

  profile.version = VERSION;
  return profile;
}

function safeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function validateReplay(raw: unknown): RouteReplay | null {
  if (!raw || typeof raw !== "object") return null;
  const replay = raw as Partial<RouteReplay>;
  if (typeof replay.duration !== "number" || !Number.isFinite(replay.duration) || replay.duration <= 0 || replay.duration > 240) return null;
  if (!Array.isArray(replay.frames) || replay.frames.length < 2 || replay.frames.length > MAX_REPLAY_FRAMES) return null;
  let previous = -1;
  for (const frame of replay.frames) {
    if (!Array.isArray(frame) || frame.length !== 5 || !frame.every(Number.isFinite)) return null;
    const [time, x, y, z, heading] = frame;
    if (time < 0 || time <= previous || time > replay.duration + 0.02) return null;
    if (Math.abs(x) > 4000 || Math.abs(z) > 4000 || y < -100 || y > 1000 || Math.abs(heading) > 100) return null;
    previous = time;
  }
  if (replay.frames[0]![0] !== 0 || Math.abs(previous - replay.duration) > 0.02) return null;
  return { duration: replay.duration, frames: replay.frames.map(frame => [...frame]) };
}
