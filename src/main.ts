import "./styles.css";
import { SpeedGame } from "./game/SpeedGame";

const canvas = document.getElementById("game-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Fastest Dude Alive requires a canvas element.");
}

document.title = "Fastest Dude Alive";

const game = new SpeedGame(canvas);
game.boot().catch((error: unknown) => {
  console.error(error);
  document.getElementById("loading")?.classList.add("is-hidden");
  document.getElementById("error-screen")?.classList.remove("is-hidden");
  const message = document.getElementById("error-message");
  if (message) {
    message.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  }
});
