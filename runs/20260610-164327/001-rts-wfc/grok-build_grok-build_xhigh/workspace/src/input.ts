import type { GameState, PlayerOrder, BuildingType } from './types';
import { screenToWorld, worldToScreen } from './render';
import type { RenderContext } from './render';
import { issueOrder, selectEntities, boxSelect, setControlGroup, recallControlGroup, trainUnit, startConstruction, canBuildAt } from './sim';
import { BUILDING_DATA } from './data';
import { VIEW_W, VIEW_H } from './constants';

export interface InputState {
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  rightDown: boolean;
  dragStartX: number;
  dragStartY: number;
  isDragging: boolean;
  lastClickTime: number;
  buildMode: BuildingType | null;
  hoveredEntityId: number | null;
}

export function createInputState(): InputState {
  return {
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    rightDown: false,
    dragStartX: 0,
    dragStartY: 0,
    isDragging: false,
    lastClickTime: 0,
    buildMode: null,
    hoveredEntityId: null,
  };
}

export function attachInput(
  canvas: HTMLCanvasElement,
  rc: RenderContext,
  state: GameState,
  input: InputState,
  onBuildRequest: (bt: BuildingType, x: number, y: number) => void,
  onTrain: (ut: any) => void,
  getSelectedPanel: () => HTMLElement | null
): void {
  const getWorld = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return screenToWorld(rc, sx, sy);
  };

  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    input.mouseX = ev.clientX - rect.left;
    input.mouseY = ev.clientY - rect.top;

    const w = getWorld(ev.clientX, ev.clientY);
    // hover detection
    input.hoveredEntityId = null;
    let closestD = 1.6;
    for (const e of state.entities.values()) {
      if (e.faction !== state.playerFaction) {
        const tx = Math.floor(e.pos.x), ty = Math.floor(e.pos.y);
        if (state.vis[ty]?.[tx] !== 'visible') continue;
      }
      const d = Math.hypot(e.pos.x - w.x, e.pos.y - w.y);
      if (d < closestD) {
        closestD = d;
        input.hoveredEntityId = e.id;
      }
    }

    // edge scroll
    const edge = 28;
    const speed = 0.9;
    if (input.mouseX < edge) rc.camX = Math.max(0, rc.camX - speed);
    if (input.mouseX > rc.w - edge) rc.camX = Math.min(state.mapW - VIEW_W, rc.camX + speed);
    if (input.mouseY < edge) rc.camY = Math.max(0, rc.camY - speed);
    if (input.mouseY > rc.h - edge) rc.camY = Math.min(state.mapH - VIEW_H, rc.camY + speed);

    // drag box
    if (input.mouseDown && !input.rightDown && !input.buildMode) {
      if (!input.isDragging) {
        const ddx = input.mouseX - input.dragStartX;
        const ddy = input.mouseY - input.dragStartY;
        if (Math.hypot(ddx, ddy) > 6) input.isDragging = true;
      }
    }

    if (input.buildMode) {
      // preview handled in main loop
    }
  });

  canvas.addEventListener('mousedown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const world = screenToWorld(rc, sx, sy);

    if (ev.button === 0) {
      input.mouseDown = true;
      input.dragStartX = sx;
      input.dragStartY = sy;
      input.isDragging = false;

      // build mode placement
      if (input.buildMode) {
        const fx = Math.floor(world.x);
        const fy = Math.floor(world.y);
        if (canBuildAt(state, input.buildMode, fx, fy, state.playerFaction)) {
          onBuildRequest(input.buildMode, fx, fy);
          input.buildMode = null;
        } else {
          // invalid placement soundless cancel
          input.buildMode = null;
        }
        return;
      }

      // check for entity click (select)
      const clicked = pickEntityAt(state, world, rc);
      const now = Date.now();
      const dbl = now - input.lastClickTime < 280;
      input.lastClickTime = now;

      if (clicked) {
        const additive = ev.shiftKey;
        selectEntities(state, [clicked.id], additive);
      } else {
        // start box drag or deselect
        if (!ev.shiftKey) {
          state.selectedIds.clear();
          for (const e of state.entities.values()) e.selected = false;
        }
      }
    } else if (ev.button === 2) {
      input.rightDown = true;
      // right click order
      if (state.selectedIds.size > 0) {
        const clicked = pickEntityAt(state, world, rc);
        let order: PlayerOrder | null = null;

        if (clicked) {
          if (clicked.faction !== state.playerFaction) {
            order = { type: 'attack', targetId: clicked.id };
          } else if (clicked.kind === 'building') {
            // repair or harvest if mine (goldmine is represented as special building)
            if (clicked.type === 'goldmine' || (clicked as any).type === 'goldmine') { // safety
              order = { type: 'harvest', targetId: clicked.id };
            } else {
              order = { type: 'repair', targetId: clicked.id };
            }
          }
        }

        if (!order) {
          // default move or attack-move if shift held?
          const isAttackMove = ev.shiftKey;
          if (isAttackMove) {
            order = { type: 'attack', pos: world };
          } else {
            order = { type: 'move', pos: world };
          }
        }

        if (order) {
          issueOrder(state, order, ev.shiftKey);
        }
      }
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if (ev.button === 0) {
      if (input.isDragging && !input.buildMode) {
        const rect = canvas.getBoundingClientRect();
        const x1 = input.dragStartX;
        const y1 = input.dragStartY;
        const x2 = ev.clientX - rect.left;
        const y2 = ev.clientY - rect.top;
        const w1 = screenToWorld(rc, x1, y1);
        const w2 = screenToWorld(rc, x2, y2);
        boxSelect(state, { x1: w1.x, y1: w1.y, x2: w2.x, y2: w2.y }, ev.shiftKey);
      }
      input.mouseDown = false;
      input.isDragging = false;
    }
    if (ev.button === 2) {
      input.rightDown = false;
    }
  });

  // prevent context menu
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard
  window.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target as HTMLElement).tagName === 'INPUT') return;

    if (ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      // pause handled in main
      (window as any).__warbandTogglePause?.();
    }

    if (ev.key.toLowerCase() === 's' && ev.ctrlKey) { ev.preventDefault(); }

    // Speed
    if (ev.key === '2') {
      (window as any).__warbandCycleSpeed?.();
    }

    // Build hotkeys
    if (ev.key === 'b' || ev.key === 'B') {
      input.buildMode = input.buildMode === 'barracks' ? null : 'barracks';
    }
    if (ev.key === 'f' || ev.key === 'F') {
      input.buildMode = input.buildMode === 'farm' ? null : 'farm';
    }
    if (ev.key === 'l' || ev.key === 'L') {
      input.buildMode = input.buildMode === 'lumbermill' ? null : 'lumbermill';
    }
    if (ev.key === 't' || ev.key === 'T') {
      input.buildMode = input.buildMode === 'tower' ? null : 'tower';
    }

    // Train hotkeys
    if (ev.key === 'w' || ev.key === 'W') onTrain('worker');
    if (ev.key === 'i' || ev.key === 'I') onTrain('inf');
    if (ev.key === 'r' || ev.key === 'R') onTrain('ranged');
    if (ev.key === 'h' || ev.key === 'H') onTrain('heavy');

    // Control groups
    const num = parseInt(ev.key);
    if (!isNaN(num) && num >= 1 && num <= 9) {
      if (ev.ctrlKey || ev.metaKey) {
        setControlGroup(state, num);
      } else {
        recallControlGroup(state, num, ev.shiftKey);
      }
    }

    // Arrow keys scroll
    const scrollSpeed = 1.6;
    if (ev.key === 'ArrowLeft') rc.camX = Math.max(0, rc.camX - scrollSpeed);
    if (ev.key === 'ArrowRight') rc.camX = Math.min(state.mapW - VIEW_W, rc.camX + scrollSpeed);
    if (ev.key === 'ArrowUp') rc.camY = Math.max(0, rc.camY - scrollSpeed);
    if (ev.key === 'ArrowDown') rc.camY = Math.min(state.mapH - VIEW_H, rc.camY + scrollSpeed);

    // Deselect
    if (ev.key === 'Escape') {
      state.selectedIds.clear();
      for (const e of state.entities.values()) e.selected = false;
      input.buildMode = null;
    }
  });

  // Minimap clicks
  const minimap = document.getElementById('minimap') as HTMLCanvasElement | null;
  if (minimap) {
    minimap.addEventListener('mousedown', (ev) => {
      const rect = minimap.getBoundingClientRect();
      const mx = ((ev.clientX - rect.left) / rect.width) * state.mapW;
      const my = ((ev.clientY - rect.top) / rect.height) * state.mapH;
      rc.camX = Math.max(0, Math.min(state.mapW - VIEW_W * 0.8, mx - VIEW_W / 2));
      rc.camY = Math.max(0, Math.min(state.mapH - VIEW_H * 0.8, my - VIEW_H / 2));
    });

    minimap.addEventListener('mousemove', (ev) => {
      if (ev.buttons === 1) {
        const rect = minimap.getBoundingClientRect();
        const mx = ((ev.clientX - rect.left) / rect.width) * state.mapW;
        const my = ((ev.clientY - rect.top) / rect.height) * state.mapH;
        rc.camX = Math.max(0, Math.min(state.mapW - VIEW_W * 0.8, mx - VIEW_W / 2));
        rc.camY = Math.max(0, Math.min(state.mapH - VIEW_H * 0.8, my - VIEW_H / 2));
      }
    });
  }
}

function pickEntityAt(state: GameState, world: {x:number,y:number}, rc: RenderContext): any | null {
  let best: any = null;
  let bestDist = 1.3;
  for (const e of state.entities.values()) {
    if (e.faction !== state.playerFaction) {
      const tx = Math.floor(e.pos.x);
      const ty = Math.floor(e.pos.y);
      if (state.vis[ty]?.[tx] !== 'visible') continue;
    }
    const d = Math.hypot(e.pos.x - world.x, e.pos.y - world.y) - (e.size * 0.3);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

export function getBuildPreview(state: GameState, input: InputState, rc: RenderContext): { bt: BuildingType; valid: boolean; x: number; y: number } | null {
  if (!input.buildMode) return null;
  const world = screenToWorld(rc, input.mouseX, input.mouseY);
  const fx = Math.floor(world.x);
  const fy = Math.floor(world.y);
  const valid = canBuildAt(state, input.buildMode, fx, fy, state.playerFaction);
  return { bt: input.buildMode, valid, x: fx, y: fy };
}
