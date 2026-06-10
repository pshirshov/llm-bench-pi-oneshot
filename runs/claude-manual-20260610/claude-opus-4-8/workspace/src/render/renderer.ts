import type { Vec2 } from "../core/vec.js";
import type { DragBox, PlacementState } from "../game/types.js";
import { buildingCenter } from "../sim/entity.js";
import { FogState } from "../sim/fog.js";
import { BUILDING_STATS, THEMES, UNIT_STATS, UnitRole, type Faction } from "../sim/stats.js";
import type { World } from "../sim/world.js";
import { TILE_PROPS, TileType } from "../wfc/tiles.js";
import type { Camera } from "./camera.js";
import type { Layout } from "./layout.js";

export interface RenderState {
  selection: Set<number>;
  placement: PlacementState | null;
  dragBox: DragBox | null;
  hover: Vec2 | null;
  now: number;
}

const SELECT_COLOR = "#39ff7a";

export class Renderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(world: World, cam: Camera, layout: Layout, state: RenderState): void {
    const ctx = this.ctx;
    const vp = layout.viewport;
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();

    this.drawTerrain(world, cam);
    this.drawCorpses(world, cam);
    this.drawBuildings(world, cam);
    this.drawUnits(world, cam);
    this.drawProjectiles(world, cam);
    this.drawFog(world, cam);
    this.drawPlacement(world, cam, state);
    this.drawDragBox(state);

    ctx.restore();
  }

  private tileRange(world: World, cam: Camera): { x0: number; y0: number; x1: number; y1: number } {
    const x0 = Math.max(0, Math.floor(cam.x));
    const y0 = Math.max(0, Math.floor(cam.y));
    const x1 = Math.min(world.map.width - 1, Math.ceil(cam.x + cam.tilesWide));
    const y1 = Math.min(world.map.height - 1, Math.ceil(cam.y + cam.tilesHigh));
    return { x0, y0, x1, y1 };
  }

  private drawTerrain(world: World, cam: Camera): void {
    const ctx = this.ctx;
    const ts = cam.tileSize;
    const { x0, y0, x1, y1 } = this.tileRange(world, cam);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (world.fog.at(tx, ty) === FogState.Unexplored) continue;
        const t = world.map.terrainAt(tx, ty);
        const props = TILE_PROPS[t];
        const sx = cam.worldToScreenX(tx);
        const sy = cam.worldToScreenY(ty);
        ctx.fillStyle = (tx + ty) % 2 === 0 ? props.color : props.colorAlt;
        ctx.fillRect(sx, sy, ts + 1, ts + 1);
        this.drawTileDecor(t, sx, sy, ts);
      }
    }
  }

  private drawTileDecor(t: TileType, sx: number, sy: number, ts: number): void {
    const ctx = this.ctx;
    if (t === TileType.Forest) {
      ctx.fillStyle = "#0e3315";
      ctx.beginPath();
      ctx.moveTo(sx + ts * 0.5, sy + ts * 0.15);
      ctx.lineTo(sx + ts * 0.78, sy + ts * 0.7);
      ctx.lineTo(sx + ts * 0.22, sy + ts * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#4a2a13";
      ctx.fillRect(sx + ts * 0.45, sy + ts * 0.66, ts * 0.1, ts * 0.22);
    } else if (t === TileType.GoldMine) {
      ctx.fillStyle = "#3a2c08";
      ctx.fillRect(sx + 1, sy + 1, ts - 2, ts - 2);
      ctx.fillStyle = "#ffd84a";
      for (const [ox, oy] of [
        [0.3, 0.35],
        [0.6, 0.45],
        [0.45, 0.65],
      ] as const) {
        ctx.beginPath();
        ctx.arc(sx + ts * ox, sy + ts * oy, ts * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (t === TileType.Rock) {
      ctx.fillStyle = "#555";
      ctx.beginPath();
      ctx.arc(sx + ts * 0.5, sy + ts * 0.55, ts * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#888";
      ctx.beginPath();
      ctx.arc(sx + ts * 0.42, sy + ts * 0.45, ts * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (t === TileType.Water) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + ts * 0.2, sy + ts * 0.6);
      ctx.lineTo(sx + ts * 0.8, sy + ts * 0.6);
      ctx.stroke();
    }
  }

  private visibleEntityTile(world: World, p: Vec2): boolean {
    return world.fog.at(Math.floor(p.x), Math.floor(p.y)) === FogState.Visible;
  }
  private exploredEntityTile(world: World, p: Vec2): boolean {
    return world.fog.at(Math.floor(p.x), Math.floor(p.y)) !== FogState.Unexplored;
  }

  private drawBuildings(world: World, cam: Camera): void {
    const ctx = this.ctx;
    const ts = cam.tileSize;
    for (const b of world.buildings.values()) {
      const center = buildingCenter(b);
      const isPlayer = b.faction === world.playerFaction;
      // Player buildings always shown; enemy buildings shown if their area is explored.
      if (!isPlayer && !this.exploredEntityTile(world, center)) continue;
      const sx = cam.worldToScreenX(b.origin.tx);
      const sy = cam.worldToScreenY(b.origin.ty);
      const w = b.footprint.w * ts;
      const h = b.footprint.h * ts;
      const theme = THEMES[b.faction];

      ctx.fillStyle = b.constructed ? theme.dark : "#3a3a3a";
      ctx.fillRect(sx + 1, sy + 1, w - 2, h - 2);
      ctx.fillStyle = b.constructed ? theme.primary : "#555";
      ctx.fillRect(sx + 3, sy + 3, w - 6, h - 6);

      // Role glyph.
      ctx.fillStyle = theme.light;
      ctx.font = `bold ${Math.floor(ts * 0.9)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(BUILDING_GLYPH[b.role], sx + w / 2, sy + h / 2 + 1);

      if (b.selected) {
        ctx.strokeStyle = SELECT_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
      }

      if (!b.constructed) {
        this.drawBar(sx + 3, sy + h - 6, w - 6, 4, b.buildProgress, "#6cf");
      } else if (b.hp < b.maxHp) {
        this.drawBar(sx + 3, sy - 6, w - 6, 4, b.hp / b.maxHp, this.hpColor(b.hp / b.maxHp));
      }

      // Rally flag for selected producers.
      if (b.selected && b.rally) {
        const rx = cam.worldToScreenX(b.rally.x);
        const ry = cam.worldToScreenY(b.rally.y);
        ctx.strokeStyle = SELECT_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx + w / 2, sy + h / 2);
        ctx.lineTo(rx, ry);
        ctx.stroke();
        ctx.fillStyle = SELECT_COLOR;
        ctx.fillRect(rx - 2, ry - 8, 3, 8);
      }
    }
  }

  private drawUnits(world: World, cam: Camera): void {
    const ctx = this.ctx;
    const ts = cam.tileSize;
    for (const u of world.units.values()) {
      const isPlayer = u.faction === world.playerFaction;
      if (!isPlayer && !this.visibleEntityTile(world, u.pos)) continue;
      const sx = cam.worldToScreenX(u.pos.x);
      const sy = cam.worldToScreenY(u.pos.y);
      const theme = THEMES[u.faction];
      const r = UNIT_STATS[u.role].radius * ts * 1.5;

      if (u.selected) {
        ctx.strokeStyle = SELECT_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(sx, sy + r * 0.5, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = theme.primary;
      ctx.strokeStyle = theme.dark;
      ctx.lineWidth = 1.5;
      this.drawUnitShape(u.role, sx, sy, r);

      // Carried resource indicator.
      if (u.carrying) {
        ctx.fillStyle = u.carrying.kind === "gold" ? "#ffd84a" : "#7a4a1f";
        ctx.beginPath();
        ctx.arc(sx + r * 0.7, sy - r * 0.7, ts * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }

      if (u.selected || u.hp < u.maxHp) {
        this.drawBar(sx - r, sy - r - 6, r * 2, 3, u.hp / u.maxHp, this.hpColor(u.hp / u.maxHp));
      }
    }
  }

  private drawUnitShape(role: UnitRole, sx: number, sy: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    if (role === UnitRole.Ranged) {
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy + r);
      ctx.lineTo(sx - r, sy + r);
      ctx.closePath();
    } else if (role === UnitRole.Heavy) {
      ctx.rect(sx - r, sy - r, r * 2, r * 2);
    } else if (role === UnitRole.Infantry) {
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // sword notch
      ctx.fillStyle = "#eee";
      ctx.fillRect(sx + r * 0.4, sy - r * 1.1, r * 0.25, r * 1.3);
      return;
    } else {
      // Worker.
      ctx.arc(sx, sy, r * 0.85, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }

  private drawProjectiles(world: World, cam: Camera): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#ffe08a";
    for (const p of world.projectiles) {
      if (!this.visibleEntityTile(world, p.pos)) continue;
      const sx = cam.worldToScreenX(p.pos.x);
      const sy = cam.worldToScreenY(p.pos.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCorpses(world: World, cam: Camera): void {
    const ctx = this.ctx;
    for (const c of world.corpses) {
      if (!this.exploredEntityTile(world, c.pos)) continue;
      const sx = cam.worldToScreenX(c.pos.x);
      const sy = cam.worldToScreenY(c.pos.y);
      ctx.globalAlpha = Math.max(0, c.fade / c.maxFade) * 0.6;
      ctx.fillStyle = "#3a0d0d";
      ctx.beginPath();
      ctx.arc(sx, sy, cam.tileSize * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawFog(world: World, cam: Camera): void {
    const ctx = this.ctx;
    const ts = cam.tileSize;
    const { x0, y0, x1, y1 } = this.tileRange(world, cam);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const f = world.fog.at(tx, ty);
        if (f === FogState.Visible) continue;
        const sx = cam.worldToScreenX(tx);
        const sy = cam.worldToScreenY(ty);
        ctx.fillStyle = f === FogState.Unexplored ? "#000" : "rgba(0,0,0,0.5)";
        ctx.fillRect(sx, sy, ts + 1, ts + 1);
      }
    }
  }

  private drawPlacement(world: World, cam: Camera, state: RenderState): void {
    if (!state.placement || !state.hover) return;
    const ctx = this.ctx;
    const ts = cam.tileSize;
    const stats = BUILDING_STATS[state.placement.role];
    const tx = Math.floor(state.hover.x);
    const ty = Math.floor(state.hover.y);
    const ok = world.map.canPlace(tx, ty, stats.footprint.w, stats.footprint.h);
    for (let dy = 0; dy < stats.footprint.h; dy++) {
      for (let dx = 0; dx < stats.footprint.w; dx++) {
        const cellOk = world.map.canPlace(tx + dx, ty + dy, 1, 1);
        const sx = cam.worldToScreenX(tx + dx);
        const sy = cam.worldToScreenY(ty + dy);
        ctx.fillStyle = cellOk && ok ? "rgba(60,220,120,0.35)" : "rgba(220,60,60,0.4)";
        ctx.fillRect(sx, sy, ts, ts);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.strokeRect(sx, sy, ts, ts);
      }
    }
  }

  private drawDragBox(state: RenderState): void {
    if (!state.dragBox) return;
    const ctx = this.ctx;
    const { x0, y0, x1, y1 } = state.dragBox;
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "rgba(60,255,120,0.1)";
    ctx.fillRect(x, y, w, h);
  }

  private drawBar(x: number, y: number, w: number, h: number, frac: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private hpColor(frac: number): string {
    if (frac > 0.6) return "#3fbf4f";
    if (frac > 0.3) return "#d9b53a";
    return "#d9453a";
  }
}

const BUILDING_GLYPH: Record<string, string> = {
  townhall: "⌂",
  farm: "≈",
  barracks: "⚔",
  lumbermill: "▣",
  guardtower: "♜",
};

export function factionLabel(f: Faction): string {
  return THEMES[f].displayName;
}
