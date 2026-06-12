/**
 * HUD layout: pure functions computing rectangle data for all UI elements.
 * Single source of truth for both rendering and hit-testing.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HudLayout {
  readonly viewport: Rect;
  readonly minimap: Rect;
  readonly resourceBar: Rect;
  readonly selectionPanel: Rect;
  readonly buttons: ReadonlyArray<ButtonDef>;
  readonly speedButton: Rect;
  readonly pauseButton: Rect;
}

export interface ButtonDef {
  readonly id: string;
  readonly rect: Rect;
  readonly label: string;
}

/** Layout constants */
const MINIMAP_SIZE = 200;
const RESOURCE_BAR_HEIGHT = 40;
const SELECTION_PANEL_WIDTH = 250;
const BUTTON_SIZE = 50;
const BUTTON_GAP = 5;
const PADDING = 5;

/**
 * Compute the HUD layout for a given viewport size.
 */
export function computeLayout(viewportWidth: number, viewportHeight: number): HudLayout {
  // Minimap: bottom-left
  const minimap: Rect = {
    x: PADDING,
    y: viewportHeight - MINIMAP_SIZE - PADDING,
    width: MINIMAP_SIZE,
    height: MINIMAP_SIZE,
  };

  // Resource bar: top, full width
  const resourceBar: Rect = {
    x: 0,
    y: 0,
    width: viewportWidth,
    height: RESOURCE_BAR_HEIGHT,
  };

  // Selection panel: right side
  const selectionPanel: Rect = {
    x: viewportWidth - SELECTION_PANEL_WIDTH - PADDING,
    y: RESOURCE_BAR_HEIGHT + PADDING,
    width: SELECTION_PANEL_WIDTH,
    height: viewportHeight - RESOURCE_BAR_HEIGHT - MINIMAP_SIZE - PADDING * 3,
  };

  // Buttons: in selection panel
  const buttons: ButtonDef[] = [];
  const buttonAreaX = selectionPanel.x + PADDING;
  const buttonAreaY = selectionPanel.y + 100; // Below unit info
  const buttonsPerRow = Math.floor((selectionPanel.width - PADDING * 2) / (BUTTON_SIZE + BUTTON_GAP));

  const buttonTypes = ['train_worker', 'train_melee', 'train_ranged', 'train_heavy',
    'build_farm', 'build_barracks', 'build_lumberMill', 'build_guardTower'];

  for (let i = 0; i < buttonTypes.length; i++) {
    const row = Math.floor(i / buttonsPerRow);
    const col = i % buttonsPerRow;
    buttons.push({
      id: buttonTypes[i],
      rect: {
        x: buttonAreaX + col * (BUTTON_SIZE + BUTTON_GAP),
        y: buttonAreaY + row * (BUTTON_SIZE + BUTTON_GAP),
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
      },
      label: buttonTypes[i].replace('_', ' '),
    });
  }

  // Speed button: top-right
  const speedButton: Rect = {
    x: viewportWidth - 100 - PADDING,
    y: PADDING,
    width: 50,
    height: 30,
  };

  // Pause button: next to speed
  const pauseButton: Rect = {
    x: viewportWidth - 50 - PADDING,
    y: PADDING,
    width: 50,
    height: 30,
  };

  return {
    viewport: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
    minimap,
    resourceBar,
    selectionPanel,
    buttons,
    speedButton,
    pauseButton,
  };
}

/**
 * Hit-test: determine which UI element is at a screen point.
 * Returns the element ID or null.
 */
export function hitTest(layout: HudLayout, screenX: number, screenY: number): string | null {
  // Check buttons
  for (const btn of layout.buttons) {
    if (pointInRect(btn.rect, screenX, screenY)) {
      return btn.id;
    }
  }

  // Check speed button
  if (pointInRect(layout.speedButton, screenX, screenY)) {
    return 'speed';
  }

  // Check pause button
  if (pointInRect(layout.pauseButton, screenX, screenY)) {
    return 'pause';
  }

  // Check minimap
  if (pointInRect(layout.minimap, screenX, screenY)) {
    return 'minimap';
  }

  // Check selection panel
  if (pointInRect(layout.selectionPanel, screenX, screenY)) {
    return 'selectionPanel';
  }

  // Check resource bar
  if (pointInRect(layout.resourceBar, screenX, screenY)) {
    return 'resourceBar';
  }

  // Otherwise it's a viewport click
  return 'viewport';
}

/**
 * Check if a point is inside a rectangle.
 */
function pointInRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width &&
         y >= rect.y && y < rect.y + rect.height;
}

/**
 * Get the minimap position for a world coordinate.
 */
export function worldToMinimap(
  layout: HudLayout,
  worldX: number,
  worldY: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const relX = worldX / mapWidth;
  const relY = worldY / mapHeight;
  return {
    x: layout.minimap.x + relX * layout.minimap.width,
    y: layout.minimap.y + relY * layout.minimap.height,
  };
}

/**
 * Get the world coordinate for a minimap position.
 */
export function minimapToWorld(
  layout: HudLayout,
  minimapX: number,
  minimapY: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const relX = (minimapX - layout.minimap.x) / layout.minimap.width;
  const relY = (minimapY - layout.minimap.y) / layout.minimap.height;
  return {
    x: relX * mapWidth,
    y: relY * mapHeight,
  };
}
