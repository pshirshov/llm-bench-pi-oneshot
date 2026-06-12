import { TILE_SIZE } from '../sim/constants';
import { getTile } from '../sim/map/tiles';
import { FACTIONS, buildingStats, unitStats } from '../sim/stats';
import type { Building, Point, Rect, Unit } from '../sim/types';
import { mustGet } from '../sim/utils';
import type { World } from '../sim/world';
import { computeHudLayout, type HudLayout } from '../ui/layout';
import type { CameraState } from '../ui/input';

export interface RenderOptions {
  world: World;
  canvas: HTMLCanvasElement;
  camera: CameraState;
  paused: boolean;
  speed: 1 | 2;
}

export class Renderer {
  private readonly context: CanvasRenderingContext2D;

  public constructor(private readonly options: RenderOptions) {
    const context = options.canvas.getContext('2d');
    if (context === null) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.context = context;
  }

  public render(): void {
    const canvas = this.options.canvas;
    const ctx = this.context;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawMap();
    this.drawEntities();
    this.drawFog();
    this.drawHud(computeHudLayout(canvas.width, canvas.height));
  }

  private drawMap(): void {
    const ctx = this.context;
    const world = this.options.world;
    const view = this.viewTileRect();
    for (let y = view.y; y < view.y + view.h; y += 1) {
      for (let x = view.x; x < view.x + view.w; x += 1) {
        if (x < 0 || y < 0 || x >= world.map.width || y >= world.map.height) {
          continue;
        }
        ctx.fillStyle = tileColor(getTile(world.map, x, y).kind);
        ctx.fillRect(...this.screenRect({ x, y, w: 1, h: 1 }));
      }
    }
  }

  private drawEntities(): void {
    for (const corpse of this.options.world.corpses) {
      this.context.globalAlpha = Math.max(0, corpse.remainingTicks / 80);
      this.context.fillStyle = '#34251d';
      this.fillCircle({ x: corpse.x, y: corpse.y }, 0.35);
      this.context.globalAlpha = 1;
    }
    for (const building of this.options.world.buildings.values()) {
      if (building.owner === 2 && !this.options.world.canSee(1, Math.floor(building.x), Math.floor(building.y))) {
        continue;
      }
      this.drawBuilding(building);
    }
    for (const unit of this.options.world.units.values()) {
      if (unit.owner === 2 && !this.options.world.canSee(1, unit.tile.x, unit.tile.y)) {
        continue;
      }
      this.drawUnit(unit);
    }
    for (const projectile of this.options.world.projectiles) {
      this.context.fillStyle = '#ffd76a';
      this.fillCircle({ x: projectile.x, y: projectile.y }, 0.12);
    }
  }

  private drawBuilding(building: Building): void {
    const theme = FACTIONS[building.faction];
    const ctx = this.context;
    ctx.fillStyle = building.complete ? theme.dark : '#777777';
    ctx.fillRect(...this.screenRect({ x: building.x, y: building.y, w: building.w, h: building.h }));
    ctx.strokeStyle = theme.secondary;
    ctx.lineWidth = 2;
    ctx.strokeRect(...this.screenRect({ x: building.x, y: building.y, w: building.w, h: building.h }));
    this.drawHpBar({ x: building.x, y: building.y - 0.15 }, building.hp / buildingStats(building.kind).hp, building.w);
  }

  private drawUnit(unit: Unit): void {
    const theme = FACTIONS[unit.faction];
    this.context.fillStyle = theme.primary;
    this.fillCircle({ x: unit.x, y: unit.y }, unit.kind === 'heavy' ? 0.38 : 0.3);
    this.context.fillStyle = theme.secondary;
    if (unit.kind === 'ranged') {
      this.fillCircle({ x: unit.x + 0.12, y: unit.y - 0.12 }, 0.09);
    }
    if (this.options.world.selectedIds.has(unit.id)) {
      this.context.strokeStyle = '#ffffff';
      this.strokeCircle({ x: unit.x, y: unit.y }, 0.45);
    }
    this.drawHpBar({ x: unit.x - 0.35, y: unit.y - 0.55 }, unit.hp / unitStats(unit.faction, unit.kind).hp, 0.7);
  }

  private drawFog(): void {
    const ctx = this.context;
    const fog = mustGet(this.options.world.fog, 1, 'fog');
    const view = this.viewTileRect();
    for (let y = view.y; y < view.y + view.h; y += 1) {
      for (let x = view.x; x < view.x + view.w; x += 1) {
        if (x < 0 || y < 0 || x >= this.options.world.map.width || y >= this.options.world.map.height) {
          continue;
        }
        const index = y * this.options.world.map.width + x;
        if (fog.visible[index] === 0) {
          ctx.fillStyle = fog.explored[index] === 1 ? 'rgba(0,0,0,0.45)' : '#000000';
          ctx.fillRect(...this.screenRect({ x, y, w: 1, h: 1 }));
        }
      }
    }
  }

  private drawHud(layout: HudLayout): void {
    this.drawPanel(layout.resourceBar.rect, '#111927');
    const player = this.options.world.player(1);
    this.context.fillStyle = '#ffffff';
    this.context.font = '16px sans-serif';
    this.context.fillText(`Gold ${Math.floor(player.gold)}   Wood ${Math.floor(player.wood)}   Supply ${player.supplyUsed}/${player.supplyCap}   Seed ${this.options.world.seed}`, 12, 23);
    this.context.fillText(`${this.options.paused ? 'Paused' : 'Running'} ${this.options.speed}x`, layout.resourceBar.rect.w - 220, 23);
    this.drawMinimap(layout.minimap.rect);
    this.drawPanel(layout.selectionPanel.rect, '#1c2635');
    for (const button of layout.buttons) {
      this.drawPanel(button.rect, '#2e4058');
      this.context.fillStyle = '#ffffff';
      this.context.font = '11px sans-serif';
      this.context.fillText(button.label, button.rect.x + 4, button.rect.y + 23);
    }
    if (this.options.world.outcome !== 'playing') {
      this.drawOutcome();
    }
  }

  private drawMinimap(rect: Rect): void {
    this.drawPanel(rect, '#0b0d13');
    const world = this.options.world;
    const fog = mustGet(world.fog, 1, 'fog');
    const sx = rect.w / world.map.width;
    const sy = rect.h / world.map.height;
    for (let y = 0; y < world.map.height; y += 1) {
      for (let x = 0; x < world.map.width; x += 1) {
        const index = y * world.map.width + x;
        this.context.fillStyle = fog.explored[index] === 0 ? '#000000' : tileColor(getTile(world.map, x, y).kind);
        if (fog.visible[index] === 0 && fog.explored[index] === 1) {
          this.context.globalAlpha = 0.45;
        }
        this.context.fillRect(rect.x + x * sx, rect.y + y * sy, Math.max(1, sx), Math.max(1, sy));
        this.context.globalAlpha = 1;
      }
    }
    const view = this.viewTileRect();
    this.context.strokeStyle = '#ffffff';
    this.context.strokeRect(rect.x + view.x * sx, rect.y + view.y * sy, view.w * sx, view.h * sy);
  }

  private drawOutcome(): void {
    const canvas = this.options.canvas;
    this.context.fillStyle = 'rgba(0,0,0,0.7)';
    this.context.fillRect(0, 0, canvas.width, canvas.height);
    this.context.fillStyle = '#ffffff';
    this.context.font = '48px sans-serif';
    this.context.fillText(this.options.world.outcome === 'victory' ? 'Victory' : 'Defeat', canvas.width / 2 - 90, canvas.height / 2);
  }

  private drawPanel(rect: Rect, color: string): void {
    this.context.fillStyle = color;
    this.context.fillRect(rect.x, rect.y, rect.w, rect.h);
    this.context.strokeStyle = '#8592a3';
    this.context.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  private drawHpBar(point: Point, ratio: number, widthTiles: number): void {
    const [x, y, w] = this.screenRect({ x: point.x, y: point.y, w: widthTiles, h: 0.08 });
    this.context.fillStyle = '#440000';
    this.context.fillRect(x, y, w, 4);
    this.context.fillStyle = '#22cc44';
    this.context.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), 4);
  }

  private fillCircle(point: Point, radiusTiles: number): void {
    this.context.beginPath();
    this.context.arc((point.x - this.options.camera.x) * TILE_SIZE * this.options.camera.zoom, (point.y - this.options.camera.y) * TILE_SIZE * this.options.camera.zoom, radiusTiles * TILE_SIZE * this.options.camera.zoom, 0, Math.PI * 2);
    this.context.fill();
  }

  private strokeCircle(point: Point, radiusTiles: number): void {
    this.context.beginPath();
    this.context.arc((point.x - this.options.camera.x) * TILE_SIZE * this.options.camera.zoom, (point.y - this.options.camera.y) * TILE_SIZE * this.options.camera.zoom, radiusTiles * TILE_SIZE * this.options.camera.zoom, 0, Math.PI * 2);
    this.context.stroke();
  }

  private screenRect(rect: Rect): [number, number, number, number] {
    const scale = TILE_SIZE * this.options.camera.zoom;
    return [(rect.x - this.options.camera.x) * scale, (rect.y - this.options.camera.y) * scale, rect.w * scale, rect.h * scale];
  }

  private viewTileRect(): Rect {
    const scale = TILE_SIZE * this.options.camera.zoom;
    return { x: Math.floor(this.options.camera.x), y: Math.floor(this.options.camera.y), w: Math.ceil(this.options.canvas.width / scale) + 1, h: Math.ceil(this.options.canvas.height / scale) + 1 };
  }
}

function tileColor(kind: string): string {
  switch (kind) {
    case 'grass': return '#2d8a33';
    case 'dirt': return '#8a6a3a';
    case 'forest': return '#0d4f1b';
    case 'water': return '#1c5f9e';
    case 'rock': return '#686868';
    case 'goldMine': return '#d7ad35';
    case 'depletedMine': return '#76664e';
    default: return '#000000';
  }
}
