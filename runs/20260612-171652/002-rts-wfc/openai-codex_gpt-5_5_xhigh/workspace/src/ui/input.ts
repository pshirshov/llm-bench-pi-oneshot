import { TILE_SIZE } from '../sim/constants';
import { getTile } from '../sim/map/tiles';
import type { BuildingKind, Point, Rect } from '../sim/types';
import { selectAt, selectBox, entityAtWorld } from '../sim/worldAccess';
import type { World } from '../sim/world';
import { computeHudLayout, hitTest, type HudElement } from './layout';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasRectSource {
  getRect(): Rect;
}

export interface InputOptions {
  canvas: HTMLCanvasElement;
  world: World;
  camera: CameraState;
  rectSource?: CanvasRectSource;
  onPauseToggle?: () => void;
  onSpeedToggle?: () => void;
}

interface DragState {
  startScreen: Point;
  startWorld: Point;
  additive: boolean;
}

const dragThreshold = 5;

export class InputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly world: World;
  private readonly camera: CameraState;
  private readonly rectSource: CanvasRectSource;
  private readonly onPauseToggle?: () => void;
  private readonly onSpeedToggle?: () => void;
  private drag?: DragState;
  private pendingBuild?: BuildingKind;

  public constructor(options: InputOptions) {
    this.canvas = options.canvas;
    this.world = options.world;
    this.camera = options.camera;
    this.rectSource = options.rectSource ?? { getRect: () => domRectToRect(this.canvas.getBoundingClientRect()) };
    this.onPauseToggle = options.onPauseToggle;
    this.onSpeedToggle = options.onSpeedToggle;
  }

  public bind(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  public unbind(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    const screen = this.toCanvasPoint(event);
    const layout = computeHudLayout(this.canvasWidth(), this.canvasHeight());
    const hud = hitTest(layout, screen.x, screen.y);
    if (hud !== undefined) {
      this.handleHud(hud, screen);
      return;
    }
    if (event.button === 0) {
      this.drag = { startScreen: screen, startWorld: this.screenToWorld(screen), additive: event.shiftKey };
    } else if (event.button === 2) {
      this.issueContextOrder(this.screenToWorld(screen));
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const rect = this.rectSource.getRect();
    const margin = 18;
    if (event.clientX - rect.x < margin) {
      this.camera.x = Math.max(0, this.camera.x - 0.5);
    } else if (rect.x + rect.w - event.clientX < margin) {
      this.camera.x += 0.5;
    }
    if (event.clientY - rect.y < margin) {
      this.camera.y = Math.max(0, this.camera.y - 0.5);
    } else if (rect.y + rect.h - event.clientY < margin) {
      this.camera.y += 0.5;
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    const drag = this.drag;
    this.drag = undefined;
    if (event.button !== 0 || drag === undefined) {
      return;
    }
    const screen = this.toCanvasPoint(event);
    const worldPoint = this.screenToWorld(screen);
    if (this.pendingBuild !== undefined) {
      this.confirmBuild(worldPoint);
      return;
    }
    if (Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) < dragThreshold) {
      selectAt(this.world, worldPoint, drag.additive);
      return;
    }
    selectBox(this.world, worldRect(drag.startWorld, worldPoint), drag.additive);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.issueContextOrder(this.screenToWorld(this.toCanvasPoint(event)));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const digit = Number.parseInt(event.key, 10);
    if (event.key === ' ') {
      this.onPauseToggle?.();
      return;
    }
    if (event.key === 'ArrowLeft') {
      this.camera.x = Math.max(0, this.camera.x - 1);
    } else if (event.key === 'ArrowRight') {
      this.camera.x += 1;
    } else if (event.key === 'ArrowUp') {
      this.camera.y = Math.max(0, this.camera.y - 1);
    } else if (event.key === 'ArrowDown') {
      this.camera.y += 1;
    } else if (digit >= 1 && digit <= 9) {
      if (event.ctrlKey) {
        this.world.controlGroups.set(digit, Array.from(this.world.selectedIds));
      } else {
        this.world.selectedIds.clear();
        for (const id of this.world.controlGroups.get(digit) ?? []) {
          if (this.world.units.has(id) || this.world.buildings.has(id)) {
            this.world.selectedIds.add(id);
          }
        }
      }
    }
  };

  private handleHud(hud: HudElement, screen: Point): void {
    if (hud.kind === 'minimap') {
      this.camera.x = Math.max(0, ((screen.x - hud.rect.x) / hud.rect.w) * this.world.map.width - 10);
      this.camera.y = Math.max(0, ((screen.y - hud.rect.y) / hud.rect.h) * this.world.map.height - 8);
      return;
    }
    if (hud.action?.type === 'train') {
      for (const id of this.world.selectedIds) {
        this.world.enqueueTraining(id, hud.action.unit);
      }
    } else if (hud.action?.type === 'build') {
      this.pendingBuild = hud.action.building;
    } else if (hud.action?.type === 'pause') {
      this.onPauseToggle?.();
    } else if (hud.action?.type === 'speed') {
      this.onSpeedToggle?.();
    }
  }

  private issueContextOrder(worldPoint: Point): void {
    if (this.pendingBuild !== undefined) {
      this.confirmBuild(worldPoint);
      return;
    }
    const entity = entityAtWorld(this.world, worldPoint);
    const selectedUnits = Array.from(this.world.selectedIds).filter(id => this.world.units.has(id));
    if (entity !== undefined && entity.owner !== 1) {
      for (const id of selectedUnits) {
        this.world.issueAttack(id, entity.id);
      }
      return;
    }
    const tile = { x: Math.floor(worldPoint.x), y: Math.floor(worldPoint.y) };
    if (tile.x >= 0 && tile.y >= 0 && tile.x < this.world.map.width && tile.y < this.world.map.height) {
      const tileData = getTile(this.world.map, tile.x, tile.y);
      if (tileData.kind === 'goldMine' || tileData.kind === 'forest') {
        for (const id of selectedUnits) {
          this.world.issueHarvest(id, tile);
        }
        return;
      }
    }
    if (entity !== undefined && entity.owner === 1 && entity.type === 'building') {
      for (const id of selectedUnits) {
        this.world.issueRepair(id, entity.id);
      }
      return;
    }
    this.world.issueMove(selectedUnits, tile);
  }

  private confirmBuild(worldPoint: Point): void {
    const building = this.pendingBuild;
    this.pendingBuild = undefined;
    if (building === undefined) {
      return;
    }
    const worker = Array.from(this.world.selectedIds).find(id => this.world.units.get(id)?.kind === 'worker');
    if (worker !== undefined) {
      this.world.issueBuild(worker, building, { x: Math.floor(worldPoint.x), y: Math.floor(worldPoint.y) });
    }
  }

  private toCanvasPoint(event: MouseEvent): Point {
    const rect = this.rectSource.getRect();
    const width = this.canvasWidth();
    const height = this.canvasHeight();
    return { x: ((event.clientX - rect.x) / rect.w) * width, y: ((event.clientY - rect.y) / rect.h) * height };
  }

  private screenToWorld(point: Point): Point {
    return { x: this.camera.x + point.x / (TILE_SIZE * this.camera.zoom), y: this.camera.y + point.y / (TILE_SIZE * this.camera.zoom) };
  }

  private canvasWidth(): number {
    return this.canvas.width > 0 ? this.canvas.width : this.rectSource.getRect().w;
  }

  private canvasHeight(): number {
    return this.canvas.height > 0 ? this.canvas.height : this.rectSource.getRect().h;
  }
}

function worldRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function domRectToRect(rect: DOMRect): Rect {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}
