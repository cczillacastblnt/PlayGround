import { AudioManager } from "./audio.js";
import { Game } from "./game.js";
import { Renderer } from "./render.js";
import { UI } from "./ui.js";
import { InputController } from "./input.js";

const canvas = document.getElementById("game");
const minimap = document.getElementById("minimap");
const portrait = document.getElementById("portrait");
const loading = document.getElementById("loading");

const audio = new AudioManager();
const game = new Game(audio);
const renderer = new Renderer(canvas, game, minimap, portrait);
let ui;
let input;
let tutorialToken = 0;
let lastTime = performance.now();
let firstFrame = true;

function clearTutorials() {
  tutorialToken++;
}

function startGame(difficulty) {
  clearTutorials();
  game.newGame(difficulty || "veteran");
  game.state = "playing";
  renderer.buildTerrain();
  ui.hidePause();
  ui.hideEnd();
  ui.enterGame();
  audio.setLowpassForPause(false);
  audio.unlock();
  audio.setMuted(ui.muted);
  game.audio = audio;

  game.emitAlert("Command link established. Build your economy and strike force.", "good", "DEPLOYMENT COMPLETE");
  const token = tutorialToken;
  setTimeout(() => {
    if (token !== tutorialToken || game.state !== "playing") return;
    game.emitAlert("Select your Command Nexus and queue more Fabricators.", "info", "ECONOMY");
  }, 5200);
  setTimeout(() => {
    if (token !== tutorialToken || game.state !== "playing") return;
    game.emitAlert("Select a Fabricator, then press Q for a Habitat or W for a Barracks.", "info", "CONSTRUCTION");
  }, 12500);
  setTimeout(() => {
    if (token !== tutorialToken || game.state !== "playing") return;
    game.emitAlert("Queue combat units, then press A and click to attack-move.", "info", "STRIKE DOCTRINE");
  }, 22000);
}

function goToMenu() {
  clearTutorials();
  game.state = "menu";
  game.buildMode = null;
  game.pendingCommand = null;
  ui.showMenu();
  audio.setLowpassForPause(true);
}

function pauseGame() {
  if (game.state !== "playing") return;
  game.state = "paused";
  ui.showPause();
  audio.setLowpassForPause(true);
}

function resumeGame() {
  if (game.state !== "paused") return;
  game.state = "playing";
  ui.hidePause();
  audio.setLowpassForPause(false);
  lastTime = performance.now();
}

const callbacks = {
  onDeploy: (difficulty) => startGame(difficulty),
  onPauseToggle: () => {
    if (game.state === "playing") pauseGame();
    else if (game.state === "paused") resumeGame();
  },
  onResume: () => resumeGame(),
  onRestart: () => startGame(game.difficultyKey),
  onReplay: () => startGame(game.difficultyKey),
  onQuit: () => goToMenu(),
  onAutoPause: () => pauseGame(),
};

ui = new UI(game, audio, renderer, callbacks);
input = new InputController(canvas, game, ui, callbacks);
window.__starfall = { game, renderer, ui, audio, input };

ui.showMenu();
loading.classList.add("is-hidden");

window.addEventListener("resize", () => renderer.resize());
window.addEventListener("orientationchange", () => setTimeout(() => renderer.resize(), 180));

let fpsClock = 0;
let frames = 0;

function frame(now) {
  const rawDt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const dt = rawDt || 0.016;

  if (game.state === "playing") {
    game.update(dt);
    ui.update(dt);
    input.update(dt);
  } else if (game.state === "paused") {
    // Keep rendering the paused battlefield but freeze simulation time.
  } else if (game.state === "menu") {
    game.update(dt);
  }

  renderer.render(dt);
  audio.update(dt);

  if (firstFrame) {
    firstFrame = false;
    document.body.classList.add("ready");
  }
  fpsClock += rawDt;
  frames++;
  if (fpsClock > 1) {
    fpsClock = 0;
    frames = 0;
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(frame);
});
