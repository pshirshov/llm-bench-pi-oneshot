// Entry point: bootstraps the game, runs the main loop.

import { type World } from './state.js';
import { type FactionId } from './data.js';
import { createWorld, initResourceTiles, setupFactionStart, tick as simTick, isBuildable, tryQueueBuilding, tryQueueTrain, orderMove, orderAttack, pathToTile, nearestAdjacentWalkable, isWalkable } from './sim.js';
import { mapForLevel, difficultyForLevel, type StartLocation } from './mapgen.js';
import { type Camera, makeCamera, centerOn, clampCamera, screenToWorld } from './camera.js';
import { aiTick } from './ai.js';
import { render, type RenderState, tickRenderState } from './render.js';
import { makeInputState, onMouseDown, onMouseMove, onMouseUp, onKeyDown, onKeyUp, scrollCamera, startBuildPlacement, tryStartTrain, cancelTrainAt } from './input.js';
import { buildHud, updateHud, drawMinimap } from './hud.js';
import { mulberry32 } from './rng.js';
import { FACTIONS, BUILDING_STATS } from './data.js';

interface Game {
  world: World;
  cam: Camera;
  rs: RenderState;
  input: ReturnType<typeof makeInputState>;
  seed: number;
  campaignSeed: number;
  level: number;     // 0..4
  unlocked: number;  // up to level+1
  difficulty: number; // 1..5
  playerFaction: FactionId;
  paused: boolean;
  speed: number;     // 1 or 2
  starts: [StartLocation, StartLocation];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  hud: ReturnType<typeof buildHud>;
  started: boolean;
  winner: FactionId | null;
}

function getSeedFromUrl(): number {
  const url = new URL(window.location.href);
  const s = url.searchParams.get('seed');
  if (s) {
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) return n;
  }
  return Math.floor(Math.random() * 0x7fffffff);
}

function getCampaignSeed(): number {
  const url = new URL(window.location.href);
  const s = url.searchParams.get('campaign');
  if (s) {
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0xC0FFEE;
}

function getUnlocked(): number {
  const url = new URL(window.location.href);
  const u = url.searchParams.get('unlocked');
  if (u) {
    const n = parseInt(u, 10);
    if (Number.isFinite(n)) return n;
  }
  try {
    const v = window.localStorage.getItem('warband_unlocked');
    if (v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  } catch { /* ignore */ }
  return 1;
}

function setUnlocked(v: number): void {
  try { window.localStorage.setItem('warband_unlocked', String(v)); } catch { /* ignore */ }
}

function showMainMenu(game: Game | null): void {
  const root = document.getElementById('hud');
  if (!root) return;
  root.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="panel">
      <h1>WARBAND</h1>
      <p style="text-align:center">A WFC-generated browser RTS. Pick a faction and a level.</p>
      <h2>Choose your faction</h2>
      <div class="faction-pick" id="faction-pick">
        <button class="faction-btn" data-faction="human">
          <span class="swatch" style="background:#3a7bd5"></span> Humans
        </button>
        <button class="faction-btn" data-faction="orc">
          <span class="swatch" style="background:#3aa15a"></span> Orcs
        </button>
      </div>
      <h2>Campaign Levels</h2>
      <div class="level-list" id="level-list"></div>
      <p style="text-align:center;color:#888;font-size:11px;margin-top:12px">
        Custom seed: <input id="custom-seed" type="number" value="${(game?.seed ?? getSeedFromUrl())}" style="width:80px;background:#1a0a00;border:1px solid #6b4a1c;color:#f4e4bc;padding:2px 4px"/>
        <button id="use-seed" class="primary" style="margin:0 0 0 8px;padding:4px 8px;font-size:11px">Use Seed</button>
      </p>
      <table class="controls-table" style="margin-top:12px">
        <tr><td>Left click / drag</td><td>Select units</td></tr>
        <tr><td>Right click</td><td>Move / attack / harvest / repair / build</td></tr>
        <tr><td>Shift+click</td><td>Add to selection</td></tr>
        <tr><td>Alt+right click</td><td>Attack-move</td></tr>
        <tr><td>Ctrl+1..9 / 1..9</td><td>Save / recall control group</td></tr>
        <tr><td>Arrows / edge of screen</td><td>Scroll the camera</td></tr>
        <tr><td>Click minimap</td><td>Jump the camera</td></tr>
        <tr><td>H</td><td>Center on Town Hall</td></tr>
        <tr><td>Esc</td><td>Cancel placement / clear selection</td></tr>
        <tr><td>Space</td><td>Pause</td></tr>
        <tr><td>1 / 2</td><td>Game speed 1x / 2x</td></tr>
      </table>
    </div>
  `;
  root.appendChild(modal);
  const list = modal.querySelector('#level-list') as HTMLElement;
  const unlocked = getUnlocked();
  const levelNames = ['Borderlands', 'Riverlands', 'Highlands', 'Chokepoint', 'Badlands'];
  const levelSizes = ['32×32', '48×48', '64×64', '80×80', '96×96'];
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('div');
    row.className = 'level-row' + (i < unlocked ? ' unlocked' : ' locked');
    const inner = `
      <div class="num">${i + 1}</div>
      <div class="meta">
        <div class="name">${levelNames[i] ?? `Level ${i + 1}`}</div>
        <div>${levelSizes[i]} • Difficulty ${i + 1}</div>
      </div>
    `;
    row.innerHTML = inner;
    if (i < unlocked) {
      row.addEventListener('click', () => startLevel(i, currentFaction));
    }
    list.appendChild(row);
  }
  let currentFaction: FactionId = 'human';
  modal.querySelectorAll('.faction-btn').forEach((el) => {
    el.addEventListener('click', () => {
      modal.querySelectorAll('.faction-btn').forEach((b) => b.classList.remove('selected'));
      el.classList.add('selected');
      currentFaction = (el as HTMLElement).dataset.faction as FactionId;
    });
  });
  // default selection
  const humanBtn = modal.querySelector('[data-faction="human"]') as HTMLElement;
  humanBtn.classList.add('selected');
  modal.querySelector('#use-seed')?.addEventListener('click', () => {
    const v = parseInt((modal.querySelector('#custom-seed') as HTMLInputElement).value, 10);
    if (Number.isFinite(v)) {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(v));
      window.location.href = url.toString();
    }
  });
}

function startLevel(level: number, playerFaction: FactionId): void {
  const root = document.getElementById('hud') as HTMLElement;
  root.innerHTML = '';
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no ctx');
  const seed = getSeedFromUrl();
  const campaignSeed = getCampaignSeed();
  const difficulty = difficultyForLevel(level);
  const { map, starts } = mapForLevel(campaignSeed, level);
  const world = createWorld(map, level, difficulty, playerFaction);
  initResourceTiles(world);
  const aiFaction: FactionId = playerFaction === 'human' ? 'orc' : 'human';
  // Apply difficulty resource bonus to AI
  const aiStartGold = 600 + difficulty * 200;
  const aiStartWood = 300 + difficulty * 100;
  // Set up player + AI on the two starts
  setupFactionStart(world, playerFaction, starts[0], { gold: 800, wood: 400 }, 3, 0.5);
  setupFactionStart(world, aiFaction, starts[1], { gold: aiStartGold, wood: aiStartWood }, 3, 0.5);
  // Center camera on the player town hall
  const cam: Camera = makeCamera();
  for (const b of world.buildings.values()) {
    if (b.faction === playerFaction && b.buildingKind === 'townhall') {
      centerOn(cam, b.pos.x + b.size.w / 2, b.pos.y + b.size.h / 2, world);
      break;
    }
  }
  const rs: RenderState = { selected: new Set(), buildPreview: null, marker: null };
  const input = makeInputState();
  const hud = buildHud(root, {
    onBuild: (bk) => startBuildPlacement(input, bk),
    onTrain: (id, k) => tryStartTrain(world, id, k),
    onCancelTrain: (id, i) => cancelTrainAt(world, id, i),
  });
  const game: Game = {
    world, cam, rs, input, seed, campaignSeed, level,
    unlocked: getUnlocked(), difficulty, playerFaction,
    paused: false, speed: 1, starts, canvas, ctx, hud, started: true, winner: null,
  };
  attachHandlers(game);
  (window as unknown as { game: Game }).game = game;
  requestAnimationFrame(() => loop(game, performance.now() / 1000));
}

function attachHandlers(game: Game): void {
  const canvas = game.canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => onMouseDown(game.input, game.world, e, canvas, game.cam, game.rs));
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    (game as unknown as { _mx?: number })._mx = e.clientX - rect.left;
    (game as unknown as { _my?: number })._my = e.clientY - rect.top;
    onMouseMove(game.input, game.world, e, canvas, game.cam);
  });
  canvas.addEventListener('mouseup', () => onMouseUp(game.input, game.world, game.rs));
  canvas.addEventListener('mouseleave', () => onMouseUp(game.input, game.world, game.rs));
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { game.paused = !game.paused; e.preventDefault(); return; }
    if (e.key === '1') { game.speed = 1; return; }
    if (e.key === '2') { game.speed = 2; return; }
    onKeyDown(game.input, game.world, e, game.cam, game.rs);
  });
  window.addEventListener('keyup', (e) => onKeyUp(game.input, e));
  // minimap click
  game.hud.minimap.addEventListener('mousedown', (e) => {
    const rect = game.hud.minimap.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    game.cam.x = px * game.world.map.width - game.cam.w / 2;
    game.cam.y = py * game.world.map.height - game.cam.h / 2;
    clampCamera(game.cam, game.world);
  });
  game.hud.minimap.addEventListener('mousemove', (e) => {
    if (!(e.buttons & 1)) return;
    const rect = game.hud.minimap.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    game.cam.x = px * game.world.map.width - game.cam.w / 2;
    game.cam.y = py * game.world.map.height - game.cam.h / 2;
    clampCamera(game.cam, game.world);
  });
  // resize
  window.addEventListener('resize', () => resizeCanvas(game));
  resizeCanvas(game);
}

function resizeCanvas(game: Game): void {
  const dpr = window.devicePixelRatio || 1;
  const w = game.canvas.clientWidth;
  const h = game.canvas.clientHeight;
  game.canvas.width = Math.floor(w * dpr);
  game.canvas.height = Math.floor(h * dpr);
  game.ctx.setTransform(dpr, 0, 0, -dpr * (h / w), 0, dpr * h);
  // recompute camera tiles to match canvas
  const tileSize = 32;
  game.cam.w = w / tileSize;
  game.cam.h = h / tileSize;
  game.cam.zoom = tileSize;
  clampCamera(game.cam, game.world);
}

function showVictory(game: Game): void {
  const root = document.getElementById('hud') as HTMLElement;
  const modal = document.createElement('div');
  modal.className = 'modal';
  const won = game.winner === game.playerFaction;
  modal.innerHTML = `
    <div class="panel" style="text-align:center">
      <h1>${won ? 'VICTORY' : 'DEFEAT'}</h1>
      <p>${won ? 'The enemy is destroyed.' : 'Your stronghold has fallen.'}</p>
      <p>Time: ${Math.floor(game.world.time)}s &middot; Level ${game.level + 1} &middot; Seed ${game.seed}</p>
      <button class="primary" id="next-level">${won && game.level < 4 ? 'Next Level' : 'Level Select'}</button>
      <button class="primary" id="replay" style="margin-left:8px">Replay</button>
    </div>
  `;
  root.appendChild(modal);
  if (won) {
    const newUnlocked = Math.max(getUnlocked(), game.level + 2);
    setUnlocked(newUnlocked);
  }
  modal.querySelector('#next-level')?.addEventListener('click', () => {
    if (won && game.level < 4) startLevel(game.level + 1, game.playerFaction);
    else showMainMenu(game);
  });
  modal.querySelector('#replay')?.addEventListener('click', () => startLevel(game.level, game.playerFaction));
}

let lastTime = 0;
let accumulator = 0;
const FIXED_DT = 1 / 60;
const rng = mulberry32(0xC0FFEE);

function loop(game: Game, now: number): void {
  if (!lastTime) lastTime = now;
  const frameDt = Math.min(0.1, now - lastTime);
  lastTime = now;
  if (!game.paused && !game.world.gameOver) {
    accumulator += frameDt * game.speed;
    while (accumulator >= FIXED_DT) {
      simTick(game.world, FIXED_DT, rng);
      const aiFaction: FactionId = game.playerFaction === 'human' ? 'orc' : 'human';
      aiTick(game.world, aiFaction, game.difficulty, rng);
      accumulator -= FIXED_DT;
    }
  }
  scrollCamera(game.input, game.cam, game.world, frameDt);
  tickRenderState(game.rs, frameDt);
  // update build preview
  if (game.input.buildKind) {
    const m = game.canvas;
    // get mouse position from last known — we cheat by using the camera center if no mouse event has happened; otherwise rely on most recent mousemove
    // Instead, track mouse position on the canvas
    const mx = (game as unknown as { _mx?: number })._mx;
    const my = (game as unknown as { _my?: number })._my;
    if (mx !== undefined && my !== undefined) {
      const w2 = screenToWorld(game.cam, mx, m.height - my);
      const tx = Math.floor(w2.x);
      const ty = Math.floor(w2.y);
      const stats = BUILDING_STATS[game.input.buildKind];
      const valid = isBuildable(game.world, tx, ty, stats.size.w, stats.size.h);
      game.rs.buildPreview = { faction: 'human', bk: game.input.buildKind, x: tx, y: ty, valid };
    }
  } else {
    game.rs.buildPreview = null;
  }
  // render
  render(game.ctx, game.world, game.cam, game.rs);
  // HUD
  updateHud(game.hud, game.world, game.rs, game.seed, game.paused, game.speed);
  drawMinimap(game.hud.minimap, game.world, game.cam);
  // victory
  if (game.world.gameOver && !game.winner) {
    game.winner = game.world.gameOver.winner;
    showVictory(game);
  }
  requestAnimationFrame((t) => loop(game, t / 1000));
}

// Track mouse position for the build preview
function attachMouseTracker(game: Game): void {
  game.canvas.addEventListener('mousemove', (e) => {
    const rect = game.canvas.getBoundingClientRect();
    (game as unknown as { _mx?: number })._mx = e.clientX - rect.left;
    (game as unknown as { _my?: number })._my = e.clientY - rect.top;
  });
}

// Bootstrap
function bootstrap(): void {
  const root = document.getElementById('hud');
  if (!root) return;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // We always go through the menu first
  // Pre-allocate a game so we can read its seed for the menu
  const seed = getSeedFromUrl();
  (window as unknown as { game: Game | null }).game = null;
  showMainMenu(null);
  // attach mouse tracker to the static canvas (no game yet, but we'll re-attach on level start)
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    (canvas as unknown as { _mx?: number })._mx = e.clientX - rect.left;
    (canvas as unknown as { _my?: number })._my = e.clientY - rect.top;
  });
  void seed;
  void attachMouseTracker;
  void orderMove; void orderAttack; void pathToTile; void nearestAdjacentWalkable; void isWalkable; void tryQueueBuilding; void tryQueueTrain; void FACTIONS;
}

bootstrap();
