// Input layer: consumes DOM MouseEvent/KeyboardEvent and translates them into
// simulation orders. Contains no game logic of its own — only hit-tests, camera
// transforms, and order dispatch. The simulation itself decides what to do.
//
// The input layer is constructed with a canvas and a getRect function so it can
// be unit-tested under jsdom (no real layout, no real canvas).

import { World } from "../sim/world.js";
import { Faction, UnitKind, BuildingKind, getUnitStats, getBuildingStats } from "../sim/stats.js";
import { UnitEntity, BuildingEntity } from "../sim/entities.js";
import { isPlacementValid, issueOrder } from "../sim/orderHandler.js";
import { Order } from "../sim/orders.js";
import { findPath, octile } from "../sim/pathfinding.js";
import { TILE, isResourceTile, isWalkableTile } from "../sim/tiles.js";
import { computeHudLayout, hitTestButtons, hitTestMinimap, HudInputState, HudLayout } from "../ui/hudLayout.js";

export type OrderDispatchFn = (world: World, unitId: number, order: Order) => void;

export interface InputState {
  world: World;
  playerFaction: Faction;
  viewportW: number;
  viewportH: number;
  /** Camera offset in tile units (tile-coords of the top-left of the viewport). */
  camera: { x: number; y: number };
  /** Tile size in pixels. */
  tileSize: number;
  /** Issue-order function. Defaults to issueOrder. */
  dispatch?: OrderDispatchFn;
  /** Resolve camera transform. */
  rect?: () => { left: number; top: number; width: number; height: number };
}

export interface InputCallbacks {
  onCommand?: (cmd: { kind: "speed"; value: 1 | 2 } | { kind: "pause" } | { kind: "train"; unit: UnitKind } | { kind: "build"; building: BuildingKind; x: number; y: number } | { kind: "selectLevel"; index: number } | { kind: "selectFaction"; faction: Faction } | { kind: "continue" }) => void;
  onSelectionChange?: (selected: number[]) => void;
  onCameraChange?: (cam: { x: number; y: number }) => void;
}

export class InputManager {
  private state: InputState;
  private callbacks: InputCallbacks;
  private dragStart: { x: number; y: number } | null = null;
  private placingBuilding: BuildingKind | null = null;
  private selected: Set<number> = new Set();
  private controlGroups: Map<number, Set<number>> = new Map();

  constructor(state: InputState, callbacks: InputCallbacks = {}) {
    this.state = state;
    this.callbacks = callbacks;
  }

  setState(state: InputState): void {
    this.state = state;
  }

  setCallbacks(callbacks: InputCallbacks): void {
    this.callbacks = callbacks;
  }

  getSelected(): number[] {
    return Array.from(this.selected);
  }

  setSelected(ids: number[]): void {
    this.selected = new Set(ids);
    this.state.world.playerSelection = new Set(ids);
    this.callbacks.onSelectionChange?.(ids);
  }

  getHudLayout(): { layout: HudLayout; state: HudInputState } {
    const w = this.state.world;
    const selIds = this.getSelected();
    const units = w.unitEntities();
    const buildings = w.buildingEntities();
    const player = w.players[this.state.playerFaction];
    const hudState: HudInputState = {
      selectedIds: selIds,
      units,
      buildings,
      playerFaction: this.state.playerFaction,
      gold: player.gold,
      wood: player.wood,
      supplyUsed: player.supplyUsed,
      supplyCap: player.supplyCap,
      seed: w.rng.seed,
      tick: w.tick,
      speed: w.speed,
      paused: w.paused,
      levels: [],
      currentLevel: 0,
    };
    return { layout: computeHudLayout(this.state.viewportW, this.state.viewportH, hudState), state: hudState };
  }

  /** Convert a client (px) coordinate to a tile coordinate. */
  private clientToTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.state.rect ? this.state.rect() : { left: 0, top: 0, width: this.state.viewportW, height: this.state.viewportH };
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < 0 || py < 0 || px >= rect.width || py >= rect.height) return null;
    return {
      x: this.state.camera.x + px / this.state.tileSize,
      y: this.state.camera.y + py / this.state.tileSize,
    };
  }

  private dispatchOrder(unitIds: number[], order: Order): void {
    const fn = this.state.dispatch ?? issueOrder;
    for (const id of unitIds) fn(this.state.world, id, order);
  }

  onMouseDown(ev: { clientX: number; clientY: number; button: number; shiftKey: boolean }): void {
    if (ev.button === 0) {
      this.dragStart = { x: ev.clientX, y: ev.clientY };
    }
  }

  onMouseUp(ev: { clientX: number; clientY: number; button: number; shiftKey: boolean }): void {
    if (ev.button !== 0) {
      this.dragStart = null;
      return;
    }
    const rect = this.state.rect ? this.state.rect() : { left: 0, top: 0, width: this.state.viewportW, height: this.state.viewportH };
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const { layout } = this.getHudLayout();
    // HUD hit-test first.
    const button = hitTestButtons(layout, px, py);
    if (button && button.enabled) {
      if (button.kind === "train") {
        const k = button.entityKind as UnitKind;
        // Enqueue training on each selected building of the right kind, or
        // the player's barracks/town hall if no building selected.
        const w = this.state.world;
        const faction = this.state.playerFaction;
        const buildings = w.buildingsOf(faction).filter((b) => b.construction >= 1);
        let target: BuildingEntity | null = null;
        if (k === "worker") target = buildings.find((b) => b.buildingKind === "townhall") ?? null;
        else if (k === "melee") target = buildings.find((b) => b.buildingKind === "barracks") ?? null;
        else {
          target = buildings.find((b) => b.buildingKind === "lumbermill") ?? null;
          if (!target) target = buildings.find((b) => b.buildingKind === "barracks") ?? null;
        }
        if (target) {
          // Deduct cost and enqueue.
          const stats = getUnitStats(faction, k);
          w.players[faction].gold -= stats.goldCost;
          w.players[faction].wood -= stats.woodCost;
          target.trainQueue.push({ unit: k, progress: 0, total: stats.trainTime });
        }
      } else if (button.kind === "build") {
        this.placingBuilding = button.entityKind as BuildingKind;
      } else if (button.kind === "speed") {
        const v = button.id === "speed-1" ? 1 : 2;
        this.state.world.speed = v as 1 | 2;
        this.callbacks.onCommand?.({ kind: "speed", value: v as 1 | 2 });
      } else if (button.kind === "pause") {
        this.state.world.paused = !this.state.world.paused;
        this.callbacks.onCommand?.({ kind: "pause" });
      }
      this.dragStart = null;
      return;
    }
    if (hitTestMinimap(layout, px, py)) {
      // Click on minimap moves the camera.
      this.handleMinimapClick(px, py);
      this.dragStart = null;
      return;
    }
    // Build placement preview.
    if (this.placingBuilding) {
      const tile = this.clientToTile(ev.clientX, ev.clientY);
      if (tile) {
        const ix = Math.floor(tile.x);
        const iy = Math.floor(tile.y);
        const stats = getBuildingStats(this.state.playerFaction, this.placingBuilding);
        const valid = isPlacementValid(this.state.world, ix, iy, stats.footprint.w, stats.footprint.h, this.state.playerFaction);
        if (valid) {
          // Find an idle worker.
          const worker = this.state.world.unitsOf(this.state.playerFaction).find((u) => u.unitKind === "worker" && u.orderState.phase === "idle");
          if (worker) {
            const ok = issueOrder(this.state.world, worker.id, { kind: "build", building: this.placingBuilding, x: ix, y: iy });
            if (ok) this.placingBuilding = null;
          }
        }
      }
      this.dragStart = null;
      return;
    }
    // World click: select.
    if (this.dragStart) {
      const dx = Math.abs(ev.clientX - this.dragStart.x);
      const dy = Math.abs(ev.clientY - this.dragStart.y);
      if (dx <= 4 && dy <= 4) {
        this.handleSingleClick(px, py, ev.shiftKey);
      } else {
        this.handleBoxSelect(px, py, ev.shiftKey);
      }
    }
    this.dragStart = null;
  }

  onMouseMove(_ev: { clientX: number; clientY: number }): void {
    // Drag tracking is unused; the mouseup computes end-of-drag from the
    // recorded dragStart.
  }

  onContextMenu(ev: { clientX: number; clientY: number; preventDefault: () => void }): void {
    ev.preventDefault();
    const rect = this.state.rect ? this.state.rect() : { left: 0, top: 0, width: this.state.viewportW, height: this.state.viewportH };
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    if (this.placingBuilding) {
      this.placingBuilding = null;
      return;
    }
    const { layout } = this.getHudLayout();
    if (hitTestButtons(layout, px, py)) return;
    if (hitTestMinimap(layout, px, py)) return;
    // Right-click on world: issue move/attack/harvest.
    const tile = this.clientToTile(ev.clientX, ev.clientY);
    if (!tile) return;
    const tx = Math.floor(tile.x);
    const ty = Math.floor(tile.y);
    if (!this.state.world.map.inBounds(tx, ty)) return;
    const targetTile = this.state.world.map.get(tx, ty);
    const targetEntity = this.findEntityAtScreen(px, py);
    const selIds = this.getSelected();
    if (selIds.length === 0) return;
    if (targetEntity) {
      if (targetEntity.faction !== this.state.playerFaction) {
        // Attack.
        for (const id of selIds) {
          this.dispatchOrder([id], { kind: "attack", target: targetEntity.id });
        }
        return;
      }
    }
    if (isResourceTile(targetTile)) {
      // Harvest order (workers only).
      for (const id of selIds) {
        const u = this.state.world.entities.get(id);
        if (u && u.kind === "unit" && u.unitKind === "worker") {
          this.dispatchOrder([id], { kind: "harvest", tx, ty });
        }
      }
      return;
    }
    // Move.
    for (const id of selIds) {
      this.dispatchOrder([id], { kind: "move", x: tx, y: ty });
    }
  }

  onKeyDown(ev: { code: string; ctrlKey: boolean; key: string; shiftKey: boolean }): void {
    const w = this.state.world;
    if (ev.code === "Space") {
      w.paused = !w.paused;
      if (typeof (ev as unknown as { preventDefault?: () => void }).preventDefault === "function") {
        (ev as unknown as { preventDefault: () => void }).preventDefault();
      }
      return;
    }
    if (ev.code === "Digit1" && !ev.ctrlKey) { w.speed = 1; return; }
    if (ev.code === "Digit2" && !ev.ctrlKey) { w.speed = 2; return; }
    if (ev.code === "Escape") {
      this.placingBuilding = null;
      this.setSelected([]);
      return;
    }
    if (ev.code.startsWith("Digit") && ev.ctrlKey) {
      const n = parseInt(ev.code.slice(5), 10);
      if (n >= 0 && n <= 9) {
        if (ev.shiftKey) {
          // Assign current selection to group n.
          this.controlGroups.set(n, new Set(this.getSelected()));
          w.controlGroups.set(n, new Set(this.getSelected()));
        } else {
          // Recall group n.
          const g = this.controlGroups.get(n) ?? w.controlGroups.get(n);
          if (g) this.setSelected(Array.from(g));
        }
      }
      return;
    }
    // Arrow keys: pan camera.
    const pan = 2;
    if (ev.code === "ArrowLeft") { this.state.camera.x -= pan; this.callbacks.onCameraChange?.(this.state.camera); return; }
    if (ev.code === "ArrowRight") { this.state.camera.x += pan; this.callbacks.onCameraChange?.(this.state.camera); return; }
    if (ev.code === "ArrowUp") { this.state.camera.y -= pan; this.callbacks.onCameraChange?.(this.state.camera); return; }
    if (ev.code === "ArrowDown") { this.state.camera.y += pan; this.callbacks.onCameraChange?.(this.state.camera); return; }
  }

  private handleSingleClick(px: number, py: number, shift: boolean): void {
    const entity = this.findEntityAtScreen(px, py);
    if (entity) {
      const id = entity.id;
      if (shift) {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
      } else {
        this.selected.clear();
        this.selected.add(id);
      }
      this.callbacks.onSelectionChange?.(Array.from(this.selected));
    } else if (!shift) {
      this.setSelected([]);
    }
  }

  private handleBoxSelect(px: number, py: number, shift: boolean): void {
    if (!this.dragStart) return;
    const rect = this.state.rect ? this.state.rect() : { left: 0, top: 0, width: this.state.viewportW, height: this.state.viewportH };
    const x0 = Math.min(this.dragStart.x, px) - rect.left;
    const y0 = Math.min(this.dragStart.y, py) - rect.top;
    const x1 = Math.max(this.dragStart.x, px) - rect.left;
    const y1 = Math.max(this.dragStart.y, py) - rect.top;
    const inBox: number[] = [];
    for (const e of this.state.world.unitEntities()) {
      if (e.faction !== this.state.playerFaction) continue;
      const ex = (e.x - this.state.camera.x) * this.state.tileSize + this.state.tileSize / 2;
      const ey = (e.y - this.state.camera.y) * this.state.tileSize + this.state.tileSize / 2;
      if (ex >= x0 && ex < x1 && ey >= y0 && ey < y1) inBox.push(e.id);
    }
    if (!shift) this.selected.clear();
    for (const id of inBox) this.selected.add(id);
    this.callbacks.onSelectionChange?.(Array.from(this.selected));
  }

  private findEntityAtScreen(px: number, py: number): UnitEntity | BuildingEntity | null {
    const ts = this.state.tileSize;
    const w = this.state.world;
    let best: UnitEntity | BuildingEntity | null = null;
    let bestD = Infinity;
    for (const e of w.unitEntities()) {
      if (e.faction !== this.state.playerFaction) continue;
      const ex = (e.x + e.subX - this.state.camera.x) * ts;
      const ey = (e.y + e.subY - this.state.camera.y) * ts;
      const d = Math.hypot(px - ex, py - ey);
      if (d < ts * 0.5 && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    for (const b of w.buildingEntities()) {
      if (b.faction !== this.state.playerFaction) continue;
      const ex = (b.x - this.state.camera.x) * ts + (ts * 1.5);
      const ey = (b.y - this.state.camera.y) * ts + (ts * 1.5);
      const d = Math.hypot(px - ex, py - ey);
      if (d < ts * 1.5 && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private handleMinimapClick(px: number, py: number): void {
    const { layout } = this.getHudLayout();
    const m = layout.minimap;
    const map = this.state.world.map;
    const fx = (px - m.x) / m.w;
    const fy = (py - m.y) / m.h;
    const cam = this.state.camera;
    const ts = this.state.tileSize;
    const visW = this.state.viewportW / ts;
    const visH = this.state.viewportH / ts;
    cam.x = Math.max(0, Math.min(map.width - visW, fx * map.width - visW / 2));
    cam.y = Math.max(0, Math.min(map.height - visH, fy * map.height - visH / 2));
    this.callbacks.onCameraChange?.(cam);
  }

  isPlacingBuilding(): BuildingKind | null {
    return this.placingBuilding;
  }
}

void findPath;
void octile;
void TILE;
void isWalkableTile;
void isResourceTile;
