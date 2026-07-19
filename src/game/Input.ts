export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const blocked = new Set([
      "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyF", "KeyQ", "KeyR", "KeyT",
      "ShiftLeft", "ShiftRight", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ]);

    window.addEventListener("keydown", (event) => {
      if (!this.held.has(event.code)) {
        this.pressed.add(event.code);
      }
      this.held.add(event.code);
      if (blocked.has(event.code)) event.preventDefault();
    });

    window.addEventListener("keyup", (event) => {
      this.held.delete(event.code);
      if (blocked.has(event.code)) event.preventDefault();
    });

    window.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        if (!this.held.has("Mouse0")) this.pressed.add("Mouse0");
        this.held.add("Mouse0");
      }
    });

    window.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.held.delete("Mouse0");
    });

    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.lookX += event.movementX;
        this.lookY += event.movementY;
      }
    });

    this.canvas.addEventListener("click", () => {
      if (document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock();
      }
    });
  }

  down(code: string): boolean {
    return this.held.has(code);
  }

  consume(code: string): boolean {
    const value = this.pressed.has(code);
    this.pressed.delete(code);
    return value;
  }

  movement(): { x: number; z: number } {
    return {
      x: Number(this.down("KeyD")) - Number(this.down("KeyA")),
      z: Number(this.down("KeyW")) - Number(this.down("KeyS")),
    };
  }

  takeLook(): { x: number; y: number } {
    const value = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return value;
  }
}
