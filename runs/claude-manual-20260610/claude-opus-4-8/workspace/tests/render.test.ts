import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXED_DT } from "../src/sim/config.js";
import { createGame } from "../src/sim/setup.js";
import { stepWorld } from "../src/sim/simulation.js";
import { Faction } from "../src/sim/stats.js";
import { Camera } from "../src/render/camera.js";
import { computeLayout } from "../src/render/layout.js";
import { Renderer } from "../src/render/renderer.js";
import { Minimap } from "../src/render/minimap.js";
import { Hud } from "../src/ui/hud.js";
import { GameSession } from "../src/game/session.js";

/**
 * A minimal CanvasRenderingContext2D / document stub so the rendering and
 * session code paths run under Node. This does not validate pixels — it
 * validates that the draw/input/loop code executes without throwing, which is
 * the part the headless unit tests for the simulation cannot cover.
 */
function makeCtxStub(): CanvasRenderingContext2D {
  const noop = (): void => {};
  const ctx: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "12px sans-serif",
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    rect: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    fill: noop,
    stroke: noop,
    arc: noop,
    ellipse: noop,
    moveTo: noop,
    lineTo: noop,
    setTransform: noop,
    translate: noop,
    scale: noop,
    drawImage: noop,
    putImageData: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (t: string) => ({ width: t.length * 6 }),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    getContext: () => ctx,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  const ctx = makeCtxStub();
  // Stub document.createElement('canvas') used by Minimap's offscreen buffers.
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
});

afterAll(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe("rendering smoke", () => {
  it("draws terrain, entities, minimap and HUD without throwing", () => {
    const { world } = createGame({
      seed: 21,
      width: 48,
      height: 48,
      playerFaction: Faction.Human,
      difficulty: 3,
    });
    // Run a while so units, projectiles and corpses exist.
    for (let i = 0; i < Math.round(150 / FIXED_DT); i++) stepWorld(world, FIXED_DT);

    const ctx = makeCtxStub();
    const layout = computeLayout(1024, 720);
    const cam = new Camera(24, layout.viewport);
    cam.centerOn({ x: 24, y: 24 }, world.map.width, world.map.height);
    const renderer = new Renderer(ctx);
    const minimap = new Minimap(world.map.width, world.map.height);
    const hud = new Hud();

    expect(() => {
      renderer.draw(world, cam, layout, {
        selection: new Set(),
        placement: null,
        dragBox: { x0: 10, y0: 50, x1: 200, y1: 240 },
        hover: { x: 24, y: 24 },
        now: world.time,
      });
      minimap.draw(ctx, world, cam, layout.minimap);
      const view = { paused: false, speed: 1 as const, seed: 21, levelLabel: "Test" };
      const buttons = hud.computeButtons(world, layout, new Set(), view);
      hud.draw(ctx, world, layout, new Set(), view, buttons, null);
    }).not.toThrow();
  });

  it("runs the session update/render loop and handles input without throwing", () => {
    const ctx = makeCtxStub();
    const init = createGame({
      seed: 5,
      width: 40,
      height: 40,
      playerFaction: Faction.Human,
      difficulty: 2,
    });
    const session = new GameSession(
      ctx,
      init,
      5,
      "Test",
      { onEnd: () => {}, onMenu: () => {} },
      1024,
      720,
    );

    expect(() => {
      // Drive a few frames.
      for (let f = 0; f < 30; f++) {
        session.onMouseMove(400, 300, false);
        session.update(0.05);
        session.render(ctx);
      }
      // Selection: box-select across the viewport, then issue orders.
      session.onLeftDown(60, 60, false);
      session.onMouseMove(900, 600, true);
      session.onLeftUp(900, 600, false);
      session.onRightDown(500, 350); // move/attack order
      session.onKeyDown("a", false); // arm attack-move
      session.onLeftDown(450, 320, false);
      session.onLeftUp(450, 320, false);
      session.onKeyDown("1", true); // assign control group
      session.onKeyDown("1", false); // recall control group
      session.onKeyDown(" ", false); // pause
      session.onKeyDown(" ", false); // resume
      for (let f = 0; f < 10; f++) {
        session.update(0.05);
        session.render(ctx);
      }
    }).not.toThrow();

    // The box-select should have grabbed the player's starting workers.
    expect(session.selection.size).toBeGreaterThan(0);
  });
});
