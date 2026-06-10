// Mouse + keyboard input handling. Emits high-level commands to the game.

import { type World, type UnitEntity, type EntityId, type BuildingKind, type UnitKind } from './state.js';
import { type Camera, screenToWorld, clampCamera, centerOn } from './camera.js';
import { TILES, type TileId, type FactionId, UNIT_STATS, BUILDING_STATS } from './data.js';
import {
  isBuildable, tryQueueBuilding, tryQueueTrain, orderMove, orderAttack, orderBuild, orderRepair, pathToTile, cancelTrain,
} from './sim.js';
import { type RenderState } from './render.js';

export interface InputState {
  drag: { x0: number; y0: number; x: number; y: number; additive: boolean } | null;
  buildKind: BuildingKind | null;
  edgeScrollX: number;
  edgeScrollY: number;
  keys: Set<string>;
  ctrlGroups: Map<number, Set<EntityId>>;
  recenterTile: { x: number; y: number } | null;
}

export function makeInputState(): InputState {
  return {
    drag: null,
    buildKind: null,
    edgeScrollX: 0,
    edgeScrollY: 0,
    keys: new Set(),
    ctrlGroups: new Map(),
    recenterTile: null,
  };
}

function entityAt(w: World, x: number, y: number): { id: EntityId; kind: 'unit' | 'building' } | null {
  for (const u of w.units.values()) {
    if (u.hp <= 0) continue;
    if (u.occ.x === x && u.occ.y === y) return { id: u.id, kind: 'unit' };
  }
  for (const b of w.buildings.values()) {
    if (b.hp <= 0) continue;
    if (Math.floor(b.pos.x) <= x && x < Math.floor(b.pos.x) + b.size.w
      && Math.floor(b.pos.y) <= y && y < Math.floor(b.pos.y) + b.size.h) return { id: b.id, kind: 'building' };
  }
  return null;
}

function selectedUnits(w: World, sel: Set<EntityId>): UnitEntity[] {
  const out: UnitEntity[] = [];
  for (const id of sel) {
    const u = w.units.get(id);
    if (u && u.hp > 0) out.push(u);
  }
  return out;
}

function entityOwner(w: World, id: EntityId): FactionId | null {
  const u = w.units.get(id);
  if (u) return u.faction;
  const b = w.buildings.get(id);
  if (b) return b.faction;
  return null;
}

export function onMouseDown(
  input: InputState, w: World, e: MouseEvent, canvas: HTMLCanvasElement, cam: Camera, rs: RenderState,
): void {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const syTop = e.clientY - rect.top; // pixels from top-left
  const sy = cam.h * cam.zoom - syTop; // flip to bottom-origin to match our render
  const w2 = screenToWorld(cam, sx, sy);
  const tx = Math.floor(w2.x);
  const ty = Math.floor(w2.y);
  if (e.button === 0) {
    if (input.buildKind) {
      const faction: FactionId = 'human';
      const stats = BUILDING_STATS[input.buildKind];
      if (isBuildable(w, tx, ty, stats.size.w, stats.size.h)) {
        const f = w.factions[faction];
        if (f.gold >= stats.cost.gold && f.wood >= stats.cost.wood) {
          const b = tryQueueBuilding(w, faction, input.buildKind, tx, ty);
          if (b) {
            const workers = selectedUnits(w, rs.selected).filter((u) => u.unitKind === 'worker');
            if (workers.length > 0) orderBuild(w, workers, b.id);
          }
        }
      }
      input.buildKind = null;
      return;
    }
    input.drag = { x0: tx, y0: ty, x: tx, y: ty, additive: e.shiftKey };
  } else if (e.button === 2) {
    issueRightClick(w, tx, ty, e.shiftKey, e.altKey, rs);
  }
}

export function onMouseMove(input: InputState, _w: World, e: MouseEvent, canvas: HTMLCanvasElement, cam: Camera): void {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const syTop = e.clientY - rect.top;
  if (input.drag) {
    const sy = cam.h * cam.zoom - syTop;
    const w2 = screenToWorld(cam, sx, sy);
    input.drag.x = Math.floor(w2.x);
    input.drag.y = Math.floor(w2.y);
  }
  const py = syTop;
  const edge = 16;
  input.edgeScrollX = 0;
  input.edgeScrollY = 0;
  if (sx < edge) input.edgeScrollX = -1;
  if (sx > cam.w * cam.zoom - edge) input.edgeScrollX = 1;
  if (py < edge) input.edgeScrollY = 1;     // top edge -> scroll up (cam.y -= 1)
  if (py > cam.h * cam.zoom - edge) input.edgeScrollY = -1;
}

export function onMouseUp(input: InputState, w: World, rs: RenderState): void {
  if (!input.drag) return;
  const d = input.drag;
  if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) < 1) {
    const ent = entityAt(w, d.x0, d.y0);
    const newSel = new Set<number>();
    if (ent && entityOwner(w, ent.id) === 'human') {
      newSel.add(ent.id);
    }
    if (d.additive) for (const id of rs.selected) newSel.add(id);
    rs.selected = newSel;
  } else {
    const minX = Math.min(d.x0, d.x);
    const maxX = Math.max(d.x0, d.x);
    const minY = Math.min(d.y0, d.y);
    const maxY = Math.max(d.y0, d.y);
    const newSel = new Set<number>();
    for (const u of w.units.values()) {
      if (u.hp <= 0 || u.faction !== 'human') continue;
      if (u.pos.x >= minX && u.pos.x <= maxX + 1 && u.pos.y >= minY && u.pos.y <= maxY + 1) {
        newSel.add(u.id);
      }
    }
    if (d.additive) for (const id of rs.selected) newSel.add(id);
    rs.selected = newSel;
  }
  input.drag = null;
}

function issueRightClick(w: World, tx: number, ty: number, shift: boolean, alt: boolean, rs: RenderState): void {
  const ent = entityAt(w, tx, ty);
  const units = selectedUnits(w, rs.selected);
  if (units.length === 0) return;
  if (ent) {
    const owner = entityOwner(w, ent.id);
    if (owner && owner !== 'human') {
      orderAttack(w, units, ent.id);
      rs.marker = { x: tx + 0.5, y: ty + 0.5, t: 0 };
      return;
    }
    if (ent.kind === 'building') {
      const b = w.buildings.get(ent.id);
      if (b) {
        if (b.underConstruction) {
          const workers = units.filter((u) => u.unitKind === 'worker');
          if (workers.length > 0) orderBuild(w, workers, b.id);
          return;
        }
        if (b.hp < b.maxHp) {
          const workers = units.filter((u) => u.unitKind === 'worker');
          if (workers.length > 0) orderRepair(w, workers, b.id);
          return;
        }
      }
    }
    const t = w.map.tiles[ty * w.map.width + tx] as TileId;
    if (t === 'gold_mine' || t === 'forest') {
      const workers = units.filter((u) => u.unitKind === 'worker');
      for (const u of workers) {
        u.workerState = 'movingToResource';
        u.order = { kind: 'harvest', target: 0 };
        pathToTile(w, u, tx, ty);
      }
      rs.marker = { x: tx + 0.5, y: ty + 0.5, t: 0 };
      return;
    }
  }
  // fallback: move (or attack-move with alt)
  orderMove(w, units, tx, ty, alt);
  rs.marker = { x: tx + 0.5, y: ty + 0.5, t: 0 };
  void shift;
}

export function startBuildPlacement(input: InputState, bk: BuildingKind): void {
  input.buildKind = bk;
}

export function cancelBuildPlacement(input: InputState): void {
  input.buildKind = null;
}

export function onKeyDown(input: InputState, w: World, e: KeyboardEvent, _cam: Camera, rs: RenderState): void {
  input.keys.add(e.key.toLowerCase());
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const slot = parseInt(e.key, 10);
    const grp = new Set<number>();
    for (const id of rs.selected) grp.add(id);
    input.ctrlGroups.set(slot, grp);
    e.preventDefault();
  } else if (!e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const slot = parseInt(e.key, 10);
    const grp = input.ctrlGroups.get(slot);
    if (grp) {
      const newSel = new Set<number>();
      for (const id of grp) {
        if (w.units.has(id) || w.buildings.has(id)) newSel.add(id);
      }
      rs.selected = newSel;
      let sx = 0, sy = 0, n = 0;
      for (const id of grp) {
        const u = w.units.get(id);
        const b = w.buildings.get(id);
        const e2 = u || b;
        if (!e2) continue;
        sx += e2.pos.x;
        sy += e2.pos.y;
        n++;
      }
      if (n > 0) input.recenterTile = { x: sx / n, y: sy / n };
    }
  } else if (e.key === 'Escape') {
    input.buildKind = null;
    rs.selected = new Set();
  } else if (e.key === 'h' || e.key === 'H') {
    for (const b of w.buildings.values()) {
      if (b.faction === 'human' && b.buildingKind === 'townhall') {
        input.recenterTile = { x: b.pos.x + b.size.w / 2, y: b.pos.y + b.size.h / 2 };
        break;
      }
    }
  }
}

export function onKeyUp(input: InputState, e: KeyboardEvent): void {
  input.keys.delete(e.key.toLowerCase());
}

export function scrollCamera(input: InputState, cam: Camera, w: World, dt: number): void {
  let dx = 0;
  let dy = 0;
  if (input.keys.has('arrowleft')) dx -= 1;
  if (input.keys.has('arrowright')) dx += 1;
  if (input.keys.has('arrowup')) dy -= 1;
  if (input.keys.has('arrowdown')) dy += 1;
  dx += input.edgeScrollX;
  dy += input.edgeScrollY;
  const speed = 18;
  cam.x += dx * speed * dt;
  cam.y += dy * speed * dt;
  clampCamera(cam, w);
  if (input.recenterTile) {
    centerOn(cam, input.recenterTile.x, input.recenterTile.y, w);
    input.recenterTile = null;
  }
}

export function tryStartTrain(w: World, buildingId: EntityId, kind: UnitKind): boolean {
  return tryQueueTrain(w, buildingId, kind);
}

export function cancelTrainAt(w: World, buildingId: EntityId, index: number): boolean {
  return cancelTrain(w, buildingId, index);
}

void TILES; void UNIT_STATS;
