import { completeLevel, LEVELS, levelSeed, loadHighestUnlocked } from "./game/campaign.js";
import { GameSession } from "./game/session.js";
import { InputController } from "./input/input.js";
import { createGame } from "./sim/setup.js";
import { Faction } from "./sim/stats.js";
import { clearOverlay, showLevelSelect, showMainMenu, showResult } from "./ui/screens.js";

type Mode = "menu" | "levelselect" | "playing" | "result";

class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlay: HTMLDivElement;
  private session: GameSession | null = null;
  private input: InputController | null = null;
  private mode: Mode = "menu";

  private faction: Faction = Faction.Human;
  private campaignSeed: number;
  private currentLevel = 0;

  private cssW = 0;
  private cssH = 0;
  private lastTime = 0;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, { position: "absolute", inset: "0", zIndex: "10" });
    host.appendChild(this.overlay);

    this.campaignSeed = readSeedFromUrl() ?? (Math.floor(Math.random() * 1_000_000) >>> 0);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.showMenu();
    requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.cssW * dpr);
    this.canvas.height = Math.floor(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.session?.resize(this.cssW, this.cssH);
  }

  private showMenu(): void {
    this.mode = "menu";
    this.teardownSession();
    showMainMenu(
      this.overlay,
      { faction: this.faction, seed: this.campaignSeed },
      {
        onStart: (faction, seed) => {
          this.faction = faction;
          this.campaignSeed = seed;
          this.startLevel(0);
        },
        onLevelSelect: (faction, seed) => {
          this.faction = faction;
          this.campaignSeed = seed;
          this.showLevelSelect();
        },
      },
    );
  }

  private showLevelSelect(): void {
    this.mode = "levelselect";
    showLevelSelect(this.overlay, loadHighestUnlocked(), {
      onPick: (index) => this.startLevel(index),
      onBack: () => this.showMenu(),
    });
  }

  private startLevel(index: number): void {
    this.teardownSession();
    clearOverlay(this.overlay);
    this.currentLevel = index;
    const def = LEVELS[index]!;
    const seed = levelSeed(this.campaignSeed, index);
    const init = createGame({
      seed,
      width: def.size,
      height: def.size,
      playerFaction: this.faction,
      difficulty: def.difficulty,
    });
    this.session = new GameSession(
      this.ctx,
      init,
      this.campaignSeed,
      `Lvl ${index + 1} · ${def.name}`,
      {
        onEnd: (result) => this.onEnd(result),
        onMenu: () => this.showMenu(),
      },
      this.cssW,
      this.cssH,
    );
    this.input = new InputController(this.canvas, this.session);
    this.mode = "playing";
  }

  private onEnd(result: "won" | "lost"): void {
    this.mode = "result";
    const def = LEVELS[this.currentLevel]!;
    const next = result === "won" ? completeLevel(this.currentLevel) : null;
    showResult(
      this.overlay,
      { result, levelName: def.name, nextLevel: next },
      {
        onContinue: () => {
          if (result === "won" && next !== null) this.startLevel(next);
          else this.startLevel(this.currentLevel); // retry / replay
        },
        onMenu: () => this.showMenu(),
      },
    );
  }

  private teardownSession(): void {
    this.input?.detach();
    this.input = null;
    this.session = null;
  }

  private loop(t: number): void {
    const now = t / 1000;
    let dt = this.lastTime === 0 ? 0 : now - this.lastTime;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1; // clamp after tab switches

    if (this.session && (this.mode === "playing" || this.mode === "result")) {
      if (this.mode === "playing") this.session.update(dt);
      this.session.render(this.ctx);
    } else {
      this.ctx.fillStyle = "#07090f";
      this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    }

    requestAnimationFrame((tt) => this.loop(tt));
  }
}

function readSeedFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("seed");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n >>> 0 : null;
}

const host = document.getElementById("app");
if (!host) throw new Error("#app host element missing");
new App(host);
