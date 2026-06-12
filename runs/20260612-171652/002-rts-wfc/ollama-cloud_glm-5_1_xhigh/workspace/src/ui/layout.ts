/** HUD layout computation — pure function of viewport size. No DOM imports. */

import type { BuildingType, UnitType } from "../sim/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HUDButton {
  id: string;
  label: string;
  rect: Rect;
  tooltip: string;
  enabled: boolean;
}

export interface HUDLayout {
  resourceBar: Rect;
  minimap: Rect;
  selectionPanel: Rect;
  buttons: HUDButton[];
  speedButton: Rect;
  pauseButton: Rect;
  seedDisplay: Rect;
}

const MINIMAP_SIZE = 160;
const SELECTION_PANEL_HEIGHT = 160;
const RESOURCE_BAR_HEIGHT = 32;

export function computeLayout(viewportWidth: number, viewportHeight: number): HUDLayout {
  const resourceBar: Rect = { x: 0, y: 0, w: viewportWidth, h: RESOURCE_BAR_HEIGHT };
  const minimap: Rect = { x: 4, y: viewportHeight - MINIMAP_SIZE - 4, w: MINIMAP_SIZE, h: MINIMAP_SIZE };
  const selectionPanel: Rect = {
    x: MINIMAP_SIZE + 8,
    y: viewportHeight - SELECTION_PANEL_HEIGHT,
    w: viewportWidth - MINIMAP_SIZE - 12,
    h: SELECTION_PANEL_HEIGHT,
  };
  const speedButton: Rect = { x: viewportWidth - 70, y: 4, w: 30, h: 24 };
  const pauseButton: Rect = { x: viewportWidth - 110, y: 4, w: 30, h: 24 };
  const seedDisplay: Rect = { x: viewportWidth - 200, y: 4, w: 80, h: 24 };

  return { resourceBar, minimap, selectionPanel, buttons: [], speedButton, pauseButton, seedDisplay };
}

export function computeSelectionButtons(
  selection: { type: string; faction: string; id: number }[],
  viewportWidth: number, viewportHeight: number
): HUDButton[] {
  const buttons: HUDButton[] = [];
  if (selection.length === 0) return buttons;

  const panelX = MINIMAP_SIZE + 8;
  const panelY = viewportHeight - SELECTION_PANEL_HEIGHT;

  if (selection.length === 1) {
    const entity = selection[0];
    const isBuilding = ["town_hall", "farm", "barracks", "lumber_mill", "guard_tower"].includes(entity.type);

    if (isBuilding) {
      const bType = entity.type as BuildingType;
      // Training buttons for production buildings
      if (bType === "town_hall") {
        buttons.push(makeButton(`train_worker`, panelX + 4, panelY + 30, `Peasant (60g)`, `Train a Peasant`));
      }
      if (bType === "barracks") {
        buttons.push(makeButton(`train_melee`, panelX + 4, panelY + 30, `Footman (130g)`, `Train Footman`));
        buttons.push(makeButton(`train_ranged`, panelX + 4 + 80, panelY + 30, `Archer (90g 60w)`, `Train Archer`));
        buttons.push(makeButton(`train_heavy`, panelX + 4 + 160, panelY + 30, `Knight (250g 125w)`, `Train Knight`));
      }
    } else {
      // Unit action buttons
      const uType = entity.type as UnitType;
      if (uType === "worker") {
        buttons.push(makeButton(`build_farm`, panelX + 4, panelY + 30, `Farm (80g 50w)`, `Build Farm`));
        buttons.push(makeButton(`build_barracks`, panelX + 84, panelY + 30, `Barracks (150g 60w)`, `Build Barracks`));
        buttons.push(makeButton(`build_lumber_mill`, panelX + 164, panelY + 30, `L. Mill (120g 80w)`, `Build Lumber Mill`));
        buttons.push(makeButton(`build_guard_tower`, panelX + 4, panelY + 60, `Tower (100g 50w)`, `Build Guard Tower`));
      }
    }
  } else {
    // Multi-selection: just show count
    buttons.push(makeButton(`selection_info`, panelX + 4, panelY + 30, `${selection.length} units`, `Selected units`));
  }

  return buttons;
}

function makeButton(id: string, x: number, y: number, label: string, tooltip: string): HUDButton {
  return { id, label, rect: { x, y, w: 76, h: 24 }, tooltip, enabled: true };
}

/** Hit-test: given a screen point, return which HUD element is under it. */
export type HITElem =
  | { type: "game_area" }
  | { type: "minimap" }
  | { type: "resource_bar" }
  | { type: "selection_panel" }
  | { type: "button"; id: string }
  | { type: "speed_button" }
  | { type: "pause_button" }
  | { type: "seed_display" };

export function hitTest(sx: number, sy: number, layout: HUDLayout, buttons: HUDButton[]): HITElem {
  if (layout.minimap.x <= sx && sx <= layout.minimap.x + layout.minimap.w &&
      layout.minimap.y <= sy && sy <= layout.minimap.y + layout.minimap.h) {
    return { type: "minimap" };
  }
  if (layout.selectionPanel.x <= sx && sx <= layout.selectionPanel.x + layout.selectionPanel.w &&
      layout.selectionPanel.y <= sy && sy <= layout.selectionPanel.y + layout.selectionPanel.h) {
    for (const btn of buttons) {
      if (btn.rect.x <= sx && sx <= btn.rect.x + btn.rect.w &&
          btn.rect.y <= sy && sy <= btn.rect.y + btn.rect.h) {
        return { type: "button", id: btn.id };
      }
    }
    return { type: "selection_panel" };
  }
  if (layout.speedButton.x <= sx && sx <= layout.speedButton.x + layout.speedButton.w &&
      layout.speedButton.y <= sy && sy <= layout.speedButton.y + layout.speedButton.h) {
    return { type: "speed_button" };
  }
  if (layout.pauseButton.x <= sx && sx <= layout.pauseButton.x + layout.pauseButton.w &&
      layout.pauseButton.y <= sy && sy <= layout.pauseButton.y + layout.pauseButton.h) {
    return { type: "pause_button" };
  }
  return { type: "game_area" };
}

/** Validate layout: no overlapping interactive elements, all within viewport. */
export function validateLayout(layout: HUDLayout, viewportWidth: number, viewportHeight: number): string[] {
  const errors: string[] = [];
  const rects = [
    { name: "minimap", ...layout.minimap },
    { name: "selectionPanel", ...layout.selectionPanel },
    { name: "speedButton", ...layout.speedButton },
    { name: "pauseButton", ...layout.pauseButton },
  ];
  for (const r of rects) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > viewportWidth || r.y + r.h > viewportHeight) {
      errors.push(`${r.name} outside viewport`);
    }
  }
  // Check minimap doesn't overlap resource bar
  if (layout.minimap.y < layout.resourceBar.h) {
    errors.push("minimap overlaps resource bar");
  }
  // Check selection panel doesn't overlap resource bar
  if (layout.selectionPanel.y < layout.resourceBar.h) {
    errors.push("selection panel overlaps resource bar");
  }
  return errors;
}