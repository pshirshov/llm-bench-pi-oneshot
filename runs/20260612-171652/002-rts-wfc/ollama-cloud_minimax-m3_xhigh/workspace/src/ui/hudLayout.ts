// HUD layout: pure function of viewport size. Returns the rectangle for every
// interactive HUD element. Used by both the renderer and the input layer —
// the renderer draws from the same rects the hit-test uses, so a click on
// the "Train Footman" button always enqueues training.

import { Faction, UnitKind, BuildingKind, getUnitStats, getBuildingStats, FACTIONS } from "../sim/stats.js";
import { UnitEntity, BuildingEntity } from "../sim/entities.js";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface HudButton {
  readonly id: string;
  readonly rect: Rect;
  readonly label: string;
  readonly subLabel?: string;
  readonly enabled: boolean;
  readonly kind: "train" | "build" | "command" | "speed" | "pause" | "level" | "faction";
  readonly costGold?: number;
  readonly costWood?: number;
  readonly entityKind?: UnitKind | BuildingKind;
}

export interface HudLayout {
  readonly viewportW: number;
  readonly viewportH: number;
  readonly resourceBar: Rect;
  readonly seedText: { x: number; y: number };
  readonly minimap: Rect;
  readonly minimapViewport: Rect | null;
  readonly selectionPanel: Rect;
  readonly buttons: HudButton[];
  readonly speedButtons: HudButton[];
  readonly portraitRect: Rect;
  readonly statsRect: Rect;
  readonly hintRect: Rect;
}

export interface HudInputState {
  selectedIds: number[];
  units: UnitEntity[];
  buildings: BuildingEntity[];
  playerFaction: Faction;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  seed: number;
  tick: number;
  speed: 1 | 2;
  paused: boolean;
  levels: Array<{ index: number; locked: boolean; cleared: boolean }>;
  currentLevel: number;
}

const MIN_W = 640;
const MIN_H = 480;
const RESOURCE_BAR_H = 32;
const MINIMAP_SIZE = 180;
const MINIMAP_MARGIN = 12;
const PANEL_W = 200;
const PANEL_H = 200;
const PANEL_MARGIN = 12;
const BUTTON_H = 22;
const BUTTON_W = 90;

export function computeHudLayout(viewportW: number, viewportH: number, state: HudInputState): HudLayout {
  const vw = Math.max(MIN_W, viewportW);
  const vh = Math.max(MIN_H, viewportH);
  const resourceBar: Rect = { x: 0, y: 0, w: vw, h: RESOURCE_BAR_H };
  const seedText = { x: vw - 200, y: 20 };
  // Minimap: top-right of viewport, below the resource bar.
  const minimap: Rect = {
    x: vw - MINIMAP_SIZE - MINIMAP_MARGIN,
    y: RESOURCE_BAR_H + MINIMAP_MARGIN,
    w: MINIMAP_SIZE,
    h: MINIMAP_SIZE,
  };
  // Selection panel: bottom-left.
  const selectionPanel: Rect = {
    x: PANEL_MARGIN,
    y: vh - PANEL_H - PANEL_MARGIN,
    w: PANEL_W,
    h: PANEL_H,
  };
  const portraitRect: Rect = { x: selectionPanel.x + 4, y: selectionPanel.y + 4, w: 48, h: 48 };
  const statsRect: Rect = { x: selectionPanel.x + 56, y: selectionPanel.y + 4, w: 130, h: 70 };
  const hintRect: Rect = { x: selectionPanel.x + 4, y: selectionPanel.y + 80, w: PANEL_W - 8, h: PANEL_H - 84 };
  // Buttons: build & train panel inside selection panel.
  const buttons: HudButton[] = [];
  const selected = state.units.filter((u) => state.selectedIds.includes(u.id));
  const selectedBuildings = state.buildings.filter((b) => state.selectedIds.includes(b.id));
  const showTrainButtons = selected.length > 0 && selected[0] && selected[0].unitKind !== "worker";
  const showBuildButtons = selected.length > 0 && selected[0] && selected[0].unitKind === "worker";
  if (showTrainButtons) {
    const faction = state.playerFaction;
    const buildings = state.buildings.filter((b) => b.faction === faction && b.construction >= 1);
    const canTrain: Record<UnitKind, boolean> = {
      worker: buildings.some((b) => b.buildingKind === "townhall"),
      melee: buildings.some((b) => b.buildingKind === "barracks"),
      ranged: buildings.some((b) => b.buildingKind === "barracks" || b.buildingKind === "lumbermill"),
      heavy: buildings.some((b) => b.buildingKind === "barracks" && buildings.some((bb) => bb.buildingKind === "lumbermill")),
    };
    const order: UnitKind[] = ["worker", "melee", "ranged", "heavy"];
    let row = 0, col = 0;
    for (const k of order) {
      const s = getUnitStats(faction, k);
      const enabled = canTrain[k] && state.gold >= s.goldCost && state.wood >= s.woodCost && (state.supplyUsed + s.supplyCost) <= state.supplyCap;
      buttons.push({
        id: `train-${k}`,
        rect: { x: hintRect.x + col * (BUTTON_W + 4), y: hintRect.y + 8 + row * (BUTTON_H + 4), w: BUTTON_W, h: BUTTON_H },
        label: FACTIONS[faction].names[k],
        subLabel: `${s.goldCost}g${s.woodCost ? ` ${s.woodCost}w` : ""}`,
        enabled,
        kind: "train",
        costGold: s.goldCost,
        costWood: s.woodCost,
        entityKind: k,
      });
      col++;
      if (col >= 2) { col = 0; row++; }
    }
  } else if (showBuildButtons) {
    const faction = state.playerFaction;
    const buildings: BuildingKind[] = ["townhall", "farm", "barracks", "lumbermill", "guardtower"];
    let row = 0, col = 0;
    for (const b of buildings) {
      const s = getBuildingStats(faction, b);
      const enabled = state.gold >= s.goldCost && state.wood >= s.woodCost;
      buttons.push({
        id: `build-${b}`,
        rect: { x: hintRect.x + col * (BUTTON_W + 4), y: hintRect.y + 8 + row * (BUTTON_H + 4), w: BUTTON_W, h: BUTTON_H },
        label: FACTIONS[faction].names[b],
        subLabel: `${s.goldCost}g${s.woodCost ? ` ${s.woodCost}w` : ""}`,
        enabled,
        kind: "build",
        costGold: s.goldCost,
        costWood: s.woodCost,
        entityKind: b,
      });
      col++;
      if (col >= 2) { col = 0; row++; }
    }
  } else if (selectedBuildings.length > 0) {
    // Show unit counts in stats, and a "Rally" hint.
    buttons.push({
      id: "info",
      rect: { x: hintRect.x, y: hintRect.y, w: hintRect.w, h: 22 },
      label: "Building",
      enabled: false,
      kind: "command",
    });
  } else {
    // Hint: select a unit.
    buttons.push({
      id: "hint",
      rect: { x: hintRect.x, y: hintRect.y, w: hintRect.w, h: 22 },
      label: "Click a unit to select",
      enabled: false,
      kind: "command",
    });
  }
  // Speed buttons: top-left, below resource bar.
  const speedButtons: HudButton[] = [
    { id: "speed-1", rect: { x: 8, y: RESOURCE_BAR_H + 8, w: 36, h: 24 }, label: "1x", enabled: state.speed !== 1, kind: "speed" },
    { id: "speed-2", rect: { x: 48, y: RESOURCE_BAR_H + 8, w: 36, h: 24 }, label: "2x", enabled: state.speed !== 2, kind: "speed" },
    { id: "pause", rect: { x: 88, y: RESOURCE_BAR_H + 8, w: 60, h: 24 }, label: state.paused ? "▶" : "||", enabled: true, kind: "pause" },
  ];
  return {
    viewportW: vw,
    viewportH: vh,
    resourceBar,
    seedText,
    minimap,
    minimapViewport: null, // filled in by caller with map dimensions
    selectionPanel,
    buttons,
    speedButtons,
    portraitRect,
    statsRect,
    hintRect,
  };
}

/** Hit-test: returns the button id at the given point, or null. */
export function hitTestButtons(layout: HudLayout, x: number, y: number): HudButton | null {
  for (const b of layout.buttons) {
    if (x >= b.rect.x && x < b.rect.x + b.rect.w && y >= b.rect.y && y < b.rect.y + b.rect.h) return b;
  }
  for (const b of layout.speedButtons) {
    if (x >= b.rect.x && x < b.rect.x + b.rect.w && y >= b.rect.y && y < b.rect.y + b.rect.h) return b;
  }
  return null;
}

export function hitTestMinimap(layout: HudLayout, x: number, y: number): boolean {
  const m = layout.minimap;
  return x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h;
}

export function hitTestResourceBar(layout: HudLayout, x: number, y: number): boolean {
  const r = layout.resourceBar;
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
