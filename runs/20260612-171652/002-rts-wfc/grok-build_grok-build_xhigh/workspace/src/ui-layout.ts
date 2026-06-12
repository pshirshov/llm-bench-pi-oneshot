/**
 * Pure UI layout and hit-testing for HUD.
 * No side effects, usable in tests (jsdom or node).
 */

export interface HudLayout {
  resourceBar: { x: number; y: number; w: number; h: number };
  minimap: { x: number; y: number; w: number; h: number };
  selectionPanel: { x: number; y: number; w: number; h: number };
  trainButtons: Array<{ type: string; rect: { x: number; y: number; w: number; h: number } }>;
  buildButtons: Array<{ type: string; rect: { x: number; y: number; w: number; h: number } }>;
}

export function computeHudLayout(viewW: number, viewH: number): HudLayout {
  const barH = 32;
  const mmSize = Math.min(180, Math.floor(viewW * 0.22));
  const selW = 240;
  const selH = 140;
  return {
    resourceBar: { x: 0, y: 0, w: viewW, h: barH },
    minimap: { x: viewW - mmSize - 8, y: barH + 8, w: mmSize, h: mmSize },
    selectionPanel: { x: 8, y: viewH - selH - 8, w: selW, h: selH },
    trainButtons: [],
    buildButtons: [],
  };
}

export function hitTestHud(layout: HudLayout, screenX: number, screenY: number): string | null {
  const r = layout.resourceBar;
  if (screenX >= r.x && screenX < r.x + r.w && screenY >= r.y && screenY < r.y + r.h) return 'resourceBar';
  const m = layout.minimap;
  if (screenX >= m.x && screenX < m.x + m.w && screenY >= m.y && screenY < m.y + m.h) return 'minimap';
  const s = layout.selectionPanel;
  if (screenX >= s.x && screenX < s.x + s.w && screenY >= s.y && screenY < s.y + s.h) return 'selectionPanel';
  return null;
}
