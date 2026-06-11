/**
 * Minimap renderer.
 *
 * `renderMinimap(ctx, world, camera, faction, rect)` draws a fog-aware
 * minimap into `rect` (pixel rectangle in the canvas) plus a viewport
 * outline showing the current camera position.
 *
 * Fog rules match the main renderer:
 *   Unexplored  → black pixel.
 *   Explored    → dimmed terrain colour.
 *   Visible     → full terrain colour; own + visible enemy units shown.
 *
 * PURE READ of World + fog — no mutation, no Math.random.
 */

import type { CanvasCtx } from "./canvas-types.js";

import type { World } from "../sim/world.js";
import type { Camera } from "./camera.js";
import type { FogMap, FogState } from "../sim/fog.js";
import { isEntityVisibleTo } from "../sim/fog.js";
import type { Faction } from "../game/types.js";
import { TILE_COLORS } from "../wfc/tiles.js";

// ---------------------------------------------------------------------------
// Pixel rect helper
// ---------------------------------------------------------------------------

/** A pixel-space rectangle within the canvas. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Faction colours (same palette as renderer)
// ---------------------------------------------------------------------------

const FACTION_COLOR: Record<Faction, string> = {
  human: "#4169e1",
  orc: "#8b0000",
};

/** Dimming factor for explored tiles on the minimap. */
const EXPLORED_ALPHA = 0.4;

// ---------------------------------------------------------------------------
// renderMinimap
// ---------------------------------------------------------------------------

/**
 * Draws a fog-aware minimap into `rect` and overlays the camera viewport as
 * a white/semi-transparent rectangle outline.
 *
 * Each world tile maps to a sub-rectangle of `rect` sized
 *   (rect.w / mapWidth)  ×  (rect.h / mapHeight).
 * For large maps this may be sub-pixel; fillRect still produces correct
 * output because the canvas composites fractional-pixel fills.
 */
export function renderMinimap(
  ctx: CanvasCtx,
  world: World,
  camera: Camera,
  faction: Faction,
  rect: PixelRect,
): void {
  const { map } = world;
  const mapW = map.width;
  const mapH = map.height;
  const fog = world.fog as FogMap | undefined;
  const fogGrid = fog?.[faction];

  const scaleX = rect.w / mapW;
  const scaleY = rect.h / mapH;

  // ── 1. Background (ensures border for tiny maps) ──────────────────────────
  ctx.fillStyle = "#000000";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // ── 2. Terrain tiles ──────────────────────────────────────────────────────
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const fogState: FogState = fogGrid ? fogGrid.get(tx, ty) : "visible";
      if (fogState === "unexplored") continue; // already black from background

      const tileKind = map.tileAt(tx, ty);
      const color = TILE_COLORS[tileKind];

      const px = rect.x + tx * scaleX;
      const py = rect.y + ty * scaleY;

      if (fogState === "explored") {
        ctx.globalAlpha = EXPLORED_ALPHA;
        ctx.fillStyle = color;
        ctx.fillRect(px, py, scaleX, scaleY);
        ctx.globalAlpha = 1;
      } else {
        // visible
        ctx.fillStyle = color;
        ctx.fillRect(px, py, scaleX, scaleY);
      }
    }
  }

  // ── 3. Buildings ──────────────────────────────────────────────────────────
  for (const building of world.buildings.values()) {
    // Enemy buildings: only show when currently visible
    if (building.owner !== faction) {
      if (!isEntityVisibleTo(world, faction, building)) continue;
    }

    const tileX = building.tile.x;
    const tileY = building.tile.y;

    const fogState: FogState = fogGrid
      ? fogGrid.get(
          Math.max(0, Math.min(mapW - 1, tileX)),
          Math.max(0, Math.min(mapH - 1, tileY)),
        )
      : "visible";

    if (fogState === "unexplored") continue;

    const px = rect.x + tileX * scaleX;
    const py = rect.y + tileY * scaleY;
    const pw = building.footprint.w * scaleX;
    const ph = building.footprint.h * scaleY;

    const alpha = fogState === "explored" ? EXPLORED_ALPHA : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = FACTION_COLOR[building.owner];
    ctx.fillRect(px, py, pw, ph);
    ctx.globalAlpha = 1;
  }

  // ── 4. Units (dots) ───────────────────────────────────────────────────────
  for (const unit of world.units.values()) {
    // Enemy units: only show on visible tiles
    if (unit.owner !== faction) {
      if (!isEntityVisibleTo(world, faction, unit)) continue;
    }

    const tx = Math.floor(unit.pos.x);
    const ty = Math.floor(unit.pos.y);

    if (!map.inBounds(tx, ty)) continue;

    const fogState: FogState = fogGrid ? fogGrid.get(tx, ty) : "visible";
    if (fogState === "unexplored") continue;

    const px = rect.x + unit.pos.x * scaleX;
    const py = rect.y + unit.pos.y * scaleY;
    const dotR = Math.max(1.5, Math.min(scaleX, scaleY) * 0.6);

    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fillStyle = FACTION_COLOR[unit.owner];
    ctx.fill();
  }

  // ── 5. Viewport outline ───────────────────────────────────────────────────
  const vpX = rect.x + (camera.offsetX / camera.tileSize) * scaleX;
  const vpY = rect.y + (camera.offsetY / camera.tileSize) * scaleY;
  const vpW = (camera.viewportW / camera.tileSize) * scaleX;
  const vpH = (camera.viewportH / camera.tileSize) * scaleY;

  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
}
