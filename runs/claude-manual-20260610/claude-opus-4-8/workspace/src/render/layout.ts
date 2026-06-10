/** Screen-space rectangles for the HUD and game viewport, recomputed on resize. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TOP_BAR_H = 30;
export const BOTTOM_H = 158;
const PAD = 8;

export interface Layout {
  canvas: Rect;
  topBar: Rect;
  bottomPanel: Rect;
  minimap: Rect;
  selectionPanel: Rect;
  commandPanel: Rect;
  viewport: Rect;
}

export function computeLayout(width: number, height: number): Layout {
  const topBar: Rect = { x: 0, y: 0, w: width, h: TOP_BAR_H };
  const bottomPanel: Rect = { x: 0, y: height - BOTTOM_H, w: width, h: BOTTOM_H };
  const mmSide = BOTTOM_H - PAD * 2;
  const minimap: Rect = {
    x: PAD,
    y: bottomPanel.y + PAD,
    w: mmSide,
    h: mmSide,
  };
  const commandW = 220;
  const commandPanel: Rect = {
    x: width - commandW - PAD,
    y: bottomPanel.y + PAD,
    w: commandW,
    h: BOTTOM_H - PAD * 2,
  };
  const selectionPanel: Rect = {
    x: minimap.x + minimap.w + PAD,
    y: bottomPanel.y + PAD,
    w: commandPanel.x - (minimap.x + minimap.w) - PAD * 2,
    h: BOTTOM_H - PAD * 2,
  };
  const viewport: Rect = {
    x: 0,
    y: TOP_BAR_H,
    w: width,
    h: height - TOP_BAR_H - BOTTOM_H,
  };
  return {
    canvas: { x: 0, y: 0, w: width, h: height },
    topBar,
    bottomPanel,
    minimap,
    selectionPanel,
    commandPanel,
    viewport,
  };
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}
