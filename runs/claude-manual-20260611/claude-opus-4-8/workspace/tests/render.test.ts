/**
 * T13 render tests — Canvas 2D renderer, camera, and fog-aware minimap.
 *
 * Vitest runs in Node (no real DOM), so we supply a minimal CanvasCtx stub
 * that records draw calls as no-ops but captures the fillStyle string at each
 * fillRect / arc call. This lets us:
 *   (a) verify that render() and renderMinimap() complete without throwing
 *       against a realistic seeded createWorld() world, and
 *   (b) verify that an enemy unit placed on a non-Visible tile is NOT rendered
 *       (its faction colour must not appear in arc calls on that tile).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createWorld } from "../src/sim/world.js";
import type { World } from "../src/sim/world.js";
import { stepWorld } from "../src/sim/simulation.js";
import { render } from "../src/render/renderer.js";
import { renderMinimap } from "../src/render/minimap.js";
import type { PixelRect } from "../src/render/minimap.js";
import { createCamera } from "../src/render/camera.js";
import type { CanvasCtx } from "../src/render/canvas-types.js";
import type { FogMap } from "../src/sim/fog.js";
import { makeEntityId } from "../src/game/types.js";
import { idle } from "../src/sim/orders.js";
import type { Unit } from "../src/sim/entity.js";

// ---------------------------------------------------------------------------
// Canvas stub
// ---------------------------------------------------------------------------

/**
 * Minimal CanvasCtx stub.  All methods are no-ops that also push a record of
 * what was called, including the current fillStyle at the time of the call.
 * This lets assertions inspect rendering decisions without a real canvas.
 */
interface DrawRecord {
  op: string;
  fillStyle?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  radius?: number;
}

function makeStub(): { ctx: CanvasCtx; calls: DrawRecord[] } {
  const calls: DrawRecord[] = [];
  let fillStyle = "#000000";
  let strokeStyle = "#000000";
  let globalAlpha = 1;
  let lineWidth = 1;
  let font = "10px sans-serif";
  let textAlign: CanvasTextAlign = "left";
  let textBaseline: CanvasTextBaseline = "alphabetic";

  const ctx: CanvasCtx = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) { fillStyle = typeof v === "string" ? v : "#gradient"; },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) { strokeStyle = typeof v === "string" ? v : "#gradient"; },
    get globalAlpha() { return globalAlpha; },
    set globalAlpha(v: number) { globalAlpha = v; },
    get lineWidth() { return lineWidth; },
    set lineWidth(v: number) { lineWidth = v; },
    get font() { return font; },
    set font(v: string) { font = v; },
    get textAlign() { return textAlign; },
    set textAlign(v: CanvasTextAlign) { textAlign = v; },
    get textBaseline() { return textBaseline; },
    set textBaseline(v: CanvasTextBaseline) { textBaseline = v; },

    fillRect(x: number, y: number, w: number, h: number): void {
      calls.push({ op: "fillRect", fillStyle, x, y, w, h });
    },
    strokeRect(x: number, y: number, w: number, h: number): void {
      calls.push({ op: "strokeRect", x, y, w, h });
    },
    fillText(_text: string, x: number, y: number): void {
      calls.push({ op: "fillText", fillStyle, x, y });
    },
    beginPath(): void {
      calls.push({ op: "beginPath" });
    },
    arc(x: number, y: number, radius: number): void {
      calls.push({ op: "arc", fillStyle, x, y, radius });
    },
    fill(): void {
      calls.push({ op: "fill", fillStyle });
    },
    stroke(): void {
      calls.push({ op: "stroke" });
    },
    save(): void {
      calls.push({ op: "save" });
    },
    restore(): void {
      calls.push({ op: "restore" });
    },
  };

  return { ctx, calls };
}

// ---------------------------------------------------------------------------
// Test world setup
// ---------------------------------------------------------------------------

const SEED = 0xdeadbeef;
const LEVEL = 0;
const VIEWPORT_W = 800;
const VIEWPORT_H = 600;
const TILE_SIZE = 32;
const MINIMAP_RECT: PixelRect = { x: 0, y: 0, w: 200, h: 200 };

function buildWorld(): World {
  return createWorld(SEED, LEVEL, "human", 2);
}

// ---------------------------------------------------------------------------
// Test (a): render and renderMinimap execute without throwing
// ---------------------------------------------------------------------------

describe("render: full draw executes without errors", () => {
  let world: World;

  beforeEach(() => {
    world = buildWorld();
    // Run one fog phase so some tiles become Visible
    stepWorld(world);
  });

  it("render() completes a full draw without throwing", () => {
    const { ctx } = makeStub();
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      world.map.width / 2,
      world.map.height / 2,
      world.map.width,
      world.map.height,
    );
    // Should not throw
    expect(() => render(ctx, world, cam, "human")).not.toThrow();
  });

  it("render() produces at least one fillRect call (terrain tiles drawn)", () => {
    const { ctx, calls } = makeStub();
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      world.map.width / 2,
      world.map.height / 2,
      world.map.width,
      world.map.height,
    );
    render(ctx, world, cam, "human");
    const fillRects = calls.filter(c => c.op === "fillRect");
    expect(fillRects.length).toBeGreaterThan(0);
  });

  it("renderMinimap() completes without throwing", () => {
    const { ctx } = makeStub();
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      world.map.width / 2,
      world.map.height / 2,
      world.map.width,
      world.map.height,
    );
    expect(() => renderMinimap(ctx, world, cam, "human", MINIMAP_RECT)).not.toThrow();
  });

  it("renderMinimap() draws a viewport strokeRect outline", () => {
    const { ctx, calls } = makeStub();
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      world.map.width / 2,
      world.map.height / 2,
      world.map.width,
      world.map.height,
    );
    renderMinimap(ctx, world, cam, "human", MINIMAP_RECT);
    const strokes = calls.filter(c => c.op === "strokeRect");
    // The viewport outline must appear
    expect(strokes.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Test (b): fog rule — enemy unit on a non-Visible tile is NOT drawn
// ---------------------------------------------------------------------------

describe("render: fog gate — enemy unit on non-Visible tile is not rendered", () => {
  it("an orc unit on an Unexplored tile produces no arc call with the orc faction colour", () => {
    const world = buildWorld();
    // Do NOT call stepWorld — all tiles remain Unexplored.

    // Find a tile that is definitely Unexplored for human: use the orc start.
    const orcStart = world.mapReport.starts[1];

    // Inject a synthetic orc unit directly on that tile.
    const syntheticOrc: Unit = {
      id: makeEntityId(99901),
      owner: "orc",
      kind: "infantry",
      hp: 60,
      maxHp: 60,
      pos: { x: orcStart.x + 0.5, y: orcStart.y + 0.5 },
      order: idle(),
      attackCooldown: 0,
    };
    world.units.set(syntheticOrc.id, syntheticOrc);

    const { ctx, calls } = makeStub();
    // Centre the camera right on that enemy unit to ensure it would be in the
    // viewport if fog were ignored.
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      orcStart.x,
      orcStart.y,
      world.map.width,
      world.map.height,
    );

    render(ctx, world, cam, "human");

    // The orc faction colour is "#8b0000".
    // Inspect every arc (unit circle) call. If the enemy unit were drawn, its
    // arc would be preceded by fillStyle = "#8b0000".
    // We look at "fill" calls that immediately follow an "arc" call with the
    // enemy colour set.
    const ORC_COLOR = "#8b0000";
    let orcCircleDrawn = false;
    for (let i = 0; i < calls.length; i++) {
      if (calls[i].op === "fill" && calls[i].fillStyle === ORC_COLOR) {
        orcCircleDrawn = true;
        break;
      }
    }
    expect(orcCircleDrawn).toBe(false);
  });

  it("an orc unit on a Visible tile IS rendered (fill with orc colour appears)", () => {
    const world = buildWorld();
    // Run one step so the human faction gets some visible tiles.
    stepWorld(world);

    // Find a tile that is Visible to human. We'll place a synthetic orc there.
    const fog = world.fog as FogMap;
    const humanFog = fog["human"];
    let visibleTileX = -1;
    let visibleTileY = -1;
    outer:
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        if (humanFog.get(x, y) === "visible") {
          visibleTileX = x;
          visibleTileY = y;
          break outer;
        }
      }
    }
    // If somehow no tile is visible (shouldn't happen after stepWorld), skip.
    if (visibleTileX === -1) return;

    const syntheticOrc: Unit = {
      id: makeEntityId(99902),
      owner: "orc",
      kind: "infantry",
      hp: 60,
      maxHp: 60,
      pos: { x: visibleTileX + 0.5, y: visibleTileY + 0.5 },
      order: idle(),
      attackCooldown: 0,
    };
    world.units.set(syntheticOrc.id, syntheticOrc);

    const { ctx, calls } = makeStub();
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      visibleTileX,
      visibleTileY,
      world.map.width,
      world.map.height,
    );
    render(ctx, world, cam, "human");

    const ORC_COLOR = "#8b0000";
    const orcCircleDrawn = calls.some(c => c.op === "fill" && c.fillStyle === ORC_COLOR);
    expect(orcCircleDrawn).toBe(true);
  });

  it("minimap: orc unit on Unexplored tile produces no arc with orc colour", () => {
    const world = buildWorld();
    // No stepWorld — all tiles Unexplored.

    const orcStart = world.mapReport.starts[1];
    const syntheticOrc: Unit = {
      id: makeEntityId(99903),
      owner: "orc",
      kind: "worker",
      hp: 40,
      maxHp: 40,
      pos: { x: orcStart.x + 0.5, y: orcStart.y + 0.5 },
      order: idle(),
      attackCooldown: 0,
    };
    world.units.set(syntheticOrc.id, syntheticOrc);

    const { ctx, calls } = makeStub();
    const cam = createCamera(
      TILE_SIZE,
      VIEWPORT_W,
      VIEWPORT_H,
      world.map.width / 2,
      world.map.height / 2,
      world.map.width,
      world.map.height,
    );
    renderMinimap(ctx, world, cam, "human", MINIMAP_RECT);

    const ORC_COLOR = "#8b0000";
    const orcDotDrawn = calls.some(c => c.op === "fill" && c.fillStyle === ORC_COLOR);
    expect(orcDotDrawn).toBe(false);
  });
});
