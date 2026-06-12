/** Input handler: translates DOM events to simulation orders. No game logic here. */

import type { EntityId, BuildingType, UnitType } from "../sim/types";
import type { World } from "../sim/world";
import type { Viewport } from "../render/viewport";
import { computeLayout, computeSelectionButtons, type HUDLayout, type HUDButton, hitTest } from "./layout";
import { BUILDING_STATS } from "../sim/stats";

export type BuildMode = BuildingType | null;

export interface InputState {
  selectedIds: EntityId[];
  controlGroups: Map<number, EntityId[]>;
  buildMode: BuildMode;
  buildPreview: { col: number; row: number } | null;
  dragStart: { x: number; y: number } | null;
  dragEnd: { x: number; y: number } | null;
  isDragging: boolean;
  paused: boolean;
  speed: number;
  seed: number;
}

export function createInputState(seed: number): InputState {
  return {
    selectedIds: [],
    controlGroups: new Map(),
    buildMode: null,
    buildPreview: null,
    dragStart: null,
    dragEnd: null,
    isDragging: false,
    paused: false,
    speed: 1,
    seed,
  };
}

export interface InputCallbacks {
  getWorld: () => World;
  getViewport: () => Viewport;
  getCanvasRect: () => DOMRect;
  requestRedraw: () => void;
}

export class InputHandler {
  state: InputState;
  private callbacks: InputCallbacks;
  private canvas: HTMLCanvasElement | null = null;
  private layout: HUDLayout | null = null;
  private buttons: HUDButton[] = [];

  constructor(seed: number, callbacks: InputCallbacks) {
    this.state = createInputState(seed);
    this.callbacks = callbacks;
  }

  bind(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
    canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => this.onKeyDown(e));
    document.addEventListener("keyup", (e) => this.onKeyUp(e));
  }

  updateLayout(width: number, height: number): void {
    this.layout = computeLayout(width, height);
  }

  private onMouseDown(e: MouseEvent): void {
    const rect = this.callbacks.getCanvasRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (!this.layout) return;
    const elem = hitTest(sx, sy, this.layout, this.buttons);

    if (e.button === 0) {
      // Left click
      if (elem.type === "minimap") {
        // Click minimap to move viewport
        const vp = this.callbacks.getViewport();
        const mapX = (sx - this.layout.minimap.x) / this.layout.minimap.w * vp.mapWidth;
        const mapY = (sy - this.layout.minimap.y) / this.layout.minimap.h * vp.mapHeight;
        vp.centerOn(mapX, mapY);
      } else if (elem.type === "button") {
        this.onButtonClick(elem.id);
      } else if (elem.type === "game_area") {
        this.state.dragStart = { x: sx, y: sy };
        this.state.dragEnd = { x: sx, y: sy };
        this.state.isDragging = false;
      }
    } else if (e.button === 2) {
      // Right click — issue order
      this.onRightClick(sx, sy);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    const rect = this.callbacks.getCanvasRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.state.dragStart && !this.state.isDragging) {
      // Click select
      this.onLeftClick(sx, sy, e.shiftKey);
    } else if (this.state.isDragging && this.state.dragStart) {
      // Box select
      this.onBoxSelect(
        this.state.dragStart.x, this.state.dragStart.y,
        sx, sy, e.shiftKey
      );
    }
    this.state.dragStart = null;
    this.state.dragEnd = null;
    this.state.isDragging = false;
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.callbacks.getCanvasRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Build preview
    if (this.state.buildMode) {
      const vp = this.callbacks.getViewport();
      const tile = vp.screenToTile(sx, sy);
      this.state.buildPreview = tile;
    }

    // Drag
    if (this.state.dragStart) {
      this.state.dragEnd = { x: sx, y: sy };
      const dx = Math.abs(sx - this.state.dragStart.x);
      const dy = Math.abs(sy - this.state.dragStart.y);
      if (dx > 5 || dy > 5) this.state.isDragging = true;
    }

    // Edge scrolling
    if (this.canvas) {
      const vp = this.callbacks.getViewport();
      const margin = 20;
      if (sx < margin) vp.scroll(-1, 0);
      if (sx > this.canvas.width - margin) vp.scroll(1, 0);
      if (sy < margin) vp.scroll(0, -1);
      if (sy > this.canvas.height - margin) vp.scroll(0, 1);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const vp = this.callbacks.getViewport();
    switch (e.key) {
      case "ArrowLeft": case "a": vp.scroll(-1, 0); break;
      case "ArrowRight": case "d": vp.scroll(1, 0); break;
      case "ArrowUp": case "w": vp.scroll(0, -1); break;
      case "ArrowDown": case "s": vp.scroll(0, 1); break;
      case " ": this.state.paused = !this.state.paused; break;
      case "1": case "2": case "3": case "4": case "5":
      case "6": case "7": case "8": case "9":
        if (e.ctrlKey) {
          this.state.controlGroups.set(Number(e.key), [...this.state.selectedIds]);
        } else {
          const group = this.state.controlGroups.get(Number(e.key));
          if (group) this.state.selectedIds = [...group];
        }
        break;
      case "Escape": this.state.buildMode = null; this.state.buildPreview = null; break;
    }
  }

  private onKeyUp(_e: KeyboardEvent): void {
    // No-op for now
  }

  private onLeftClick(sx: number, sy: number, shift: boolean): void {
    const world = this.callbacks.getWorld();
    const vp = this.callbacks.getViewport();

    if (this.state.buildMode) {
      // Confirm building placement
      const tile = vp.screenToTile(sx, sy);
      if (this.state.selectedIds.length > 0 && world.canPlaceBuilding(this.state.buildMode, tile.col, tile.row)) {
        const workerId = this.state.selectedIds[0];
        world.buildBuilding(workerId, this.state.buildMode, tile);
        this.state.buildMode = null;
        this.state.buildPreview = null;
      }
      return;
    }

    const worldPos = vp.screenToWorld(sx, sy);
    const clicked = world.units.filter(u =>
      u.hp > 0 && dist(u.x, u.y, worldPos.x, worldPos.y) < 0.5
    );

    if (shift && clicked.length > 0) {
      this.state.selectedIds.push(...clicked.map(u => u.id));
    } else if (clicked.length > 0) {
      this.state.selectedIds = clicked.map(u => u.id);
    } else {
      // Check buildings
      const clickedBuilding = world.buildings.filter(b => {
        const bs = BUILDING_STATS[b.type];
        return b.hp > 0 &&
          worldPos.x >= b.col && worldPos.x < b.col + bs.width &&
          worldPos.y >= b.row && worldPos.y < b.row + bs.height;
      });
      if (clickedBuilding.length > 0) {
        this.state.selectedIds = [clickedBuilding[0].id];
      } else {
        this.state.selectedIds = [];
      }
    }
    this.updateButtons();
  }

  private onRightClick(sx: number, sy: number): void {
    const world = this.callbacks.getWorld();
    const vp = this.callbacks.getViewport();
    const worldPos = vp.screenToWorld(sx, sy);
    const tile = vp.screenToTile(sx, sy);

    for (const id of this.state.selectedIds) {
      const unit = world.units.find(u => u.id === id);
      if (!unit || unit.hp <= 0) continue;

      // Check if right-clicking on an enemy
      const enemy = world.units.find(u =>
        u.faction !== unit.faction && u.hp > 0 && dist(u.x, u.y, worldPos.x, worldPos.y) < 0.5
      );
      if (enemy) {
        world.issueOrder(id, { type: "attack", targetId: enemy.id });
        continue;
      }

      // Check if right-clicking on a resource
      if (unit.type === "worker") {
        const tileType = world.map.getTile(tile.col, tile.row);
        if (tileType === "gold_mine") {
          const mine = findMineAt(world, tile.col, tile.row);
          if (mine) {
            world.issueOrder(id, { type: "harvest", targetId: mine.id });
            continue;
          }
        } else if (tileType === "forest") {
          const forestId = tile.col + tile.row * 10000;
          world.issueOrder(id, { type: "harvest", targetId: forestId });
          continue;
        }
      }

      // Check if right-clicking on a friendly building for repair
      if (unit.type === "worker") {
        const bldg = world.buildings.find(b =>
          b.faction === unit.faction && b.hp > 0 && b.hp < b.maxHp &&
          worldPos.x >= b.col && worldPos.x < b.col + BUILDING_STATS[b.type].width &&
          worldPos.y >= b.row && worldPos.y < b.row + BUILDING_STATS[b.type].height
        );
        if (bldg) {
          world.issueOrder(id, { type: "repair", targetId: bldg.id });
          continue;
        }
      }

      // Default: move
      world.issueOrder(id, { type: "move", targetPos: worldPos });
    }
  }

  private onBoxSelect(x1: number, y1: number, x2: number, y2: number, shift: boolean): void {
    const world = this.callbacks.getWorld();
    const vp = this.callbacks.getViewport();
    const p1 = vp.screenToWorld(Math.min(x1, x2), Math.min(y1, y2));
    const p2 = vp.screenToWorld(Math.max(x1, x2), Math.max(y1, y2));

    const selected = world.units.filter(u =>
      u.hp > 0 && u.x >= p1.x && u.x <= p2.x && u.y >= p1.y && u.y <= p2.y
    );

    if (shift) {
      this.state.selectedIds.push(...selected.map(u => u.id));
    } else {
      this.state.selectedIds = selected.map(u => u.id);
    }
    this.updateButtons();
  }

  private onButtonClick(id: string): void {
    const world = this.callbacks.getWorld();
    if (id.startsWith("train_")) {
      const unitType = id.replace("train_", "");
      for (const sid of this.state.selectedIds) {
        world.trainUnit(sid, unitType as UnitType);
        break;
      }
    } else if (id.startsWith("build_")) {
      this.state.buildMode = id.replace("build_", "") as BuildingType;
    }
  }

  private updateButtons(): void {
    const world = this.callbacks.getWorld();
    const selected = this.state.selectedIds
      .map(id => world.units.find(u => u.id === id) ?? world.buildings.find(b => b.id === id))
      .filter(Boolean) as { type: string; faction: string; id: number }[];
    if (!this.layout) return;
    this.buttons = computeSelectionButtons(
      selected, this.layout.selectionPanel.x + this.layout.selectionPanel.w,
      this.layout.selectionPanel.y + this.layout.selectionPanel.h
    );
  }
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

function findMineAt(world: World, col: number, row: number): { id: number } | null {
  for (const mine of world.map.goldMines.values()) {
    if (mine.col === col && mine.row === row) return mine;
  }
  return null;
}