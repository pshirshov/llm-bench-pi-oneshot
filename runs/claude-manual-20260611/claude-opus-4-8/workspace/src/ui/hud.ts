/**
 * Canvas HUD — resource bar, selection panel, command buttons.
 *
 * PURE READ of World state + current selection.  No game-logic mutation,
 * no Math.random.
 *
 * Consumers:
 *   - `buildHudLayout`  — compute the data-driven button/panel geometry
 *     once per resize; pass to renderHud and hudButtonsAt.
 *   - `renderHud`       — draw the HUD into a CanvasCtx.
 *   - `hudButtonsAt`    — hit-test (mouseX, mouseY) → HudIntent | null.
 */

import type { CanvasCtx } from "../render/canvas-types.js";
import type { World } from "../sim/world.js";
import type { Building, Unit } from "../sim/entity.js";
import type { BuildingKind, Faction, UnitKind } from "../game/types.js";
import { BUILDING_KINDS } from "../game/types.js";
import { getBuildingStats, getUnitStats } from "../sim/stats.js";

// ---------------------------------------------------------------------------
// Intents emitted on button click
// ---------------------------------------------------------------------------

export type HudIntent =
  | { readonly kind: "train"; readonly unit: UnitKind }
  | { readonly kind: "build"; readonly building: BuildingKind };

// ---------------------------------------------------------------------------
// Layout geometry types
// ---------------------------------------------------------------------------

/** An axis-aligned rectangle in canvas pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One command button — geometry + the intent it emits when clicked. */
export interface CommandButton {
  readonly rect: Rect;
  readonly intent: HudIntent;
  /** Gold cost label. */
  readonly goldCost: number;
  /** Wood cost label. */
  readonly woodCost: number;
  /** Display label (unit/building name). */
  readonly label: string;
  /** Training progress in [0, 1], or undefined if not currently training. */
  readonly progress?: number;
}

/**
 * Data-driven layout produced by `buildHudLayout`.
 * The renderer and input handler share this object — no duplication of
 * geometry constants across modules.
 */
export interface HudLayout {
  /** Canvas pixel dimensions this layout was computed for. */
  readonly viewportW: number;
  readonly viewportH: number;

  /** Top resource bar strip. */
  readonly resourceBarRect: Rect;

  /** Bottom selection panel. */
  readonly selectionPanelRect: Rect;

  /** Portrait area within the selection panel. */
  readonly portraitRect: Rect;

  /** Stats text area within the selection panel. */
  readonly statsRect: Rect;

  /** Area for progress bar within the selection panel (build/train progress). */
  readonly progressBarRect: Rect;

  /** Command button grid (may be empty when nothing is selected). */
  readonly commandButtons: readonly CommandButton[];
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const RESOURCE_BAR_H = 32;
const PANEL_H = 120;
const PORTRAIT_W = 80;
const BUTTON_W = 80;
const BUTTON_H = 56;
const BUTTON_COLS = 4;
const BUTTON_GAP = 4;

// ---------------------------------------------------------------------------
// Layout builder
// ---------------------------------------------------------------------------

/**
 * Computes a HudLayout for the given viewport dimensions and current
 * selection.  Call this once per resize (or whenever the selection
 * changes the button set).
 *
 * @param viewportW     - Canvas pixel width.
 * @param viewportH     - Canvas pixel height.
 * @param faction       - The human player's faction (affects unit/building names).
 * @param world         - Current world (read-only — for training queues).
 * @param selectedUnits - Currently selected unit ids (may be empty).
 * @param selectedBuilding - Currently selected building id (or undefined).
 */
export function buildHudLayout(
  viewportW: number,
  viewportH: number,
  faction: Faction,
  world: World,
  selectedUnits: ReadonlySet<number>,
  selectedBuilding: number | undefined,
): HudLayout {
  const resourceBarRect: Rect = { x: 0, y: 0, w: viewportW, h: RESOURCE_BAR_H };

  const panelY = viewportH - PANEL_H;
  const selectionPanelRect: Rect = { x: 0, y: panelY, w: viewportW, h: PANEL_H };
  const portraitRect: Rect = { x: 4, y: panelY + 4, w: PORTRAIT_W, h: PANEL_H - 8 };
  const statsRect: Rect = {
    x: PORTRAIT_W + 12,
    y: panelY + 4,
    w: 180,
    h: PANEL_H - 8,
  };
  const progressBarRect: Rect = {
    x: PORTRAIT_W + 12,
    y: panelY + PANEL_H - 22,
    w: 160,
    h: 14,
  };

  const commandButtons: CommandButton[] = buildCommandButtons(
    viewportW,
    panelY,
    faction,
    world,
    selectedUnits,
    selectedBuilding,
  );

  return {
    viewportW,
    viewportH,
    resourceBarRect,
    selectionPanelRect,
    portraitRect,
    statsRect,
    progressBarRect,
    commandButtons,
  };
}

// ---------------------------------------------------------------------------
// Command button helper
// ---------------------------------------------------------------------------

/**
 * Determines which command buttons to show based on the selection and
 * produces their geometry + intents.
 */
function buildCommandButtons(
  viewportW: number,
  panelY: number,
  faction: Faction,
  world: World,
  selectedUnits: ReadonlySet<number>,
  selectedBuilding: number | undefined,
): CommandButton[] {
  const buttons: CommandButton[] = [];

  // Button grid origin: right portion of the panel
  const gridX = viewportW - (BUTTON_W + BUTTON_GAP) * BUTTON_COLS - 8;
  const gridY = panelY + 8;

  let col = 0;
  let row = 0;

  function addButton(intent: HudIntent, label: string, goldCost: number, woodCost: number, progress?: number): void {
    const x = gridX + col * (BUTTON_W + BUTTON_GAP);
    const y = gridY + row * (BUTTON_H + BUTTON_GAP);
    buttons.push({ rect: { x, y, w: BUTTON_W, h: BUTTON_H }, intent, label, goldCost, woodCost, progress });
    col++;
    if (col >= BUTTON_COLS) {
      col = 0;
      row++;
    }
  }

  // Worker selected → show build buttons
  const firstUnitId = selectedUnits.values().next().value as number | undefined;
  if (firstUnitId !== undefined) {
    const unit = world.units.get(firstUnitId as never);
    if (unit !== undefined && unit.kind === "worker") {
      for (const bk of BUILDING_KINDS) {
        const stats = getBuildingStats(faction, bk);
        addButton({ kind: "build", building: bk }, stats.name, stats.goldCost, stats.woodCost);
      }
    }
  }

  // Production building selected → show train buttons
  if (selectedBuilding !== undefined) {
    const building = world.buildings.get(selectedBuilding as never);
    if (building !== undefined && building.buildProgress >= 1) {
      const trainableFromKind: Record<BuildingKind, readonly UnitKind[]> = {
        townHall: ["worker"],
        barracks: ["infantry", "ranged", "heavy"],
        farm: [],
        lumberMill: [],
        guardTower: [],
      };
      const trainable = trainableFromKind[building.kind];
      // Progress for the head item in the train queue
      const queueHead = building.trainQueue[0];
      for (const uk of trainable) {
        const stats = getUnitStats(faction, uk);
        const isTraining = queueHead !== undefined && queueHead.unitKind === uk;
        const progress = isTraining ? queueHead.progress / queueHead.trainTime : undefined;
        addButton({ kind: "train", unit: uk }, stats.name, stats.goldCost, stats.woodCost, progress);
      }
    }
  }

  return buttons;
}

// ---------------------------------------------------------------------------
// Faction portrait colours (mirroring renderer)
// ---------------------------------------------------------------------------

const FACTION_COLOR: Record<Faction, string> = {
  human: "#4169e1",
  orc: "#8b0000",
};

// ---------------------------------------------------------------------------
// renderHud — draw the HUD
// ---------------------------------------------------------------------------

/**
 * Draws the full HUD: resource bar + seed, selection panel, command buttons.
 *
 * PURE READ — does not mutate world or layout.
 */
export function renderHud(
  ctx: CanvasCtx,
  world: World,
  layout: HudLayout,
  faction: Faction,
  selectedUnits: ReadonlySet<number>,
  selectedBuilding: number | undefined,
): void {
  drawResourceBar(ctx, world, layout, faction);
  drawSelectionPanel(ctx, world, layout, faction, selectedUnits, selectedBuilding);
  drawCommandButtons(ctx, layout, world.players[faction].gold, world.players[faction].wood);
}

// ---------------------------------------------------------------------------
// Resource bar
// ---------------------------------------------------------------------------

function drawResourceBar(
  ctx: CanvasCtx,
  world: World,
  layout: HudLayout,
  faction: Faction,
): void {
  const { resourceBarRect } = layout;
  const { x, y, w, h } = resourceBarRect;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(x, y, w, h);

  const player = world.players[faction];

  ctx.font = "bold 14px sans-serif";
  ctx.textBaseline = "middle";
  const midY = y + h / 2;

  // Gold
  ctx.fillStyle = "#ffd700";
  ctx.textAlign = "left";
  ctx.fillText(`Gold: ${player.gold}`, x + 8, midY);

  // Wood
  ctx.fillStyle = "#228b22";
  ctx.fillText(`Wood: ${player.wood}`, x + 130, midY);

  // Supply
  ctx.fillStyle = "#cccccc";
  ctx.fillText(`Supply: ${player.supplyUsed}/${player.supplyCap}`, x + 260, midY);

  // Seed — required by A8
  const seedStr = `Seed: ${world.rng.seed}`;
  ctx.fillStyle = "#aaaaaa";
  ctx.textAlign = "right";
  ctx.fillText(seedStr, x + w - 8, midY);
}

// ---------------------------------------------------------------------------
// Selection panel
// ---------------------------------------------------------------------------

function drawSelectionPanel(
  ctx: CanvasCtx,
  world: World,
  layout: HudLayout,
  faction: Faction,
  selectedUnits: ReadonlySet<number>,
  selectedBuilding: number | undefined,
): void {
  const { selectionPanelRect, portraitRect, statsRect, progressBarRect } = layout;

  // Panel background
  ctx.fillStyle = "rgba(20,20,20,0.85)";
  ctx.fillRect(selectionPanelRect.x, selectionPanelRect.y, selectionPanelRect.w, selectionPanelRect.h);

  const unitIds = [...selectedUnits];

  if (unitIds.length === 1) {
    const unit = world.units.get(unitIds[0] as never);
    if (unit !== undefined) {
      drawUnitPortrait(ctx, unit, portraitRect);
      drawUnitStats(ctx, unit, statsRect);
    }
  } else if (unitIds.length > 1) {
    drawMultiPortraits(ctx, world, unitIds, selectionPanelRect, faction);
  } else if (selectedBuilding !== undefined) {
    const building = world.buildings.get(selectedBuilding as never);
    if (building !== undefined) {
      drawBuildingPortrait(ctx, building, portraitRect);
      drawBuildingStats(ctx, world, building, statsRect, progressBarRect);
    }
  }
}

// ---------------------------------------------------------------------------
// Portrait helpers
// ---------------------------------------------------------------------------

const UNIT_KIND_COLOR: Record<UnitKind, string> = {
  worker: "#a0c080",
  infantry: "#5080c0",
  ranged: "#c0a050",
  heavy: "#804040",
};

function drawUnitPortrait(ctx: CanvasCtx, unit: Unit, rect: Rect): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.min(rect.w, rect.h) / 2 - 4;

  // Portrait background
  ctx.fillStyle = "#222222";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Faction-coloured border ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = FACTION_COLOR[unit.owner];
  ctx.fill();

  // Unit kind shape
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = UNIT_KIND_COLOR[unit.kind];
  ctx.fill();

  // Kind initial
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.max(10, radius * 0.8)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(unit.kind[0].toUpperCase(), cx, cy);
}

function drawBuildingPortrait(ctx: CanvasCtx, building: Building, rect: Rect): void {
  ctx.fillStyle = "#222222";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Building block shape
  const margin = 8;
  ctx.fillStyle = FACTION_COLOR[building.owner];
  ctx.fillRect(rect.x + margin, rect.y + margin, rect.w - margin * 2, rect.h - margin * 2);

  // Kind abbreviation
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(building.kind.slice(0, 2).toUpperCase(), rect.x + rect.w / 2, rect.y + rect.h / 2);
}

function drawMultiPortraits(
  ctx: CanvasCtx,
  world: World,
  unitIds: number[],
  panelRect: Rect,
  _faction: Faction,
): void {
  const MINI_SIZE = 28;
  const MINI_GAP = 4;
  const startX = panelRect.x + 4;
  const startY = panelRect.y + 4;
  const cols = Math.floor((panelRect.w - 8) / (MINI_SIZE + MINI_GAP));

  unitIds.slice(0, 16).forEach((id, i) => {
    const unit = world.units.get(id as never);
    if (unit === undefined) return;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = startX + col * (MINI_SIZE + MINI_GAP);
    const py = startY + row * (MINI_SIZE + MINI_GAP);

    ctx.fillStyle = FACTION_COLOR[unit.owner];
    ctx.fillRect(px, py, MINI_SIZE, MINI_SIZE);

    ctx.fillStyle = UNIT_KIND_COLOR[unit.kind];
    ctx.fillRect(px + 2, py + 2, MINI_SIZE - 4, MINI_SIZE - 4);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(unit.kind[0].toUpperCase(), px + MINI_SIZE / 2, py + MINI_SIZE / 2);
  });
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function drawUnitStats(ctx: CanvasCtx, unit: Unit, rect: Rect): void {
  ctx.fillStyle = "#ffffff";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const lineH = 17;
  ctx.fillText(`HP: ${unit.hp}/${unit.maxHp}`, rect.x, rect.y);
  ctx.fillText(`Kind: ${unit.kind}`, rect.x, rect.y + lineH);
}

function drawBuildingStats(
  ctx: CanvasCtx,
  world: World,
  building: Building,
  statsRect: Rect,
  progressBarRect: Rect,
): void {
  ctx.fillStyle = "#ffffff";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const lineH = 17;
  ctx.fillText(`${building.kind}`, statsRect.x, statsRect.y);
  ctx.fillText(`HP: ${building.hp}/${building.maxHp}`, statsRect.x, statsRect.y + lineH);

  // Construction progress bar
  if (building.buildProgress < 1) {
    drawProgressBar(ctx, progressBarRect, building.buildProgress, "#44aa44", "Building...");
  }

  // Training progress bar (head of queue)
  const queueHead = building.trainQueue[0];
  if (queueHead !== undefined && building.buildProgress >= 1) {
    const progress = queueHead.progress / queueHead.trainTime;
    drawProgressBar(ctx, progressBarRect, progress, "#4488cc", `Training: ${queueHead.unitKind}`);
  }

  // Suppress unused variable warning when world is read in future
  void world;
}

function drawProgressBar(
  ctx: CanvasCtx,
  rect: Rect,
  progress: number,
  color: string,
  label: string,
): void {
  // Background track
  ctx.fillStyle = "#333333";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Fill
  const fillW = Math.max(0, Math.min(rect.w, rect.w * progress));
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, fillW, rect.h);

  // Label
  ctx.fillStyle = "#ffffff";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

// ---------------------------------------------------------------------------
// Command buttons
// ---------------------------------------------------------------------------

function drawCommandButtons(
  ctx: CanvasCtx,
  layout: HudLayout,
  playerGold: number,
  playerWood: number,
): void {
  for (const btn of layout.commandButtons) {
    const { rect, label, goldCost, woodCost, progress } = btn;
    const canAfford = playerGold >= goldCost && playerWood >= woodCost;

    // Button background — dimmed when unaffordable
    ctx.fillStyle = canAfford ? "#444444" : "#2a2a2a";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // Border
    ctx.strokeStyle = canAfford ? "#888888" : "#555555";
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // Label
    ctx.fillStyle = canAfford ? "#ffffff" : "#888888";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + 4);

    // Cost line
    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#ffd700";
    ctx.fillText(`G:${goldCost}`, rect.x + rect.w / 2 - 16, rect.y + rect.h - 18);
    ctx.fillStyle = "#228b22";
    ctx.fillText(`W:${woodCost}`, rect.x + rect.w / 2 + 16, rect.y + rect.h - 18);

    // Progress bar (if training in progress)
    if (progress !== undefined) {
      const pb: Rect = { x: rect.x + 2, y: rect.y + rect.h - 8, w: rect.w - 4, h: 5 };
      ctx.fillStyle = "#333333";
      ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
      ctx.fillStyle = "#4488cc";
      ctx.fillRect(pb.x, pb.y, pb.w * Math.min(1, Math.max(0, progress)), pb.h);
    }
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Hit-tests a canvas mouse coordinate against the command buttons in the layout.
 *
 * Returns the matching `HudIntent` if the click falls inside a button, or
 * `null` if no button was hit.  The caller (T15 input handler) uses this to
 * dispatch orders without coupling input to HUD geometry.
 */
export function hudButtonsAt(
  layout: HudLayout,
  mouseX: number,
  mouseY: number,
): HudIntent | null {
  for (const btn of layout.commandButtons) {
    const { x, y, w, h } = btn.rect;
    if (mouseX >= x && mouseX < x + w && mouseY >= y && mouseY < y + h) {
      return btn.intent;
    }
  }
  return null;
}
