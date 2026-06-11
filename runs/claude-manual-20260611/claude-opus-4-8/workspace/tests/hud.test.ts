/**
 * T14 HUD tests — canvas HUD + hit-test.
 *
 * Vitest runs in Node (no real DOM). We supply the same CanvasCtx stub
 * as render.test.ts (recording draw calls). Assertions:
 *   (a) renderHud() completes against a stub without throwing on a
 *       realistic seeded createWorld() world.
 *   (b) The resource bar reflects the World's gold/wood/supply values AND
 *       the active seed string is rendered (appears in fillText calls).
 *   (c) hudButtonsAt() returns the correct HudIntent for a click inside a
 *       known button rect (Worker selected → build buttons present).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createWorld } from "../src/sim/world.js";
import type { World } from "../src/sim/world.js";
import type { CanvasCtx } from "../src/render/canvas-types.js";
import { buildHudLayout, renderHud, hudButtonsAt } from "../src/ui/hud.js";
import type { HudLayout } from "../src/ui/hud.js";

// ---------------------------------------------------------------------------
// Canvas stub (identical shape to render.test.ts)
// ---------------------------------------------------------------------------

interface DrawRecord {
  op: string;
  fillStyle?: string;
  text?: string;
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
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof v === "string" ? v : "#gradient";
    },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
      strokeStyle = typeof v === "string" ? v : "#gradient";
    },
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
    fillText(text: string, x: number, y: number): void {
      calls.push({ op: "fillText", fillStyle, text, x, y });
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
// Shared setup
// ---------------------------------------------------------------------------

const SEED = 0xdeadbeef;
const LEVEL = 0;
const VIEWPORT_W = 800;
const VIEWPORT_H = 600;

function buildWorld(): World {
  return createWorld(SEED, LEVEL, "human", 2);
}

// ---------------------------------------------------------------------------
// Test (a): renderHud completes without throwing
// ---------------------------------------------------------------------------

describe("HUD: renderHud executes without errors", () => {
  let world: World;
  let layout: HudLayout;

  beforeEach(() => {
    world = buildWorld();
    layout = buildHudLayout(
      VIEWPORT_W,
      VIEWPORT_H,
      "human",
      world,
      new Set<number>(),
      undefined,
    );
  });

  it("renderHud() on an empty selection does not throw", () => {
    const { ctx } = makeStub();
    expect(() =>
      renderHud(ctx, world, layout, "human", new Set<number>(), undefined),
    ).not.toThrow();
  });

  it("renderHud() produces at least one fillRect call", () => {
    const { ctx, calls } = makeStub();
    renderHud(ctx, world, layout, "human", new Set<number>(), undefined);
    const rects = calls.filter((c) => c.op === "fillRect");
    expect(rects.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test (b): resource bar values + seed appear in fillText calls
// ---------------------------------------------------------------------------

describe("HUD: resource bar renders correct values including seed", () => {
  let world: World;
  let layout: HudLayout;

  beforeEach(() => {
    world = buildWorld();
    layout = buildHudLayout(
      VIEWPORT_W,
      VIEWPORT_H,
      "human",
      world,
      new Set<number>(),
      undefined,
    );
  });

  it("gold value is rendered in the resource bar", () => {
    const { ctx, calls } = makeStub();
    renderHud(ctx, world, layout, "human", new Set<number>(), undefined);
    const textCalls = calls.filter((c) => c.op === "fillText");
    const goldText = textCalls.find(
      (c) => typeof c.text === "string" && c.text.includes(`Gold: ${world.players.human.gold}`),
    );
    expect(goldText).toBeDefined();
  });

  it("wood value is rendered in the resource bar", () => {
    const { ctx, calls } = makeStub();
    renderHud(ctx, world, layout, "human", new Set<number>(), undefined);
    const textCalls = calls.filter((c) => c.op === "fillText");
    const woodText = textCalls.find(
      (c) => typeof c.text === "string" && c.text.includes(`Wood: ${world.players.human.wood}`),
    );
    expect(woodText).toBeDefined();
  });

  it("supply values are rendered in the resource bar", () => {
    const { ctx, calls } = makeStub();
    renderHud(ctx, world, layout, "human", new Set<number>(), undefined);
    const textCalls = calls.filter((c) => c.op === "fillText");
    const supplyText = textCalls.find(
      (c) =>
        typeof c.text === "string" &&
        c.text.includes("Supply:") &&
        c.text.includes(String(world.players.human.supplyUsed)) &&
        c.text.includes(String(world.players.human.supplyCap)),
    );
    expect(supplyText).toBeDefined();
  });

  it("active seed is rendered in the resource bar (A8 requirement)", () => {
    const { ctx, calls } = makeStub();
    renderHud(ctx, world, layout, "human", new Set<number>(), undefined);
    const textCalls = calls.filter((c) => c.op === "fillText");
    const seedStr = String(world.rng.seed);
    const seedText = textCalls.find(
      (c) => typeof c.text === "string" && c.text.includes(seedStr),
    );
    expect(seedText).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test (c): hudButtonsAt hit-test returns correct intent
// ---------------------------------------------------------------------------

describe("HUD: hudButtonsAt hit-test", () => {
  let world: World;

  beforeEach(() => {
    world = buildWorld();
  });

  it("returns null when no unit is selected (no command buttons)", () => {
    const layout = buildHudLayout(
      VIEWPORT_W,
      VIEWPORT_H,
      "human",
      world,
      new Set<number>(),
      undefined,
    );
    // Click in the middle of the canvas — no buttons present
    const intent = hudButtonsAt(layout, VIEWPORT_W / 2, VIEWPORT_H / 2);
    expect(intent).toBeNull();
  });

  it("clicking inside a build button rect returns the correct build intent", () => {
    // Find the first worker unit owned by the human player
    let workerNumId: number | undefined;
    for (const [id, unit] of world.units) {
      if (unit.owner === "human" && unit.kind === "worker") {
        workerNumId = id as number;
        break;
      }
    }
    expect(workerNumId).toBeDefined();

    const selected = new Set<number>([workerNumId!]);
    const layout = buildHudLayout(
      VIEWPORT_W,
      VIEWPORT_H,
      "human",
      world,
      selected,
      undefined,
    );

    // There must be at least one command button (build townHall, farm, etc.)
    expect(layout.commandButtons.length).toBeGreaterThan(0);

    // Click at the centre of the first button
    const firstBtn = layout.commandButtons[0];
    const cx = firstBtn.rect.x + firstBtn.rect.w / 2;
    const cy = firstBtn.rect.y + firstBtn.rect.h / 2;
    const intent = hudButtonsAt(layout, cx, cy);

    expect(intent).not.toBeNull();
    expect(intent!.kind).toBe("build");
  });

  it("clicking just outside a button rect returns null", () => {
    let workerNumId: number | undefined;
    for (const [id, unit] of world.units) {
      if (unit.owner === "human" && unit.kind === "worker") {
        workerNumId = id as number;
        break;
      }
    }
    expect(workerNumId).toBeDefined();

    const selected = new Set<number>([workerNumId!]);
    const layout = buildHudLayout(
      VIEWPORT_W,
      VIEWPORT_H,
      "human",
      world,
      selected,
      undefined,
    );
    expect(layout.commandButtons.length).toBeGreaterThan(0);

    // Click 1px above the first button
    const firstBtn = layout.commandButtons[0];
    const intent = hudButtonsAt(layout, firstBtn.rect.x + 1, firstBtn.rect.y - 1);
    expect(intent).toBeNull();
  });
});
