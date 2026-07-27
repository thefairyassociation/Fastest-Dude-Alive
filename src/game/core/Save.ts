/**
 * Versioned player profile.
 *
 * Saves are treated as public data: every field is optional on read, every
 * unknown shape falls back to defaults, and a version bump routes through
 * `migrate` rather than silently discarding progress. The prototype uses
 * localStorage; the shape is deliberately IndexedDB-ready.
 */

const KEY = "fastest-dude-alive:profile";
const VERSION = 2;

/**
 * Bounds for anything read back from storage. A profile is user-editable, so
 * treat it as untrusted input: a hand-written `unlocked: 9999` or a
 * million-entry `collected` array should cost nothing at parse time.
 */
const MAX_CHAPTERS = 12;
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
}

export interface CampaignSave {
  /** Highest chapter unlocked (1-based). */
  unlocked: number;
  /** Chapter ids the player has finished. */
  completed: string[];
  /** Chapter the player is midway through, if any. */
  current: string | null;
}

export interface Profile {
  version: number;
  settings: Settings;
  campaign: CampaignSave;
  /** Best time in seconds per free-roam route id. */
  routeBests: Record<string, number>;
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
    quality: "high",
    lookSensitivity: 1,
    reducedMotion: false,
    showSpeedInMph: false,
  },
  campaign: { unlocked: 1, completed: [], current: null },
  routeBests: {},
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

  recordRoute(id: string, seconds: number): boolean {
    const previous = this.profile.routeBests[id];
    if (previous !== undefined && previous <= seconds) return false;
    this.profile.routeBests[id] = seconds;
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

function migrate(raw: unknown): Profile {
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
    profile.settings.reducedMotion = s.reducedMotion === true;
    profile.settings.showSpeedInMph = s.showSpeedInMph === true;
  }

  if (typeof source.campaign === "object" && source.campaign !== null) {
    const c = source.campaign as Partial<CampaignSave>;
    if (typeof c.unlocked === "number" && Number.isFinite(c.unlocked)) {
      profile.campaign.unlocked = Math.min(MAX_CHAPTERS, Math.max(1, Math.floor(c.unlocked)));
    }
    profile.campaign.completed = idList(c.completed);
    profile.campaign.current = typeof c.current === "string" ? c.current : null;
  }

  if (typeof source.routeBests === "object" && source.routeBests !== null) {
    let kept = 0;
    for (const [id, value] of Object.entries(source.routeBests)) {
      if (kept >= MAX_IDS) break;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      profile.routeBests[id] = value;
      kept += 1;
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
