import type { Vec2 } from "../core/vec.js";
import { FIXED_DT, MAX_STEPS_PER_FRAME, TILE_SIZE } from "../sim/config.js";
import { canBuildBuilding, cancelLastTrain, enqueueTrain, requirementsMet } from "../sim/behaviors.js";
import { type Building, createBuilding, type Entity, type Unit } from "../sim/entity.js";
import {
  orderAttack,
  orderAttackMove,
  orderBuild,
  orderHarvest,
  orderMove,
  orderRepair,
  stopUnit,
} from "../sim/orders.js";
import { stepWorld } from "../sim/simulation.js";
import {
  BUILDING_REQUIREMENTS,
  BUILDING_STATS,
  type BuildingRole,
  UnitRole,
} from "../sim/stats.js";
import type { GameInit } from "../sim/setup.js";
import type { World } from "../sim/world.js";
import { Camera } from "../render/camera.js";
import { computeLayout, type Layout, pointInRect } from "../render/layout.js";
import { Minimap } from "../render/minimap.js";
import { Renderer } from "../render/renderer.js";
import { type HudAction, type HudButton, Hud, type HudView } from "../ui/hud.js";
import type { DragBox, GameSpeed, PlacementState } from "./types.js";

const CAMERA_KEYS_SPEED = 22; // tiles/sec
const EDGE_SCROLL_MARGIN = 12;
const DRAG_THRESHOLD = 5; // px before a click becomes a box-select

export interface SessionCallbacks {
  onEnd(result: "won" | "lost"): void;
  onMenu(): void;
}

/** Owns one live match: world, camera, rendering, input translation, and the fixed-timestep loop. */
export class GameSession {
  readonly world: World;
  private readonly cam: Camera;
  private readonly renderer: Renderer;
  private readonly minimap: Minimap;
  private readonly hud: Hud;
  private layout: Layout;

  readonly selection = new Set<number>();
  private readonly controlGroups = new Map<number, number[]>();
  placement: PlacementState | null = null;
  dragBox: DragBox | null = null;
  private dragStart: { x: number; y: number } | null = null;
  hover: Vec2 | null = null;
  private hoveredButton: HudButton | null = null;
  private buttons: HudButton[] = [];

  paused = false;
  speed: GameSpeed = 1;
  private accumulator = 0;
  private ended = false;
  private attackMoveArmed = false;

  private readonly keys = new Set<string>();
  private mouseScreen: { x: number; y: number } | null = null;
  private minimapDragging = false;

  private readonly seed: number;
  private readonly levelLabel: string;

  constructor(
    ctx: CanvasRenderingContext2D,
    init: GameInit,
    seed: number,
    levelLabel: string,
    private readonly callbacks: SessionCallbacks,
    width: number,
    height: number,
  ) {
    this.world = init.world;
    this.seed = seed;
    this.levelLabel = levelLabel;
    this.layout = computeLayout(width, height);
    this.cam = new Camera(TILE_SIZE, this.layout.viewport);
    this.cam.centerOn(init.playerStart, this.world.map.width, this.world.map.height);
    this.renderer = new Renderer(ctx);
    this.minimap = new Minimap(this.world.map.width, this.world.map.height);
    this.hud = new Hud();
  }

  resize(width: number, height: number): void {
    this.layout = computeLayout(width, height);
    this.cam.setViewport(this.layout.viewport);
    this.cam.clamp(this.world.map.width, this.world.map.height);
  }

  // ---- main loop hooks ----

  update(realDt: number): void {
    this.updateCamera(realDt);

    if (!this.paused && this.world.status === "playing") {
      this.accumulator += realDt * this.speed;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepWorld(this.world, FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (this.accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    this.pruneSelection();

    if (!this.ended && this.world.status !== "playing") {
      this.ended = true;
      this.callbacks.onEnd(this.world.status === "won" ? "won" : "lost");
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.layout.canvas.w, this.layout.canvas.h);

    const view = this.hudView();
    this.buttons = this.hud.computeButtons(this.world, this.layout, this.selection, view);

    this.renderer.draw(this.world, this.cam, this.layout, {
      selection: this.selection,
      placement: this.placement,
      dragBox: this.dragBox,
      hover: this.hover,
      now: this.world.time,
    });
    this.minimap.draw(ctx, this.world, this.cam, this.layout.minimap);
    this.hud.draw(ctx, this.world, this.layout, this.selection, view, this.buttons, this.hoveredButton);
  }

  private hudView(): HudView {
    return { paused: this.paused, speed: this.speed, seed: this.seed, levelLabel: this.levelLabel };
  }

  private updateCamera(dt: number): void {
    const mw = this.world.map.width;
    const mh = this.world.map.height;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) dx -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) dx += 1;
    if (this.keys.has("arrowup") || this.keys.has("w")) dy -= 1;
    if (this.keys.has("arrowdown") || this.keys.has("s")) dy += 1;

    // Edge scrolling when the mouse is inside the viewport.
    const m = this.mouseScreen;
    if (m && pointInRect(m.x, m.y, this.layout.viewport)) {
      if (m.x - this.layout.viewport.x < EDGE_SCROLL_MARGIN) dx -= 1;
      if (this.layout.viewport.x + this.layout.viewport.w - m.x < EDGE_SCROLL_MARGIN) dx += 1;
      if (m.y - this.layout.viewport.y < EDGE_SCROLL_MARGIN) dy -= 1;
      if (this.layout.viewport.y + this.layout.viewport.h - m.y < EDGE_SCROLL_MARGIN) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      this.cam.pan(dx * CAMERA_KEYS_SPEED * dt, dy * CAMERA_KEYS_SPEED * dt, mw, mh);
    }
  }

  private pruneSelection(): void {
    for (const id of [...this.selection]) {
      if (!this.world.getEntity(id)) this.selection.delete(id);
    }
  }

  // ---- input entry points (called by InputController) ----

  onKeyDown(key: string, ctrl: boolean): void {
    const k = key.toLowerCase();
    this.keys.add(k);
    if (k === " ") {
      this.paused = !this.paused;
      return;
    }
    if (k === "escape") {
      this.cancelPlacement();
      this.attackMoveArmed = false;
      return;
    }
    if (k === "a" && this.selection.size > 0) {
      // Arm attack-move (only if we actually own military/units).
      this.attackMoveArmed = true;
    }
    if (k === "h") {
      for (const u of this.selectedOwnUnits()) stopUnit(u);
    }
    if (k >= "1" && k <= "9") {
      const group = Number(k);
      if (ctrl) this.assignControlGroup(group);
      else this.recallControlGroup(group);
    }
  }

  onKeyUp(key: string): void {
    this.keys.delete(key.toLowerCase());
  }

  /** Mouse left the canvas: stop edge-scrolling and clear hover. */
  setMouseInactive(): void {
    this.mouseScreen = null;
    this.hover = null;
  }

  onMouseMove(sx: number, sy: number, leftDown: boolean): void {
    this.mouseScreen = { x: sx, y: sy };
    this.hover = this.cam.screenToWorld(sx, sy);
    this.hoveredButton = this.hud.hitTest(this.buttons, sx, sy);

    if (this.minimapDragging && pointInRect(sx, sy, this.layout.minimap)) {
      this.jumpCameraToMinimap(sx, sy);
    }

    if (this.dragStart && leftDown) {
      const dist = Math.hypot(sx - this.dragStart.x, sy - this.dragStart.y);
      if (dist > DRAG_THRESHOLD) {
        this.dragBox = { x0: this.dragStart.x, y0: this.dragStart.y, x1: sx, y1: sy };
      }
    }
  }

  onLeftDown(sx: number, sy: number, shift: boolean): void {
    // HUD buttons first.
    const btn = this.hud.hitTest(this.buttons, sx, sy);
    if (btn) {
      if (btn.enabled) this.dispatchHud(btn.action);
      return;
    }
    if (pointInRect(sx, sy, this.layout.minimap)) {
      this.minimapDragging = true;
      this.jumpCameraToMinimap(sx, sy);
      return;
    }
    if (!pointInRect(sx, sy, this.layout.viewport)) return;

    const world = this.cam.screenToWorld(sx, sy);
    if (this.placement) {
      this.confirmPlacement(world);
      return;
    }
    if (this.attackMoveArmed) {
      this.attackMoveArmed = false;
      this.issueAttackMove(world);
      return;
    }
    // Begin potential drag / click selection.
    this.dragStart = { x: sx, y: sy };
    this.pendingShift = shift;
  }

  private pendingShift = false;

  onLeftUp(sx: number, sy: number, shift: boolean): void {
    this.minimapDragging = false;
    if (this.dragBox) {
      this.boxSelect(this.dragBox, shift || this.pendingShift);
      this.dragBox = null;
      this.dragStart = null;
      return;
    }
    if (this.dragStart) {
      this.clickSelect(this.cam.screenToWorld(sx, sy), shift || this.pendingShift);
      this.dragStart = null;
    }
  }

  onRightDown(sx: number, sy: number): void {
    if (this.placement) {
      this.cancelPlacement();
      return;
    }
    if (this.attackMoveArmed) {
      this.attackMoveArmed = false;
      return;
    }
    if (pointInRect(sx, sy, this.layout.minimap)) {
      this.issueRightClick(this.minimap.toWorld(this.layout.minimap, sx, sy));
      return;
    }
    if (!pointInRect(sx, sy, this.layout.viewport)) return;
    this.issueRightClick(this.cam.screenToWorld(sx, sy));
  }

  // ---- selection ----

  private clickSelect(world: Vec2, additive: boolean): void {
    const e = this.pickEntityAt(world, false);
    if (!additive) this.clearSelection();
    if (e) {
      if (additive && this.selection.has(e.id)) this.selection.delete(e.id);
      else this.selection.add(e.id);
    }
    this.syncSelectionFlags();
  }

  private boxSelect(box: DragBox, additive: boolean): void {
    if (!additive) this.clearSelection();
    const x0 = Math.min(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const x1 = Math.max(box.x0, box.x1);
    const y1 = Math.max(box.y0, box.y1);
    let pickedOwnUnits = false;
    for (const u of this.world.units.values()) {
      if (u.faction !== this.world.playerFaction) continue;
      const px = this.cam.worldToScreenX(u.pos.x);
      const py = this.cam.worldToScreenY(u.pos.y);
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
        this.selection.add(u.id);
        pickedOwnUnits = true;
      }
    }
    // If the box caught no units, allow selecting a single building inside it.
    if (!pickedOwnUnits) {
      for (const b of this.world.buildings.values()) {
        if (b.faction !== this.world.playerFaction) continue;
        const px = this.cam.worldToScreenX(b.origin.tx + b.footprint.w / 2);
        const py = this.cam.worldToScreenY(b.origin.ty + b.footprint.h / 2);
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
          this.selection.add(b.id);
          break;
        }
      }
    }
    this.syncSelectionFlags();
  }

  private pickEntityAt(world: Vec2, preferEnemy: boolean): Entity | null {
    void preferEnemy;
    // Units first (topmost feel), then buildings.
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.world.units.values()) {
      const isOwn = u.faction === this.world.playerFaction;
      const visible = isOwn || this.isVisible(u.pos);
      if (!visible) continue;
      const d = Math.hypot(u.pos.x - world.x, u.pos.y - world.y);
      if (d <= 0.6 && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) return best;
    for (const b of this.world.buildings.values()) {
      const isOwn = b.faction === this.world.playerFaction;
      if (!isOwn && !this.isExplored(b)) continue;
      if (
        world.x >= b.origin.tx &&
        world.x < b.origin.tx + b.footprint.w &&
        world.y >= b.origin.ty &&
        world.y < b.origin.ty + b.footprint.h
      ) {
        return b;
      }
    }
    return null;
  }

  private isVisible(p: Vec2): boolean {
    return this.world.fog.isVisible(Math.floor(p.x), Math.floor(p.y));
  }
  private isExplored(b: Building): boolean {
    return this.world.fog.isExplored(b.origin.tx, b.origin.ty);
  }

  private clearSelection(): void {
    this.selection.clear();
  }

  private syncSelectionFlags(): void {
    for (const u of this.world.units.values()) u.selected = this.selection.has(u.id);
    for (const b of this.world.buildings.values()) b.selected = this.selection.has(b.id);
  }

  private selectedOwnUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.selection) {
      const e = this.world.getEntity(id);
      if (e && e.kind === "unit" && e.faction === this.world.playerFaction) out.push(e);
    }
    return out;
  }

  private selectedOwnBuildings(): Building[] {
    const out: Building[] = [];
    for (const id of this.selection) {
      const e = this.world.getEntity(id);
      if (e && e.kind === "building" && e.faction === this.world.playerFaction) out.push(e);
    }
    return out;
  }

  // ---- control groups ----

  private assignControlGroup(group: number): void {
    this.controlGroups.set(group, [...this.selection]);
  }

  private recallControlGroup(group: number): void {
    const ids = this.controlGroups.get(group);
    if (!ids) return;
    this.clearSelection();
    for (const id of ids) if (this.world.getEntity(id)) this.selection.add(id);
    this.syncSelectionFlags();
  }

  // ---- orders ----

  private issueRightClick(world: Vec2): void {
    const units = this.selectedOwnUnits();
    const buildings = this.selectedOwnBuildings();
    if (units.length === 0 && buildings.length > 0) {
      // Set rally point for producers.
      for (const b of buildings) b.rally = { x: world.x, y: world.y };
      return;
    }
    const target = this.pickEntityAt(world, true);
    const tile = { tx: Math.floor(world.x), ty: Math.floor(world.y) };
    for (const u of units) {
      if (target && target.faction !== this.world.playerFaction) {
        orderAttack(this.world, u, target.id);
      } else if (target && target.kind === "building" && target.faction === this.world.playerFaction) {
        if (u.role === UnitRole.Worker && !target.constructed) orderBuild(this.world, u, target.id);
        else if (u.role === UnitRole.Worker && target.hp < target.maxHp) orderRepair(this.world, u, target.id);
        else orderMove(this.world, u, world);
      } else if (u.role === UnitRole.Worker && this.world.map.isGoldMine(tile.tx, tile.ty)) {
        orderHarvest(this.world, u, tile, "gold");
      } else if (u.role === UnitRole.Worker && this.world.map.isForest(tile.tx, tile.ty)) {
        orderHarvest(this.world, u, tile, "wood");
      } else {
        orderMove(this.world, u, world);
      }
    }
  }

  private issueAttackMove(world: Vec2): void {
    for (const u of this.selectedOwnUnits()) orderAttackMove(this.world, u, world);
  }

  // ---- HUD actions ----

  private dispatchHud(action: HudAction): void {
    switch (action.kind) {
      case "togglePause":
        this.paused = !this.paused;
        break;
      case "toggleSpeed":
        this.speed = this.speed === 1 ? 2 : 1;
        break;
      case "menu":
        this.callbacks.onMenu();
        break;
      case "train": {
        const producer = this.selectedOwnBuildings().find(
          (b) => b.constructed && BUILDING_STATS[b.role].trains.includes(action.role),
        );
        if (producer) enqueueTrain(this.world, producer, action.role);
        break;
      }
      case "cancelTrain": {
        const producer = this.selectedOwnBuildings().find((b) => b.trainingQueue.length > 0);
        if (producer) cancelLastTrain(this.world, producer);
        break;
      }
      case "build":
        this.beginPlacement(action.role);
        break;
    }
  }

  private beginPlacement(role: BuildingRole): void {
    if (!requirementsMet(this.world, this.world.playerFaction, BUILDING_REQUIREMENTS[role])) return;
    if (!canBuildBuilding(this.world, this.world.playerFaction, role).ok) return;
    const worker = this.selectedOwnUnits().find((u) => u.role === UnitRole.Worker);
    if (!worker) return;
    this.placement = { role, builderId: worker.id };
  }

  private confirmPlacement(world: Vec2): void {
    if (!this.placement) return;
    const role = this.placement.role;
    const stats = BUILDING_STATS[role];
    const tx = Math.floor(world.x);
    const ty = Math.floor(world.y);
    if (!this.world.map.canPlace(tx, ty, stats.footprint.w, stats.footprint.h)) return;
    if (!canBuildBuilding(this.world, this.world.playerFaction, role).ok) {
      this.cancelPlacement();
      return;
    }
    const worker = this.world.units.get(this.placement.builderId);
    if (!worker) {
      this.cancelPlacement();
      return;
    }
    const fs = this.world.factions[this.world.playerFaction];
    fs.gold -= stats.goldCost;
    fs.wood -= stats.woodCost;
    const site = createBuilding(this.world.playerFaction, role, { tx, ty }, false);
    this.world.addBuilding(site);
    orderBuild(this.world, worker, site.id);
    this.placement = null;
  }

  private cancelPlacement(): void {
    this.placement = null;
  }

  private jumpCameraToMinimap(sx: number, sy: number): void {
    const world = this.minimap.toWorld(this.layout.minimap, sx, sy);
    this.cam.centerOn(world, this.world.map.width, this.world.map.height);
  }
}
