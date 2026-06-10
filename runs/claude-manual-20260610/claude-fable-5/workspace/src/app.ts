import { createAi, tickAi, AiState } from './game/ai';
import {
  canPlaceBuilding,
  createGame,
  placeBuilding,
  issueOrder,
  smartOrder,
  trainUnit,
} from './game/commands';
import { BUILDING_STATS, BuildingType, Faction, UnitType, UNIT_RADIUS } from './game/data';
import { updateFog } from './game/fog';
import { createSimContext, SimContext, tickGame } from './game/sim';
import { distToBuilding, findBuilding, GameResult, GameState, TICK_DT, Unit } from './game/state';
import { HudLayout, HudRenderer, PANEL_H, TOP_BAR_H } from './render/hud';
import { Camera, renderWorld, TILE } from './render/render';

const EDGE_SCROLL_MARGIN = 14; // px
const SCROLL_SPEED = 22; // tiles per second
const MAX_TICKS_PER_FRAME = 10;
const DRAG_THRESHOLD = 5; // px before a click becomes a box select

export interface SessionOptions {
  level: number;
  campaignSeed: number;
  playerFaction: Faction;
  onResult: (result: GameResult) => void;
}

export class GameSession {
  readonly state: GameState;
  private readonly ai: AiState;
  private readonly simCtx: SimContext;
  private readonly hud = new HudRenderer();
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly opts: SessionOptions;

  private cam: Camera = { x: 0, y: 0 };
  private selection = new Set<number>();
  private controlGroups = new Map<number, number[]>();
  private paused = false;
  private speed = 1;
  private placing: BuildingType | null = null;
  private attackMoveArmed = false;

  private mouseX = 0;
  private mouseY = 0;
  private mouseInside = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private minimapDragging = false;
  private keys = new Set<string>();
  private lastLayout: HudLayout | null = null;

  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;
  private resultSent = false;
  private disposed = false;

  private readonly listeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, opts: SessionOptions) {
    this.canvas = canvas;
    this.opts = opts;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D context unavailable');
    this.g = g;
    this.state = createGame(opts.level, opts.campaignSeed, opts.playerFaction);
    this.ai = createAi(this.state);
    this.simCtx = createSimContext(this.state);

    // Centre the camera on the player's start.
    const start = this.state.map.starts[0];
    this.cam.x = start.x - canvas.width / TILE / 2;
    this.cam.y = start.y - canvas.height / TILE / 2;
    this.clampCamera();
    updateFog(this.state, this.state.players[0]);

    this.bind();
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    for (const off of this.listeners) off();
  }

  // -------------------------------------------------------------------------
  // Event wiring

  private bind(): void {
    const on = (target: EventTarget, type: string, fn: EventListener): void => {
      target.addEventListener(type, fn);
      this.listeners.push(() => target.removeEventListener(type, fn));
    };

    on(this.canvas, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    on(this.canvas, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
    on(window, 'mouseup', (e) => this.onMouseUp(e as MouseEvent));
    on(this.canvas, 'mouseenter', () => (this.mouseInside = true));
    on(this.canvas, 'mouseleave', () => (this.mouseInside = false));
    on(this.canvas, 'contextmenu', (e) => {
      e.preventDefault();
      this.onRightClick(e as MouseEvent);
    });
    on(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    on(window, 'keyup', (e) => {
      this.keys.delete((e as KeyboardEvent).key);
    });
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const { x, y } = this.eventPos(e);

    // HUD buttons take priority.
    const btn = this.lastLayout?.buttons.find(
      (b) => b.enabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
    );
    if (btn) {
      this.activateButton(btn.id);
      return;
    }
    if (this.lastLayout && inMinimap(this.lastLayout, x, y)) {
      this.minimapDragging = true;
      this.minimapJump(x, y);
      return;
    }
    if (this.placing) {
      this.confirmPlacement();
      return;
    }
    if (this.attackMoveArmed) {
      const w = this.screenToWorld(x, y);
      this.issueAttackMove(w.x, w.y);
      this.attackMoveArmed = false;
      return;
    }
    this.dragStart = { x, y };
    this.dragging = false;
  }

  private onMouseMove(e: MouseEvent): void {
    const { x, y } = this.eventPos(e);
    this.mouseX = x;
    this.mouseY = y;
    if (this.minimapDragging) {
      this.minimapJump(x, y);
      return;
    }
    if (this.dragStart) {
      const dist = Math.hypot(x - this.dragStart.x, y - this.dragStart.y);
      if (dist > DRAG_THRESHOLD) this.dragging = true;
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (this.minimapDragging) {
      this.minimapDragging = false;
      return;
    }
    if (!this.dragStart) return;
    const { x, y } = this.eventPos(e);
    const additive = e.shiftKey;
    if (this.dragging) {
      this.boxSelect(this.dragStart.x, this.dragStart.y, x, y, additive);
    } else {
      this.clickSelect(x, y, additive);
    }
    this.dragStart = null;
    this.dragging = false;
  }

  private onRightClick(e: MouseEvent): void {
    const { x, y } = this.eventPos(e);
    if (this.placing) {
      // Spec: right-click also confirms building placement.
      this.confirmPlacement();
      return;
    }
    if (this.lastLayout && inMinimap(this.lastLayout, x, y)) return;
    if (y < TOP_BAR_H || (this.lastLayout && inPanel(this.lastLayout, x, y))) return;
    const w = this.screenToWorld(x, y);
    for (const id of this.selection) {
      const u = this.state.units.find((un) => un.id === id);
      if (!u || u.faction !== this.state.playerFaction) continue;
      smartOrder(this.state, u, jitter(w.x, id), jitter(w.y, id * 7));
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
      return;
    }
    if (k === ' ') {
      this.paused = !this.paused;
      e.preventDefault();
      return;
    }
    if (k === 'f' || k === 'F') {
      this.speed = this.speed === 1 ? 2 : 1;
      return;
    }
    if (k === 'a' || k === 'A') {
      if (this.selectedMilitary().length > 0) this.attackMoveArmed = true;
      return;
    }
    if (k === 'Escape') {
      if (this.placing) this.placing = null;
      else if (this.attackMoveArmed) this.attackMoveArmed = false;
      else this.selection.clear();
      return;
    }
    if (/^[1-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey) {
        const ids = [...this.selection].filter((id) =>
          this.state.units.some((u) => u.id === id && u.faction === this.state.playerFaction),
        );
        this.controlGroups.set(n, ids);
        e.preventDefault();
      } else {
        const ids = this.controlGroups.get(n) ?? [];
        const alive = ids.filter((id) => this.state.units.some((u) => u.id === id));
        if (alive.length > 0) {
          this.selection = new Set(alive);
          this.placing = null;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Actions

  private activateButton(id: string): void {
    const [verb, arg] = id.split(':');
    if (verb === 'build') {
      this.placing = arg as BuildingType;
    } else if (verb === 'train') {
      const buildingId = [...this.selection].find((sid) => findBuilding(this.state, sid));
      const building = buildingId !== undefined ? findBuilding(this.state, buildingId) : undefined;
      if (building && building.faction === this.state.playerFaction) {
        trainUnit(this.state, building, arg as UnitType);
      }
    }
  }

  private confirmPlacement(): void {
    if (!this.placing) return;
    const spot = this.placementSpot();
    const worker = this.selectedWorkers()[0];
    if (!worker) {
      this.placing = null;
      return;
    }
    const b = placeBuilding(this.state, worker, this.placing, spot.tx, spot.ty);
    if (b) {
      // Other selected workers help build.
      for (const w of this.selectedWorkers().slice(1)) {
        issueOrder(this.state, w, { kind: 'build', buildingId: b.id });
      }
      this.placing = null;
    }
    // Invalid spot: stay in placement mode so the player can adjust.
  }

  private issueAttackMove(wx: number, wy: number): void {
    for (const u of this.selectedMilitary()) {
      issueOrder(this.state, u, { kind: 'attackMove', x: jitter(wx, u.id), y: jitter(wy, u.id * 3) });
    }
  }

  private clickSelect(x: number, y: number, additive: boolean): void {
    if (y < TOP_BAR_H) return;
    if (this.lastLayout && (inMinimap(this.lastLayout, x, y) || inPanel(this.lastLayout, x, y))) return;
    const w = this.screenToWorld(x, y);
    // Prefer units (own first), then buildings.
    let picked: number | null = null;
    let bestDist = 0.8;
    for (const u of this.state.units) {
      if (u.faction !== this.state.playerFaction && !this.tileVisibleToPlayer(u.x, u.y)) continue;
      const d = Math.hypot(u.x - w.x, u.y - w.y) - (u.faction === this.state.playerFaction ? 0.1 : 0);
      if (d < bestDist) {
        bestDist = d;
        picked = u.id;
      }
    }
    if (picked === null) {
      for (const b of this.state.buildings) {
        const visible =
          b.faction === this.state.playerFaction ||
          this.state.players[0].buildingMemory.has(b.id) ||
          this.tileVisibleToPlayer(b.tx + 0.5, b.ty + 0.5);
        if (visible && distToBuilding(b, w.x, w.y) === 0) {
          picked = b.id;
          break;
        }
      }
    }
    if (!additive) this.selection.clear();
    if (picked !== null) {
      // Buildings are single-select; units never mix with buildings.
      const isBuilding = !!findBuilding(this.state, picked);
      if (isBuilding) this.selection = new Set([picked]);
      else {
        for (const sid of [...this.selection]) {
          if (findBuilding(this.state, sid)) this.selection.delete(sid);
        }
        this.selection.add(picked);
      }
    }
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const a = this.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    const hits = this.state.units.filter(
      (u) =>
        u.faction === this.state.playerFaction &&
        u.x + UNIT_RADIUS >= a.x &&
        u.x - UNIT_RADIUS <= b.x &&
        u.y + UNIT_RADIUS >= a.y &&
        u.y - UNIT_RADIUS <= b.y,
    );
    if (!additive) this.selection.clear();
    if (hits.length > 0) {
      for (const sid of [...this.selection]) {
        if (findBuilding(this.state, sid)) this.selection.delete(sid);
      }
      for (const u of hits) this.selection.add(u.id);
    }
  }

  private selectedWorkers(): Unit[] {
    return [...this.selection]
      .map((id) => this.state.units.find((u) => u.id === id))
      .filter((u): u is Unit => !!u && u.faction === this.state.playerFaction && u.type === UnitType.Worker);
  }

  private selectedMilitary(): Unit[] {
    return [...this.selection]
      .map((id) => this.state.units.find((u) => u.id === id))
      .filter((u): u is Unit => !!u && u.faction === this.state.playerFaction && u.type !== UnitType.Worker);
  }

  // -------------------------------------------------------------------------
  // Coordinate helpers

  private eventPos(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: this.cam.x + x / TILE, y: this.cam.y + (y - TOP_BAR_H) / TILE };
  }

  private tileVisibleToPlayer(x: number, y: number): boolean {
    const map = this.state.map;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
    return this.state.players[0].fog[ty * map.width + tx] === 2;
  }

  private minimapJump(x: number, y: number): void {
    const layout = this.lastLayout;
    if (!layout) return;
    const m = layout.minimap;
    const wx = (x - m.x) / m.scale;
    const wy = (y - m.y) / m.scale;
    this.cam.x = wx - this.canvas.width / TILE / 2;
    this.cam.y = wy - (this.canvas.height - TOP_BAR_H) / TILE / 2;
    this.clampCamera();
  }

  private clampCamera(): void {
    const viewW = this.canvas.width / TILE;
    const viewH = (this.canvas.height - TOP_BAR_H) / TILE;
    this.cam.x = Math.max(0, Math.min(this.state.map.width - viewW, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.state.map.height - viewH, this.cam.y));
    if (this.state.map.width < viewW) this.cam.x = (this.state.map.width - viewW) / 2;
    if (this.state.map.height < viewH) this.cam.y = (this.state.map.height - viewH) / 2;
  }

  private placementSpot(): { tx: number; ty: number; valid: boolean } {
    const type = this.placing!;
    const s = BUILDING_STATS[type];
    const w = this.screenToWorld(this.mouseX, this.mouseY);
    const tx = Math.round(w.x - s.width / 2);
    const ty = Math.round(w.y - s.height / 2);
    return { tx, ty, valid: canPlaceBuilding(this.state, type, tx, ty) };
  }

  // -------------------------------------------------------------------------
  // Main loop

  private frame = (now: number): void => {
    if (this.disposed) return;
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.scrollCamera(elapsed);

    if (!this.paused && this.state.result === 'playing') {
      this.accumulator += elapsed * this.speed;
      let steps = 0;
      while (this.accumulator >= TICK_DT && steps < MAX_TICKS_PER_FRAME) {
        tickGame(this.state, this.simCtx);
        tickAi(this.state, this.ai);
        this.accumulator -= TICK_DT;
        steps++;
      }
      if (steps === MAX_TICKS_PER_FRAME) this.accumulator = 0; // shed load, no spiral
    }

    this.pruneSelection();
    this.render(now / 1000);

    if (this.state.result !== 'playing' && !this.resultSent) {
      this.resultSent = true;
      this.opts.onResult(this.state.result);
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  private scrollCamera(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (this.mouseInside && !this.minimapDragging) {
      if (this.mouseX < EDGE_SCROLL_MARGIN) dx -= 1;
      if (this.mouseX > this.canvas.width - EDGE_SCROLL_MARGIN) dx += 1;
      if (this.mouseY < EDGE_SCROLL_MARGIN) dy -= 1;
      if (this.mouseY > this.canvas.height - EDGE_SCROLL_MARGIN) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      this.cam.x += dx * SCROLL_SPEED * dt;
      this.cam.y += dy * SCROLL_SPEED * dt;
      this.clampCamera();
    }
  }

  private pruneSelection(): void {
    for (const id of [...this.selection]) {
      if (!this.state.units.some((u) => u.id === id) && !findBuilding(this.state, id)) {
        this.selection.delete(id);
      }
    }
  }

  private render(frameTime: number): void {
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;

    g.save();
    g.translate(0, TOP_BAR_H);
    renderWorld(
      g,
      this.state,
      this.cam,
      w,
      h - TOP_BAR_H,
      {
        selectedIds: this.selection,
        dragRect:
          this.dragging && this.dragStart
            ? {
                x0: this.dragStart.x,
                y0: this.dragStart.y - TOP_BAR_H,
                x1: this.mouseX,
                y1: this.mouseY - TOP_BAR_H,
              }
            : null,
        placing: this.placing ? { type: this.placing, ...this.placementSpot() } : null,
      },
      frameTime,
    );
    g.restore();

    this.lastLayout = this.hud.render(
      g,
      this.state,
      this.cam,
      w,
      h,
      this.selection,
      this.paused,
      this.speed,
      this.placing !== null,
    );

    if (this.attackMoveArmed) {
      g.fillStyle = '#e05040';
      g.font = '14px Georgia, serif';
      g.fillText('Attack-move: click a target location', w / 2 - 110, TOP_BAR_H + 18);
    }
    if (this.paused) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, TOP_BAR_H, w, h - TOP_BAR_H - PANEL_H);
      g.fillStyle = '#e8e0c8';
      g.font = '32px Georgia, serif';
      g.fillText('PAUSED', w / 2 - 60, h / 2);
    }
  }
}

function inMinimap(layout: HudLayout, x: number, y: number): boolean {
  const m = layout.minimap;
  return x >= m.x && x <= m.x + m.size && y >= m.y && y <= m.y + m.size;
}

function inPanel(layout: HudLayout, x: number, y: number): boolean {
  const p = layout.panel;
  return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
}

/** Small deterministic spread so group orders do not stack on one point. */
function jitter(v: number, salt: number): number {
  return v + (((salt * 2654435761) >>> 16) % 100) / 100 - 0.5;
}
