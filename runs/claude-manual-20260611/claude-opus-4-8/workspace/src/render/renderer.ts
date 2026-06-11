/**
 * Main canvas 2D renderer.
 *
 * `render(ctx, world, camera, faction)` draws the current world state into
 * the provided canvas context — terrain tiles, buildings, units, projectiles,
 * and selection markers — all gated by fog-of-war rules.
 *
 * Fog rules:
 *   Unexplored  → tile drawn solid black; no entities shown.
 *   Explored    → terrain/buildings shown dimmed (last-seen snapshot);
 *                 enemy UNITS NOT shown; own units shown (always known).
 *   Visible     → everything shown at full brightness.
 *
 * PURE READ of World + fog — no mutation, no Math.random.
 */

import type { CanvasCtx } from "./canvas-types.js";
import type { World } from "../sim/world.js";
import type { Camera } from "./camera.js";
import { worldToScreenX, worldToScreenY, visibleTileRange } from "./camera.js";
import { isEntityVisibleTo } from "../sim/fog.js";
import type { FogMap, FogState } from "../sim/fog.js";
import type { Faction } from "../game/types.js";
import type { Building, Unit } from "../sim/entity.js";
import { TILE_COLORS } from "../wfc/tiles.js";

// ---------------------------------------------------------------------------
// Faction colours
// ---------------------------------------------------------------------------

/** Primary colour for each faction — used for unit/building tints. */
const FACTION_COLOR: Record<Faction, string> = {
  human: "#4169e1", // royal blue
  orc: "#8b0000",   // dark red
};

// ---------------------------------------------------------------------------
// Fog shading helpers
// ---------------------------------------------------------------------------

/** Alpha used when drawing explored-but-not-visible terrain/buildings. */
const EXPLORED_ALPHA = 0.45;

// ---------------------------------------------------------------------------
// Tile drawing
// ---------------------------------------------------------------------------

function drawTile(
  ctx: CanvasCtx,
  sx: number,
  sy: number,
  tileSize: number,
  color: string,
  fogState: FogState,
): void {
  if (fogState === "unexplored") {
    ctx.fillStyle = "#000000";
    ctx.fillRect(sx, sy, tileSize, tileSize);
    return;
  }
  if (fogState === "explored") {
    ctx.globalAlpha = EXPLORED_ALPHA;
    ctx.fillStyle = color;
    ctx.fillRect(sx, sy, tileSize, tileSize);
    ctx.globalAlpha = 1;
    return;
  }
  // visible
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, tileSize, tileSize);
}

// ---------------------------------------------------------------------------
// Building drawing
// ---------------------------------------------------------------------------

/**
 * Short label drawn inside buildings to indicate kind.
 * Keeping them to 1–2 characters ensures they fit in small tiles.
 */
const BUILDING_LABEL: Record<string, string> = {
  townHall: "TH",
  farm: "F",
  barracks: "B",
  lumberMill: "LM",
  guardTower: "GT",
};

function drawBuilding(
  ctx: CanvasCtx,
  building: Building,
  camera: Camera,
  fogState: FogState,
): void {
  if (fogState === "unexplored") return;

  const ts = camera.tileSize;
  const sx = worldToScreenX(camera, building.tile.x);
  const sy = worldToScreenY(camera, building.tile.y);
  const pw = building.footprint.w * ts;
  const ph = building.footprint.h * ts;

  const alpha = fogState === "explored" ? EXPLORED_ALPHA : 1;
  ctx.globalAlpha = alpha;

  // Faction-tinted rectangle
  ctx.fillStyle = FACTION_COLOR[building.owner];
  ctx.fillRect(sx + 2, sy + 2, pw - 4, ph - 4);

  // Construction progress: draw a darker overlay proportional to incompleteness
  if (building.buildProgress < 1) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    const progressH = (ph - 4) * (1 - building.buildProgress);
    const progressY = sy + 2 + (ph - 4) * building.buildProgress;
    ctx.fillRect(sx + 2, progressY, pw - 4, progressH);
  }

  // Kind label (only for fully visible tiles)
  if (fogState === "visible") {
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(8, ts / 4)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      BUILDING_LABEL[building.kind] ?? building.kind.slice(0, 2),
      sx + pw / 2,
      sy + ph / 2,
    );
  }

  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Unit drawing
// ---------------------------------------------------------------------------

/** Single-character glyph for unit kind. */
const UNIT_GLYPH: Record<string, string> = {
  worker: "W",
  infantry: "I",
  ranged: "R",
  heavy: "H",
};

function drawUnit(
  ctx: CanvasCtx,
  unit: Unit,
  camera: Camera,
  selected: boolean,
): void {
  const ts = camera.tileSize;
  const sx = worldToScreenX(camera, unit.pos.x);
  const sy = worldToScreenY(camera, unit.pos.y);
  const radius = ts * 0.38;

  // Selection ring drawn beneath the unit
  if (selected) {
    ctx.beginPath();
    ctx.arc(sx, sy, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Unit circle
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fillStyle = FACTION_COLOR[unit.owner];
  ctx.fill();

  // Glyph
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.max(7, ts / 5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(UNIT_GLYPH[unit.kind] ?? "?", sx, sy);

  // HP bar
  const hpFrac = unit.hp / unit.maxHp;
  const barW = ts * 0.7;
  const barH = 3;
  const barX = sx - barW / 2;
  const barY = sy - radius - 6;
  ctx.fillStyle = "#333333";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hpFrac > 0.5 ? "#00cc44" : hpFrac > 0.25 ? "#ffaa00" : "#cc2200";
  ctx.fillRect(barX, barY, barW * hpFrac, barH);
}

// ---------------------------------------------------------------------------
// Projectile drawing
// ---------------------------------------------------------------------------

function drawProjectile(
  ctx: CanvasCtx,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(2, tileSize * 0.1), 0, Math.PI * 2);
  ctx.fillStyle = "#ffa500";
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Main render entry point
// ---------------------------------------------------------------------------

/**
 * Renders the world onto `ctx`, from the perspective of `faction`.
 *
 * `selection` is an optional set of EntityIds currently selected by the
 * player; entities in this set receive a yellow selection ring.
 */
export function render(
  ctx: CanvasCtx,
  world: World,
  camera: Camera,
  faction: Faction,
  selection?: ReadonlySet<number>,
): void {
  const { map } = world;
  const ts = camera.tileSize;
  const fog = world.fog as FogMap | undefined;
  const fogGrid = fog?.[faction];

  const { minTX, maxTX, minTY, maxTY } = visibleTileRange(camera, map.width, map.height);

  // ── 1. Terrain tiles ──────────────────────────────────────────────────────
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      const sx = worldToScreenX(camera, tx);
      const sy = worldToScreenY(camera, ty);
      const tileKind = map.tileAt(tx, ty);
      const color = TILE_COLORS[tileKind];
      const fogState: FogState = fogGrid ? fogGrid.get(tx, ty) : "visible";
      drawTile(ctx, sx, sy, ts, color, fogState);
    }
  }

  // ── 2. Buildings ──────────────────────────────────────────────────────────
  for (const building of world.buildings.values()) {
    // Cull buildings wholly outside the viewport (coarse check on anchor tile)
    if (
      building.tile.x + building.footprint.w < minTX ||
      building.tile.x > maxTX ||
      building.tile.y + building.footprint.h < minTY ||
      building.tile.y > maxTY
    ) {
      continue;
    }

    const tileX = building.tile.x;
    const tileY = building.tile.y;
    const fogState: FogState = fogGrid
      ? fogGrid.get(
          Math.max(0, Math.min(map.width - 1, tileX)),
          Math.max(0, Math.min(map.height - 1, tileY)),
        )
      : "visible";

    // Enemy buildings: draw only when visible to the player faction
    if (building.owner !== faction) {
      if (!isEntityVisibleTo(world, faction, building)) continue;
    }

    drawBuilding(ctx, building, camera, fogState);
  }

  // ── 3. Units ──────────────────────────────────────────────────────────────
  for (const unit of world.units.values()) {
    const tx = Math.floor(unit.pos.x);
    const ty = Math.floor(unit.pos.y);

    // Cull units outside the viewport (with a 1-tile border for partial circles)
    if (tx < minTX - 1 || tx > maxTX + 1 || ty < minTY - 1 || ty > maxTY + 1) {
      continue;
    }

    // Enemy units: only draw when the player faction can see them
    if (unit.owner !== faction) {
      if (!isEntityVisibleTo(world, faction, unit)) continue;
    }

    const fogState: FogState = fogGrid
      ? fogGrid.get(
          Math.max(0, Math.min(map.width - 1, tx)),
          Math.max(0, Math.min(map.height - 1, ty)),
        )
      : "visible";

    // Own units on explored-but-not-visible tiles drawn dimmed
    if (unit.owner === faction && fogState === "explored") {
      ctx.globalAlpha = EXPLORED_ALPHA;
    }

    const isSelected = selection !== undefined && selection.has(unit.id);
    drawUnit(ctx, unit, camera, isSelected);

    ctx.globalAlpha = 1;
  }

  // ── 4. Projectiles ────────────────────────────────────────────────────────
  for (const proj of world.projectiles.values()) {
    const tx = Math.floor(proj.pos.x);
    const ty = Math.floor(proj.pos.y);

    if (tx < minTX - 1 || tx > maxTX + 1 || ty < minTY - 1 || ty > maxTY + 1) {
      continue;
    }

    // Enemy projectiles hidden on non-visible tiles
    if (proj.owner !== faction) {
      if (fogGrid && fogGrid.inBounds(tx, ty) && fogGrid.get(tx, ty) !== "visible") {
        continue;
      }
    }

    const sx = worldToScreenX(camera, proj.pos.x);
    const sy = worldToScreenY(camera, proj.pos.y);
    drawProjectile(ctx, sx, sy, ts);
  }
}
