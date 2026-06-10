import { idx } from '../map/gamemap';
import { Tile } from '../map/tiles';
import { BUILDING_STATS, BuildingType, FACTIONS, UNIT_RADIUS, UNIT_STATS, UnitType } from '../game/data';
import { Building, footprintOf, GameState, PlayerState, Unit } from '../game/state';

export const TILE = 28;

export interface Camera {
  x: number; // top-left corner, tile units
  y: number;
}

export interface WorldOverlay {
  selectedIds: ReadonlySet<number>;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
  placing: { type: BuildingType; tx: number; ty: number; valid: boolean } | null;
}

const TILE_COLORS: Record<Tile, [string, string]> = {
  [Tile.Grass]: ['#3e7a35', '#447f3a'],
  [Tile.Dirt]: ['#8a6f47', '#917750'],
  [Tile.Forest]: ['#1e4d20', '#234f24'],
  [Tile.Water]: ['#274f8f', '#2b5598'],
  [Tile.Rock]: ['#6b6b70', '#74747a'],
  [Tile.GoldMine]: ['#8a6f47', '#8a6f47'],
};

function tileShade(x: number, y: number): number {
  // Cheap deterministic checker-ish variation.
  return ((x * 7 + y * 13) ^ (x * 3)) & 1;
}

export function renderWorld(
  g: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  viewW: number,
  viewH: number,
  overlay: WorldOverlay,
  frameTime: number,
): void {
  const player = state.players[0];
  const { map } = state;
  const minX = Math.max(0, Math.floor(cam.x));
  const minY = Math.max(0, Math.floor(cam.y));
  const maxX = Math.min(map.width - 1, Math.ceil(cam.x + viewW / TILE));
  const maxY = Math.min(map.height - 1, Math.ceil(cam.y + viewH / TILE));

  g.fillStyle = '#000';
  g.fillRect(0, 0, viewW, viewH);

  // --- terrain (live or remembered) ---
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = idx(map, x, y);
      const fog = player.fog[i];
      if (fog === 0) continue; // unexplored: stays black
      const t = (fog === 2 ? map.tiles[i] : player.seenTiles[i]) as Tile;
      const px = Math.round((x - cam.x) * TILE);
      const py = Math.round((y - cam.y) * TILE);
      g.fillStyle = TILE_COLORS[t][tileShade(x, y)];
      g.fillRect(px, py, TILE, TILE);
      drawTileDetail(g, t, px, py, x, y, frameTime);
    }
  }

  // --- corpses ---
  for (const c of state.corpses) {
    if (!tileVisible(player, map.width, c.x, c.y)) continue;
    const alpha = Math.max(0, 1 - c.age / 6);
    const px = (c.x - cam.x) * TILE;
    const py = (c.y - cam.y) * TILE;
    g.save();
    g.globalAlpha = alpha * 0.7;
    g.fillStyle = '#3a2a20';
    g.beginPath();
    g.ellipse(px, py, TILE * 0.32, TILE * 0.18, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // --- buildings (live when visible, ghosts from memory when explored) ---
  for (const b of state.buildings) {
    if (b.faction === player.faction || buildingTouchesVisible(state, player, b)) {
      drawBuilding(g, cam, b.type, b.faction, b.tx, b.ty, b, overlay.selectedIds.has(b.id), 1);
    }
  }
  for (const [id, mem] of player.buildingMemory) {
    if (state.buildings.some((b) => b.id === id && buildingTouchesVisible(state, player, b))) continue;
    drawBuilding(g, cam, mem.type, mem.faction, mem.tx, mem.ty, null, false, 0.5);
  }

  // --- units ---
  for (const u of state.units) {
    if (u.faction !== player.faction && !tileVisible(player, map.width, u.x, u.y)) continue;
    drawUnit(g, cam, u, overlay.selectedIds.has(u.id));
  }

  // --- projectiles ---
  g.fillStyle = '#f5e9b0';
  for (const p of state.projectiles) {
    if (!tileVisible(player, map.width, p.x, p.y)) continue;
    const px = (p.x - cam.x) * TILE;
    const py = (p.y - cam.y) * TILE;
    g.beginPath();
    g.arc(px, py, 3, 0, Math.PI * 2);
    g.fill();
  }

  // --- fog dimming over explored ---
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (player.fog[idx(map, x, y)] !== 1) continue;
      g.fillRect(Math.round((x - cam.x) * TILE), Math.round((y - cam.y) * TILE), TILE, TILE);
    }
  }

  // --- placement ghost ---
  if (overlay.placing) {
    const { type, tx, ty, valid } = overlay.placing;
    const s = BUILDING_STATS[type];
    const px = (tx - cam.x) * TILE;
    const py = (ty - cam.y) * TILE;
    g.fillStyle = valid ? 'rgba(80,220,80,0.35)' : 'rgba(220,60,60,0.4)';
    g.fillRect(px, py, s.width * TILE, s.height * TILE);
    g.strokeStyle = valid ? '#6f6' : '#f66';
    g.lineWidth = 2;
    g.strokeRect(px + 1, py + 1, s.width * TILE - 2, s.height * TILE - 2);
  }

  // --- drag-select rectangle ---
  if (overlay.dragRect) {
    const r = overlay.dragRect;
    g.strokeStyle = '#9f9';
    g.lineWidth = 1;
    g.strokeRect(
      Math.min(r.x0, r.x1),
      Math.min(r.y0, r.y1),
      Math.abs(r.x1 - r.x0),
      Math.abs(r.y1 - r.y0),
    );
  }
}

function tileVisible(player: PlayerState, mapWidth: number, x: number, y: number): boolean {
  return player.fog[Math.floor(y) * mapWidth + Math.floor(x)] === 2;
}

function buildingTouchesVisible(state: GameState, player: PlayerState, b: Building): boolean {
  const { w, h } = footprintOf(b);
  for (let y = b.ty; y < b.ty + h; y++) {
    for (let x = b.tx; x < b.tx + w; x++) {
      if (player.fog[idx(state.map, x, y)] === 2) return true;
    }
  }
  return false;
}

function drawTileDetail(
  g: CanvasRenderingContext2D,
  t: Tile,
  px: number,
  py: number,
  x: number,
  y: number,
  frameTime: number,
): void {
  if (t === Tile.Forest) {
    // Two stylised conifers.
    g.fillStyle = '#0f3812';
    triangle(g, px + TILE * 0.3, py + TILE * 0.75, TILE * 0.34);
    triangle(g, px + TILE * 0.7, py + TILE * 0.85, TILE * 0.42);
    g.fillStyle = '#5a3d22';
    g.fillRect(px + TILE * 0.66, py + TILE * 0.82, 3, 4);
  } else if (t === Tile.Water) {
    const ph = Math.sin(frameTime * 1.6 + x * 1.7 + y * 2.3);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px + 4, py + TILE * 0.5 + ph * 3);
    g.quadraticCurveTo(px + TILE * 0.5, py + TILE * 0.5 + ph * 3 - 3, px + TILE - 4, py + TILE * 0.5 + ph * 3);
    g.stroke();
  } else if (t === Tile.Rock) {
    g.fillStyle = '#55555a';
    g.beginPath();
    g.moveTo(px + TILE * 0.2, py + TILE * 0.85);
    g.lineTo(px + TILE * 0.5, py + TILE * 0.25);
    g.lineTo(px + TILE * 0.85, py + TILE * 0.85);
    g.closePath();
    g.fill();
    g.fillStyle = '#86868c';
    g.beginPath();
    g.moveTo(px + TILE * 0.42, py + TILE * 0.42);
    g.lineTo(px + TILE * 0.5, py + TILE * 0.25);
    g.lineTo(px + TILE * 0.6, py + TILE * 0.42);
    g.closePath();
    g.fill();
  } else if (t === Tile.GoldMine) {
    g.fillStyle = '#4a3a22';
    g.beginPath();
    g.moveTo(px + 2, py + TILE - 2);
    g.lineTo(px + TILE * 0.5, py + 4);
    g.lineTo(px + TILE - 2, py + TILE - 2);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(px + TILE * 0.35, py + TILE * 0.55, TILE * 0.3, TILE * 0.4);
    g.fillStyle = '#e8c84a';
    g.fillRect(px + TILE * 0.44, py + TILE * 0.3, TILE * 0.14, TILE * 0.12);
  }
}

function triangle(g: CanvasRenderingContext2D, cx: number, baseY: number, size: number): void {
  g.beginPath();
  g.moveTo(cx - size / 2, baseY);
  g.lineTo(cx, baseY - size);
  g.lineTo(cx + size / 2, baseY);
  g.closePath();
  g.fill();
}

export function drawBuilding(
  g: CanvasRenderingContext2D,
  cam: Camera,
  type: BuildingType,
  faction: number,
  tx: number,
  ty: number,
  live: Building | null,
  selected: boolean,
  alpha: number,
): void {
  const stats = BUILDING_STATS[type];
  const fac = FACTIONS[faction as 0 | 1];
  const px = (tx - cam.x) * TILE;
  const py = (ty - cam.y) * TILE;
  const w = stats.width * TILE;
  const h = stats.height * TILE;

  g.save();
  g.globalAlpha = alpha;

  // Base slab.
  g.fillStyle = '#2c2c30';
  g.fillRect(px + 2, py + 2, w - 4, h - 4);
  g.fillStyle = fac.colorDark;
  g.fillRect(px + 4, py + 4, w - 8, h - 8);

  // Type-specific motif.
  g.fillStyle = fac.color;
  const cx = px + w / 2;
  const cy = py + h / 2;
  switch (type) {
    case BuildingType.TownHall: {
      g.fillRect(px + w * 0.2, py + h * 0.3, w * 0.6, h * 0.55);
      g.beginPath();
      g.moveTo(px + w * 0.15, py + h * 0.32);
      g.lineTo(cx, py + h * 0.08);
      g.lineTo(px + w * 0.85, py + h * 0.32);
      g.closePath();
      g.fill();
      g.fillStyle = '#e8e0c8';
      g.fillRect(cx - 2, py + h * 0.05, 2, h * 0.18);
      break;
    }
    case BuildingType.Farm: {
      g.fillRect(px + w * 0.18, py + h * 0.45, w * 0.64, h * 0.4);
      g.beginPath();
      g.moveTo(px + w * 0.12, py + h * 0.48);
      g.lineTo(cx, py + h * 0.15);
      g.lineTo(px + w * 0.88, py + h * 0.48);
      g.closePath();
      g.fill();
      break;
    }
    case BuildingType.Barracks: {
      g.fillRect(px + w * 0.15, py + h * 0.25, w * 0.7, h * 0.6);
      g.strokeStyle = '#e8e0c8';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - w * 0.12, cy + h * 0.12);
      g.lineTo(cx + w * 0.12, cy - h * 0.12);
      g.moveTo(cx + w * 0.12, cy + h * 0.12);
      g.lineTo(cx - w * 0.12, cy - h * 0.12);
      g.stroke();
      break;
    }
    case BuildingType.LumberMill: {
      g.fillRect(px + w * 0.15, py + h * 0.35, w * 0.7, h * 0.5);
      g.strokeStyle = '#e8e0c8';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, Math.min(w, h) * 0.18, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case BuildingType.Tower: {
      g.fillRect(px + w * 0.28, py + h * 0.15, w * 0.44, h * 0.7);
      g.fillRect(px + w * 0.2, py + h * 0.1, w * 0.6, h * 0.12);
      break;
    }
  }

  if (live && !live.constructed) {
    // Scaffolding hatch + progress bar.
    g.strokeStyle = 'rgba(232,224,200,0.5)';
    g.lineWidth = 1;
    for (let i = 0; i < w + h; i += 8) {
      g.beginPath();
      g.moveTo(px + Math.min(i, w), py + Math.max(0, i - w));
      g.lineTo(px + Math.max(0, i - h), py + Math.min(i, h));
      g.stroke();
    }
    const frac = live.buildProgress / BUILDING_STATS[type].buildTime;
    drawBar(g, px + 3, py + h - 7, w - 6, 4, frac, '#d8b542');
  }
  if (live) {
    const frac = live.hp / stats.hp;
    if (frac < 1) drawBar(g, px + 3, py - 6, w - 6, 4, frac, hpColor(frac));
  }
  if (selected) {
    g.strokeStyle = '#7f7';
    g.lineWidth = 2;
    g.strokeRect(px + 1, py + 1, w - 2, h - 2);
  }
  g.restore();
}

function drawUnit(g: CanvasRenderingContext2D, cam: Camera, u: Unit, selected: boolean): void {
  const fac = FACTIONS[u.faction];
  const px = (u.x - cam.x) * TILE;
  const py = (u.y - cam.y) * TILE;
  const r = UNIT_RADIUS * TILE * (u.type === UnitType.Heavy ? 1.25 : u.type === UnitType.Worker ? 0.85 : 1);

  if (selected) {
    g.strokeStyle = '#7f7';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py, r + 3, 0, Math.PI * 2);
    g.stroke();
  }

  g.fillStyle = fac.colorDark;
  g.beginPath();
  g.arc(px, py + 1.5, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fac.color;
  g.beginPath();
  g.arc(px, py, r, 0, Math.PI * 2);
  g.fill();

  // Type glyph.
  g.strokeStyle = '#f2ecd8';
  g.fillStyle = '#f2ecd8';
  g.lineWidth = 1.5;
  switch (u.type) {
    case UnitType.Worker:
      g.beginPath();
      g.arc(px, py, r * 0.35, 0, Math.PI * 2);
      g.fill();
      break;
    case UnitType.Melee:
      g.beginPath();
      g.moveTo(px - r * 0.4, py + r * 0.45);
      g.lineTo(px + r * 0.4, py - r * 0.45);
      g.moveTo(px + r * 0.05, py - r * 0.1);
      g.lineTo(px - r * 0.25, py - r * 0.4);
      g.stroke();
      break;
    case UnitType.Ranged:
      g.beginPath();
      g.arc(px, py, r * 0.55, -Math.PI * 0.35, Math.PI * 0.35);
      g.stroke();
      g.beginPath();
      g.moveTo(px - r * 0.3, py);
      g.lineTo(px + r * 0.55, py);
      g.stroke();
      break;
    case UnitType.Heavy:
      g.strokeRect(px - r * 0.35, py - r * 0.35, r * 0.7, r * 0.7);
      break;
  }

  // Carried resources.
  if (u.carrying && u.carrying.amount > 0) {
    g.fillStyle = u.carrying.kind === 'gold' ? '#e8c84a' : '#8a5a2a';
    g.fillRect(px + r * 0.4, py - r * 1.1, 5, 5);
  }

  const maxHp = UNIT_STATS[u.type].hp;
  if (u.hp < maxHp) {
    drawBar(g, px - r, py - r - 6, r * 2, 3, u.hp / maxHp, hpColor(u.hp / maxHp));
  }
}

function drawBar(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
): void {
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}

export function hpColor(frac: number): string {
  return frac > 0.6 ? '#5fd35f' : frac > 0.3 ? '#e0c040' : '#e05040';
}
