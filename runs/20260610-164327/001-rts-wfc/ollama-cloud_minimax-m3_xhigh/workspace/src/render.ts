// Canvas 2D rendering. Programmatic placeholder art only.

import { type World, type UnitEntity, type BuildingEntity } from './state.js';
import { FACTIONS, TILES, type TileId, type UnitStats, type BuildingStats, type FactionId } from './data.js';
import { type Camera } from './camera.js';

const TILE_PALETTE: Record<TileId, { base: string; detail: string; accent: string }> = {
  grass:     { base: '#3aa15a', detail: '#2a7a40', accent: '#4ab06a' },
  dirt:      { base: '#9b7a3a', detail: '#6b4a1c', accent: '#b0894a' },
  forest:    { base: '#1f4a23', detail: '#0a1a08', accent: '#2a5a30' },
  water:     { base: '#2c5a9b', detail: '#1a3a6b', accent: '#3a6aab' },
  rock:      { base: '#666',    detail: '#333',    accent: '#888' },
  gold_mine: { base: '#c79c2e', detail: '#7a5a00', accent: '#e0b040' },
};

const BUILDING_SIZE_FOR_PREVIEW: Record<BuildingStats['kind'], { w: number; h: number }> = {
  townhall: { w: 3, h: 3 },
  farm: { w: 2, h: 2 },
  barracks: { w: 3, h: 2 },
  mill: { w: 2, h: 2 },
  tower: { w: 1, h: 1 },
};

const UNIT_MAX_HP: Record<UnitStats['kind'], number> = { worker: 30, melee: 60, ranged: 50, heavy: 140 };

function drawTile(ctx: CanvasRenderingContext2D, t: TileId, px: number, py: number, size: number): void {
  const pal = TILE_PALETTE[t];
  ctx.fillStyle = pal.base;
  ctx.fillRect(px, py, size, size);
  ctx.strokeStyle = pal.detail;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
  if (t === 'forest') {
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < 3; i++) {
      const cx = px + ((i * 11 + 7) % size);
      const cy = py + ((i * 13 + 5) % size);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (t === 'rock') {
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < 2; i++) {
      const cx = px + ((i * 17 + 5) % size);
      const cy = py + ((i * 19 + 9) % size);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (t === 'water') {
    ctx.fillStyle = pal.accent;
    ctx.fillRect(px + 2, py + size * 0.55, size - 4, 1);
  } else if (t === 'gold_mine') {
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < 4; i++) {
      const cx = px + ((i * 7 + 3) % (size - 4)) + 2;
      const cy = py + ((i * 9 + 5) % (size - 4)) + 2;
      ctx.fillRect(cx, cy, 3, 3);
    }
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: BuildingEntity, sx: number, sy: number, size: number): void {
  const fac = FACTIONS[b.faction];
  const w = b.size.w * size;
  const h = b.size.h * size;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(sx + 2, sy + h - 4, w - 2, 4);
  ctx.fillStyle = fac.buildingWall;
  ctx.fillRect(sx, sy, w, h);
  ctx.fillStyle = fac.buildingRoof;
  if (b.buildingKind === 'tower') {
    ctx.fillRect(sx + 1, sy + 1, w - 2, h - 2);
  } else {
    ctx.beginPath();
    ctx.moveTo(sx, sy + h * 0.5);
    ctx.lineTo(sx + w / 2, sy);
    ctx.lineTo(sx + w, sy + h * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = fac.dark;
  const dw = Math.max(2, w * 0.18);
  const dh = Math.max(2, h * 0.3);
  ctx.fillRect(sx + w / 2 - dw / 2, sy + h - dh - 1, dw, dh);
  if (b.underConstruction) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(sx, sy, w, h);
    const prog = b.buildProgress / b.buildTime;
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx + 1, sy + h - 3, (w - 2) * prog, 2);
  }
  if (b.flashTimer && b.flashTimer > 0) {
    ctx.fillStyle = `rgba(255,255,255,${b.flashTimer * 3})`;
    ctx.fillRect(sx, sy, w, h);
    b.flashTimer -= 0.016;
  }
  if (b.hp < b.maxHp) {
    const ratio = b.hp / b.maxHp;
    ctx.fillStyle = '#400';
    ctx.fillRect(sx, sy - 4, w, 3);
    ctx.fillStyle = ratio > 0.5 ? '#0a0' : ratio > 0.25 ? '#aa0' : '#a00';
    ctx.fillRect(sx, sy - 4, w * ratio, 3);
  }
}

function drawUnit(ctx: CanvasRenderingContext2D, u: UnitEntity, sx: number, sy: number, size: number): void {
  const fac = FACTIONS[u.faction];
  ctx.fillStyle = fac.primary;
  ctx.beginPath();
  ctx.arc(sx + size / 2, sy + size / 2, size * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = fac.dark;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (u.unitKind !== 'worker') {
    ctx.fillStyle = fac.unitAccent;
    ctx.beginPath();
    ctx.arc(sx + size / 2, sy + size / 2, size * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = fac.unitAccent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx + size / 2, sy + size / 2);
  ctx.lineTo(sx + size / 2 + Math.cos(u.facing) * size * 0.4, sy + size / 2 + Math.sin(u.facing) * size * 0.4);
  ctx.stroke();
  if (u.hp <= 0 && u.corpseT !== undefined) {
    ctx.fillStyle = `rgba(0,0,0,${u.corpseT * 0.5})`;
    ctx.fillRect(sx, sy, size, size);
  }
  if (u.hp < UNIT_MAX_HP[u.unitKind]) {
    const ratio = u.hp / UNIT_MAX_HP[u.unitKind];
    ctx.fillStyle = '#400';
    ctx.fillRect(sx, sy - 3, size, 2);
    ctx.fillStyle = ratio > 0.5 ? '#0a0' : ratio > 0.25 ? '#aa0' : '#a00';
    ctx.fillRect(sx, sy - 3, size * ratio, 2);
  }
}

function drawProjectile(ctx: CanvasRenderingContext2D, p: { pos: { x: number; y: number }; faction: FactionId }, sx: number, sy: number, size: number): void {
  const fac = FACTIONS[p.faction];
  ctx.fillStyle = fac.unitAccent;
  ctx.beginPath();
  ctx.arc(sx + size / 2, sy + size / 2, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = fac.unitAccent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx + size / 2, sy + size / 2);
  ctx.lineTo(sx + size / 2 - 3, sy + size / 2 - 3);
  ctx.stroke();
}

export interface RenderState {
  selected: Set<number>;
  buildPreview: { faction: FactionId; bk: BuildingStats['kind']; x: number; y: number; valid: boolean } | null;
  marker: { x: number; y: number; t: number } | null;
}

function isPlayerVisible(w: World, x: number, y: number): boolean {
  const v = w.factions.human.fog[y * w.map.width + x] as number;
  if (v === 2) return true;
  if (v === 1) {
    for (const u of w.units.values()) {
      if (u.occ.x === x && u.occ.y === y && u.faction === 'human') return true;
    }
    for (const b of w.buildings.values()) {
      if (Math.floor(b.pos.x) <= x && x < Math.floor(b.pos.x) + b.size.w
        && Math.floor(b.pos.y) <= y && y < Math.floor(b.pos.y) + b.size.h
        && b.faction === 'human') return true;
    }
    return false;
  }
  return false;
}

export function render(ctx: CanvasRenderingContext2D, w: World, cam: Camera, rs: RenderState): void {
  const size = cam.zoom;
  const w_px = cam.w * size;
  const h_px = cam.h * size;
  ctx.clearRect(0, 0, w_px, h_px);
  // 1. Tiles
  const startX = Math.max(0, Math.floor(cam.x));
  const startY = Math.max(0, Math.floor(cam.y));
  const endX = Math.min(w.map.width, Math.ceil(cam.x + cam.w) + 1);
  const endY = Math.min(w.map.height, Math.ceil(cam.y + cam.h) + 1);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const t = w.map.tiles[y * w.map.width + x] as TileId;
      const sx = (x - cam.x) * size;
      const sy = (y - cam.y) * size;
      drawTile(ctx, t, sx, sy, size);
    }
  }
  // 2. Fog (player's perspective)
  const playerFog = w.factions.human.fog;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const v = playerFog[y * w.map.width + x] as number;
      const sx = (x - cam.x) * size;
      const sy = (y - cam.y) * size;
      if (v === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(sx, sy, size, size);
      } else if (v === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(sx, sy, size, size);
      }
    }
  }
  // 3. Buildings
  for (const b of w.buildings.values()) {
    const bcx = Math.floor(b.pos.x + b.size.w / 2);
    const bcy = Math.floor(b.pos.y + b.size.h / 2);
    if (bcx < startX || bcy < startY || bcx >= endX || bcy >= endY) continue;
    if (!isPlayerVisible(w, bcx, bcy)) continue;
    const sx = (b.pos.x - cam.x) * size;
    const sy = (b.pos.y - cam.y) * size;
    drawBuilding(ctx, b, sx, sy, size);
  }
  // 4. Units
  for (const u of w.units.values()) {
    if (u.occ.x < startX || u.occ.y < startY || u.occ.x >= endX || u.occ.y >= endY) continue;
    if (!isPlayerVisible(w, u.occ.x, u.occ.y)) continue;
    const sx = (u.pos.x - cam.x) * size - size * 0.25;
    const sy = (u.pos.y - cam.y) * size - size * 0.25;
    drawUnit(ctx, u, sx, sy, size * 1.5);
  }
  // 5. Projectiles
  for (const p of w.projectiles.values()) {
    const px = Math.floor(p.pos.x);
    const py = Math.floor(p.pos.y);
    if (px < startX || py < startY || px >= endX || py >= endY) continue;
    const sx = (p.pos.x - cam.x) * size - size * 0.25;
    const sy = (p.pos.y - cam.y) * size - size * 0.25;
    drawProjectile(ctx, p, sx, sy, size * 1.5);
  }
  // 6. Selection circles
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  for (const id of rs.selected) {
    const u = w.units.get(id) || w.buildings.get(id);
    if (!u) continue;
    const sx = (u.pos.x - cam.x) * size;
    const sy = (u.pos.y - cam.y) * size;
    const radius = ('size' in u ? Math.max(u.size.w, u.size.h) : 0.5) * size * 0.6;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 7. Build preview
  if (rs.buildPreview) {
    const { bk, x, y, valid } = rs.buildPreview;
    const stats = BUILDING_SIZE_FOR_PREVIEW[bk];
    const sx = (x - cam.x) * size;
    const sy = (y - cam.y) * size;
    ctx.fillStyle = valid ? 'rgba(0,255,0,0.25)' : 'rgba(255,0,0,0.25)';
    ctx.fillRect(sx, sy, stats.w * size, stats.h * size);
    ctx.strokeStyle = valid ? '#0f0' : '#f00';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, stats.w * size - 1, stats.h * size - 1);
  }
  // 8. Move/attack marker
  if (rs.marker) {
    const m = rs.marker;
    const sx = (m.x - cam.x) * size;
    const sy = (m.y - cam.y) * size;
    const a = 1 - m.t;
    ctx.strokeStyle = `rgba(255,255,100,${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, size * 0.4 * (1 - m.t) + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  void TILES;
}

export function tickRenderState(rs: RenderState, dt: number): void {
  if (rs.marker) {
    rs.marker.t += dt;
    if (rs.marker.t >= 1) rs.marker = null;
  }
}
