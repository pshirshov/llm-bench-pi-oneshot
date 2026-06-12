// Main entry. Sets up the canvas, input, renderer, and game loop. Boots a
// level, starts the AI for the opposing faction, and runs the loop.

import { setupLevel } from "./sim/campaign.js";
import { World } from "./sim/world.js";
import { step } from "./sim/sim.js";
import { spawnAiBase, configForDifficulty } from "./sim/ai.js";
import { InputManager, InputState } from "./input/inputManager.js";
import { render, RenderOptions } from "./render/renderer.js";
import { Faction, SIM_CONSTANTS, getBuildingStats } from "./sim/stats.js";
import { HudLayout } from "./ui/hudLayout.js";
import { makeRng, Rng } from "./sim/rng.js";
import { isWalkableTile } from "./sim/tiles.js";

export interface GameOptions {
  playerFaction: Faction;
  seed: number;
  level: number;
}

export interface Game {
  world: World;
  playerFaction: Faction;
  input: InputManager;
  camera: { x: number; y: number };
  tileSize: number;
  campaign: { cleared: number[]; level: number; totalLevels: number };
  layout: HudLayout | null;
}

export function createGame(canvas: HTMLCanvasElement, opts: GameOptions): Game {
  const info = setupLevel(opts.seed, opts.level);
  // The setupLevel uses a child RNG internally; we keep this RNG as a stable
  // player-side stream for any gameplay randomness that depends on it.
  const worldRng: Rng = makeRng(opts.seed ^ (opts.level * 0x9e3779b1));
  const world = new World(info.result.map, worldRng);
  const playerFaction: Faction = opts.playerFaction;
  const enemyFaction: Faction = playerFaction === "humans" ? "orcs" : "humans";
  const config = configForDifficulty(info.difficulty);
  spawnPlayerBase(world, playerFaction, info.result.starts.a.x, info.result.starts.a.y);
  spawnAiBase(world, enemyFaction, info.result.starts.b.x, info.result.starts.b.y, config);
  const camera = { x: 0, y: 0 };
  const tileSize = SIM_CONSTANTS.tilePixelSize;
  const state: InputState = {
    world,
    playerFaction,
    viewportW: canvas.width,
    viewportH: canvas.height,
    camera,
    tileSize,
    rect: () => canvas.getBoundingClientRect(),
  };
  const input = new InputManager(state, {});
  return {
    world,
    playerFaction,
    input,
    camera,
    tileSize,
    campaign: { cleared: [], level: opts.level, totalLevels: 5 },
    layout: null,
  };
}

function spawnPlayerBase(world: World, faction: Faction, sx: number, sy: number): void {
  const stats = getBuildingStats(faction, "townhall");
  const x = Math.max(0, sx - 1);
  const y = Math.max(0, sy - 1);
  for (let dy = 0; dy < stats.footprint.h; dy++) {
    for (let dx = 0; dx < stats.footprint.w; dx++) {
      if (world.map.inBounds(x + dx, y + dy)) world.map.set(x + dx, y + dy, TILE_GRASS);
    }
  }
  world.spawnBuilding(faction, "townhall", x, y, 1, null);
  world.recomputeSupplyCap(faction);
  const adj: Array<[number, number]> = [];
  for (let dy = -1; dy <= stats.footprint.h; dy++) {
    for (let dx = -1; dx <= stats.footprint.w; dx++) {
      const onLeft = dx === -1;
      const onRight = dx === stats.footprint.w;
      const onTop = dy === -1;
      const onBottom = dy === stats.footprint.h;
      if (!onLeft && !onRight && !onTop && !onBottom) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (world.map.inBounds(xx, yy) && isWalkableTile(world.map.get(xx, yy))) adj.push([xx, yy]);
    }
  }
  for (let i = 0; i < 3 && i < adj.length; i++) {
    const pos = adj[i] as [number, number];
    world.spawnUnit(faction, "worker", pos[0], pos[1]);
  }
}

const TILE_GRASS = 0;

export function bindGameToCanvas(game: Game, canvas: HTMLCanvasElement): void {
  const { input } = game;
  // Recompute layout on resize.
  const updateLayout = () => {
    game.layout = input.getHudLayout().layout;
  };
  updateLayout();
  window.addEventListener("resize", updateLayout);
  // Mouse handlers.
  const onMouseDown = (ev: MouseEvent) => {
    input.onMouseDown({ clientX: ev.clientX, clientY: ev.clientY, button: ev.button, shiftKey: ev.shiftKey });
  };
  const onMouseUp = (ev: MouseEvent) => {
    input.onMouseUp({ clientX: ev.clientX, clientY: ev.clientY, button: ev.button, shiftKey: ev.shiftKey });
  };
  const onContextMenu = (ev: MouseEvent) => {
    input.onContextMenu({ clientX: ev.clientX, clientY: ev.clientY, preventDefault: () => ev.preventDefault() });
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    input.onKeyDown({ code: ev.code, ctrlKey: ev.ctrlKey, key: ev.key, shiftKey: ev.shiftKey });
  };
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", onKeyDown);
}

export function renderFrame(game: Game, ctx: CanvasRenderingContext2D): void {
  if (!game.layout) game.layout = game.input.getHudLayout().layout;
  const opts: RenderOptions = {
    tileSize: game.tileSize,
    layout: game.layout,
  };
  render(ctx, game.world, game.camera, opts);
}

export function tickGame(game: Game): void {
  if (game.world.paused) return;
  const stepsThisFrame = game.world.speed;
  for (let i = 0; i < stepsThisFrame; i++) {
    step(game.world);
  }
  game.layout = game.input.getHudLayout().layout;
}
