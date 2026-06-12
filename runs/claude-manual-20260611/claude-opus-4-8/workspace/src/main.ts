/**
 * Application shell (T18) — the screen state machine + render loop that turn the
 * headless simulation, render, HUD, and input layers into a playable game.
 *
 * Responsibilities (WIRING ONLY — no game logic lives here):
 *   - A screen STATE MACHINE: menu → levelSelect → match → result → (next level
 *     / replay / back to menu). Each non-match screen is a DOM overlay from
 *     `src/ui/menus.ts`; the match screen is the canvas.
 *   - Per match: read the campaign seed (`?seed=` or the menu text input), build
 *     the selected level's `GameSession`, and `bindInput` to drive selection +
 *     orders.
 *   - A single requestAnimationFrame loop: each frame compute the real dt, call
 *     `session.frame(dt)` (the fixed-timestep sim lives inside the session), then
 *     render the world + HUD + minimap, then check `session.checkEndCondition()`
 *     and transition to the result screen on a decided outcome (recording the
 *     victory to unlock the next level).
 *
 * DISCIPLINE: all mutable state lives in the `App` object below (the app shell —
 * permitted), not in module-level variables. No `Math.random` (seeds flow only
 * through `seedFromUrl`); no game logic (that is all in the imported modules).
 */

import { GameSession } from "./game/session.js";
import type { SessionViewport } from "./game/session.js";
import { render, drawPlacementGhost } from "./render/renderer.js";
import { renderHud } from "./ui/hud.js";
import { renderMinimap } from "./render/minimap.js";
import type { PixelRect } from "./render/minimap.js";
import { bindInput } from "./input/input.js";
import { screenToWorldX, screenToWorldY } from "./render/camera.js";
import { seedFromUrl } from "./core/rng.js";
import type { Vec2 } from "./core/vec.js";
import type { Faction } from "./game/types.js";
import {
  CAMPAIGN_LEVELS,
  campaignLevel,
  levelSeed,
  isLevelUnlocked,
  unlockedLevels,
  recordVictory,
} from "./game/campaign.js";
import {
  showMainMenu,
  hideMainMenu,
  showLevelSelect,
  hideLevelSelect,
  showVictory,
  hideVictory,
  showDefeat,
  hideDefeat,
} from "./ui/menus.js";
import type { LevelSelectEntry } from "./ui/menus.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tile size in pixels for the match camera (and HUD/minimap scaling). */
const TILE_SIZE = 24;

/** Minimap box: side length and margin from the canvas corner, in pixels. */
const MINIMAP_SIZE = 160;
const MINIMAP_MARGIN = 8;

/** Height (px) of the bottom selection panel — the minimap sits just above it. */
const PANEL_HEIGHT = 120;

/** The four screen states of the app. */
type Screen = "menu" | "levelSelect" | "match" | "result";

// ---------------------------------------------------------------------------
// App state (the single mutable app-shell object — NOT module-level)
// ---------------------------------------------------------------------------

interface App {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Which screen is currently active. */
  screen: Screen;
  /** Campaign seed in effect (set when leaving the main menu). */
  campaignSeed: number;
  /** Faction the player controls (AI takes the other). */
  faction: Faction;
  /** The live match session, or null outside `match`/`result`. */
  session: GameSession | null;
  /** Index of the level currently being played, or -1 if none. */
  levelIndex: number;
  /** Input-binding teardown for the live match, or null. */
  unbindInput: (() => void) | null;
  /** Timestamp (ms) of the previous rAF tick, for real-dt computation. */
  lastFrameMs: number | null;
  /**
   * Integer world tile under the cursor, tracked from mousemove for the
   * building-placement ghost preview. Null until the first mousemove over a live
   * match (or outside `match`/`result`).
   */
  cursorTile: Vec2 | null;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function main(): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#game canvas element missing");

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Default campaign seed from the URL so a `?seed=` link is honoured even
  // before the menu input is touched; the menu can override it.
  const { seed: urlSeed } = seedFromUrl();

  const app: App = {
    canvas,
    ctx,
    screen: "menu",
    campaignSeed: urlSeed,
    faction: "human",
    session: null,
    levelIndex: -1,
    unbindInput: null,
    lastFrameMs: null,
    cursorTile: null,
  };

  sizeCanvasToWindow(app);
  window.addEventListener("resize", () => onResize(app));

  // Track the cursor tile for the building-placement ghost preview. This is a
  // SEPARATE listener from the input layer's binding (which handles selection /
  // orders); main.ts owns the cursor-tile state and feeds it to the renderer.
  canvas.addEventListener("mousemove", (e: MouseEvent) => onCursorMove(app, e));

  goToMenu(app);

  // Single persistent render loop; it only steps + draws while in `match`.
  const loop = (nowMs: number): void => {
    tick(app, nowMs);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Canvas sizing
// ---------------------------------------------------------------------------

function sizeCanvasToWindow(app: App): void {
  app.canvas.width = window.innerWidth;
  app.canvas.height = window.innerHeight;
}

function onResize(app: App): void {
  sizeCanvasToWindow(app);
  // Keep the live session's camera + HUD layout in step with the new viewport.
  const session = app.session;
  if (session !== null) {
    const camera = session.inputContext().camera;
    camera.viewportW = app.canvas.width;
    camera.viewportH = app.canvas.height;
    session.rebuildHudLayout();
  }
}

/**
 * Updates `app.cursorTile` (the integer world tile under the cursor) from a
 * canvas mousemove, using the live session's camera for the screen→world
 * transform. A no-op outside a live match (no session ⇒ nothing to preview).
 */
function onCursorMove(app: App, e: MouseEvent): void {
  const session = app.session;
  if (session === null) {
    app.cursorTile = null;
    return;
  }
  const camera = session.inputContext().camera;
  app.cursorTile = {
    x: Math.floor(screenToWorldX(camera, e.offsetX)),
    y: Math.floor(screenToWorldY(camera, e.offsetY)),
  };
}

// ---------------------------------------------------------------------------
// Screen transitions
// ---------------------------------------------------------------------------

function hideAllOverlays(): void {
  hideMainMenu();
  hideLevelSelect();
  hideVictory();
  hideDefeat();
}

function goToMenu(app: App): void {
  teardownMatch(app);
  app.screen = "menu";
  hideAllOverlays();
  paintBackdrop(app);
  showMainMenu({
    onStart: (seedText: string): void => {
      app.campaignSeed = resolveSeed(seedText);
      goToLevelSelect(app);
    },
  });
}

/**
 * Resolves the campaign seed from the menu's seed text box. Reuses the URL seed
 * parser so the parsing rules (decimal uint32, blank ⇒ derived) match the
 * `?seed=` contract exactly: an empty box yields a fresh derived seed.
 */
function resolveSeed(seedText: string): number {
  const search = seedText === "" ? "" : `?seed=${encodeURIComponent(seedText)}`;
  return seedFromUrl(search).seed;
}

function goToLevelSelect(app: App): void {
  teardownMatch(app);
  app.screen = "levelSelect";
  hideAllOverlays();
  paintBackdrop(app);

  const unlocked = new Set(unlockedLevels());
  const levels: LevelSelectEntry[] = CAMPAIGN_LEVELS.map((lvl) => ({
    index: lvl.index,
    name: lvl.name,
    width: lvl.width,
    height: lvl.height,
    difficulty: lvl.aiDifficulty,
    unlocked: unlocked.has(lvl.index),
  }));

  showLevelSelect({
    levels,
    seed: app.campaignSeed,
    faction: app.faction,
    onFaction: (faction: Faction): void => {
      app.faction = faction;
      // Re-show so the toggle reflects the new pick.
      goToLevelSelect(app);
    },
    onSelect: (levelIndex: number): void => {
      if (!isLevelUnlocked(levelIndex)) return;
      startMatch(app, levelIndex);
    },
    onBack: (): void => goToMenu(app),
  });
}

function startMatch(app: App, levelIndex: number): void {
  teardownMatch(app);

  const level = campaignLevel(levelIndex);
  const viewport: SessionViewport = {
    tileSize: TILE_SIZE,
    viewportW: app.canvas.width,
    viewportH: app.canvas.height,
  };

  // The session seed is the level's DERIVED per-level seed, so the map the
  // player sees matches `levelMap(campaignSeed, levelIndex)` exactly, and is
  // reproducible from (campaign seed, level number). The level's declared
  // width/height are forwarded so the match map uses the campaign level's size
  // (32/48/64/80/96) instead of createWorld's 48×48 default, and its scarcity so
  // the played terrain matches the previewed map's constraint level.
  const session = new GameSession(
    levelSeed(app.campaignSeed, levelIndex),
    levelIndex,
    app.faction,
    level.aiDifficulty,
    viewport,
    level.width,
    level.height,
    level.scarcity,
  );

  app.session = session;
  app.levelIndex = levelIndex;
  app.unbindInput = bindInput(app.canvas, session.inputContext());
  app.lastFrameMs = null;
  app.screen = "match";
  hideAllOverlays();
}

/** Tears down the live match's input binding + session reference (idempotent). */
function teardownMatch(app: App): void {
  if (app.unbindInput !== null) {
    app.unbindInput();
    app.unbindInput = null;
  }
  app.session = null;
  app.levelIndex = -1;
  app.lastFrameMs = null;
  app.cursorTile = null;
}

function goToResult(app: App, result: "victory" | "defeat", levelIndex: number): void {
  // Stop driving the sim, but keep the final frame on screen behind the overlay.
  if (app.unbindInput !== null) {
    app.unbindInput();
    app.unbindInput = null;
  }
  app.screen = "result";
  const level = campaignLevel(levelIndex);

  if (result === "victory") {
    const nextIndex = recordVictory(levelIndex);
    showVictory({
      subtitle: `${level.name} cleared`,
      onNext:
        nextIndex !== null
          ? (): void => startMatch(app, nextIndex)
          : undefined,
      onRestart: (): void => startMatch(app, levelIndex),
      onMainMenu: (): void => goToMenu(app),
    });
  } else {
    showDefeat({
      subtitle: level.name,
      onRestart: (): void => startMatch(app, levelIndex),
      onMainMenu: (): void => goToMenu(app),
    });
  }
}

// ---------------------------------------------------------------------------
// Per-frame tick
// ---------------------------------------------------------------------------

function tick(app: App, nowMs: number): void {
  if (app.screen !== "match") return;
  const session = app.session;
  if (session === null) return;

  // Real elapsed time since the previous tick; first frame after (re)start has
  // no baseline, so it advances the sim by zero.
  const dt = app.lastFrameMs === null ? 0 : nowMs - app.lastFrameMs;
  app.lastFrameMs = nowMs;

  session.frame(dt);
  renderMatch(app, session);

  const result = session.checkEndCondition();
  if (result !== null) {
    goToResult(app, result, app.levelIndex);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMatch(app: App, session: GameSession): void {
  const { ctx } = app;
  const inputCtx = session.inputContext();
  const { world } = session;
  const { camera, faction, selection, selectedBuilding } = inputCtx;

  // Clear the frame.
  ctx.fillStyle = "#07090f";
  ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);

  render(ctx, world, camera, faction, selection);
  // Building-placement ghost (over the world, under the HUD): a green/red
  // footprint preview at the cursor tile while in build mode.
  drawPlacementGhost(ctx, world, camera, faction, inputCtx.placement, app.cursorTile);
  renderHud(ctx, world, inputCtx.hudLayout, faction, selection, selectedBuilding);
  renderMinimap(ctx, world, camera, faction, minimapRect(app));
}

/** Bottom-left minimap box, seated just above the selection panel. */
function minimapRect(app: App): PixelRect {
  return {
    x: MINIMAP_MARGIN,
    y: app.canvas.height - PANEL_HEIGHT - MINIMAP_SIZE - MINIMAP_MARGIN,
    w: MINIMAP_SIZE,
    h: MINIMAP_SIZE,
  };
}

/** Fills the canvas behind a DOM overlay so the menu does not sit over a stale frame. */
function paintBackdrop(app: App): void {
  app.ctx.fillStyle = "#07090f";
  app.ctx.fillRect(0, 0, app.canvas.width, app.canvas.height);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main();
