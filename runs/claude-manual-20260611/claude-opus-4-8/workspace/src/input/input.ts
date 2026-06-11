/**
 * DOM input binding + order dispatch (T15).
 *
 * Defines the `InputContext` session/UI state the input layer mutates, then
 * implements pure handler functions (no real DOM needed for testing) plus a
 * thin `bindInput` that attaches DOM listeners that delegate to those handlers.
 *
 * DISCIPLINE: this module only translates DOM events into selection-state
 * changes + unit orders. It never calls stepWorld, Math.random, or any
 * rendering function. It is free of module-level mutable state.
 */

import type { World } from "../sim/world.js";
import type { Camera } from "../render/camera.js";
import {
  screenToWorldX,
  screenToWorldY,
  scrollCamera,
  centerOnMinimapPoint,
} from "../render/camera.js";
import type { HudLayout } from "../ui/hud.js";
import { hudButtonsAt } from "../ui/hud.js";
import type { Building, Unit } from "../sim/entity.js";
import type { EntityId, Faction, BuildingKind } from "../game/types.js";
import {
  moveTo,
  attack,
  attackMove,
  harvest,
  repair,
  build,
  stop,
} from "../sim/orders.js";
import { isEntityVisibleTo } from "../sim/fog.js";
import type { Vec2 } from "../core/vec.js";

// ---------------------------------------------------------------------------
// InputContext — session / UI state owned by the input layer
// ---------------------------------------------------------------------------

/**
 * The complete mutable session and UI state that the input handler reads and
 * writes. T17's GameSession will own and provide one of these. The input
 * handlers never allocate a new InputContext — they mutate the one passed in,
 * so tests can create a minimal context and inspect mutations directly.
 */
export interface InputContext {
  /** The live simulation state (read by hit-testing and order dispatch). */
  readonly world: World;

  /** The viewport/camera (mutated by scroll handlers). */
  camera: Camera;

  /** The faction the human player controls. */
  readonly faction: Faction;

  /**
   * The currently-selected entity ids.
   * Units are stored here; a selected building replaces all unit selections.
   */
  selection: Set<EntityId>;

  /**
   * The currently-selected building id, if any. Mutually exclusive with a
   * non-empty `selection` unit set.
   */
  selectedBuilding: EntityId | undefined;

  /**
   * Named control groups (1..9 → array of EntityIds at the time of binding).
   * Key is the digit 1-9; value is the ordered snapshot of the selection.
   */
  controlGroups: Map<number, EntityId[]>;

  /** Whether the simulation is paused. */
  paused: boolean;

  /** Playback speed multiplier. */
  speed: 1 | 2;

  /**
   * Building placement mode: non-null while the player is choosing where to
   * place a building (after clicking a "build" HUD button). The renderer
   * reads this to show a placement preview at the cursor tile.
   */
  placement: { readonly building: BuildingKind } | null;

  /**
   * The HUD layout computed for the current viewport + selection. Input reads
   * this for button hit-testing; the renderer re-computes it when selection
   * or viewport changes.
   */
  readonly hudLayout: HudLayout;

  /**
   * Map dimensions — needed for camera scroll clamping and world↔screen
   * transforms. Kept here so handlers never need to import World's map size
   * indirectly; these are read from world.map at context-creation time.
   */
  readonly mapWidth: number;
  readonly mapHeight: number;
}

// ---------------------------------------------------------------------------
// Internal drag-select state (held outside InputContext to keep that interface
// clean; the drag fields are event-handler scratch state, not session state)
// ---------------------------------------------------------------------------

/**
 * Transient drag-select state stored on the context for a mouse-down/move/up
 * sequence. Exposed as an optional extension on InputContext so `bindInput`
 * can attach it without a separate module-level variable (which would fail
 * for multiple concurrent GameSessions).
 */
export interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

export interface InputContextWithDrag extends InputContext {
  _drag?: DragState;
  _attackMoveMode?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Screen-edge scroll zone in pixels. */
const EDGE_SCROLL_ZONE = 12;
/** Pixels per scroll tick for arrow keys and edge scroll. */
const SCROLL_STEP = 16;
/** Minimum pixel drag before treating a mouse-down + mouse-up as a drag (vs click). */
const DRAG_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Helper: screen position → world tile (integer)
// ---------------------------------------------------------------------------

function screenToTile(
  cam: Camera,
  screenX: number,
  screenY: number,
): Vec2 {
  return {
    x: Math.floor(screenToWorldX(cam, screenX)),
    y: Math.floor(screenToWorldY(cam, screenY)),
  };
}

// ---------------------------------------------------------------------------
// Helper: find own unit or building at a world tile
// ---------------------------------------------------------------------------

/**
 * Returns the own-faction unit (if any) whose tile position matches `tile`.
 * A unit is "at" tile (tx, ty) when `floor(pos.x) === tx && floor(pos.y) === ty`.
 */
function ownUnitAtTile(
  world: World,
  faction: Faction,
  tile: Vec2,
): Unit | undefined {
  for (const unit of world.units.values()) {
    if (unit.owner !== faction) continue;
    if (Math.floor(unit.pos.x) === tile.x && Math.floor(unit.pos.y) === tile.y) {
      return unit;
    }
  }
  return undefined;
}

/**
 * Returns the own-faction building (if any) whose footprint contains `tile`.
 */
function ownBuildingAtTile(
  world: World,
  faction: Faction,
  tile: Vec2,
): Building | undefined {
  for (const building of world.buildings.values()) {
    if (building.owner !== faction) continue;
    const { x, y } = building.tile;
    const { w, h } = building.footprint;
    if (tile.x >= x && tile.x < x + w && tile.y >= y && tile.y < y + h) {
      return building;
    }
  }
  return undefined;
}

/**
 * Returns a hostile entity (unit or building) visible to `faction` at `tile`.
 * Prefers units over buildings when both are present.
 */
function hostileEntityAtTile(
  world: World,
  faction: Faction,
  tile: Vec2,
): Unit | Building | undefined {
  // Check hostile units first
  for (const unit of world.units.values()) {
    if (unit.owner === faction) continue;
    if (!isEntityVisibleTo(world, faction, unit)) continue;
    if (Math.floor(unit.pos.x) === tile.x && Math.floor(unit.pos.y) === tile.y) {
      return unit;
    }
  }
  // Check hostile buildings
  for (const building of world.buildings.values()) {
    if (building.owner === faction) continue;
    if (!isEntityVisibleTo(world, faction, building)) continue;
    const { x, y } = building.tile;
    const { w, h } = building.footprint;
    if (tile.x >= x && tile.x < x + w && tile.y >= y && tile.y < y + h) {
      return building;
    }
  }
  return undefined;
}

/**
 * Returns a friendly building visible and damageable (hp < maxHp) at `tile`,
 * for the repair-order context.
 */
function damagedFriendlyBuildingAtTile(
  world: World,
  faction: Faction,
  tile: Vec2,
): Building | undefined {
  for (const building of world.buildings.values()) {
    if (building.owner !== faction) continue;
    const { x, y } = building.tile;
    const { w, h } = building.footprint;
    if (tile.x >= x && tile.x < x + w && tile.y >= y && tile.y < y + h) {
      if (building.hp < building.maxHp) return building;
    }
  }
  return undefined;
}

/**
 * Returns true iff the tile is a resource tile (goldMine or forest) that a
 * worker could harvest.
 */
function isHarvestTile(world: World, tile: Vec2): boolean {
  if (!world.map.inBounds(tile.x, tile.y)) return false;
  const kind = world.map.tileAt(tile.x, tile.y);
  return kind === "goldMine" || kind === "forest";
}

/**
 * Returns a resource EntityId for a gold-mine tile, or undefined if the tile
 * is not a mine. There is no separate entity for resource tiles in this game;
 * the harvest order uses a pseudo-entity id derived from the tile position so
 * the economy phase can resolve it. We encode the tile as `y * mapWidth + x`
 * cast to EntityId (a stable key the economy phase can recover by divmod).
 * For forest tiles we do the same encoding.
 *
 * NOTE: the economy phase (T10) must be consistent with this encoding. For
 * now we also support a direct-tile harvest — see handleRightClick notes.
 */
function resourceEntityId(world: World, tile: Vec2): EntityId {
  return (tile.y * world.map.width + tile.x) as EntityId;
}

// ---------------------------------------------------------------------------
// Handler: left-click (selection + HUD)
// ---------------------------------------------------------------------------

/**
 * Handles a left-click at canvas coordinates (screenX, screenY).
 *
 * Priority order:
 *   1. HUD button hit → enter build-placement mode or train intent (caller's
 *      responsibility to read the returned intent; we update `placement`).
 *   2. Build-placement mode → confirm placement at the tile (if valid) and
 *      issue `build` order to all selected workers; cancel on invalid tile.
 *   3. World selection → own unit, own building, or deselect.
 *
 * Shift-click adds/removes from the selection.
 * Returns the HudIntent if a HUD button was clicked, otherwise undefined.
 */
export function handleLeftClick(
  ctx: InputContextWithDrag,
  screenX: number,
  screenY: number,
  shiftHeld: boolean,
): { kind: "hudIntent"; intent: ReturnType<typeof hudButtonsAt> } | undefined {
  // 1. HUD button hit-test
  const intent = hudButtonsAt(ctx.hudLayout, screenX, screenY);
  if (intent !== null) {
    if (intent.kind === "build") {
      // Enter placement mode — reset existing placement
      ctx.placement = { building: intent.building };
    }
    // "train" intent is handled by the GameSession on the returned value
    return { kind: "hudIntent", intent };
  }

  // 2. Build-placement confirmation
  if (ctx.placement !== null) {
    const tile = screenToTile(ctx.camera, screenX, screenY);
    const { w, h } = getBuildingFootprintSize(ctx.placement.building);
    const fp = { w, h };
    if (ctx.world.map.canPlaceBuilding(tile, fp)) {
      // Issue build order to all selected workers
      for (const id of ctx.selection) {
        const unit = ctx.world.units.get(id);
        if (unit !== undefined && unit.kind === "worker") {
          unit.order = build(ctx.placement.building, tile);
        }
      }
      ctx.placement = null;
    }
    // If tile is invalid, do nothing (keep placement mode active so the player
    // can try a different tile; Esc or right-click cancels).
    return undefined;
  }

  // 3. World selection
  const tile = screenToTile(ctx.camera, screenX, screenY);

  // Check own unit at tile
  const ownUnit = ownUnitAtTile(ctx.world, ctx.faction, tile);
  if (ownUnit !== undefined) {
    if (shiftHeld) {
      if (ctx.selection.has(ownUnit.id)) {
        ctx.selection.delete(ownUnit.id);
      } else {
        ctx.selection.add(ownUnit.id);
        ctx.selectedBuilding = undefined;
      }
    } else {
      ctx.selection = new Set<EntityId>([ownUnit.id]);
      ctx.selectedBuilding = undefined;
    }
    return undefined;
  }

  // Check own building at tile
  const ownBuilding = ownBuildingAtTile(ctx.world, ctx.faction, tile);
  if (ownBuilding !== undefined) {
    if (!shiftHeld) {
      ctx.selection = new Set<EntityId>();
      ctx.selectedBuilding = ownBuilding.id;
    }
    return undefined;
  }

  // Clicked empty ground → deselect (unless shift)
  if (!shiftHeld) {
    ctx.selection = new Set<EntityId>();
    ctx.selectedBuilding = undefined;
  }
  return undefined;
}

/**
 * Returns the footprint dimensions of a building kind.
 * Matches the stats table without importing the full stats module from here
 * (avoids circular dep risk). These values must stay in sync with stats.ts.
 * Fallback is 2×2 for unknown kinds.
 */
function getBuildingFootprintSize(kind: BuildingKind): { w: number; h: number } {
  switch (kind) {
    case "townHall":   return { w: 4, h: 4 };
    case "barracks":   return { w: 3, h: 3 };
    case "farm":       return { w: 2, h: 2 };
    case "lumberMill": return { w: 3, h: 3 };
    case "guardTower": return { w: 2, h: 2 };
    default: return { w: 2, h: 2 };
  }
}

// ---------------------------------------------------------------------------
// Handler: left-drag box select (mouse-up finalisation)
// ---------------------------------------------------------------------------

/**
 * Finalises a box-select drag. Selects all own-faction units whose tile
 * position falls inside the screen rect defined by (x0,y0)–(x1,y1).
 * Shift-held adds to the existing selection; otherwise replaces it.
 *
 * The rect coordinates are screen pixels; convert to world tile range.
 */
export function handleBoxSelect(
  ctx: InputContextWithDrag,
  screenX0: number,
  screenY0: number,
  screenX1: number,
  screenY1: number,
  shiftHeld: boolean,
): void {
  // Normalise so min/max are correct regardless of drag direction
  const minSX = Math.min(screenX0, screenX1);
  const maxSX = Math.max(screenX0, screenX1);
  const minSY = Math.min(screenY0, screenY1);
  const maxSY = Math.max(screenY0, screenY1);

  // Convert to world fractional tile bounds
  const minWX = screenToWorldX(ctx.camera, minSX);
  const maxWX = screenToWorldX(ctx.camera, maxSX);
  const minWY = screenToWorldY(ctx.camera, minSY);
  const maxWY = screenToWorldY(ctx.camera, maxSY);

  const selected: EntityId[] = [];
  for (const unit of ctx.world.units.values()) {
    if (unit.owner !== ctx.faction) continue;
    // Use the unit's fractional world position for containment
    if (
      unit.pos.x >= minWX &&
      unit.pos.x <= maxWX &&
      unit.pos.y >= minWY &&
      unit.pos.y <= maxWY
    ) {
      selected.push(unit.id);
    }
  }

  if (selected.length === 0 && !shiftHeld) {
    // Drag over nothing: deselect
    ctx.selection = new Set<EntityId>();
    ctx.selectedBuilding = undefined;
    return;
  }

  if (shiftHeld) {
    for (const id of selected) {
      ctx.selection.add(id);
    }
  } else {
    ctx.selection = new Set<EntityId>(selected);
    if (selected.length > 0) ctx.selectedBuilding = undefined;
  }
}

// ---------------------------------------------------------------------------
// Handler: right-click (context-sensitive orders)
// ---------------------------------------------------------------------------

/**
 * Handles a right-click at canvas coordinates (screenX, screenY).
 *
 * If `placement` is active, cancels it (Esc and right-click both cancel).
 * Otherwise issues context-sensitive orders to all selected own units:
 *   - hostile visible entity at tile → attack
 *   - damaged friendly building at tile → repair
 *   - resource tile (goldMine / forest) → harvest
 *   - empty tile → move
 */
export function handleRightClick(
  ctx: InputContextWithDrag,
  screenX: number,
  screenY: number,
): void {
  // Cancel placement mode
  if (ctx.placement !== null) {
    ctx.placement = null;
    return;
  }

  if (ctx.selection.size === 0) return;

  const tile = screenToTile(ctx.camera, screenX, screenY);

  // Determine order kind by what's at the tile
  const hostile = hostileEntityAtTile(ctx.world, ctx.faction, tile);
  if (hostile !== undefined) {
    for (const id of ctx.selection) {
      const unit = ctx.world.units.get(id);
      if (unit !== undefined) unit.order = attack(hostile.id);
    }
    return;
  }

  const damagedBuilding = damagedFriendlyBuildingAtTile(ctx.world, ctx.faction, tile);
  if (damagedBuilding !== undefined) {
    for (const id of ctx.selection) {
      const unit = ctx.world.units.get(id);
      if (unit !== undefined) unit.order = repair(damagedBuilding.id);
    }
    return;
  }

  if (isHarvestTile(ctx.world, tile)) {
    const resId = resourceEntityId(ctx.world, tile);
    for (const id of ctx.selection) {
      const unit = ctx.world.units.get(id);
      if (unit !== undefined) unit.order = harvest(resId);
    }
    return;
  }

  // Default: move
  for (const id of ctx.selection) {
    const unit = ctx.world.units.get(id);
    if (unit !== undefined) unit.order = moveTo(tile);
  }
}

// ---------------------------------------------------------------------------
// Handler: attack-move mode — press A then left-click a point
// ---------------------------------------------------------------------------

/**
 * Handles a left-click while attack-move mode is active (i.e. after pressing A).
 * Issues `attackMove` order to all selected own units and exits attack-move mode.
 */
export function handleAttackMoveClick(
  ctx: InputContextWithDrag,
  screenX: number,
  screenY: number,
): void {
  const tile = screenToTile(ctx.camera, screenX, screenY);
  for (const id of ctx.selection) {
    const unit = ctx.world.units.get(id);
    if (unit !== undefined) unit.order = attackMove(tile);
  }
  ctx._attackMoveMode = false;
}

// ---------------------------------------------------------------------------
// Handler: keyboard input
// ---------------------------------------------------------------------------

/**
 * Handles a keydown event described by `key`.
 *
 * Keys handled:
 *   Space         → toggle paused
 *   +/=           → set speed to 2
 *   -             → set speed to 1
 *   A             → enter attack-move mode
 *   Escape        → cancel placement or attack-move mode; issue stop order
 *   1..9          → recall control group (or bind if Ctrl held)
 *   ArrowLeft/Right/Up/Down → scroll camera
 */
export function handleKeyDown(
  ctx: InputContextWithDrag,
  key: string,
  ctrlHeld: boolean,
): void {
  switch (key) {
    case " ":
      ctx.paused = !ctx.paused;
      return;

    case "+":
    case "=":
      ctx.speed = 2;
      return;

    case "-":
      ctx.speed = 1;
      return;

    case "a":
    case "A":
      if (ctx.selection.size > 0) {
        ctx._attackMoveMode = true;
      }
      return;

    case "Escape":
      if (ctx.placement !== null) {
        ctx.placement = null;
      } else if (ctx._attackMoveMode === true) {
        ctx._attackMoveMode = false;
      } else {
        // Issue stop to selected units
        for (const id of ctx.selection) {
          const unit = ctx.world.units.get(id);
          if (unit !== undefined) unit.order = stop();
        }
      }
      return;

    case "ArrowLeft":
      ctx.camera = scrollCamera(ctx.camera, -SCROLL_STEP, 0, ctx.mapWidth, ctx.mapHeight);
      return;
    case "ArrowRight":
      ctx.camera = scrollCamera(ctx.camera, SCROLL_STEP, 0, ctx.mapWidth, ctx.mapHeight);
      return;
    case "ArrowUp":
      ctx.camera = scrollCamera(ctx.camera, 0, -SCROLL_STEP, ctx.mapWidth, ctx.mapHeight);
      return;
    case "ArrowDown":
      ctx.camera = scrollCamera(ctx.camera, 0, SCROLL_STEP, ctx.mapWidth, ctx.mapHeight);
      return;

    default:
      break;
  }

  // Control group binding/recall (keys "1" through "9")
  const digit = parseInt(key, 10);
  if (!isNaN(digit) && digit >= 1 && digit <= 9) {
    if (ctrlHeld) {
      // Bind: snapshot current selection to this group
      ctx.controlGroups.set(digit, [...ctx.selection]);
    } else {
      // Recall: replace selection with the group
      const group = ctx.controlGroups.get(digit);
      if (group !== undefined && group.length > 0) {
        ctx.selection = new Set<EntityId>(group as EntityId[]);
        ctx.selectedBuilding = undefined;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Handler: mouse move (edge scrolling + drag tracking)
// ---------------------------------------------------------------------------

/**
 * Handles a mousemove event at canvas coordinates (screenX, screenY) with the
 * given viewport size. Updates the drag state if dragging, and performs
 * edge-of-screen scrolling when the cursor is within EDGE_SCROLL_ZONE pixels
 * of the canvas edge.
 */
export function handleMouseMove(
  ctx: InputContextWithDrag,
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  leftButtonHeld: boolean,
): void {
  // Edge scroll
  let dx = 0;
  let dy = 0;
  if (screenX < EDGE_SCROLL_ZONE) dx = -SCROLL_STEP;
  else if (screenX > viewportW - EDGE_SCROLL_ZONE) dx = SCROLL_STEP;
  if (screenY < EDGE_SCROLL_ZONE) dy = -SCROLL_STEP;
  else if (screenY > viewportH - EDGE_SCROLL_ZONE) dy = SCROLL_STEP;
  if (dx !== 0 || dy !== 0) {
    ctx.camera = scrollCamera(ctx.camera, dx, dy, ctx.mapWidth, ctx.mapHeight);
  }

  // Drag tracking
  if (leftButtonHeld && ctx._drag !== undefined) {
    ctx._drag.currentX = screenX;
    ctx._drag.currentY = screenY;
    // Activate drag once the threshold is crossed
    if (!ctx._drag.active) {
      const ddx = screenX - ctx._drag.startX;
      const ddy = screenY - ctx._drag.startY;
      if (ddx * ddx + ddy * ddy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
        ctx._drag.active = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Handler: minimap click / drag
// ---------------------------------------------------------------------------

/**
 * Handles a click or drag on the minimap. `mx` and `my` are fractions [0,1]
 * of the map dimensions (as produced by normalizing click coords within the
 * minimap rect).
 */
export function handleMinimapClick(
  ctx: InputContextWithDrag,
  mx: number,
  my: number,
): void {
  ctx.camera = centerOnMinimapPoint(ctx.camera, mx, my, ctx.mapWidth, ctx.mapHeight);
}

// ---------------------------------------------------------------------------
// bindInput — attaches DOM event listeners to a canvas
// ---------------------------------------------------------------------------

/**
 * Attaches DOM input listeners to `canvas`, delegating to the pure handler
 * functions above. Guards for missing `document` (Node test environment).
 *
 * The returned function detaches all listeners (for cleanup / hot-reload).
 */
export function bindInput(
  canvas: HTMLCanvasElement,
  ctx: InputContextWithDrag,
): () => void {
  if (typeof document === "undefined") return () => undefined;

  // ---- Mouse down: begin potential drag ----
  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    ctx._drag = {
      startX: e.offsetX,
      startY: e.offsetY,
      currentX: e.offsetX,
      currentY: e.offsetY,
      active: false,
    };
  }

  // ---- Mouse move ----
  function onMouseMove(e: MouseEvent): void {
    handleMouseMove(
      ctx,
      e.offsetX,
      e.offsetY,
      canvas.width,
      canvas.height,
      (e.buttons & 1) !== 0,
    );
  }

  // ---- Mouse up: finalise click or box-select ----
  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      const drag = ctx._drag;
      if (drag !== undefined && drag.active) {
        // Box select
        handleBoxSelect(
          ctx,
          drag.startX,
          drag.startY,
          e.offsetX,
          e.offsetY,
          e.shiftKey,
        );
      } else {
        // Single click
        if (ctx._attackMoveMode === true) {
          handleAttackMoveClick(ctx, e.offsetX, e.offsetY);
        } else {
          handleLeftClick(ctx, e.offsetX, e.offsetY, e.shiftKey);
        }
      }
      ctx._drag = undefined;
    } else if (e.button === 2) {
      handleRightClick(ctx, e.offsetX, e.offsetY);
    }
  }

  // ---- Context menu: suppress (right-click is our order key) ----
  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  // ---- Key down ----
  function onKeyDown(e: KeyboardEvent): void {
    handleKeyDown(ctx, e.key, e.ctrlKey);
  }

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("keydown", onKeyDown);

  // Return cleanup function
  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("keydown", onKeyDown);
  };
}
