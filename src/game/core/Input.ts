/**
 * Keyboard/mouse/gamepad input with pointer lock.
 *
 * Actions are named rather than key-coded so the campaign UI, the menu and
 * gameplay can all ask the same questions ("is the player holding sprint?")
 * without knowing the binding. Bindings live in one table and can be
 * remapped at runtime.
 */
export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "jump"
  | "slide"
  | "strike"
  | "bolt"
  | "pulse"
  | "focus"
  | "interact"
  | "activity"
  | "recover"
  | "advance"
  | "pause"
  | "map"
  | "recenter";

const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  sprint: ["ShiftLeft", "ShiftRight"],
  jump: ["Space"],
  slide: ["ControlLeft", "KeyC"],
  strike: ["Mouse0"],
  bolt: ["KeyE"],
  pulse: ["KeyQ"],
  focus: ["KeyF", "Mouse2"],
  interact: ["KeyE"],
  activity: ["KeyT"],
  recover: ["KeyR"],
  advance: ["Space", "Enter", "Mouse0"],
  pause: ["Escape"],
  map: ["KeyM"],
  recenter: ["KeyV"],
};

/** Codes we swallow so the page never scrolls or scrubs under the game. */
const BLOCKED = new Set([
  "KeyI", "KeyJ", "KeyK", "KeyL", "KeyV",
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyF", "KeyQ", "KeyR", "KeyT", "KeyC", "KeyM",
  "ShiftLeft", "ShiftRight", "ControlLeft", "Space",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  /** Gamepad buttons currently down, and the edges not yet consumed. */
  private readonly padHeld = new Set<number>();
  private readonly padPressed = new Set<number>();
  /** A menu's held confirm/back must be released before gameplay can own it. */
  private readonly padQuarantined = new Set<number>();
  /** Tracks the gamepad Start button independently of gameplay input. */
  private padPauseHeld = false;
  private padMapHeld = false;
  private readonly bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  private lookX = 0;
  private lookY = 0;
  private readonly moveSample = { x: 0, z: 0 };
  private readonly lookSample = { x: 0, y: 0 };
  /** Multiplies raw mouse deltas; exposed through the settings panel. */
  lookSensitivity = 1;
  private enabled = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      if (!this.enabled) return;
      this.pressed.add(event.code);
      this.held.add(event.code);
      if (BLOCKED.has(event.code)) event.preventDefault();
    });

    window.addEventListener("keyup", (event) => {
      this.held.delete(event.code);
      if (this.enabled && BLOCKED.has(event.code)) event.preventDefault();
    });

    // Losing focus mid-sprint used to leave keys stuck down forever.
    window.addEventListener("blur", () => this.releaseAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });

    window.addEventListener("mousedown", (event) => {
      if (!this.enabled) return;
      const code = `Mouse${event.button}`;
      if (!this.held.has(code)) this.pressed.add(code);
      this.held.add(code);
    });

    window.addEventListener("mouseup", (event) => {
      this.held.delete(`Mouse${event.button}`);
    });

    window.addEventListener("contextmenu", (event) => {
      if (document.pointerLockElement === this.canvas) event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.lookX += event.movementX;
        this.lookY += event.movementY;
      }
    });
  }

  /** Gameplay input is muted while a menu or a cutscene owns the screen. */
  setEnabled(value: boolean): void {
    if (this.enabled === value) return;
    this.enabled = value;
    if (!value) this.releaseAll();
    else {
      const pad = this.gamepad();
      if (pad) {
        for (let index = 0; index < pad.buttons.length; index += 1) {
          if (pad.buttons[index]?.pressed) this.padQuarantined.add(index);
        }
      }
    }
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      // Some embedded browsers deny capture. Keyboard camera controls remain available.
      try { void this.canvas.requestPointerLock()?.catch(() => {}); } catch { /* unsupported capture */ }
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /**
   * Samples gamepad button transitions into the same edge set the keyboard
   * uses. Call once per simulation step: `consume` clears edges, so a press
   * survives until something actually claims it.
   */
  poll(): void {
    const pad = this.gamepad();
    if (!pad) {
      this.padHeld.clear();
      this.padPressed.clear();
      this.padQuarantined.clear();
      return;
    }
    for (let index = 0; index < pad.buttons.length; index += 1) {
      const down = pad.buttons[index]?.pressed === true;
      if (this.padQuarantined.has(index)) {
        if (!down) this.padQuarantined.delete(index);
        continue;
      }
      if (down) {
        if (!this.padHeld.has(index)) this.padPressed.add(index);
        this.padHeld.add(index);
      } else {
        this.padHeld.delete(index);
      }
    }
  }

  /**
   * Samples the gamepad Start button even while gameplay input is disabled.
   * This lets Start resume a paused run without allowing other buttons to
   * accumulate while a menu owns the screen.
   */
  pollPause(): boolean {
    if (typeof navigator.getGamepads !== "function") {
      this.padPauseHeld = false;
      return false;
    }
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected) continue;
      const down = pad.buttons[9]?.pressed === true;
      const pressed = down && !this.padPauseHeld;
      this.padPauseHeld = down;
      return pressed;
    }
    this.padPauseHeld = false;
    return false;
  }

  /** The city map owns a pause, so R3 must still be readable with gameplay muted. */
  pollMap(): boolean {
    if (typeof navigator.getGamepads !== "function") { this.padMapHeld = false; return false; }
    const pad = Array.from(navigator.getGamepads()).find(candidate => candidate?.connected);
    const held = pad?.buttons[11]?.pressed === true;
    const pressed = held && !this.padMapHeld;
    this.padMapHeld = held;
    return pressed;
  }

  down(action: Action): boolean {
    for (const code of this.bindings[action]) {
      if (this.held.has(code)) return true;
    }
    return this.gamepadDown(action);
  }

  /** True once per press; clears the press so two systems cannot both claim it. */
  consume(action: Action): boolean {
    let found = false;
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) found = true;
    }
    const button = GAMEPAD_BUTTONS[action];
    if (button !== undefined && this.padPressed.delete(button)) found = true;
    return found;
  }

  /** Reads a press without clearing it — for HUD hints and prompts. */
  peek(action: Action): boolean {
    for (const code of this.bindings[action]) {
      if (this.pressed.has(code)) return true;
    }
    const button = GAMEPAD_BUTTONS[action];
    return button !== undefined && this.padPressed.has(button);
  }

  /**
   * Drops a press that has already been claimed by the DOM.
   * Clicking a dialogue choice fires the button's handler *and* records a
   * Mouse0 edge, which the same frame's advance would otherwise eat.
   */
  discard(action: Action): void {
    for (const code of this.bindings[action]) this.pressed.delete(code);
    const button = GAMEPAD_BUTTONS[action];
    if (button !== undefined) this.padPressed.delete(button);
  }

  bind(action: Action, codes: string[]): void {
    this.bindings[action] = codes;
  }

  bindingLabel(action: Action): string {
    const first = this.bindings[action][0] ?? "";
    return keyLabel(first);
  }

  movement(): { x: number; z: number } {
    const pad = this.gamepad();
    if (pad) {
      const x = pad.axes[0] ?? 0;
      const z = -(pad.axes[1] ?? 0);
      const length = Math.hypot(x, z);
      if (length > 0.18) {
        const magnitude = Math.min(1, (length - 0.18) / 0.82);
        this.moveSample.x = x / length * magnitude;
        this.moveSample.z = z / length * magnitude;
        return this.moveSample;
      }
    }
    this.moveSample.x = Number(this.down("right")) - Number(this.down("left"));
    this.moveSample.z = Number(this.down("forward")) - Number(this.down("back"));
    return this.moveSample;
  }

  takeLook(dt = 1 / 60): { x: number; y: number } {
    if (this.enabled) {
      const seconds = Math.min(0.05, Math.max(0, dt));
      this.lookX += (Number(this.held.has("KeyL")) - Number(this.held.has("KeyJ"))) * 900 * seconds;
      this.lookY += (Number(this.held.has("KeyK")) - Number(this.held.has("KeyI"))) * 700 * seconds;
    }
    const pad = this.gamepad();
    if (pad) {
      const frameScale = Math.min(0.05, Math.max(0, dt)) * 60;
      this.lookX += deadzone(pad.axes[2] ?? 0) * 22 * frameScale;
      this.lookY += deadzone(pad.axes[3] ?? 0) * 18 * frameScale;
    }
    this.lookSample.x = this.lookX * this.lookSensitivity;
    this.lookSample.y = this.lookY * this.lookSensitivity;
    this.lookX = 0;
    this.lookY = 0;
    return this.lookSample;
  }

  /** Drops every held/pressed code — used on blur and on mode changes. */
  releaseAll(): void {
    this.held.clear();
    this.pressed.clear();
    this.padHeld.clear();
    this.padPressed.clear();
    this.padQuarantined.clear();
    this.lookX = 0;
    this.lookY = 0;
  }

  private gamepad(): Gamepad | null {
    if (!this.enabled || typeof navigator.getGamepads !== "function") return null;
    for (const pad of navigator.getGamepads()) {
      if (pad?.connected) return pad;
    }
    return null;
  }

  private gamepadDown(action: Action): boolean {
    const pad = this.gamepad();
    if (!pad) return false;
    const index = GAMEPAD_BUTTONS[action];
    if (index === undefined) return false;
    if (this.padQuarantined.has(index)) return false;
    return pad.buttons[index]?.pressed === true;
  }
}

const GAMEPAD_BUTTONS: Partial<Record<Action, number>> = {
  jump: 0,
  slide: 1,
  strike: 2,
  bolt: 3,
  pulse: 5,
  focus: 4,
  sprint: 10,
  interact: 2,
  activity: 8,
  map: 11,
  advance: 0,
  pause: 9,
};

function deadzone(value: number): number {
  return Math.abs(value) < 0.18 ? 0 : value;
}

function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Mouse0") return "LMB";
  if (code === "Mouse2") return "RMB";
  if (code === "Space") return "Spc";
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft") return "Ctrl";
  return code;
}
