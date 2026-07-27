import type { Input } from "../core/Input";
import type { DialogueView } from "../story/Campaign";
import type { ChoiceOption, Line } from "../story/script";
import { CAST } from "../story/cast";

/**
 * The conversation panel.
 *
 * Lines advance one at a time on the advance key; a choice beat swaps the
 * hint for two buttons that can be driven with the mouse or with A/D and
 * Space, so the campaign never demands a pointer mid-run.
 */
export class Dialogue implements DialogueView {
  private readonly root = element("dialogue");
  private readonly chip = element("dialogue-chip");
  private readonly name = element("dialogue-name");
  private readonly role = element("dialogue-role");
  private readonly text = element("dialogue-text");
  private readonly hint = element("dialogue-hint");
  private readonly choiceBox = element("dialogue-choices");

  private lines: Line[] = [];
  private index = 0;
  private options: [ChoiceOption, ChoiceOption] | null = null;
  private highlighted = 0;
  private resolved: string | null = null;

  constructor(private readonly input: Input) {}

  get active(): boolean {
    return this.lines.length > 0 || this.options !== null;
  }

  get chosen(): string | null {
    return this.resolved;
  }

  show(lines: Line[]): void {
    if (lines.length === 0) return;
    this.lines = lines;
    this.index = 0;
    this.options = null;
    this.choiceBox.classList.add("is-hidden");
    this.choiceBox.replaceChildren();
    this.root.classList.remove("is-hidden");
    this.hint.textContent = "Space to continue";
    this.render();
  }

  ask(prompt: string, options: [ChoiceOption, ChoiceOption]): void {
    this.lines = [];
    this.options = options;
    this.highlighted = 0;
    this.resolved = null;
    this.root.classList.remove("is-hidden");
    this.root.classList.add("narration");
    this.chip.textContent = "?";
    this.chip.style.background = "#e8a53c";
    this.name.textContent = "Meridian City";
    this.role.textContent = "";
    this.text.textContent = prompt;
    this.hint.textContent = "A / D to choose · Space to confirm";

    this.choiceBox.replaceChildren();
    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.textContent = option.label;
      button.addEventListener("click", () => {
        this.highlighted = index;
        this.confirmChoice();
        // The same click also registered a Mouse0 edge, and Mouse0 is bound
        // to advance — without this the first outcome line is skipped.
        this.input.discard("advance");
      });
      this.choiceBox.append(button);
    });
    this.choiceBox.classList.remove("is-hidden");
    this.highlight();
  }

  advance(): void {
    if (this.options) {
      this.confirmChoice();
      return;
    }
    this.index += 1;
    if (this.index >= this.lines.length) {
      this.lines = [];
      return;
    }
    this.render();
  }

  cycle(direction: number): void {
    if (!this.options || direction === 0) return;
    // There are always exactly two options, so either direction just toggles.
    this.highlighted = this.highlighted === 0 ? 1 : 0;
    this.highlight();
  }

  hide(): void {
    this.lines = [];
    this.options = null;
    this.resolved = null;
    this.root.classList.add("is-hidden");
    this.root.classList.remove("narration");
    this.choiceBox.classList.add("is-hidden");
    this.choiceBox.replaceChildren();
  }

  private confirmChoice(): void {
    const options = this.options;
    if (!options) return;
    const picked = options[this.highlighted === 0 ? 0 : 1];
    this.resolved = picked.id;
    // The outcome lines replace the prompt in place.
    this.options = null;
    this.choiceBox.classList.add("is-hidden");
    this.choiceBox.replaceChildren();
    this.root.classList.remove("narration");
    this.hint.textContent = "Space to continue";
    this.lines = picked.outcome;
    this.index = 0;
    if (this.lines.length === 0) return;
    this.render();
  }

  private highlight(): void {
    const buttons = this.choiceBox.querySelectorAll(".choice-button");
    buttons.forEach((button, index) => {
      button.classList.toggle("selected", index === this.highlighted);
    });
  }

  private render(): void {
    const line = this.lines[this.index];
    if (!line) return;

    if (line.who === "narration") {
      this.root.classList.add("narration");
      this.chip.textContent = "···";
      this.chip.style.background = "rgba(238, 240, 241, 0.16)";
      this.chip.style.color = "#eef0f1";
      this.name.textContent = "Meridian City";
      this.role.textContent = "";
    } else {
      const member = CAST[line.who];
      this.root.classList.remove("narration");
      this.chip.textContent = (member?.short ?? "?").charAt(0);
      this.chip.style.background = member?.color ?? "#e8a53c";
      this.chip.style.color = "#0e1012";
      this.name.textContent = member?.name ?? line.who;
      this.role.textContent = member?.role ?? "";
    }

    this.text.textContent = line.text;
    this.hint.textContent =
      this.index >= this.lines.length - 1 ? "Space to close" : "Space to continue";
  }
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing dialogue element #${id}`);
  return value;
}
