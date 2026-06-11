/**
 * Main entry point: sets up game loop, input handling, and coordinates all systems.
 */
import { GameState, Faction, TILE_SIZE, Camera, InputState } from './engine/types.js';
import { getSeed } from './engine/prng.js';
import { initGameState, updateSimulation } from './engine/simulation.js';
import { render, renderMinimap } from './ui/renderer.js';
import { updateHUD, updateSelectionPanel, handleRightClick, handleLeftClick, handleBoxSelect, handleMinimapClick } from './ui/ui.js';
import { canPlaceBuilding, deductCost, createEntity } from './entities/manager.js';
import { getStats } from './entities/stats.js';
import { AIController } from './ai/ai.js';

// Game state
let gameState: GameState | null = null;
let ai: AIController | null = null;
const camera: Camera = { x: 0, y: 0, width: 0, height: 0 };
const input: InputState = {
  mouseX: 0, mouseY: 0, mouseDown: false, rightMouseDown: false,
  dragStartX: 0, dragStartY: 0, isDragging: false,
  keys: new Set(), shiftKey: false, ctrlKey: false, buildMode: null
};

// Expose input for UI buttons
(window as unknown as Record<string, unknown>).__gameInput = input;

// DOM elements
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let minimapCanvas: HTMLCanvasElement;
let minimapCtx: CanvasRenderingContext2D;
let selectionPanel: HTMLElement;
let buildPanel: HTMLElement;
let gameOverScreen: HTMLElement;
let gameOverText: HTMLElement;

/** Fixed timestep simulation */
const TICK_RATE = 60; // Hz
const TICK_MS = 1000 / TICK_RATE;
let accumulator = 0;
let lastTime = 0;

function gameLoop(time: number): void {
  if (!gameState || !ai) {
    requestAnimationFrame(gameLoop);
    return;
  }

  const rawDt = lastTime === 0 ? TICK_MS : time - lastTime;
  lastTime = time;
  const dt = Math.min(rawDt, 100); // cap to prevent spiral of death

  accumulator += dt;

  // Fixed timestep simulation
  while (accumulator >= TICK_MS) {
    updateSimulation(gameState, ai, TICK_MS);
    accumulator -= TICK_MS;
  }

  // Handle scrolling
  handleScrolling(dt);

  // Render
  render(ctx, gameState, camera, canvas.width, canvas.height);
  renderMinimap(minimapCtx, gameState, camera, minimapCanvas.width, minimapCanvas.height);

  // Update UI
  updateHUD(gameState);
  updateSelectionPanel(gameState, selectionPanel, buildPanel);

  // Draw build preview
  if (input.buildMode) {
    drawBuildPreview();
  }

  // Draw drag selection box
  if (input.isDragging && input.mouseDown) {
    drawSelectionBox();
  }

  // Check game over
  if (gameState.gameOver) {
    showGameOver();
    handleGameOver();
  }

  requestAnimationFrame(gameLoop);
}

function handleScrolling(dt: number): void {
  const scrollSpeed = 400 * (dt / 1000);
  const edgeSize = 20;

  if (input.keys.has('ArrowLeft') || input.mouseX < edgeSize) {
    camera.x -= scrollSpeed;
  }
  if (input.keys.has('ArrowRight') || input.mouseX > canvas.width - edgeSize) {
    camera.x += scrollSpeed;
  }
  if (input.keys.has('ArrowUp') || input.mouseY < edgeSize) {
    camera.y -= scrollSpeed;
  }
  if (input.keys.has('ArrowDown') || input.mouseY > canvas.height - edgeSize) {
    camera.y += scrollSpeed;
  }

  // Clamp camera
  if (gameState) {
    camera.x = Math.max(0, Math.min(gameState.mapWidth * TILE_SIZE - camera.width, camera.x));
    camera.y = Math.max(0, Math.min(gameState.mapHeight * TILE_SIZE - camera.height, camera.y));
  }
}

function drawBuildPreview(): void {
  if (!gameState || !input.buildMode || !ctx) return;

  const tx = Math.floor((input.mouseX + camera.x) / TILE_SIZE);
  const ty = Math.floor((input.mouseY + camera.y) / TILE_SIZE);
  const stats = getStats(input.buildMode, gameState.playerFaction);
  const valid = canPlaceBuilding(input.buildMode, tx, ty, gameState, gameState.playerFaction);

  ctx.strokeStyle = valid ? '#0f0' : '#f00';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    tx * TILE_SIZE - camera.x,
    ty * TILE_SIZE - camera.y,
    stats.width * TILE_SIZE,
    stats.height * TILE_SIZE
  );
  ctx.lineWidth = 1;
}

function drawSelectionBox(): void {
  if (!ctx) return;

  const x1 = Math.min(input.dragStartX, input.mouseX);
  const y1 = Math.min(input.dragStartY, input.mouseY);
  const x2 = Math.max(input.dragStartX, input.mouseX);
  const y2 = Math.max(input.dragStartY, input.mouseY);

  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 1;
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
}

function showGameOver(): void {
  if (!gameState) return;

  gameOverScreen.classList.remove('hidden');
  if (gameState.winner === gameState.playerFaction) {
    gameOverText.textContent = '⚔ VICTORY ⚔';
    gameOverText.style.color = '#4f4';
  } else {
    gameOverText.textContent = '💀 DEFEAT 💀';
    gameOverText.style.color = '#f44';
  }
}

/** Start a new game */
function startGame(faction: Faction, seed: number, level: number = 0): void {
  const result = initGameState(seed, faction, level);
  gameState = result.state;
  ai = result.ai;

  // Center camera on player's town hall
  const th = gameState.entities.find(
    e => e.faction === faction && e.type === 'town_hall'
  );
  if (th) {
    camera.x = th.x - camera.width / 2;
    camera.y = th.y - camera.height / 2;
  }

  // Show HUD, hide menus
  document.getElementById('menu-screen')!.classList.add('hidden');
  document.getElementById('level-select')!.classList.add('hidden');
  document.getElementById('hud')!.style.display = 'block';
  gameOverScreen.classList.add('hidden');

  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seed.toString());
  window.history.replaceState(null, '', url.toString());
}

/** Setup input handlers */
function setupInput(): void {
  // Mouse
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      input.mouseDown = true;
      input.dragStartX = e.offsetX;
      input.dragStartY = e.offsetY;
      input.isDragging = false;
    }
    if (e.button === 2) {
      e.preventDefault();
      if (gameState) {
        const worldX = e.offsetX + camera.x;
        const worldY = e.offsetY + camera.y;

        // Build placement
        if (input.buildMode) {
          const tx = Math.floor(worldX / TILE_SIZE);
          const ty = Math.floor(worldY / TILE_SIZE);
          if (canPlaceBuilding(input.buildMode, tx, ty, gameState, gameState.playerFaction)) {
            deductCost(input.buildMode, gameState.playerFaction, gameState);
            const building = createEntity(input.buildMode, gameState.playerFaction, tx, ty, gameState);
            building.hp = 1;
            building.state = 'building';

            // Find selected worker to build it
            const worker = gameState!.entities.find(
              e => gameState!.selectedEntityIds.includes(e.id) && e.type === 'worker' && e.faction === gameState!.playerFaction
            );
            if (worker) {
              worker.buildingType = input.buildMode;
              worker.buildProgress = 0;
              worker.state = 'building';
              worker.targetX = building.x;
              worker.targetY = building.y;
              worker.tileX = tx;
              worker.tileY = ty;
            }
          }
          input.buildMode = null;
          return;
        }

        handleRightClick(gameState, worldX, worldY, input);
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    input.mouseX = e.offsetX;
    input.mouseY = e.offsetY;

    if (input.mouseDown && !input.isDragging) {
      const dx = e.offsetX - input.dragStartX;
      const dy = e.offsetY - input.dragStartY;
      if (Math.hypot(dx, dy) > 5) {
        input.isDragging = true;
      }
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      if (input.isDragging && gameState) {
        // Box select
        const worldX1 = input.dragStartX + camera.x;
        const worldY1 = input.dragStartY + camera.y;
        const worldX2 = e.offsetX + camera.x;
        const worldY2 = e.offsetY + camera.y;
        handleBoxSelect(gameState, worldX1, worldY1, worldX2, worldY2, input.shiftKey);
      } else if (gameState) {
        // Click select
        const worldX = e.offsetX + camera.x;
        const worldY = e.offsetY + camera.y;
        handleLeftClick(gameState, worldX, worldY, input.shiftKey);
      }
      input.mouseDown = false;
      input.isDragging = false;
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard
  document.addEventListener('keydown', (e) => {
    input.keys.add(e.key);
    input.shiftKey = e.shiftKey;
    input.ctrlKey = e.ctrlKey;

    if (e.key === ' ' && gameState) {
      e.preventDefault();
      gameState.paused = !gameState.paused;
    }

    if (e.key === 'Escape') {
      input.buildMode = null;
      if (gameState) gameState.selectedEntityIds = [];
    }

    // Speed toggle
    if (e.key === '+' || e.key === '=') {
      if (gameState) gameState.speed = gameState.speed === 1 ? 2 : 1;
    }

    // Control groups
    if (gameState && e.key >= '1' && e.key <= '9') {
      if (input.ctrlKey) {
        // Save control group
        const w = window as unknown as Record<string, unknown>;
        w.__controlGroups = w.__controlGroups || {};
        (w.__controlGroups as Record<string, number[]>)[e.key] = [...gameState.selectedEntityIds];
      } else {
        // Load control group
        const w = window as unknown as Record<string, unknown>;
        const groups = w.__controlGroups as Record<string, number[]> | undefined;
        if (groups?.[e.key]) {
          if (gameState) {
            gameState.selectedEntityIds = groups[e.key].filter(
              (id: number) => gameState!.entities.some(e => e.id === id && e.state !== 'dead')
            );
          }
        }
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    input.keys.delete(e.key);
    input.shiftKey = e.shiftKey;
    input.ctrlKey = e.ctrlKey;
  });

  // Minimap click
  minimapCanvas.addEventListener('mousedown', (e) => {
    if (gameState) {
      handleMinimapClick(gameState, camera, e.offsetX, e.offsetY, minimapCanvas.width, minimapCanvas.height);
    }
  });

  minimapCanvas.addEventListener('mousemove', (e) => {
    if (e.buttons === 1 && gameState) {
      handleMinimapClick(gameState, camera, e.offsetX, e.offsetY, minimapCanvas.width, minimapCanvas.height);
    }
  });

  // Resize
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas(): void {
  if (!canvas) return;

  const topBarHeight = 32;
  const selectionHeight = 160;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - topBarHeight - selectionHeight;

  camera.width = canvas.width;
  camera.height = canvas.height;
}

/** Setup menu handlers */
function setupMenus(): void {
  let selectedFaction: Faction = 'humans';

  // Faction buttons
  document.querySelectorAll('[data-faction]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-faction]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedFaction = (btn as HTMLElement).dataset.faction as Faction;
    });
  });

  // Campaign button
  document.getElementById('btn-campaign')!.addEventListener('click', () => {
    document.getElementById('menu-screen')!.classList.add('hidden');
    document.getElementById('level-select')!.classList.remove('hidden');
    showLevelSelect(selectedFaction);
  });

  // Skirmish button
  document.getElementById('btn-skirmish')!.addEventListener('click', () => {
    const seedInput = document.getElementById('seed-input') as HTMLInputElement;
    const seed = seedInput.value ? parseInt(seedInput.value) : getSeed();
    startGame(selectedFaction, seed, 0);
  });

  // Back to menu
  document.getElementById('btn-back-menu')!.addEventListener('click', () => {
    document.getElementById('level-select')!.classList.add('hidden');
    document.getElementById('menu-screen')!.classList.remove('hidden');
  });

  // Game over -> Menu
  document.getElementById('btn-menu')!.addEventListener('click', () => {
    document.getElementById('game-over-screen')!.classList.add('hidden');
    document.getElementById('hud')!.style.display = 'none';
    document.getElementById('menu-screen')!.classList.remove('hidden');
  });
}

function showLevelSelect(faction: Faction): void {
  const container = document.getElementById('level-buttons')!;
  container.innerHTML = '';

  const unlocked = getUnlockedLevel();

  for (let i = 0; i < 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.textContent = `Level ${i + 1}`;

    if (i > unlocked) {
      btn.classList.add('disabled');
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.addEventListener('click', () => {
        const seed = getSeed();
        startGame(faction, seed, i);
      });
    }

    container.appendChild(btn);
  }
}

function getUnlockedLevel(): number {
  const stored = localStorage.getItem('warband_level');
  return stored ? parseInt(stored) : 0;
}

function unlockNextLevel(level: number): void {
  const current = getUnlockedLevel();
  if (level >= current) {
    localStorage.setItem('warband_level', (level + 1).toString());
  }
}

// Game over handler with level unlock
function handleGameOver(): void {
  if (gameState?.gameOver && gameState.winner === gameState.playerFaction) {
    unlockNextLevel(gameState.level);
  }
}

// Patch the game loop to use the enhanced version
// (We'll override the function reference in the loop)

/** Initialize the game */
function init(): void {
  // Get DOM elements
  canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;
  minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  minimapCtx = minimapCanvas.getContext('2d')!;
  selectionPanel = document.getElementById('selection-panel')!;
  buildPanel = document.getElementById('build-panel')!;
  gameOverScreen = document.getElementById('game-over-screen')!;
  gameOverText = document.getElementById('game-over-text')!;

  resizeCanvas();
  setupInput();
  setupMenus();

  // Check URL for auto-start
  const params = new URLSearchParams(window.location.search);
  const urlSeed = params.get('seed');
  const urlLevel = params.get('level');
  const urlFaction = params.get('faction') as Faction;

  if (urlSeed) {
    startGame(urlFaction || 'humans', parseInt(urlSeed), urlLevel ? parseInt(urlLevel) : 0);
  }

  // Start game loop
  requestAnimationFrame(gameLoop);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
