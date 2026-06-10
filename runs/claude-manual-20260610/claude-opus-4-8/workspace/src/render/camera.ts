import type { Vec2 } from "../core/vec.js";
import type { Rect } from "./layout.js";

/**
 * Maps world (tile) coordinates to screen pixels within the game viewport.
 * Zoom is fixed; the camera pans across the map and clamps to its bounds.
 */
export class Camera {
  /** World-space tile coordinate shown at the viewport's top-left. */
  x = 0;
  y = 0;
  tileSize: number;
  viewport: Rect;

  constructor(tileSize: number, viewport: Rect) {
    this.tileSize = tileSize;
    this.viewport = viewport;
  }

  setViewport(v: Rect): void {
    this.viewport = v;
  }

  /** Visible width/height in tiles. */
  get tilesWide(): number {
    return this.viewport.w / this.tileSize;
  }
  get tilesHigh(): number {
    return this.viewport.h / this.tileSize;
  }

  worldToScreenX(wx: number): number {
    return this.viewport.x + (wx - this.x) * this.tileSize;
  }
  worldToScreenY(wy: number): number {
    return this.viewport.y + (wy - this.y) * this.tileSize;
  }
  screenToWorldX(sx: number): number {
    return (sx - this.viewport.x) / this.tileSize + this.x;
  }
  screenToWorldY(sy: number): number {
    return (sy - this.viewport.y) / this.tileSize + this.y;
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: this.screenToWorldX(sx), y: this.screenToWorldY(sy) };
  }

  centerOn(world: Vec2, mapW: number, mapH: number): void {
    this.x = world.x - this.tilesWide / 2;
    this.y = world.y - this.tilesHigh / 2;
    this.clamp(mapW, mapH);
  }

  pan(dxTiles: number, dyTiles: number, mapW: number, mapH: number): void {
    this.x += dxTiles;
    this.y += dyTiles;
    this.clamp(mapW, mapH);
  }

  clamp(mapW: number, mapH: number): void {
    const maxX = Math.max(0, mapW - this.tilesWide);
    const maxY = Math.max(0, mapH - this.tilesHigh);
    if (this.x < 0) this.x = 0;
    else if (this.x > maxX) this.x = maxX;
    if (this.y < 0) this.y = 0;
    else if (this.y > maxY) this.y = maxY;
  }
}
