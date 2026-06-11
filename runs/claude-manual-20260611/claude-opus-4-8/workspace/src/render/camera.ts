/**
 * Camera: pixel offset + viewport size + tile size, with world↔screen
 * coordinate transforms, map-clamped scrolling, and helpers to centre on a
 * tile or a minimap point.
 *
 * Pure data + math — no DOM interaction, no mutation of World state.
 */

// ---------------------------------------------------------------------------
// Camera type
// ---------------------------------------------------------------------------

/**
 * Describes what region of the world is visible in the canvas viewport.
 *
 * - `offsetX` / `offsetY`: world position (in PIXELS) of the viewport's
 *   top-left corner.  Equivalently, the tile at screen position (0, 0) is at
 *   world tile (offsetX / tileSize, offsetY / tileSize).
 * - `viewportW` / `viewportH`: canvas size in pixels.
 * - `tileSize`: side length of one tile in pixels (square tiles).
 */
export interface Camera {
  offsetX: number;
  offsetY: number;
  viewportW: number;
  viewportH: number;
  tileSize: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Constructs a camera centred on tile (cx, cy) within a map of given size. */
export function createCamera(
  tileSize: number,
  viewportW: number,
  viewportH: number,
  cx: number,
  cy: number,
  mapWidth: number,
  mapHeight: number,
): Camera {
  const cam: Camera = {
    offsetX: 0,
    offsetY: 0,
    viewportW,
    viewportH,
    tileSize,
  };
  return centerOnTile(cam, cx, cy, mapWidth, mapHeight);
}

// ---------------------------------------------------------------------------
// World ↔ screen transforms
// ---------------------------------------------------------------------------

/** Converts a world tile coordinate (integer or fractional) to a screen pixel x. */
export function worldToScreenX(cam: Camera, tileX: number): number {
  return tileX * cam.tileSize - cam.offsetX;
}

/** Converts a world tile coordinate (integer or fractional) to a screen pixel y. */
export function worldToScreenY(cam: Camera, tileY: number): number {
  return tileY * cam.tileSize - cam.offsetY;
}

/** Converts a screen pixel x back to a fractional world tile x. */
export function screenToWorldX(cam: Camera, screenX: number): number {
  return (screenX + cam.offsetX) / cam.tileSize;
}

/** Converts a screen pixel y back to a fractional world tile y. */
export function screenToWorldY(cam: Camera, screenY: number): number {
  return (screenY + cam.offsetY) / cam.tileSize;
}

// ---------------------------------------------------------------------------
// Viewport tile range
// ---------------------------------------------------------------------------

/**
 * Returns the range of tile indices visible in the viewport, clamped to the
 * map bounds.  Useful for culling: only iterate tiles in this range.
 */
export function visibleTileRange(
  cam: Camera,
  mapWidth: number,
  mapHeight: number,
): { minTX: number; maxTX: number; minTY: number; maxTY: number } {
  const minTX = Math.max(0, Math.floor(cam.offsetX / cam.tileSize));
  const minTY = Math.max(0, Math.floor(cam.offsetY / cam.tileSize));
  const maxTX = Math.min(
    mapWidth - 1,
    Math.floor((cam.offsetX + cam.viewportW) / cam.tileSize),
  );
  const maxTY = Math.min(
    mapHeight - 1,
    Math.floor((cam.offsetY + cam.viewportH) / cam.tileSize),
  );
  return { minTX, maxTX, minTY, maxTY };
}

// ---------------------------------------------------------------------------
// Camera mutation helpers
// ---------------------------------------------------------------------------

/**
 * Returns a new camera scrolled by (dx, dy) pixels, clamped so the viewport
 * never shows tiles outside the map.
 */
export function scrollCamera(
  cam: Camera,
  dx: number,
  dy: number,
  mapWidth: number,
  mapHeight: number,
): Camera {
  const maxOffsetX = mapWidth * cam.tileSize - cam.viewportW;
  const maxOffsetY = mapHeight * cam.tileSize - cam.viewportH;
  return {
    ...cam,
    offsetX: Math.max(0, Math.min(maxOffsetX, cam.offsetX + dx)),
    offsetY: Math.max(0, Math.min(maxOffsetY, cam.offsetY + dy)),
  };
}

/**
 * Returns a new camera centred on tile (tx, ty), clamped to map bounds.
 */
export function centerOnTile(
  cam: Camera,
  tx: number,
  ty: number,
  mapWidth: number,
  mapHeight: number,
): Camera {
  const centrePixelX = tx * cam.tileSize + cam.tileSize / 2;
  const centrePixelY = ty * cam.tileSize + cam.tileSize / 2;
  return scrollCamera(
    { ...cam, offsetX: 0, offsetY: 0 },
    centrePixelX - cam.viewportW / 2,
    centrePixelY - cam.viewportH / 2,
    mapWidth,
    mapHeight,
  );
}

/**
 * Returns a new camera centred on a minimap point (mx, my) expressed in
 * fractions [0, 1] of the map dimensions (as produced by a click on the
 * minimap).
 */
export function centerOnMinimapPoint(
  cam: Camera,
  mx: number,
  my: number,
  mapWidth: number,
  mapHeight: number,
): Camera {
  const tx = mx * mapWidth;
  const ty = my * mapHeight;
  return centerOnTile(cam, tx, ty, mapWidth, mapHeight);
}
