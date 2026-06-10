// ─── Warband — RTS Game Entry Point ───

import { Faction, GameScreen } from './types';
import { simulateTick } from './game';
import { createGameState } from './game';
import { AIController } from './ai';
import { Renderer } from './renderer';
import { InputHandler } from './input';
import { TICK_DURATION } from './constants';

function getSeedFromUrl(): number {
  const params = new URLSearchParams(window.location.search);
  const seedParam = params.get('seed');
  if (seedParam) return parseInt(seedParam, 10) || 12345;
  return Math.floor(Math.random() * 2147483647);
}

function main(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!canvas) {
    // eslint-disable-next-line no-console
    console.error('Canvas element not found');
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // eslint-disable-next-line no-console
    console.error('Could not get 2D context');
    return;
  }

  // Resize canvas
  function resize(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    renderer.resize(canvas.width, canvas.height);
  }

  // Initialize game
  const seed = getSeedFromUrl();
  const playerFaction = Faction.Human;
  let state = createGameState(seed, playerFaction, 1);
  // Show level select first, but keep the seed
  state.screen = GameScreen.LevelSelect;

  const renderer = new Renderer(canvas);
  const input = new InputHandler(canvas, renderer);
  input.init(state);

  let aiController = new AIController(state.aiFaction, state.aiDifficulty, seed + 999);

  resize();
  window.addEventListener('resize', resize);

  // Game loop
  let lastTime = performance.now();
  let accumulator = 0;

  function gameLoop(now: number): void {
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Cap delta to prevent spiral of death
    const cappedDt = Math.min(dt, 0.1);
    accumulator += cappedDt;

    // Process input
    input.update(state, cappedDt);

    // Check if game needs restart (new level selected)
    if (input.needsRestart) {
      input.needsRestart = false;
      aiController = new AIController(state.aiFaction, state.aiDifficulty, input.restartSeed + 999);
    }

    // Fixed timestep simulation
    while (accumulator >= TICK_DURATION) {
      if (state.screen === GameScreen.Playing && !state.paused) {
        simulateTick(state);
        aiController.update(state, TICK_DURATION);
      }
      accumulator -= TICK_DURATION;
    }

    // Render
    renderer.render(state);

    // Draw selection rectangle
    const selRect = input.getSelectionRect();
    if (selRect) {
      const ctx2 = canvas.getContext('2d')!;
      ctx2.strokeStyle = '#0f0';
      ctx2.lineWidth = 1;
      ctx2.strokeRect(
        selRect.x1, selRect.y1,
        selRect.x2 - selRect.x1, selRect.y2 - selRect.y1
      );
    }

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
}

// Start
main();