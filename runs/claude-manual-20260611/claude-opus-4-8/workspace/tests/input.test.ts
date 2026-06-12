/**
 * T15 input handler tests — pure handlers called with synthetic coords/keys
 * against a realistic world. No real DOM needed.
 *
 * Assertions:
 *   (a) Box-select over a region selects exactly the own units inside the rect
 *       (and not those outside).
 *   (b) Shift+click toggles a unit in/out of the selection.
 *   (c) Right-click on a visible hostile issues ATTACK orders to the selected
 *       own units (assert unit.order.kind === 'attack' with the correct targetId).
 *   (d) Ctrl+1 binds a control group; pressing 1 recalls it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createWorld } from "../src/sim/world.js";
import type { World } from "../src/sim/world.js";
import type { EntityId, Faction, UnitKind } from "../src/game/types.js";
import { makeEntityId } from "../src/game/types.js";
import type { Building, Unit } from "../src/sim/entity.js";
import { getBuildingStats } from "../src/sim/stats.js";
import { createCamera } from "../src/render/camera.js";
import type { Camera } from "../src/render/camera.js";
import { buildHudLayout } from "../src/ui/hud.js";
import type { HudLayout } from "../src/ui/hud.js";
import type { InputContextWithDrag } from "../src/input/input.js";
import {
  handleBoxSelect,
  handleLeftClick,
  handleRightClick,
  handleKeyDown,
} from "../src/input/input.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal InputContext for tests
// ---------------------------------------------------------------------------

const SEED = 0x1234abcd;
const LEVEL = 0;
const VIEWPORT_W = 800;
const VIEWPORT_H = 600;
const TILE_SIZE = 32;

function makeCtx(world: World, faction: Faction): InputContextWithDrag {
  const camera: Camera = createCamera(
    TILE_SIZE,
    VIEWPORT_W,
    VIEWPORT_H,
    10,
    10,
    world.map.width,
    world.map.height,
  );
  const layout: HudLayout = buildHudLayout(
    VIEWPORT_W,
    VIEWPORT_H,
    faction,
    world,
    new Set<number>(),
    undefined,
  );
  return {
    world,
    camera,
    faction,
    selection: new Set<EntityId>(),
    selectedBuilding: undefined,
    controlGroups: new Map<number, EntityId[]>(),
    paused: false,
    speed: 1,
    placement: null,
    hudLayout: layout,
    mapWidth: world.map.width,
    mapHeight: world.map.height,
    _drag: undefined,
    _attackMoveMode: false,
  };
}

// ---------------------------------------------------------------------------
// Helper: place a unit at a specific fractional world position and register it
// ---------------------------------------------------------------------------

function placeUnitAt(
  world: World,
  owner: Faction,
  posX: number,
  posY: number,
): Unit {
  const id = world.nextId();
  const unit: Unit = {
    id,
    owner,
    kind: "infantry",
    hp: 100,
    maxHp: 100,
    pos: { x: posX, y: posY },
    order: { kind: "stop" },
    attackCooldown: 0,
  };
  world.units.set(id, unit);
  return unit;
}

// ---------------------------------------------------------------------------
// (a) Box-select selects exactly own units inside the rect
// ---------------------------------------------------------------------------

describe("input: box-select", () => {
  let world: World;
  let ctx: InputContextWithDrag;
  let insideUnit: Unit;
  let outsideUnit: Unit;

  beforeEach(() => {
    world = createWorld(SEED, LEVEL, "human", 2);
    ctx = makeCtx(world, "human");

    // Place one unit clearly inside the selection box and one clearly outside.
    // The camera offset is (cam.offsetX, cam.offsetY). With TILE_SIZE=32 the
    // world tile for screen (x,y) is: tile_x = (x + offsetX) / 32.
    // We choose tiles that will be visible and unambiguous.
    //
    // We'll place insideUnit at tile (10,10) and outsideUnit at tile (20,20),
    // then box-select a screen rect that covers tile (10,10) but not (20,20).

    insideUnit = placeUnitAt(world, "human", 10.5, 10.5); // tile (10,10)
    outsideUnit = placeUnitAt(world, "human", 20.5, 20.5); // tile (20,20)
  });

  it("selects only own units inside the screen rect", () => {
    // Camera: offsetX/Y = (cam.offsetX, cam.offsetY).
    // World tile X from screen X: (screenX + cam.offsetX) / TILE_SIZE
    // So to select tile 10.5 (world), screen X = 10.5 * 32 - cam.offsetX
    const cam = ctx.camera;

    // Compute screen positions for the two units
    const insideScreenX = insideUnit.pos.x * TILE_SIZE - cam.offsetX;
    const insideScreenY = insideUnit.pos.y * TILE_SIZE - cam.offsetY;
    const outsideScreenX = outsideUnit.pos.x * TILE_SIZE - cam.offsetX;
    const outsideScreenY = outsideUnit.pos.y * TILE_SIZE - cam.offsetY;

    // Create a selection rect that includes insideUnit but excludes outsideUnit.
    // The midpoint between the two in screen space divides them cleanly.
    const midX = (insideScreenX + outsideScreenX) / 2;
    const midY = (insideScreenY + outsideScreenY) / 2;

    // Box: from a point above-left of insideUnit to midpoint
    const boxX0 = insideScreenX - 20;
    const boxY0 = insideScreenY - 20;
    const boxX1 = midX - 1;  // stops before midpoint → excludes outsideUnit
    const boxY1 = midY - 1;

    handleBoxSelect(ctx, boxX0, boxY0, boxX1, boxY1, false);

    // insideUnit should be selected; outsideUnit should NOT
    expect(ctx.selection.has(insideUnit.id)).toBe(true);
    expect(ctx.selection.has(outsideUnit.id)).toBe(false);
  });

  it("does not select enemy units inside the rect", () => {
    const enemyUnit = placeUnitAt(world, "orc", 10.5, 10.5); // same tile as insideUnit

    const cam = ctx.camera;
    const screenX = insideUnit.pos.x * TILE_SIZE - cam.offsetX;
    const screenY = insideUnit.pos.y * TILE_SIZE - cam.offsetY;

    handleBoxSelect(ctx, screenX - 20, screenY - 20, screenX + 20, screenY + 20, false);

    // Own unit selected; enemy at same position not selected
    expect(ctx.selection.has(insideUnit.id)).toBe(true);
    expect(ctx.selection.has(enemyUnit.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Shift+click toggles a unit in/out of the selection
// ---------------------------------------------------------------------------

describe("input: shift-click toggle", () => {
  let world: World;
  let ctx: InputContextWithDrag;
  let unitA: Unit;
  let unitB: Unit;

  beforeEach(() => {
    world = createWorld(SEED, LEVEL, "human", 2);
    ctx = makeCtx(world, "human");
    unitA = placeUnitAt(world, "human", 5.5, 5.5);
    unitB = placeUnitAt(world, "human", 6.5, 5.5);
  });

  it("shift-click adds a unit to an existing selection", () => {
    // First select unitA by normal click
    ctx.selection = new Set<EntityId>([unitA.id]);

    // Now shift-click unitB
    const cam = ctx.camera;
    const screenX = unitB.pos.x * TILE_SIZE - cam.offsetX;
    const screenY = unitB.pos.y * TILE_SIZE - cam.offsetY;
    handleLeftClick(ctx, screenX, screenY, true);

    expect(ctx.selection.has(unitA.id)).toBe(true);
    expect(ctx.selection.has(unitB.id)).toBe(true);
  });

  it("shift-click removes a unit already in the selection", () => {
    // Select both
    ctx.selection = new Set<EntityId>([unitA.id, unitB.id]);

    // Shift-click unitA to remove it
    const cam = ctx.camera;
    const screenX = unitA.pos.x * TILE_SIZE - cam.offsetX;
    const screenY = unitA.pos.y * TILE_SIZE - cam.offsetY;
    handleLeftClick(ctx, screenX, screenY, true);

    expect(ctx.selection.has(unitA.id)).toBe(false);
    expect(ctx.selection.has(unitB.id)).toBe(true);
  });

  it("normal click (no shift) replaces selection with just that unit", () => {
    ctx.selection = new Set<EntityId>([unitA.id, unitB.id]);

    // Click unitA without shift
    const cam = ctx.camera;
    const screenX = unitA.pos.x * TILE_SIZE - cam.offsetX;
    const screenY = unitA.pos.y * TILE_SIZE - cam.offsetY;
    handleLeftClick(ctx, screenX, screenY, false);

    expect(ctx.selection.has(unitA.id)).toBe(true);
    expect(ctx.selection.has(unitB.id)).toBe(false);
    expect(ctx.selection.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (c) Right-click on visible hostile issues ATTACK order
// ---------------------------------------------------------------------------

describe("input: right-click context-sensitive orders", () => {
  let world: World;
  let ctx: InputContextWithDrag;
  let ownUnit: Unit;

  beforeEach(() => {
    world = createWorld(SEED, LEVEL, "human", 2);
    ctx = makeCtx(world, "human");
    ownUnit = placeUnitAt(world, "human", 8.5, 8.5);
    ctx.selection = new Set<EntityId>([ownUnit.id]);
  });

  it("right-click on a visible hostile unit issues ATTACK order with correct targetId", () => {
    // Place a hostile unit
    const hostile = placeUnitAt(world, "orc", 15.5, 15.5);

    // Make the hostile tile visible to the human faction
    if (world.fog !== undefined) {
      const grid = world.fog["human"];
      grid.set(15, 15, "visible");
    }

    const cam = ctx.camera;
    const screenX = hostile.pos.x * TILE_SIZE - cam.offsetX;
    const screenY = hostile.pos.y * TILE_SIZE - cam.offsetY;

    handleRightClick(ctx, screenX, screenY);

    const updatedUnit = world.units.get(ownUnit.id);
    expect(updatedUnit).toBeDefined();
    expect(updatedUnit!.order.kind).toBe("attack");
    if (updatedUnit!.order.kind === "attack") {
      expect(updatedUnit!.order.targetId).toBe(hostile.id);
    }
  });

  it("right-click on empty ground issues MOVE order", () => {
    // Choose a tile that is empty (no unit/building), map-interior, walkable
    // We'll use tile (12,12) which should be clear on a 48x48 map interior
    const cam = ctx.camera;
    // Tile 12,12 → screen coords
    const tileX = 12;
    const tileY = 12;
    const screenX = (tileX + 0.5) * TILE_SIZE - cam.offsetX;
    const screenY = (tileY + 0.5) * TILE_SIZE - cam.offsetY;

    handleRightClick(ctx, screenX, screenY);

    const updatedUnit = world.units.get(ownUnit.id);
    expect(updatedUnit).toBeDefined();
    // Should be a move order (unless tile happened to be gold/forest — we just
    // check it's not stop)
    expect(updatedUnit!.order.kind === "move" || updatedUnit!.order.kind === "harvest").toBe(true);
  });

  it("right-click in placement mode cancels placement", () => {
    ctx.placement = { building: "barracks" };
    handleRightClick(ctx, 100, 100);
    expect(ctx.placement).toBeNull();

    // Own unit's order should be unchanged (was not re-issued)
    const updatedUnit = world.units.get(ownUnit.id);
    expect(updatedUnit!.order.kind).toBe("stop");
  });
});

// ---------------------------------------------------------------------------
// (d) Ctrl+1 binds control group; pressing 1 recalls it
// ---------------------------------------------------------------------------

describe("input: control groups", () => {
  let world: World;
  let ctx: InputContextWithDrag;
  let unitA: Unit;
  let unitB: Unit;

  beforeEach(() => {
    world = createWorld(SEED, LEVEL, "human", 2);
    ctx = makeCtx(world, "human");
    unitA = placeUnitAt(world, "human", 5.5, 5.5);
    unitB = placeUnitAt(world, "human", 6.5, 6.5);
    ctx.selection = new Set<EntityId>([unitA.id, unitB.id]);
  });

  it("Ctrl+1 binds the current selection to group 1, and pressing 1 recalls it", () => {
    // Bind
    handleKeyDown(ctx, "1", true); // Ctrl+1

    // Change selection
    ctx.selection = new Set<EntityId>();
    ctx.selection.add(unitA.id);

    // Recall
    handleKeyDown(ctx, "1", false); // 1

    expect(ctx.selection.has(unitA.id)).toBe(true);
    expect(ctx.selection.has(unitB.id)).toBe(true);
    expect(ctx.selection.size).toBe(2);
  });

  it("pressing a digit for an empty group does nothing", () => {
    // Group 5 has no binding
    ctx.selection = new Set<EntityId>([unitA.id]);
    handleKeyDown(ctx, "5", false);
    // Selection should be unchanged
    expect(ctx.selection.size).toBe(1);
    expect(ctx.selection.has(unitA.id)).toBe(true);
  });

  it("Space toggles paused", () => {
    expect(ctx.paused).toBe(false);
    handleKeyDown(ctx, " ", false);
    expect(ctx.paused).toBe(true);
    handleKeyDown(ctx, " ", false);
    expect(ctx.paused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional: attack-move mode
// ---------------------------------------------------------------------------

describe("input: attack-move mode", () => {
  let world: World;
  let ctx: InputContextWithDrag;
  let ownUnit: Unit;

  beforeEach(() => {
    world = createWorld(SEED, LEVEL, "human", 2);
    ctx = makeCtx(world, "human");
    ownUnit = placeUnitAt(world, "human", 8.5, 8.5);
    ctx.selection = new Set<EntityId>([ownUnit.id]);
  });

  it("pressing A sets attack-move mode, which is cancelled by Escape", () => {
    handleKeyDown(ctx, "A", false);
    expect(ctx._attackMoveMode).toBe(true);

    handleKeyDown(ctx, "Escape", false);
    expect(ctx._attackMoveMode).toBe(false);
  });

  it("placement mode is cancelled by Escape", () => {
    ctx.placement = { building: "barracks" };
    handleKeyDown(ctx, "Escape", false);
    expect(ctx.placement).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (D6) Train intent — a left-click on a train HUD button sets building.order;
//      it is a NO-OP for an enemy-owned or absent selected building.
// ---------------------------------------------------------------------------

/**
 * Injects a COMPLETE production building at `tile` for `owner`. The footprint is
 * cleared to buildable ground first so placement succeeds on any seeded terrain,
 * then the building is registered and its footprint occupied (mirroring the
 * world's own `addBuilding`, but without its supply bookkeeping, which these
 * train-intent tests do not exercise).
 */
function injectBuilding(
  world: World,
  kind: Building["kind"],
  owner: Faction,
  tile: { x: number; y: number },
): Building {
  const stats = getBuildingStats(owner, kind);
  world.map.clearForBuilding(tile, stats.footprint);
  const b: Building = {
    id: world.nextId(),
    owner,
    kind,
    hp: stats.hp,
    maxHp: stats.hp,
    tile,
    footprint: stats.footprint,
    buildProgress: 1,
    trainQueue: [],
  };
  world.buildings.set(b.id, b);
  world.map.occupy(tile, stats.footprint, b.id);
  return b;
}

/**
 * Builds an InputContext whose HUD layout is computed with `selectedBuilding`
 * selected, so the production building's train buttons are present for hit-test.
 */
function ctxWithSelectedBuilding(
  world: World,
  faction: Faction,
  selectedBuilding: EntityId | undefined,
): InputContextWithDrag {
  const base = makeCtx(world, faction);
  // `hudLayout` is readonly on the interface, so rebuild the context as a fresh
  // literal with the building-selected layout rather than reassigning the field.
  return {
    ...base,
    selectedBuilding,
    hudLayout: buildHudLayout(
      VIEWPORT_W,
      VIEWPORT_H,
      faction,
      world,
      new Set<number>(),
      selectedBuilding,
    ),
  };
}

/** Centre of the first command button whose intent trains `unit`. */
function trainButtonCenter(layout: HudLayout, unit: UnitKind): { x: number; y: number } {
  const btn = layout.commandButtons.find(
    (b) => b.intent.kind === "train" && b.intent.unit === unit,
  );
  if (btn === undefined) throw new Error(`no train button for ${unit} in layout`);
  return { x: btn.rect.x + btn.rect.w / 2, y: btn.rect.y + btn.rect.h / 2 };
}

describe("input: train intent (D6)", () => {
  let world: World;

  beforeEach(() => {
    world = createWorld(SEED, LEVEL, "human", 2);
  });

  it("left-click on a train button sets building.order = {kind:'train', unitKind} on an OWNED production building", () => {
    const barracks = injectBuilding(world, "barracks", "human", { x: 20, y: 20 });
    const ctx = ctxWithSelectedBuilding(world, "human", barracks.id);

    // A barracks trains infantry/ranged/heavy; click the infantry button.
    const { x, y } = trainButtonCenter(ctx.hudLayout, "infantry");
    const result = handleLeftClick(ctx, x, y, false);

    // The click is reported as a HUD intent…
    expect(result?.kind).toBe("hudIntent");
    // …and the train order is set on the selected building.
    expect(barracks.order).toBeDefined();
    expect(barracks.order!.kind).toBe("train");
    if (barracks.order!.kind === "train") {
      expect(barracks.order!.unitKind).toBe("infantry");
    }
  });

  it("is a NO-OP for an ENEMY-owned selected building (ownership guard)", () => {
    // The building belongs to orc, but the player faction is human. Build the
    // HUD with it 'selected' so a train button exists to click; the ownership
    // guard in applyTrainIntent must refuse to set the order.
    const orcBarracks = injectBuilding(world, "barracks", "orc", { x: 20, y: 20 });
    const ctx = ctxWithSelectedBuilding(world, "human", orcBarracks.id);

    const { x, y } = trainButtonCenter(ctx.hudLayout, "infantry");
    handleLeftClick(ctx, x, y, false);

    // No train order was set on the enemy building.
    expect(orcBarracks.order).toBeUndefined();
  });

  it("is a NO-OP when no building is selected (selectedBuilding undefined)", () => {
    // Build a barracks but DON'T select it; instead hand-craft a layout that
    // exposes a train button while selectedBuilding is undefined, proving the
    // guard keys on selectedBuilding rather than on the click alone.
    const barracks = injectBuilding(world, "barracks", "human", { x: 20, y: 20 });
    const base = makeCtx(world, "human");
    // Borrow a train-button layout (computed as if the barracks were selected),
    // but leave selectedBuilding undefined. `hudLayout` is readonly, so assemble
    // a fresh context literal.
    const ctx: InputContextWithDrag = {
      ...base,
      selectedBuilding: undefined,
      hudLayout: buildHudLayout(
        VIEWPORT_W,
        VIEWPORT_H,
        "human",
        world,
        new Set<number>(),
        barracks.id,
      ),
    };

    const { x, y } = trainButtonCenter(ctx.hudLayout, "infantry");
    handleLeftClick(ctx, x, y, false);

    // The order must NOT have been set — no selected building to train from.
    expect(barracks.order).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Additional: EntityId branding — make sure test-created ids work
// ---------------------------------------------------------------------------

describe("input: EntityId helper", () => {
  it("makeEntityId returns a branded EntityId", () => {
    const id = makeEntityId(42);
    expect(id).toBe(42);
  });
});
