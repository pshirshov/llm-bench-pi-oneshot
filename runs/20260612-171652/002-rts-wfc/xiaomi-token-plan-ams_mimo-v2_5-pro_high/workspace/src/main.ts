/**
 * Main entry point: initializes the game loop, rendering, and input handling.
 */

import type { GameState, Faction } from './core/types';
import { TICK_RATE } from './core/types';
import { parseSeedFromURL } from './core/prng';
import { initGame, gameTick } from './sim/game';
import { createAIState, processAI } from './ai/ai';
import { computeLayout } from './ui/layout';
import { createInputState, handleMouseDown, handleMouseUp, handleKeyDown, defaultTransform } from './ui/input';
import { render } from './render/renderer';
import type { InputState } from './ui/input';
import type { HudLayout } from './ui/layout';

interface GameApp {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  state: GameState;
  input: InputState;
  layout: HudLayout;
  ai: ReturnType<typeof createAIState>;
  lastTime: number;
  accumulator: number;
  animFrame: number;
}

function createApp(): GameApp {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('Canvas element not found');

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  // Parse seed from URL
  const seed = parseSeedFromURL(window.location.href);
  const playerFaction: Faction = 'humans';

  // Initialize game
  const state = initGame({ seed, level: 0, playerFaction, difficulty: 1 });
  const ai = createAIState('orcs', 1);

  // Create input state
  const input = createInputState();

  // Compute layout
  const layout = computeLayout(canvas.width, canvas.height);

  return {
    canvas,
    ctx,
    state,
    input,
    layout,
    ai,
    lastTime: 0,
    accumulator: 0,
    animFrame: 0,
  };
}

function startGameLoop(app: GameApp): void {
  const tickInterval = 1000 / TICK_RATE;

  function gameLoop(currentTime: number): void {
    if (app.lastTime === 0) app.lastTime = currentTime;
    const deltaTime = currentTime - app.lastTime;
    app.lastTime = currentTime;

    // Fixed timestep simulation
    app.accumulator += deltaTime * app.state.speed;
    while (app.accumulator >= tickInterval) {
      gameTick(app.state);
      processAI(app.state, app.ai);
      app.accumulator -= tickInterval;
    }

    // Render
    render(app.ctx, app.state, app.layout, app.input.camera,
      app.input.selectedEntities, 'humans');

    // Request next frame
    app.animFrame = requestAnimationFrame(gameLoop);
  }

  app.animFrame = requestAnimationFrame(gameLoop);
}

function setupInput(app: GameApp): void {
  const transform = defaultTransform(app.canvas);

  app.canvas.addEventListener('mousedown', (e: MouseEvent) => {
    const pos = transform(e.clientX, e.clientY);
    handleMouseDown(app.input, app.state, app.layout, pos.x, pos.y,
      e.button, e.shiftKey, 'humans');
  });

  app.canvas.addEventListener('mouseup', (e: MouseEvent) => {
    const pos = transform(e.clientX, e.clientY);
    handleMouseUp(app.input, app.state, app.layout, pos.x, pos.y, 'humans');
  });

  app.canvas.addEventListener('contextmenu', (e: Event) => {
    e.preventDefault();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    handleKeyDown(app.input, app.state, e.key, e.ctrlKey, 'humans');
  });

  // Resize handling
  window.addEventListener('resize', () => {
    app.canvas.width = window.innerWidth;
    app.canvas.height = window.innerHeight;
    app.layout = computeLayout(app.canvas.width, app.canvas.height);
  });
}

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const app = createApp();
      setupInput(app);
      startGameLoop(app);
    } catch (error) {
      console.error('Failed to initialize game:', error);
    }
  });
}
