import { canTrain, canAfford, canPlaceBuilding } from '../game/commands';
import {
  BUILDING_STATS,
  BuildingType,
  FACTIONS,
  TRAINED_AT,
  UNIT_REQUIREMENTS,
  UNIT_STATS,
  UnitType,
} from '../game/data';
import { Building, findBuilding, findUnit, GameState, Unit } from '../game/state';
import { Tile } from '../map/tiles';
import { idx } from '../map/gamemap';
import { Camera, hpColor, TILE } from './render';

export const TOP_BAR_H = 26;
export const PANEL_H = 124;
export const MINIMAP_SIZE = 168;

export interface HudButton {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string; // e.g. "build:farm", "train:melee"
  label: string;
  sub: string;
  enabled: boolean;
}

export interface HudLayout {
  minimap: { x: number; y: number; size: number; scale: number };
  panel: { x: number; y: number; w: number; h: number };
  buttons: HudButton[];
}

const MINIMAP_COLORS: Record<Tile, string> = {
  [Tile.Grass]: '#3e7a35',
  [Tile.Dirt]: '#8a6f47',
  [Tile.Forest]: '#1e4d20',
  [Tile.Water]: '#274f8f',
  [Tile.Rock]: '#6b6b70',
  [Tile.GoldMine]: '#e8c84a',
};

export class HudRenderer {
  private minimapCanvas = document.createElement('canvas');
  private minimapDirty = 0;

  render(
    g: CanvasRenderingContext2D,
    state: GameState,
    cam: Camera,
    screenW: number,
    screenH: number,
    selection: ReadonlySet<number>,
    paused: boolean,
    speed: number,
    placingArmed: boolean,
  ): HudLayout {
    const buttons: HudButton[] = [];
    this.drawTopBar(g, state, screenW, paused, speed);
    const minimap = this.drawMinimap(g, state, cam, screenW, screenH);
    const panel = this.drawPanel(g, state, screenW, screenH, selection, buttons, placingArmed);
    return { minimap, panel, buttons };
  }

  private drawTopBar(
    g: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    paused: boolean,
    speed: number,
  ): void {
    const p = state.players[0];
    g.fillStyle = 'rgba(12,12,18,0.92)';
    g.fillRect(0, 0, screenW, TOP_BAR_H);
    g.strokeStyle = '#3a3a48';
    g.beginPath();
    g.moveTo(0, TOP_BAR_H + 0.5);
    g.lineTo(screenW, TOP_BAR_H + 0.5);
    g.stroke();

    g.font = '13px Georgia, serif';
    g.textBaseline = 'middle';
    const y = TOP_BAR_H / 2;

    g.fillStyle = '#e8c84a';
    g.fillText(`Gold ${Math.floor(p.gold)}`, 12, y);
    g.fillStyle = '#c89a6a';
    g.fillText(`Wood ${Math.floor(p.wood)}`, 110, y);
    const supplyBlocked = p.supplyUsed >= p.supplyCap;
    g.fillStyle = supplyBlocked ? '#e05040' : '#b8e0b8';
    g.fillText(`Supply ${p.supplyUsed}/${p.supplyCap}`, 208, y);
    g.fillStyle = '#9090a8';
    g.fillText(
      `Seed ${state.seed}  ·  Level ${state.level} (difficulty ${state.difficulty})  ·  ${formatTime(state.time)}`,
      320,
      y,
    );
    const status = paused ? 'PAUSED (Space)' : `${speed}x speed (F)`;
    g.fillStyle = paused ? '#e0c040' : '#9090a8';
    const tw = g.measureText(status).width;
    g.fillText(status, screenW - tw - 12, y);
  }

  private drawMinimap(
    g: CanvasRenderingContext2D,
    state: GameState,
    cam: Camera,
    screenW: number,
    screenH: number,
  ): HudLayout['minimap'] {
    const { map } = state;
    const size = MINIMAP_SIZE;
    const x = 8;
    const y = screenH - size - 8;
    const scale = size / Math.max(map.width, map.height);

    if (this.minimapCanvas.width !== map.width) {
      this.minimapCanvas.width = map.width;
      this.minimapCanvas.height = map.height;
    }
    if (this.minimapDirty-- <= 0) {
      this.minimapDirty = 10;
      const mg = this.minimapCanvas.getContext('2d')!;
      const player = state.players[0];
      const img = mg.createImageData(map.width, map.height);
      for (let i = 0; i < map.tiles.length; i++) {
        const fog = player.fog[i];
        let r = 0;
        let gg = 0;
        let b = 0;
        if (fog > 0) {
          const t = (fog === 2 ? map.tiles[i] : player.seenTiles[i]) as Tile;
          const c = MINIMAP_COLORS[t];
          r = parseInt(c.slice(1, 3), 16);
          gg = parseInt(c.slice(3, 5), 16);
          b = parseInt(c.slice(5, 7), 16);
          if (fog === 1) {
            r = (r * 0.5) | 0;
            gg = (gg * 0.5) | 0;
            b = (b * 0.5) | 0;
          }
        }
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = gg;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
      mg.putImageData(img, 0, 0);
    }

    g.fillStyle = '#0c0c12';
    g.fillRect(x - 3, y - 3, size + 6, size + 6);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.minimapCanvas, x, y, map.width * scale, map.height * scale);

    // Entities (respecting fog).
    const player = state.players[0];
    for (const b of state.buildings) {
      const visible =
        b.faction === player.faction ||
        player.fog[idx(map, b.tx, b.ty)] === 2 ||
        player.buildingMemory.has(b.id);
      if (!visible) continue;
      g.fillStyle = FACTIONS[b.faction].color;
      g.fillRect(x + b.tx * scale, y + b.ty * scale, Math.max(2, 3 * scale), Math.max(2, 3 * scale));
    }
    for (const u of state.units) {
      if (u.faction !== player.faction) {
        const i = idx(map, Math.floor(u.x), Math.floor(u.y));
        if (player.fog[i] !== 2) continue;
      }
      g.fillStyle = FACTIONS[u.faction].color;
      g.fillRect(x + u.x * scale - 1, y + u.y * scale - 1, 2, 2);
    }

    // Viewport rectangle.
    const viewW = (screenW / TILE) * scale;
    const viewH = ((screenH - TOP_BAR_H) / TILE) * scale;
    g.strokeStyle = '#e8e0c8';
    g.lineWidth = 1;
    g.strokeRect(x + cam.x * scale, y + cam.y * scale, viewW, viewH);

    return { x, y, size, scale };
  }

  private drawPanel(
    g: CanvasRenderingContext2D,
    state: GameState,
    screenW: number,
    screenH: number,
    selection: ReadonlySet<number>,
    buttons: HudButton[],
    placingArmed: boolean,
  ): HudLayout['panel'] {
    const x = MINIMAP_SIZE + 20;
    const h = PANEL_H;
    const y = screenH - h - 8;
    const w = Math.min(720, screenW - x - 12);
    g.fillStyle = 'rgba(12,12,18,0.92)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#3a3a48';
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const units: Unit[] = [];
    let building: Building | undefined;
    for (const id of selection) {
      const u = findUnit(state, id);
      if (u) units.push(u);
      else building = building ?? findBuilding(state, id);
    }

    g.font = '13px Georgia, serif';
    g.textBaseline = 'top';

    if (units.length === 1) {
      this.drawUnitInfo(g, state, units[0], x + 12, y + 10);
    } else if (units.length > 1) {
      this.drawGroupInfo(g, state, units, x + 12, y + 10);
    } else if (building) {
      this.drawBuildingInfo(g, state, building, x + 12, y + 10);
    } else {
      g.fillStyle = '#707088';
      g.fillText('No selection — left-click or drag to select. Right-click to order.', x + 12, y + 10);
    }

    // Action buttons.
    const own = units.filter((u) => u.faction === state.playerFaction);
    const bx = x + w - 332;
    if (own.some((u) => u.type === UnitType.Worker)) {
      const fac = FACTIONS[state.playerFaction];
      const player = state.players[0];
      const types: BuildingType[] = [
        BuildingType.TownHall,
        BuildingType.Farm,
        BuildingType.Barracks,
        BuildingType.LumberMill,
        BuildingType.Tower,
      ];
      types.forEach((bt, i) => {
        const s = BUILDING_STATS[bt];
        buttons.push({
          x: bx + (i % 3) * 108,
          y: y + 10 + Math.floor(i / 3) * 52 + 2,
          w: 100,
          h: 46,
          id: `build:${bt}`,
          label: fac.buildingNames[bt],
          sub: costText(s.goldCost, s.woodCost, 0),
          enabled: canAfford(player, s.goldCost, s.woodCost),
        });
      });
      if (placingArmed) {
        g.fillStyle = '#d8b542';
        g.fillText('Choose a spot — click to place, Esc to cancel', x + 12, y + h - 22);
      }
    } else if (building && building.faction === state.playerFaction && building.constructed) {
      const player = state.players[0];
      const fac = FACTIONS[state.playerFaction];
      const trainables = (Object.values(UnitType) as UnitType[]).filter(
        (ut) => TRAINED_AT[ut] === building!.type,
      );
      trainables.forEach((ut, i) => {
        const s = UNIT_STATS[ut];
        const reqs = UNIT_REQUIREMENTS[ut];
        const reqMet = reqs.every((r) =>
          state.buildings.some((b) => b.faction === player.faction && b.type === r && b.constructed),
        );
        buttons.push({
          x: bx + (i % 3) * 108,
          y: y + 10 + Math.floor(i / 3) * 52 + 2,
          w: 100,
          h: 46,
          id: `train:${ut}`,
          label: fac.unitNames[ut],
          sub: reqMet ? costText(s.goldCost, s.woodCost, s.supplyCost) : 'needs ' + reqs.map((r) => fac.buildingNames[r]).join(', '),
          enabled: canTrain(state, building, ut),
        });
      });
    }

    for (const b of buttons) {
      g.fillStyle = b.enabled ? '#2a3040' : '#1a1d26';
      g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = b.enabled ? '#6a7088' : '#33363f';
      g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      g.fillStyle = b.enabled ? '#e8e0c8' : '#606068';
      g.font = '12px Georgia, serif';
      g.fillText(b.label, b.x + 6, b.y + 6, b.w - 12);
      g.fillStyle = b.enabled ? '#a8a890' : '#50505a';
      g.font = '11px Georgia, serif';
      g.fillText(b.sub, b.x + 6, b.y + 24, b.w - 12);
    }

    return { x, y, w, h };
  }

  private drawUnitInfo(g: CanvasRenderingContext2D, _state: GameState, u: Unit, x: number, y: number): void {
    const fac = FACTIONS[u.faction];
    const s = UNIT_STATS[u.type];
    this.portrait(g, fac.color, x, y, 44);
    g.fillStyle = '#e8e0c8';
    g.font = '14px Georgia, serif';
    g.fillText(fac.unitNames[u.type], x + 56, y);
    g.font = '12px Georgia, serif';
    g.fillStyle = hpColor(u.hp / s.hp);
    g.fillText(`HP ${Math.ceil(u.hp)}/${s.hp}`, x + 56, y + 20);
    g.fillStyle = '#a8a890';
    g.fillText(`Dmg ${s.damage}  Armor ${s.armor}  Range ${s.range.toFixed(1)}`, x + 56, y + 38);
    g.fillText(`Speed ${s.speed}  Sight ${s.sight}`, x + 56, y + 54);
    if (u.carrying) {
      g.fillStyle = '#d8b542';
      g.fillText(`Carrying ${Math.floor(u.carrying.amount)} ${u.carrying.kind}`, x + 56, y + 72);
    } else {
      g.fillStyle = '#707088';
      g.fillText(orderText(u), x + 56, y + 72);
    }
  }

  private drawGroupInfo(g: CanvasRenderingContext2D, state: GameState, units: Unit[], x: number, y: number): void {
    g.fillStyle = '#e8e0c8';
    g.font = '14px Georgia, serif';
    g.fillText(`${units.length} units selected`, x, y);
    units.slice(0, 24).forEach((u, i) => {
      const px = x + (i % 12) * 26;
      const py = y + 24 + Math.floor(i / 12) * 34;
      this.portrait(g, FACTIONS[u.faction].color, px, py, 22);
      const s = UNIT_STATS[u.type];
      g.fillStyle = hpColor(u.hp / s.hp);
      g.fillRect(px, py + 24, 22 * Math.max(0, u.hp / s.hp), 3);
    });
    void state;
  }

  private drawBuildingInfo(g: CanvasRenderingContext2D, state: GameState, b: Building, x: number, y: number): void {
    const fac = FACTIONS[b.faction];
    const s = BUILDING_STATS[b.type];
    this.portrait(g, fac.colorDark, x, y, 44);
    g.fillStyle = '#e8e0c8';
    g.font = '14px Georgia, serif';
    g.fillText(fac.buildingNames[b.type], x + 56, y);
    g.font = '12px Georgia, serif';
    g.fillStyle = hpColor(b.hp / s.hp);
    g.fillText(`HP ${Math.ceil(b.hp)}/${s.hp}`, x + 56, y + 20);
    if (!b.constructed) {
      const frac = b.buildProgress / s.buildTime;
      g.fillStyle = '#d8b542';
      g.fillText(`Under construction ${(frac * 100).toFixed(0)}%`, x + 56, y + 38);
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(x + 56, y + 56, 160, 8);
      g.fillStyle = '#d8b542';
      g.fillRect(x + 56, y + 56, 160 * frac, 8);
    } else if (b.trainQueue.length > 0) {
      const head = b.trainQueue[0];
      const frac = 1 - head.remaining / head.total;
      g.fillStyle = '#a8a890';
      g.fillText(
        `Training ${fac.unitNames[head.unit]} (${b.trainQueue.length} queued)`,
        x + 56,
        y + 38,
      );
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(x + 56, y + 56, 160, 8);
      g.fillStyle = '#5fd35f';
      g.fillRect(x + 56, y + 56, 160 * frac, 8);
    } else if (s.supplyGranted > 0) {
      g.fillStyle = '#a8a890';
      g.fillText(`Grants ${s.supplyGranted} supply`, x + 56, y + 38);
    } else if (s.damage > 0) {
      g.fillStyle = '#a8a890';
      g.fillText(`Dmg ${s.damage}  Range ${s.range.toFixed(1)}`, x + 56, y + 38);
    }
    void state;
  }

  private portrait(g: CanvasRenderingContext2D, color: string, x: number, y: number, size: number): void {
    g.fillStyle = '#1a1d26';
    g.fillRect(x, y, size, size);
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + size / 2, y + size / 2, size * 0.32, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a3a48';
    g.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }
}

function costText(gold: number, wood: number, supply: number): string {
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (wood > 0) parts.push(`${wood}w`);
  if (supply > 0) parts.push(`${supply} supply`);
  return parts.join(' ');
}

function orderText(u: Unit): string {
  switch (u.order.kind) {
    case 'idle':
      return 'Idle';
    case 'move':
      return 'Moving';
    case 'attackMove':
      return 'Attack-moving';
    case 'attack':
      return 'Attacking';
    case 'harvestGold':
      return 'Mining gold';
    case 'harvestWood':
      return 'Chopping wood';
    case 'build':
      return 'Building';
    case 'repair':
      return 'Repairing';
  }
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Placement validity preview helper shared with input. */
export function placementValid(state: GameState, type: BuildingType, tx: number, ty: number): boolean {
  return canPlaceBuilding(state, type, tx, ty);
}
