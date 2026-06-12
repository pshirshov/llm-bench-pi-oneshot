/** Game entry point. */

import { World } from "./sim/world";
import { Viewport } from "./render/viewport";
import { Renderer } from "./render/renderer";
import { InputHandler } from "./ui/input";
import { TICK_RATE } from "./sim/constants";
import { parseSeedParam, freshSeed } from "./sim/prng";

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let world: World;
let viewport: Viewport;
let renderer: Renderer;
let input: InputHandler;
let lastTime = 0;
let accumulator = 0;
let seed: number;

function init(): void {
  canvas = document.getElementById("game") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas element not found");

  seed = parseSeedParam(window.location.href) ?? freshSeed();

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const ctxMaybe = canvas.getContext("2d");
  if (!ctxMaybe) throw new Error("Could not get 2D context");
  ctx = ctxMaybe;

  world = new World(seed, 1, "human");
  viewport = new Viewport(canvas.width, canvas.height, world.map.width, world.map.height);
  renderer = new Renderer(ctx);
  input = new InputHandler(seed, {
    getWorld: () => world,
    getViewport: () => viewport,
    getCanvasRect: () => canvas.getBoundingClientRect(),
    requestRedraw: () => {},
  });
  input.bind(canvas);
  input.updateLayout(canvas.width, canvas.height);

  // Center viewport on player start
  if (world.starts.length > 0) {
    const s = world.starts[0];
    viewport.centerOn(s.col + 1.5, s.row + 1.5);
  }

  window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    viewport.width = canvas.width;
    viewport.height = canvas.height;
    input.updateLayout(canvas.width, canvas.height);
  });

  requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp: number): void {
  const dt = timestamp - lastTime;
  lastTime = timestamp;

  if (!input.state.paused) {
    accumulator += dt * input.state.speed;
    const tickDuration = 1000 / TICK_RATE;
    let steps = 0;
    while (accumulator >= tickDuration && steps < 5) {
      world.step();
      accumulator -= tickDuration;
      steps++;
    }
    if (steps >= 5) accumulator = 0; // prevent spiral of death
  }

  renderer.render(world, viewport, input.state, canvas.width, canvas.height);
  requestAnimationFrame(gameLoop);
}

init();