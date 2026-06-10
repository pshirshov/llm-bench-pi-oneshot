import type { Vec2 } from "../core/vec.js";
import { buildingCenter } from "../sim/entity.js";
import { FogState } from "../sim/fog.js";
import { THEMES } from "../sim/stats.js";
import type { World } from "../sim/world.js";
import { TILE_PROPS } from "../wfc/tiles.js";
import type { Camera } from "./camera.js";
import type { Rect } from "./layout.js";

/**
 * Minimap rendering. Terrain is rasterised once to an offscreen canvas at
 * map resolution and blitted scaled; fog and entities are redrawn each frame.
 * The minimap respects fog (unexplored hidden, explored dimmed).
 */
export class Minimap {
  private readonly terrain: HTMLCanvasElement;
  private readonly fog: HTMLCanvasElement;
  private readonly mapW: number;
  private readonly mapH: number;
  private terrainBuilt = false;

  constructor(mapW: number, mapH: number) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.terrain = document.createElement("canvas");
    this.terrain.width = mapW;
    this.terrain.height = mapH;
    this.fog = document.createElement("canvas");
    this.fog.width = mapW;
    this.fog.height = mapH;
  }

  /** Rebuild the cached terrain raster (call when terrain mutates, e.g. forest depletes). */
  invalidate(): void {
    this.terrainBuilt = false;
  }

  private buildTerrain(world: World): void {
    const ctx = this.terrain.getContext("2d");
    if (!ctx) return;
    for (let y = 0; y < this.mapH; y++) {
      for (let x = 0; x < this.mapW; x++) {
        ctx.fillStyle = TILE_PROPS[world.map.terrainAt(x, y)].color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    this.terrainBuilt = true;
  }

  draw(ctx: CanvasRenderingContext2D, world: World, cam: Camera, rect: Rect): void {
    if (!this.terrainBuilt) this.buildTerrain(world);

    // Background.
    ctx.fillStyle = "#000";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, rect.x, rect.y, rect.w, rect.h);

    // Fog overlay via ImageData at map resolution.
    const fctx = this.fog.getContext("2d");
    if (fctx) {
      const img = fctx.createImageData(this.mapW, this.mapH);
      const data = img.data;
      for (let i = 0; i < this.mapW * this.mapH; i++) {
        const f = world.fog.state[i] as FogState;
        const o = i * 4;
        if (f === FogState.Visible) {
          data[o + 3] = 0;
        } else if (f === FogState.Explored) {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 120;
        } else {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);
      ctx.drawImage(this.fog, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.imageSmoothingEnabled = prevSmoothing;

    const sx = rect.w / this.mapW;
    const sy = rect.h / this.mapH;

    // Entity dots.
    for (const b of world.buildings.values()) {
      const c = buildingCenter(b);
      if (b.faction !== world.playerFaction && world.fog.at(Math.floor(c.x), Math.floor(c.y)) === FogState.Unexplored) {
        continue;
      }
      ctx.fillStyle = THEMES[b.faction].light;
      ctx.fillRect(rect.x + (b.origin.tx) * sx - 1, rect.y + (b.origin.ty) * sy - 1, Math.max(2, b.footprint.w * sx), Math.max(2, b.footprint.h * sy));
    }
    for (const u of world.units.values()) {
      if (u.faction !== world.playerFaction && world.fog.at(Math.floor(u.pos.x), Math.floor(u.pos.y)) !== FogState.Visible) {
        continue;
      }
      ctx.fillStyle = THEMES[u.faction].primary;
      ctx.fillRect(rect.x + u.pos.x * sx - 1, rect.y + u.pos.y * sy - 1, 2, 2);
    }

    // Viewport rectangle.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      rect.x + cam.x * sx,
      rect.y + cam.y * sy,
      cam.tilesWide * sx,
      cam.tilesHigh * sy,
    );

    // Frame.
    ctx.strokeStyle = "#222";
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }

  /** Convert a point inside the minimap rect to a world coordinate. */
  toWorld(rect: Rect, px: number, py: number): Vec2 {
    const fx = (px - rect.x) / rect.w;
    const fy = (py - rect.y) / rect.h;
    return {
      x: Math.max(0, Math.min(this.mapW, fx * this.mapW)),
      y: Math.max(0, Math.min(this.mapH, fy * this.mapH)),
    };
  }
}
