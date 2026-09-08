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
  private activePanel = "menu-root";
  private padConfirmHeld = false;
  private padBackHeld = false;
  private padDirection = 0;
  private padRepeatAt = 0;

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
    element("campaign-chapter-count").textContent = `${CHAPTERS.length} chapters / The campaign`;
    this.wireNavigation();
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
    this.focusFirst(this.pause);
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
    this.focusFirst(this.results);
  }

  hideResults(): void {
    this.results.classList.add("is-hidden");
  }

  get resultsVisible(): boolean {
    return !this.results.classList.contains("is-hidden");
  }

  private showPanel(id: string): void {
    this.activePanel = id;
    for (const [key, panel] of this.panels) {
      panel.classList.toggle("is-hidden", key !== id);
      panel.inert = key !== id;
    }
    const panel = this.panels.get(id);
    if (panel && this.visible) this.focusFirst(panel);
    this.root.scrollTop = 0;
  }

  /* ---------------- content ---------------- */

  private refreshStats(): void {
    const profile = this.save.data;
    const km = Math.round(profile.totalDistanceMeters / 100) / 10;
    const chapters = profile.campaign.completed.length;
    const mph = this.save.settings.showSpeedInMph;
    const best = Math.round(profile.topSpeedKph * (mph ? 0.621371 : 1));
    this.menuStat.textContent =
      `${km.toFixed(1)} km travelled · ${profile.collected.length} motes found · ` +
      `${chapters}/${CHAPTERS.length} chapters · best ${best} ${mph ? "mph" : "km/h"}`;
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
      card.classList.toggle("current", chapter.number === unlocked);
      if (chapter.number === unlocked) card.setAttribute("aria-current", "step");

      const number = document.createElement("span");
      number.className = "chapter-number";
      number.textContent = chapter.number.toString().padStart(2, "0");

      const body = document.createElement("span");
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
    const volume = element("setting-volume") as HTMLInputElement;
    const volumeValue = element("setting-volume-value");
    const muted = element("setting-muted") as HTMLInputElement;

    const settings = this.save.settings;
    quality.value = settings.quality;
    sensitivity.value = settings.lookSensitivity.toString();
    sensitivityValue.textContent = `${settings.lookSensitivity.toFixed(2)}×`;
    reduced.checked = settings.reducedMotion;
    mph.checked = settings.showSpeedInMph;
    volume.value = settings.masterVolume.toString();
    volumeValue.textContent = `${Math.round(settings.masterVolume * 100)}%`;
    muted.checked = settings.muted;
    volume.addEventListener("input", () => {
      const value = Number(volume.value);
      if (!Number.isFinite(value)) return;
      volumeValue.textContent = `${Math.round(value * 100)}%`;
      this.save.update((profile) => { profile.settings.masterVolume = value; });
      this.callbacks.onSettingsChanged();
    });
    muted.addEventListener("change", () => {
      this.save.update((profile) => { profile.settings.muted = muted.checked; });
      this.callbacks.onSettingsChanged();
    });

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

    element("btn-reset-profile").addEventListener("click", () => {
      // Destructive and irreversible, so it asks first.
      if (!window.confirm("Reset every route time, mote and chapter? This cannot be undone.")) return;
      this.save.reset();
      quality.value = this.save.settings.quality;
      sensitivity.value = this.save.settings.lookSensitivity.toString();
      sensitivityValue.textContent = `${this.save.settings.lookSensitivity.toFixed(2)}×`;
      volume.value = this.save.settings.masterVolume.toString();
      volumeValue.textContent = `${Math.round(this.save.settings.masterVolume * 100)}%`;
      muted.checked = this.save.settings.muted;
      reduced.checked = this.save.settings.reducedMotion;
      mph.checked = this.save.settings.showSpeedInMph;
      this.refreshStats();
      this.callbacks.onSettingsChanged();
    });
  }
  /** Native controls remain keyboard operable; the same focus model drives a pad. */
  private wireNavigation(): void {
    window.addEventListener("keydown", (event) => {
      const scope = this.navigationScope();
      if (!scope) return;
      if (event.key === "Escape" && this.visible && this.activePanel !== "menu-root") {
        event.preventDefault();
        this.showPanel("menu-root");
        return;
      }
      const active = document.activeElement;
      const editing = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
      if (!editing && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        this.moveFocus(scope, event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === "Tab") {
        const controls = this.controls(scope);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (active === first || !scope.contains(active))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (active === last || !scope.contains(active))) {
          event.preventDefault();
          first?.focus();
        }
      }
    });

    const poll = (now: number) => {
      const scope = this.navigationScope();
      const pad = typeof navigator.getGamepads === "function"
        ? Array.from(navigator.getGamepads()).find((entry) => entry?.connected)
        : null;
      const confirm = pad?.buttons[0]?.pressed === true;
      const back = pad?.buttons[1]?.pressed === true;
      let direction = 0;
      if (pad) {
        if (pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -0.6) direction = -1;
        if (pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > 0.6) direction = 1;
      }
      if (scope && !document.hidden) {
        if (direction && (direction !== this.padDirection || now >= this.padRepeatAt)) {
          this.moveFocus(scope, direction);
          this.padRepeatAt = now + (direction !== this.padDirection ? 380 : 150);
        }
        const active = document.activeElement;
        if (active && scope.contains(active)) {
          const horizontal = pad?.buttons[14]?.pressed || (pad?.axes[0] ?? 0) < -0.6 ? -1
            : pad?.buttons[15]?.pressed || (pad?.axes[0] ?? 0) > 0.6 ? 1 : 0;
          if (horizontal && now >= this.padRepeatAt) {
            this.adjustControl(active, horizontal);
            this.padRepeatAt = now + 180;
          }
          if (confirm && !this.padConfirmHeld) {
            if (active instanceof HTMLButtonElement) active.click();
            else if (active instanceof HTMLInputElement && active.type === "checkbox") active.click();
            else if (active instanceof HTMLSelectElement) this.adjustControl(active, 1);
          }
        } else if (confirm && !this.padConfirmHeld) this.focusFirst(scope);
        if (back && !this.padBackHeld) {
          if (this.visible && this.activePanel !== "menu-root") this.showPanel("menu-root");
          else if (this.pauseVisible) this.callbacks.onResume();
        }
      }
      this.padConfirmHeld = confirm;
      this.padBackHeld = back;
      this.padDirection = direction;
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  private navigationScope(): HTMLElement | null {
    if (this.resultsVisible) return this.results;
    if (this.pauseVisible) return this.pause;
    if (this.visible) return this.panels.get(this.activePanel) ?? this.root;
    return null;
  }

  private controls(scope: HTMLElement): HTMLElement[] {
    return Array.from(scope.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)"))
      .filter((control) => !control.closest(".is-hidden") && !control.hidden);
  }

  private focusFirst(scope: HTMLElement): void {
    this.controls(scope)[0]?.focus({ preventScroll: true });
  }

  private moveFocus(scope: HTMLElement, direction: number): void {
    const controls = this.controls(scope);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? 0 : (index + direction + controls.length) % controls.length;
    controls[next]?.focus({ preventScroll: true });
    controls[next]?.scrollIntoView({ block: "nearest" });
  }

  private adjustControl(control: Element, direction: number): void {
    if (control instanceof HTMLInputElement && control.type === "range") {
      if (direction > 0) control.stepUp(); else control.stepDown();
      control.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (control instanceof HTMLSelectElement) {
      control.selectedIndex = Math.max(0, Math.min(control.options.length - 1, control.selectedIndex + direction));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing menu element #${id}`);
  return value;
}
