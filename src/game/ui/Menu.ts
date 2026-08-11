import type { Quality, Save } from "../core/Save";
import { ACT_TITLES, CHAPTERS, type Chapter } from "../story/script";

/**
 * Front end: mode select, chapter select, settings, controls, pause and the
 * results card. It owns no game state — every action is reported through the
 * callbacks the shell installs.
 */

export interface MenuCallbacks {
  onFreeRoam(): void;
  onChapter(chapter: Chapter): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onResultsPrimary(): void;
  onSettingsChanged(): void;
}

export class Menu {
  private readonly root = element("menu");
  private readonly panels = new Map<string, HTMLElement>();
  private readonly chapterList = element("chapter-list");
  private readonly menuStat = element("menu-stat");
  private readonly results = element("results");
  private readonly resultsEyebrow = element("results-eyebrow");
  private readonly resultsTitle = element("results-title");
  private readonly resultsBody = element("results-body");
  private readonly resultsPrimary = element("results-primary");
  private readonly pause = element("pause");
  private readonly pauseTitle = element("pause-title");

  constructor(
    private readonly save: Save,
    private readonly callbacks: MenuCallbacks,
  ) {
    for (const id of ["menu-root", "menu-chapters", "menu-settings", "menu-controls"]) {
      this.panels.set(id, element(id));
    }

    element("btn-free-roam").addEventListener("click", () => {
      this.hide();
      this.callbacks.onFreeRoam();
    });
    element("btn-story").addEventListener("click", () => {
      this.buildChapters();
      this.showPanel("menu-chapters");
    });
    element("btn-settings").addEventListener("click", () => this.showPanel("menu-settings"));
    element("btn-controls").addEventListener("click", () => this.showPanel("menu-controls"));

    for (const button of document.querySelectorAll<HTMLElement>("[data-back]")) {
      button.addEventListener("click", () => this.showPanel(button.dataset.back ?? "menu-root"));
    }

    element("pause-resume").addEventListener("click", () => this.callbacks.onResume());
    element("pause-restart").addEventListener("click", () => this.callbacks.onRestart());
    element("pause-quit").addEventListener("click", () => this.callbacks.onQuit());
    this.resultsPrimary.addEventListener("click", () => this.callbacks.onResultsPrimary());
    element("results-secondary").addEventListener("click", () => this.callbacks.onQuit());

    this.wireSettings();
  }

  /* ---------------- visibility ---------------- */

  show(): void {
    this.root.classList.remove("is-hidden");
    this.showPanel("menu-root");
    this.refreshStats();
  }

  hide(): void {
    this.root.classList.add("is-hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("is-hidden");
  }

  showPause(title: string): void {
    this.pauseTitle.textContent = title;
    this.pause.classList.remove("is-hidden");
  }

  hidePause(): void {
    this.pause.classList.add("is-hidden");
  }

  get pauseVisible(): boolean {
    return !this.pause.classList.contains("is-hidden");
  }

  showResults(eyebrow: string, title: string, body: string, primaryLabel: string): void {
    this.resultsEyebrow.textContent = eyebrow;
    this.resultsTitle.textContent = title;
    this.resultsBody.textContent = body;
    this.resultsPrimary.textContent = primaryLabel;
    this.results.classList.remove("is-hidden");
  }

  hideResults(): void {
    this.results.classList.add("is-hidden");
  }

  get resultsVisible(): boolean {
    return !this.results.classList.contains("is-hidden");
  }

  private showPanel(id: string): void {
    for (const [key, panel] of this.panels) {
      panel.classList.toggle("is-hidden", key !== id);
    }
  }

  /* ---------------- content ---------------- */

  private refreshStats(): void {
    const profile = this.save.data;
    const km = Math.round(profile.totalDistanceMeters / 100) / 10;
    const chapters = profile.campaign.completed.length;
    const relayClears = Object.values(profile.relayRecords).reduce(
      (total, record) => total + record.clears,
      0,
    );
    this.menuStat.textContent =
      `${km.toFixed(1)} km run · ${profile.collected.length} motes · ` +
      `${relayClears} relay clears · ${chapters}/${CHAPTERS.length} chapters · ` +
      `top ${Math.round(profile.topSpeedKph)} km/h`;
  }

  private buildChapters(): void {
    this.chapterList.replaceChildren();
    const unlocked = this.save.data.campaign.unlocked;
    const completed = new Set(this.save.data.campaign.completed);
    let currentAct = 0;

    for (const chapter of CHAPTERS) {
      if (chapter.act !== currentAct) {
        currentAct = chapter.act;
        const heading = document.createElement("p");
        heading.className = "act-heading";
        heading.textContent = ACT_TITLES[chapter.act];
        this.chapterList.append(heading);
      }

      const available = chapter.number <= unlocked;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "chapter-card";
      card.disabled = !available;

      const number = document.createElement("span");
      number.className = "chapter-number";
      number.textContent = chapter.number.toString().padStart(2, "0");

      const body = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = chapter.title;
      const blurb = document.createElement("p");
      blurb.textContent = available ? chapter.brief : chapter.subtitle;
      body.append(title, blurb);

      const flag = document.createElement("span");
      flag.className = completed.has(chapter.id) ? "chapter-flag" : "chapter-flag locked";
      flag.textContent = completed.has(chapter.id) ? "Complete" : available ? "Play" : "Locked";

      card.append(number, body, flag);
      card.addEventListener("click", () => {
        if (!available) return;
        this.hide();
        this.callbacks.onChapter(chapter);
      });
      this.chapterList.append(card);
    }
  }

  private wireSettings(): void {
    const quality = element("set-quality") as HTMLSelectElement;
    const sensitivity = element("set-sensitivity") as HTMLInputElement;
    const sensitivityValue = element("set-sensitivity-value");
    const reduced = element("set-reduced-motion") as HTMLInputElement;
    const mph = element("set-mph") as HTMLInputElement;
    const relayAssist = element("set-relay-assist") as HTMLInputElement;

    const settings = this.save.settings;
    quality.value = settings.quality;
    sensitivity.value = settings.lookSensitivity.toString();
    sensitivityValue.textContent = `${settings.lookSensitivity.toFixed(2)}×`;
    reduced.checked = settings.reducedMotion;
    mph.checked = settings.showSpeedInMph;
    relayAssist.checked = settings.relayAssist;

    quality.addEventListener("change", () => {
      const value = quality.value;
      if (value === "low" || value === "medium" || value === "high") {
        this.save.update((profile) => {
          profile.settings.quality = value as Quality;
        });
        this.callbacks.onSettingsChanged();
      }
    });

    sensitivity.addEventListener("input", () => {
      const value = Number(sensitivity.value);
      if (!Number.isFinite(value)) return;
      sensitivityValue.textContent = `${value.toFixed(2)}×`;
      this.save.update((profile) => {
        profile.settings.lookSensitivity = value;
      });
      this.callbacks.onSettingsChanged();
    });

    reduced.addEventListener("change", () => {
      this.save.update((profile) => {
        profile.settings.reducedMotion = reduced.checked;
      });
      this.callbacks.onSettingsChanged();
    });

    mph.addEventListener("change", () => {
      this.save.update((profile) => {
        profile.settings.showSpeedInMph = mph.checked;
      });
      this.callbacks.onSettingsChanged();
    });

    relayAssist.addEventListener("change", () => {
      this.save.update((profile) => {
        profile.settings.relayAssist = relayAssist.checked;
      });
      this.callbacks.onSettingsChanged();
    });

    element("btn-reset-profile").addEventListener("click", () => {
      // Destructive and irreversible, so it asks first.
      if (!window.confirm("Reset every route time, mote, relay record and chapter? This cannot be undone.")) return;
      this.save.reset();
      quality.value = this.save.settings.quality;
      sensitivity.value = this.save.settings.lookSensitivity.toString();
      reduced.checked = this.save.settings.reducedMotion;
      mph.checked = this.save.settings.showSpeedInMph;
      relayAssist.checked = this.save.settings.relayAssist;
      this.refreshStats();
      this.callbacks.onSettingsChanged();
    });
  }
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing menu element #${id}`);
  return value;
}
