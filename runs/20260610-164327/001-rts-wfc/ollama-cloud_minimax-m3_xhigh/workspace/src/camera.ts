// Camera: world <-> screen coords, edge scrolling, zoom, clamping.

import { type World } from './state.js';

export interface Camera {
  // World position at the top-left of the viewport (tile-space).
  x: number;
  y: number;
  // Viewport size in tiles (set externally from canvas size)
  w: number;
  h: number;
  zoom: number;  // pixels per tile
}

export function makeCamera(): Camera {
  return { x: 0, y: 0, w: 30, h: 20, zoom: 32 };
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

export function clampCamera(cam: Camera, w: World): void {
  if (cam.x < 0) cam.x = 0;
  if (cam.y < 0) cam.y = 0;
  if (cam.x + cam.w > w.map.width) cam.x = Math.max(0, w.map.width - cam.w);
  if (cam.y + cam.h > w.map.height) cam.y = Math.max(0, w.map.height - cam.h);
}

export function centerOn(cam: Camera, wx: number, wy: number, w: World): void {
  cam.x = wx - cam.w / 2;
  cam.y = wy - cam.h / 2;
  clampCamera(cam, w);
}
