import { SECONDS_PER_TICK, TICK_RATE } from './sim/constants';
import { seedFromUrl } from './sim/prng';
import type { Faction } from './sim/types';
import { World } from './sim/world';
import { Renderer, type RenderOptions } from './render/renderer';
import { InputController, type CameraState } from './ui/input';
import './style.css';

interface RunningGame {
  world: World;
  renderer: Renderer;
  input: InputController;
  camera: CameraState;
  renderOptions: RenderOptions;
}

const canvas = requireElement(document.querySelector<HTMLCanvasElement>('#game'), 'game canvas');
const menu = requireElement(document.querySelector<HTMLDivElement>('#menu'), 'menu');

const campaignSeed = seedFromUrl(window.location.search);
let selectedFaction: Faction = 'humans';
let selectedLevel = 1;
let unlocked = Number.parseInt(window.localStorage.getItem('warband-unlocked') ?? '1', 10);
let running: RunningGame | undefined;
let paused = false;
let speed: 1 | 2 = 1;
let accumulator = 0;
let previousTime = performance.now();

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
showMenu();
requestAnimationFrame(frame);

function showMenu(): void {
  if (running !== undefined) {
    running.input.unbind();
    running = undefined;
  }
  menu.hidden = false;
  menu.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = 'Warband';
  const seed = document.createElement('p');
  seed.textContent = `Campaign seed: ${campaignSeed}`;
  const factionRow = document.createElement('div');
  factionRow.append(button('Humans', () => { selectedFaction = 'humans'; }));
  factionRow.append(button('Orcs', () => { selectedFaction = 'orcs'; }));
  const levelRow = document.createElement('div');
  for (let level = 1; level <= 5; level += 1) {
    const levelButton = button(level <= unlocked ? `Level ${level}` : `Locked ${level}`, () => { selectedLevel = level; startGame(); });
    levelButton.disabled = level > unlocked;
    levelRow.append(levelButton);
  }
  const start = button(`Start Level ${selectedLevel}`, startGame);
  menu.append(title, seed, factionRow, levelRow, start);
}

function startGame(): void {
  menu.hidden = true;
  paused = false;
  speed = 1;
  const world = World.create(campaignSeed, selectedLevel, { playerFaction: selectedFaction });
  const camera = { x: Math.max(0, world.map.starts[0].x - 10), y: Math.max(0, world.map.starts[0].y - 8), zoom: 1 };
  const renderOptions: RenderOptions = { world, canvas, camera, paused, speed };
  const renderer = new Renderer(renderOptions);
  const input = new InputController({
    canvas,
    world,
    camera,
    onPauseToggle: () => { paused = !paused; renderOptions.paused = paused; },
    onSpeedToggle: () => { speed = speed === 1 ? 2 : 1; renderOptions.speed = speed; }
  });
  input.bind();
  running = { world, renderer, input, camera, renderOptions };
}

function frame(time: number): void {
  const delta = Math.min(0.25, (time - previousTime) / 1000);
  previousTime = time;
  const game = running;
  if (game !== undefined) {
    if (!paused) {
      accumulator += delta * speed;
      while (accumulator >= SECONDS_PER_TICK) {
        game.world.step(1);
        accumulator -= SECONDS_PER_TICK;
      }
    }
    game.renderer.render();
    if (game.world.outcome === 'victory') {
      unlocked = Math.max(unlocked, Math.min(5, game.world.map.level + 1));
      window.localStorage.setItem('warband-unlocked', unlocked.toString());
    }
  }
  requestAnimationFrame(frame);
}

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const item = document.createElement('button');
  item.textContent = label;
  item.addEventListener('click', action);
  return item;
}

function requireElement<T extends HTMLElement>(element: T | null, label: string): T {
  if (element === null) {
    throw new Error(`missing ${label}`);
  }
  return element;
}

export const fixedTickRate = TICK_RATE;
