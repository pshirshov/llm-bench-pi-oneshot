import type { GameState, Entity, Building, Projectile, Corpse, Faction, Tile, TileVisibility, UnitType, BuildingType } from './types';
import {
  FACTION_COLORS, TILE_COLORS,
  UNIT_DATA, BUILDING_DATA
} from './data';
import { TILE_PX, CANVAS_W, CANVAS_H, MINIMAP_SIZE } from './constants';
import { VIEW_W, VIEW_H } from './constants';
import type { Point } from './types';

const TILE_SIZE = TILE_PX; // on screen px per tile

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  camX: number;
  camY: number;
  scale: number;
}

export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })!;
  ctx.imageSmoothingEnabled = false;
  return {
    ctx,
    w: CANVAS_W,
    h: CANVAS_H,
    camX: 0,
    camY: 0,
    scale: 1,
  };
}

export function screenToWorld(rc: RenderContext, sx: number, sy: number): Point {
  const tx = rc.camX + sx / TILE_SIZE;
  const ty = rc.camY + sy / TILE_SIZE;
  return { x: tx, y: ty };
}

export function worldToScreen(rc: RenderContext, wx: number, wy: number): Point {
  const sx = (wx - rc.camX) * TILE_SIZE;
  const sy = (wy - rc.camY) * TILE_SIZE;
  return { x: sx, y: sy };
}

function drawRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, stroke?: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawTriangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.55);
  ctx.lineTo(-size * 0.7, size * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawRectOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, lw = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
}

export function render(rc: RenderContext, state: GameState, mouseWorld?: Point, buildPreview?: {bt: any, valid: boolean, x: number, y: number} | null): void {
  const { ctx, w, h } = rc;
  const { mapW, mapH, tiles, vis, entities, projectiles, corpses, playerFaction } = state;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  const viewTilesX = VIEW_W;
  const viewTilesY = VIEW_H;
  const startX = Math.floor(rc.camX);
  const startY = Math.floor(rc.camY);
  const endX = Math.min(mapW, startX + viewTilesX + 2);
  const endY = Math.min(mapH, startY + viewTilesY + 2);

  // Draw tiles
  for (let ty = Math.max(0, startY - 1); ty < endY; ty++) {
    for (let tx = Math.max(0, startX - 1); tx < endX; tx++) {
      const screenX = (tx - rc.camX) * TILE_SIZE;
      const screenY = (ty - rc.camY) * TILE_SIZE;
      const v = vis[ty]?.[tx] ?? 'unexplored';
      const tile = tiles[ty][tx];

      let color = TILE_COLORS[tile] || '#333';
      if (v === 'unexplored') {
        color = '#0a0a0a';
      } else if (v === 'explored') {
        color = mixColor(color, '#222', 0.55);
      }
      drawRect(ctx, screenX, screenY, TILE_SIZE, TILE_SIZE, color);

      // tile details
      if (v !== 'unexplored') {
        if (tile === 'forest') {
          drawCircle(ctx, screenX + 5, screenY + 5, 3.5, '#143a14');
          drawCircle(ctx, screenX + 11, screenY + 9, 3, '#143a14');
        }
        if (tile === 'rock') {
          drawRect(ctx, screenX + 4, screenY + 4, TILE_SIZE - 9, TILE_SIZE - 9, '#444');
        }
        if (tile === 'water') {
          ctx.fillStyle = 'rgba(40,90,150,0.35)';
          ctx.fillRect(screenX + 1, screenY + 2 + ((state.tick / 9) % 3), TILE_SIZE - 2, 3);
        }
        if (tile === 'goldmine') {
          drawRect(ctx, screenX + 3, screenY + 3, TILE_SIZE - 6, TILE_SIZE - 6, '#c5a030');
          drawCircle(ctx, screenX + TILE_SIZE/2, screenY + TILE_SIZE/2, 3, '#ffe070');
        }
      }
      // grid lines faint
      if (v !== 'unexplored') {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Draw fog overlay on unexplored tiles
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  for (let ty = Math.max(0, startY - 1); ty < endY; ty++) {
    for (let tx = Math.max(0, startX - 1); tx < endX; tx++) {
      if (vis[ty]?.[tx] === 'unexplored') {
        const sx = (tx - rc.camX) * TILE_SIZE;
        const sy = (ty - rc.camY) * TILE_SIZE;
        ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Draw entities - only visible ones (or last known for buildings in fog)
  const drawnBuildings = new Set<number>();
  const player = playerFaction;
  const opp = player === 'human' ? 'orc' : 'human';

  // Sort for painter's: buildings first, then units
  const sortedEntities = Array.from(entities.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'building' ? -1 : 1;
    return a.pos.y - b.pos.y;
  });

  for (const e of sortedEntities) {
    if (e.faction !== player) {
      // enemy: only draw if tile visible
      const tx = Math.floor(e.pos.x);
      const ty = Math.floor(e.pos.y);
      if (vis[ty]?.[tx] !== 'visible') {
        // for buildings, draw last-known faded version from exploredBuildings
        if (e.kind === 'building' && state.exploredBuildings.has(e.id)) {
          const ghost = state.exploredBuildings.get(e.id)!;
          drawBuilding(rc, ghost, true);
          drawnBuildings.add(e.id);
        }
        continue;
      }
    }

    const s = worldToScreen(rc, e.pos.x, e.pos.y);
    const isSel = e.selected;

    if (e.kind === 'building') {
      drawBuilding(rc, e as Building, false, isSel);
      drawnBuildings.add(e.id);
    } else {
      drawUnit(rc, e, isSel);
    }

    // HP bar
    if (e.hp < e.maxHp * 0.98 && vis[Math.floor(e.pos.y)]?.[Math.floor(e.pos.x)] === 'visible') {
      const hpPct = Math.max(0, e.hp / e.maxHp);
      const barW = e.kind === 'building' ? 28 : 18;
      const barY = s.y - (e.kind === 'building' ? 20 : 15);
      ctx.fillStyle = '#111';
      ctx.fillRect(s.x - barW/2, barY, barW, 4);
      ctx.fillStyle = hpPct > 0.5 ? '#5f5' : hpPct > 0.25 ? '#ff5' : '#f44';
      ctx.fillRect(s.x - barW/2 + 1, barY + 1, (barW - 2) * hpPct, 2);
    }
  }

  // Draw build preview if active
  if (buildPreview && buildPreview.bt) {
    const { bt, valid, x, y } = buildPreview;
    const fac = state.playerFaction;
    const stats = BUILDING_DATA[fac][bt as BuildingType];
    const sx = (x - rc.camX) * TILE_SIZE;
    const sy = (y - rc.camY) * TILE_SIZE;
    const pw = stats.footprintW * TILE_SIZE;
    const ph = stats.footprintH * TILE_SIZE;
    ctx.strokeStyle = valid ? '#5f5' : '#f55';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, pw, ph);
    ctx.fillStyle = valid ? 'rgba(90,200,90,0.25)' : 'rgba(220,70,70,0.3)';
    ctx.fillRect(sx, sy, pw, ph);
  }

  // Projectiles
  ctx.strokeStyle = '#ffdd66';
  ctx.lineWidth = 2;
  for (const p of projectiles) {
    const s = worldToScreen(rc, p.pos.x, p.pos.y);
    const prev = worldToScreen(rc, p.pos.x - p.vel.x * 0.06, p.pos.y - p.vel.y * 0.06);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    drawCircle(ctx, s.x, s.y, 1.6, '#ffe066');
  }

  // Corpses
  for (const c of corpses) {
    const s = worldToScreen(rc, c.pos.x, c.pos.y);
    const alpha = Math.max(0.1, c.fade * 0.7);
    const col = c.faction === player ? 'rgba(140,140,140,' : 'rgba(100,80,60,';
    ctx.fillStyle = col + alpha + ')';
    const r = c.size * TILE_SIZE * 0.6;
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(3, r), 0, Math.PI * 2);
    ctx.fill();
  }

  // Selection box (drawn by caller using input state if needed)

  // Minimap (drawn separately in main for simplicity)
}

function drawUnit(rc: RenderContext, e: Entity, selected: boolean): void {
  const { ctx } = rc;
  const s = worldToScreen(rc, e.pos.x, e.pos.y);
  const fac = e.faction;
  const colors = FACTION_COLORS[fac];
  const ut = e.type as 'worker' | 'inf' | 'ranged' | 'heavy';
  const stats = UNIT_DATA[fac][ut];
  const r = e.size * TILE_SIZE * 0.85;

  const rot = e.facing ?? 0;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(s.x + 1, s.y + 3, r * 0.85, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  if (ut === 'worker') {
    // worker = small person with pick/shovel
    drawCircle(ctx, s.x, s.y, r * 0.7, colors.primary);
    drawCircle(ctx, s.x, s.y - 1, r * 0.45, colors.accent);
    // tool
    ctx.strokeStyle = '#aa9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x + 2, s.y - 2);
    ctx.lineTo(s.x + 7, s.y + 6);
    ctx.stroke();
  } else if (ut === 'inf') {
    // infantry
    drawCircle(ctx, s.x, s.y, r, colors.primary);
    drawTriangle(ctx, s.x, s.y - 1, r * 0.7, rot + 0.1, colors.secondary);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(s.x - 2, s.y + 3, 4, 2);
  } else if (ut === 'ranged') {
    drawCircle(ctx, s.x, s.y, r * 0.92, colors.primary);
    drawCircle(ctx, s.x, s.y, r * 0.55, '#333');
    ctx.fillStyle = colors.secondary;
    ctx.fillRect(s.x - 1, s.y - 7, 3, 10); // bow / spear
  } else {
    // heavy
    drawCircle(ctx, s.x, s.y, r * 1.05, colors.primary);
    drawCircle(ctx, s.x, s.y, r * 0.65, '#222');
    ctx.fillStyle = colors.accent;
    ctx.fillRect(s.x - 5, s.y - 2, 10, 4);
  }

  if (selected) {
    ctx.strokeStyle = '#ffdd66';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // facing indicator small
  if (e.vel && Math.hypot(e.vel.x, e.vel.y) > 0.05) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    const fx = s.x + Math.cos(rot) * (r + 1);
    const fy = s.y + Math.sin(rot) * (r + 1);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(fx, fy);
    ctx.stroke();
  }
}

function drawBuilding(rc: RenderContext, b: Building, ghost = false, selected = false): void {
  const { ctx } = rc;
  const s = worldToScreen(rc, b.pos.x, b.pos.y);
  const fac = b.faction;
  const colors = FACTION_COLORS[fac];
  const bt = b.type;
  const stats = BUILDING_DATA[fac][bt as BuildingType];
  const fw = stats.footprintW * TILE_SIZE;
  const fh = stats.footprintH * TILE_SIZE;
  const sx = (b.footX - rc.camX) * TILE_SIZE;
  const sy = (b.footY - rc.camY) * TILE_SIZE;

  let alpha = ghost ? 0.45 : 1.0;
  if (!b.isBuilt) alpha *= 0.65;

  // base
  ctx.fillStyle = ghost ? 'rgba(80,80,80,0.4)' : mixColor(colors.primary, '#222', 0.3);
  ctx.globalAlpha = alpha;
  ctx.fillRect(sx, sy, fw, fh);

  // structure
  const topH = fh * (bt === 'th' ? 0.55 : bt === 'barracks' ? 0.45 : 0.5);
  ctx.fillStyle = ghost ? '#555' : colors.secondary;
  ctx.fillRect(sx + 2, sy + 2, fw - 4, topH);

  // roof / details
  ctx.fillStyle = ghost ? '#666' : colors.accent;
  if (bt === 'th' || bt === 'barracks') {
    ctx.fillRect(sx + 3, sy + 1, fw - 6, 5);
  }
  if (bt === 'tower') {
    ctx.fillRect(sx + 1, sy + 1, fw - 2, 4);
    // crenellations
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(sx + 2 + i * 4, sy, 2, 3);
    }
  }
  if (bt === 'farm') {
    ctx.fillStyle = '#a80';
    ctx.fillRect(sx + 2, sy + fh * 0.4, fw - 4, fh * 0.35);
  }
  if (bt === 'lumbermill') {
    ctx.fillStyle = '#542';
    ctx.fillRect(sx + fw * 0.2, sy + 3, fw * 0.6, fh - 6);
  }

  ctx.globalAlpha = 1;

  if (!b.isBuilt) {
    // construction hatch
    const pct = Math.min(1, (b.buildProgress || 0) / stats.buildTime);
    ctx.fillStyle = 'rgba(255,220,80,0.5)';
    ctx.fillRect(sx + 2, sy + fh - 5, (fw - 4) * pct, 3);
  }

  if (selected && !ghost) {
    ctx.strokeStyle = '#ffdd66';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(sx - 1, sy - 1, fw + 2, fh + 2);
  }
}

function mixColor(c1: string, c2: string, t: number): string {
  // very rough
  const parse = (c: string) => {
    if (c[0] === '#') {
      const n = parseInt(c.slice(1), 16);
      return [(n>>16)&255, (n>>8)&255, n&255];
    }
    return [100,100,100];
  };
  const a = parse(c1), b = parse(c2);
  const r = Math.floor(a[0]*(1-t) + b[0]*t);
  const g = Math.floor(a[1]*(1-t) + b[1]*t);
  const bl = Math.floor(a[2]*(1-t) + b[2]*t);
  return `rgb(${r},${g},${bl})`;
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  size: number,
  offsetX: number,
  offsetY: number
): void {
  const { mapW, mapH, tiles, vis, entities, playerFaction } = state;
  ctx.save();
  ctx.translate(offsetX, offsetY);

  const scaleX = size / mapW;
  const scaleY = size / mapH;
  const sc = Math.min(scaleX, scaleY);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // terrain
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const v = vis[y][x];
      let col = TILE_COLORS[tiles[y][x]] || '#222';
      if (v === 'unexplored') col = '#111';
      else if (v === 'explored') col = mixColor(col, '#222', 0.7);
      ctx.fillStyle = col;
      ctx.fillRect(Math.floor(x * sc), Math.floor(y * sc), Math.ceil(sc) + 1, Math.ceil(sc) + 1);
    }
  }

  // entities
  for (const e of entities.values()) {
    if (e.faction !== playerFaction) {
      const tx = Math.floor(e.pos.x), ty = Math.floor(e.pos.y);
      if (vis[ty]?.[tx] !== 'visible') continue;
    }
    const ex = Math.floor(e.pos.x * sc);
    const ey = Math.floor(e.pos.y * sc);
    const col = e.faction === playerFaction ? '#5f5' : '#f55';
    ctx.fillStyle = col;
    const r = e.kind === 'building' ? 2.5 : 1.6;
    ctx.fillRect(ex - r/2, ey - r/2, r, r);
  }

  // viewport rect
  const viewW = VIEW_W;
  const viewH = VIEW_H;
  ctx.strokeStyle = '#ffcc66';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    state.camX * sc,
    state.camY * sc,
    viewW * sc,
    viewH * sc
  );

  ctx.restore();
}

export function drawSelectionBox(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.strokeStyle = '#aaddff';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(120,180,255,0.12)';
  const [lx, rx] = [Math.min(x1, x2), Math.max(x1, x2)];
  const [ty, by] = [Math.min(y1, y2), Math.max(y1, y2)];
  ctx.fillRect(lx, ty, rx - lx, by - ty);
  ctx.strokeRect(lx, ty, rx - lx, by - ty);
}

export function drawHUD(ctx: CanvasRenderingContext2D, state: GameState, w: number): void {
  const p = state.playerFaction;
  const opp = p === 'human' ? 'orc' : 'human';
  ctx.fillStyle = 'rgba(20,20,20,0.92)';
  ctx.fillRect(0, 0, w, 36);

  ctx.font = '13px monospace';
  ctx.fillStyle = '#ffcc66';
  ctx.fillText(`GOLD ${Math.floor(state.gold[p])}`, 14, 23);
  ctx.fillText(`WOOD ${Math.floor(state.wood[p])}`, 110, 23);
  ctx.fillText(`SUPPLY ${state.supplyUsed[p]}/${state.supplyCap[p]}`, 210, 23);

  ctx.fillStyle = '#888';
  ctx.fillText(`SEED ${state.seed}`, 330, 23);
  ctx.fillText(`LVL ${state.level + 1}  DIFF ${state.difficulty}`, 430, 23);

  if (state.paused) {
    ctx.fillStyle = '#ff6666';
    ctx.fillText('PAUSED', 560, 23);
  } else if (state.speed === 2) {
    ctx.fillStyle = '#66ff99';
    ctx.fillText('x2', 560, 23);
  }

  // Selected info strip
  const sel = Array.from(state.selectedIds).map(id => state.entities.get(id)).filter(Boolean);
  if (sel.length > 0) {
    const first = sel[0];
    ctx.fillStyle = '#ddd';
    let txt = `${sel.length} selected`;
    if (sel.length === 1 && first) {
      const nm = first.kind === 'unit' ? (UNIT_DATA[first.faction] as any)[first.type].name : (BUILDING_DATA[first.faction] as any)[first.type].name;
      txt = `${nm}  HP ${Math.ceil(first.hp)}/${first.maxHp}`;
    }
    ctx.fillText(txt, 620, 23);
  }
}
