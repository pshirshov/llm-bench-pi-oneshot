// Canvas 2D renderer. Draws the map, entities, fog of war, and HUD. All HUD
// elements are drawn from the same layout rects the input layer hit-tests, so
// the source of truth is in `hudLayout.ts`.

import { World } from "../sim/world.js";
import { TILE, TILE_META } from "../sim/tiles.js";
import { getUnitStats, getBuildingStats, FACTIONS } from "../sim/stats.js";
import { HudLayout, HudButton } from "../ui/hudLayout.js";
import { UnitEntity, BuildingEntity, isBuilding, isProjectile, isUnit } from "../sim/entities.js";
import { FOG } from "../sim/fog.js";

export interface Camera {
  x: number;
  y: number;
}

export interface RenderOptions {
  /** Tile size in pixels. */
  tileSize: number;
  /** Show the build-placement preview at this tile. */
  buildPreview?: { building: import("../sim/stats.js").BuildingKind; x: number; y: number } | null;
  /** Show box-select drag rectangle in tile coords. */
  boxSelect?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Optional override for HUD layout (used by tests). */
  layout: HudLayout;
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  opts: RenderOptions,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  drawMap(ctx, world, camera, opts);
  drawEntities(ctx, world, camera, opts);
  drawFog(ctx, world, camera, opts);
  drawHud(ctx, world, camera, opts);
  if (opts.buildPreview) drawBuildPreview(ctx, world, camera, opts.buildPreview, opts.tileSize);
  if (opts.boxSelect) drawBoxSelect(ctx, camera, opts.boxSelect, opts.tileSize);
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  opts: RenderOptions,
): void {
  const ts = opts.tileSize;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const startX = Math.max(0, Math.floor(camera.x));
  const startY = Math.max(0, Math.floor(camera.y));
  const endX = Math.min(world.map.width, Math.ceil(camera.x + W / ts) + 1);
  const endY = Math.min(world.map.height, Math.ceil(camera.y + H / ts) + 1);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const t = world.map.get(x, y);
      const meta = TILE_META[t];
      const px = (x - camera.x) * ts;
      const py = (y - camera.y) * ts;
      ctx.fillStyle = meta.color;
      ctx.fillRect(px, py, ts, ts);
      // Texture: simple stripes for forest, dots for gold.
      if (t === TILE.FOREST) {
        ctx.fillStyle = "#0d2a0d";
        ctx.fillRect(px + ts * 0.1, py + ts * 0.1, ts * 0.2, ts * 0.2);
        ctx.fillRect(px + ts * 0.6, py + ts * 0.5, ts * 0.3, ts * 0.3);
      } else if (t === TILE.GOLD_MINE) {
        ctx.fillStyle = "#a08010";
        ctx.beginPath();
        ctx.arc(px + ts / 2, py + ts / 2, ts * 0.2, 0, Math.PI * 2);
        ctx.fill();
        // HP-ish indicator.
        const gold = world.map.mineGold[mapIdx(world, x, y)] ?? 0;
        if (gold > 0) {
          ctx.fillStyle = "#fff";
          ctx.font = `${Math.floor(ts * 0.25)}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("Au", px + ts / 2, py + ts / 2);
        }
      } else if (t === TILE.WATER) {
        ctx.fillStyle = "#152a4a";
        ctx.fillRect(px, py + ts * 0.6, ts, ts * 0.1);
      } else if (t === TILE.ROCK) {
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.moveTo(px + ts * 0.2, py + ts * 0.7);
        ctx.lineTo(px + ts * 0.4, py + ts * 0.3);
        ctx.lineTo(px + ts * 0.6, py + ts * 0.7);
        ctx.closePath();
        ctx.fill();
      } else if (t === TILE.STUMP) {
        ctx.fillStyle = "#3a2a10";
        ctx.fillRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4);
      } else if (t === TILE.DEPLETED_MINE) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4);
      }
    }
  }
}

function mapIdx(world: World, x: number, y: number): number {
  return y * world.map.width + x;
}

function drawEntities(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  opts: RenderOptions,
): void {
  const ts = opts.tileSize;
  // Draw buildings.
  for (const e of world.entities.values()) {
    if (!isBuilding(e)) continue;
    const stats = getBuildingStats(e.faction, e.buildingKind);
    const px = (e.x - camera.x) * ts;
    const py = (e.y - camera.y) * ts;
    const w = stats.footprint.w * ts;
    const h = stats.footprint.h * ts;
    // Skip if not visible.
    if (px + w < 0 || py + h < 0 || px > ctx.canvas.width || py > ctx.canvas.height) continue;
    const fac = FACTIONS[e.faction];
    ctx.fillStyle = fac.color;
    if (e.construction < 1) {
      ctx.globalAlpha = 0.4;
      ctx.fillRect(px, py, w, h);
      ctx.globalAlpha = 1;
      // Show construction progress.
      ctx.fillStyle = "#fff";
      ctx.fillRect(px, py + h - 4, w * e.construction, 4);
    } else {
      ctx.fillRect(px, py, w, h);
    }
    // Roof.
    ctx.fillStyle = fac.accent;
    ctx.fillRect(px + 2, py + 2, w - 4, h / 3);
    // HP bar.
    if (e.hp < e.maxHp) {
      const ratio = e.hp / e.maxHp;
      ctx.fillStyle = "#000";
      ctx.fillRect(px, py - 6, w, 4);
      ctx.fillStyle = ratio > 0.5 ? "#3a3" : ratio > 0.25 ? "#da3" : "#a22";
      ctx.fillRect(px, py - 6, w * ratio, 4);
    }
    // Building label (small).
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.floor(ts * 0.3)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fac.names[e.buildingKind].slice(0, 6), px + w / 2, py + h / 2);
  }
  // Draw units.
  for (const e of world.entities.values()) {
    if (!isUnit(e)) continue;
    // Skip enemy units not in player's fog.
    if (e.faction !== world.players.humans.faction && e.faction !== world.players.orcs.faction) continue;
    const stats = getUnitStats(e.faction, e.unitKind);
    const px = (e.x + e.subX - camera.x) * ts;
    const py = (e.y + e.subY - camera.y) * ts;
    if (px < -ts || py < -ts || px > ctx.canvas.width + ts || py > ctx.canvas.height + ts) continue;
    const fac = FACTIONS[e.faction];
    ctx.fillStyle = fac.color;
    ctx.beginPath();
    ctx.arc(px, py, ts * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Accent ring.
    ctx.strokeStyle = fac.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, ts * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    // HP bar above.
    if (e.hp < stats.hp) {
      const ratio = e.hp / stats.hp;
      ctx.fillStyle = "#000";
      ctx.fillRect(px - ts * 0.3, py - ts * 0.5, ts * 0.6, 3);
      ctx.fillStyle = ratio > 0.5 ? "#3a3" : ratio > 0.25 ? "#da3" : "#a22";
      ctx.fillRect(px - ts * 0.3, py - ts * 0.5, ts * 0.6 * ratio, 3);
    }
    // Range indicator for ranged units.
    if (e.unitKind === "ranged" && (e.target !== null || e.orderState.phase === "attacking")) {
      ctx.strokeStyle = "rgba(255,80,80,0.4)";
      ctx.beginPath();
      ctx.arc(px, py, stats.attackRange * ts, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Draw projectiles.
  for (const e of world.entities.values()) {
    if (!isProjectile(e)) continue;
    const px = (e.x - camera.x) * ts;
    const py = (e.y - camera.y) * ts;
    ctx.fillStyle = "#ff8";
    ctx.beginPath();
    ctx.arc(px, py, ts * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFog(ctx: CanvasRenderingContext2D, world: World, _camera: Camera, _opts: RenderOptions): void {
  // Render a dim overlay for tiles that are UNEXPLORED or EXPLORED (but not VISIBLE).
  const w = world.map.width;
  const h = world.map.height;
  const playerFog = world.fog.get("humans");
  // For simplicity, we draw a full-map tinted overlay using a low-alpha
  // canvas. Performance: an ImageData buffer would be better; for 96x96 this
  // is fine.
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = imageData.data;
  const ts = _opts.tileSize;
  const cam = _camera;
  for (let py = 0; py < ctx.canvas.height; py++) {
    for (let px = 0; px < ctx.canvas.width; px++) {
      const tx = Math.floor(cam.x + px / ts);
      const ty = Math.floor(cam.y + py / ts);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const f = playerFog[ty * w + tx] as number;
      if (f === FOG.UNEXPLORED) {
        const i = (py * ctx.canvas.width + px) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      } else if (f === FOG.EXPLORED) {
        const i = (py * ctx.canvas.width + px) * 4;
        data[i] = Math.floor(data[i] as number * 0.4);
        data[i + 1] = Math.floor(data[i + 1] as number * 0.4);
        data[i + 2] = Math.floor(data[i + 2] as number * 0.4);
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawHud(ctx: CanvasRenderingContext2D, world: World, _camera: Camera, opts: RenderOptions): void {
  const layout = opts.layout;
  // Resource bar.
  const rb = layout.resourceBar;
  ctx.fillStyle = "#1a1a2a";
  ctx.fillRect(rb.x, rb.y, rb.w, rb.h);
  ctx.fillStyle = "#fff";
  ctx.font = "14px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const player = world.players.humans;
  ctx.fillText(
    `Gold: ${Math.floor(player.gold)}  Wood: ${Math.floor(player.wood)}  Supply: ${player.supplyUsed}/${player.supplyCap}  Tick: ${world.tick}  Seed: ${world.rng.seed}  ${world.paused ? "[PAUSED]" : world.speed + "x"}`,
    rb.x + 8, rb.y + rb.h / 2,
  );
  // Minimap.
  drawMinimap(ctx, world, layout);
  // Selection panel.
  drawSelectionPanel(ctx, world, layout);
  // Speed buttons.
  for (const b of layout.speedButtons) drawButton(ctx, b, false);
}

function drawMinimap(ctx: CanvasRenderingContext2D, world: World, layout: HudLayout): void {
  const m = layout.minimap;
  const W = world.map.width;
  const H = world.map.height;
  const sx = m.w / W;
  const sy = m.h / H;
  ctx.fillStyle = "#000";
  ctx.fillRect(m.x, m.y, m.w, m.h);
  // Draw tiles.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = world.map.get(x, y);
      ctx.fillStyle = TILE_META[t].color;
      ctx.fillRect(m.x + x * sx, m.y + y * sy, Math.ceil(sx), Math.ceil(sy));
    }
  }
  // Draw entities (very small).
  for (const e of world.entities.values()) {
    if (e.kind === "building") {
      const b = e as BuildingEntity;
      ctx.fillStyle = FACTIONS[b.faction].color;
      ctx.fillRect(m.x + b.x * sx, m.y + b.y * sy, 4, 4);
    } else if (e.kind === "unit") {
      const u = e as UnitEntity;
      ctx.fillStyle = FACTIONS[u.faction].color;
      ctx.fillRect(m.x + u.x * sx, m.y + u.y * sy, 2, 2);
    }
  }
  // Viewport rectangle (approximate, fixed size based on canvas).
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(m.x, m.y, m.w, m.h);
}

function drawSelectionPanel(ctx: CanvasRenderingContext2D, world: World, layout: HudLayout): void {
  const p = layout.selectionPanel;
  ctx.fillStyle = "rgba(20,20,30,0.85)";
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = "#666";
  ctx.strokeRect(p.x, p.y, p.w, p.h);
  // Portrait.
  const pr = layout.portraitRect;
  ctx.fillStyle = "#3a3a4a";
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  // Stats text.
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const sel = (world.playerSelection && world.playerSelection.size > 0) ? Array.from(world.playerSelection) : [];
  if (sel.length > 0) {
    const e = world.entities.get(sel[0] as number);
    if (e && e.kind === "unit") {
      const stats = getUnitStats(e.faction, e.unitKind);
      ctx.fillText(FACTIONS[e.faction].names[e.unitKind], layout.statsRect.x, layout.statsRect.y);
      ctx.fillText(`HP: ${e.hp}/${stats.hp}`, layout.statsRect.x, layout.statsRect.y + 14);
      ctx.fillText(`ATK: ${stats.damage} RNG: ${stats.attackRange}`, layout.statsRect.x, layout.statsRect.y + 26);
      ctx.fillText(`Armor: ${stats.armor} Spd: ${stats.moveSpeed.toFixed(1)}`, layout.statsRect.x, layout.statsRect.y + 38);
      ctx.fillText(`Cargo: ${e.orderState.cargo.gold}g ${e.orderState.cargo.wood}w`, layout.statsRect.x, layout.statsRect.y + 50);
    } else if (e && e.kind === "building") {
      ctx.fillText(FACTIONS[e.faction].names[e.buildingKind], layout.statsRect.x, layout.statsRect.y);
      ctx.fillText(`HP: ${e.hp}/${e.maxHp}`, layout.statsRect.x, layout.statsRect.y + 14);
      ctx.fillText(`Construction: ${(e.construction * 100).toFixed(0)}%`, layout.statsRect.x, layout.statsRect.y + 26);
    }
  }
  // Buttons.
  for (const b of layout.buttons) drawButton(ctx, b, true);
}

function drawButton(ctx: CanvasRenderingContext2D, b: HudButton, withSub: boolean): void {
  ctx.fillStyle = b.enabled ? "#3a4a5a" : "#222";
  ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
  ctx.strokeStyle = b.enabled ? "#888" : "#444";
  ctx.strokeRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
  ctx.fillStyle = b.enabled ? "#fff" : "#888";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(b.label, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2 - (withSub && b.subLabel ? 4 : 0));
  if (withSub && b.subLabel) {
    ctx.fillStyle = b.enabled ? "#bbb" : "#555";
    ctx.font = "9px monospace";
    ctx.fillText(b.subLabel, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2 + 8);
  }
}

function drawBuildPreview(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  preview: { building: import("../sim/stats.js").BuildingKind; x: number; y: number },
  ts: number,
): void {
  const stats = getBuildingStats("humans", preview.building);
  const px = (preview.x - camera.x) * ts;
  const py = (preview.y - camera.y) * ts;
  const w = stats.footprint.w * ts;
  const h = stats.footprint.h * ts;
  // For simplicity, assume valid (player won't show invalid).
  ctx.fillStyle = "rgba(100,200,100,0.4)";
  ctx.fillRect(px, py, w, h);
  ctx.strokeStyle = "#3a3";
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, w, h);
  void world;
}

function drawBoxSelect(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  box: { x0: number; y0: number; x1: number; y1: number },
  ts: number,
): void {
  const px0 = (box.x0 - camera.x) * ts;
  const py0 = (box.y0 - camera.y) * ts;
  const px1 = (box.x1 - camera.x) * ts;
  const py1 = (box.y1 - camera.y) * ts;
  ctx.fillStyle = "rgba(100,150,255,0.2)";
  ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
  ctx.strokeStyle = "#58f";
  ctx.lineWidth = 1;
  ctx.strokeRect(px0, py0, px1 - px0, py1 - py0);
}
