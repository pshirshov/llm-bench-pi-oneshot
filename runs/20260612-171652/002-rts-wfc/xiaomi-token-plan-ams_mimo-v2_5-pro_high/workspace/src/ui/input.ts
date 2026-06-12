/**
 * Input handling: translates DOM events into simulation orders.
 * Contains no game logic of its own — only input → order mapping.
 */

import type { GameState, Faction, Entity, BuildingType, UnitType } from '../core/types';
import type { HudLayout } from './layout';
import { hitTest, minimapToWorld } from './layout';
import { assignMoveOrder, assignHarvestOrder } from '../sim/movement';
import { enqueueTraining, placeBuilding } from '../sim/orders';

export interface InputState {
  selectedEntities: Entity[];
  controlGroups: Map<number, Entity[]>;
  isDragging: boolean;
  dragStart: { x: number; y: number } | null;
  dragEnd: { x: number; y: number } | null;
  placementMode: BuildingType | null;
  camera: { x: number; y: number };
}

/** Create initial input state */
export function createInputState(): InputState {
  return {
    selectedEntities: [],
    controlGroups: new Map(),
    isDragging: false,
    dragStart: null,
    dragEnd: null,
    placementMode: null,
    camera: { x: 0, y: 0 },
  };
}

/** Get client→canvas coordinate transform */
export type CoordTransform = (clientX: number, clientY: number) => { x: number; y: number };

/** Default transform using getBoundingClientRect */
export function defaultTransform(canvas: HTMLCanvasElement): CoordTransform {
  return (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };
}

/**
 * Handle a mouse down event.
 */
export function handleMouseDown(
  state: InputState,
  gameState: GameState,
  layout: HudLayout,
  screenX: number,
  screenY: number,
  button: number,
  shiftKey: boolean,
  playerFaction: Faction,
): void {
  const element = hitTest(layout, screenX, screenY);

  if (button === 0) {
    // Left click
    if (element === 'viewport') {
      handleViewportLeftClick(state, gameState, layout, screenX, screenY, shiftKey, playerFaction);
    } else if (element === 'minimap') {
      handleMinimapClick(state, layout, screenX, screenY, gameState.map.width, gameState.map.height);
    } else if (element !== null && (element.startsWith('train_') || element.startsWith('build_'))) {
      handleButtonClick(state, gameState, element, playerFaction);
    } else if (element === 'speed') {
      gameState.speed = gameState.speed >= 2 ? 1 : gameState.speed + 1;
    } else if (element === 'pause') {
      gameState.paused = !gameState.paused;
    }
  } else if (button === 2) {
    // Right click
    if (element === 'viewport') {
      handleViewportRightClick(state, gameState, layout, screenX, screenY, playerFaction);
    }
  }
}

/**
 * Handle left click on the viewport.
 */
function handleViewportLeftClick(
  state: InputState,
  gameState: GameState,
  layout: HudLayout,
  screenX: number,
  screenY: number,
  shiftKey: boolean,
  playerFaction: Faction,
): void {
  const worldPos = screenToWorld(state, layout, screenX, screenY);

  // If in placement mode, try to place building
  if (state.placementMode) {
    placeBuilding(gameState, playerFaction, state.placementMode,
      Math.floor(worldPos.x), Math.floor(worldPos.y));
    state.placementMode = null;
    // Assign idle worker to build
    const worker = state.selectedEntities.find(e =>
      e.entityType === 'unit' && e.unitType === 'worker',
    );
    if (worker) {
      // Building was placed, assign worker
    }
    return;
  }

  // Start drag selection
  state.isDragging = true;
  state.dragStart = { x: screenX, y: screenY };
  state.dragEnd = { x: screenX, y: screenY };

  // Try to select entity at click position
  const clickedEntity = findEntityAtPosition(gameState, worldPos.x, worldPos.y, playerFaction);

  if (clickedEntity) {
    if (shiftKey) {
      // Add to selection
      if (!state.selectedEntities.includes(clickedEntity)) {
        state.selectedEntities.push(clickedEntity);
      }
    } else {
      state.selectedEntities = [clickedEntity];
    }
  } else if (!shiftKey) {
    state.selectedEntities = [];
  }
}

/**
 * Handle right click on the viewport (context-sensitive order).
 */
function handleViewportRightClick(
  state: InputState,
  gameState: GameState,
  layout: HudLayout,
  screenX: number,
  screenY: number,
  playerFaction: Faction,
): void {
  if (state.selectedEntities.length === 0) return;

  const worldPos = screenToWorld(state, layout, screenX, screenY);
  const targetEntity = findEntityAtPosition(gameState, worldPos.x, worldPos.y);

  for (const entity of state.selectedEntities) {
    if (entity.faction !== playerFaction) continue;
    if (entity.entityType !== 'unit') continue;

    if (targetEntity && targetEntity.faction !== playerFaction) {
      // Attack enemy
      entity.order = { type: 'attack', targetId: targetEntity.id };
    } else if (targetEntity && targetEntity.buildingType === 'goldMine') {
      // Harvest gold
      assignHarvestOrder(gameState, entity, targetEntity.id);
    } else if (targetEntity && targetEntity.faction === playerFaction &&
               targetEntity.entityType === 'building' && targetEntity.hp < targetEntity.maxHp) {
      // Repair
      entity.order = { type: 'repair', targetId: targetEntity.id };
      entity.repairTarget = targetEntity.id;
    } else {
      // Move to position
      assignMoveOrder(gameState, entity, worldPos.x, worldPos.y);
    }
  }
}

/**
 * Handle minimap click.
 */
function handleMinimapClick(
  state: InputState,
  layout: HudLayout,
  screenX: number,
  screenY: number,
  mapWidth: number,
  mapHeight: number,
): void {
  const worldPos = minimapToWorld(layout, screenX, screenY, mapWidth, mapHeight);
  state.camera.x = worldPos.x - layout.viewport.width / 2;
  state.camera.y = worldPos.y - layout.viewport.height / 2;
}

/**
 * Handle button click (train/build).
 */
function handleButtonClick(
  state: InputState,
  gameState: GameState,
  buttonId: string,
  playerFaction: Faction,
): void {
  void playerFaction; // Required parameter for interface consistency
  if (buttonId.startsWith('train_')) {
    const unitType = buttonId.replace('train_', '') as UnitType;
    const building = state.selectedEntities.find(e =>
      e.entityType === 'building' && (e.buildingType === 'barracks' || e.buildingType === 'townHall'),
    );
    if (building) {
      enqueueTraining(gameState, building, unitType);
    }
  } else if (buttonId.startsWith('build_')) {
    const buildingType = buttonId.replace('build_', '') as BuildingType;
    state.placementMode = buildingType;
  }
}

/**
 * Handle mouse up (end drag selection).
 */
export function handleMouseUp(
  state: InputState,
  gameState: GameState,
  layout: HudLayout,
  screenX: number,
  screenY: number,
  playerFaction: Faction,
): void {
  if (!state.isDragging || !state.dragStart) return;

  const dragEnd = { x: screenX, y: screenY };
  const dx = Math.abs(dragEnd.x - state.dragStart.x);
  const dy = Math.abs(dragEnd.y - state.dragStart.y);

  if (dx > 5 || dy > 5) {
    // Box selection
    const startWorld = screenToWorld(state, layout, state.dragStart.x, state.dragStart.y);
    const endWorld = screenToWorld(state, layout, dragEnd.x, dragEnd.y);

    const minX = Math.min(startWorld.x, endWorld.x);
    const maxX = Math.max(startWorld.x, endWorld.x);
    const minY = Math.min(startWorld.y, endWorld.y);
    const maxY = Math.max(startWorld.y, endWorld.y);

    state.selectedEntities = gameState.entities.filter(e =>
      e.alive && e.faction === playerFaction &&
      e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY,
    );
  }

  state.isDragging = false;
  state.dragStart = null;
  state.dragEnd = null;
}

/**
 * Handle keyboard input.
 */
export function handleKeyDown(
  state: InputState,
  gameState: GameState,
  key: string,
  ctrlKey: boolean,
  playerFaction: Faction,
): void {
  void playerFaction; // Required parameter for interface consistency
  // Control groups
  if (ctrlKey && key >= '1' && key <= '9') {
    const groupNum = parseInt(key);
    state.controlGroups.set(groupNum, [...state.selectedEntities]);
    return;
  }

  if (!ctrlKey && key >= '1' && key <= '9') {
    const groupNum = parseInt(key);
    const group = state.controlGroups.get(groupNum);
    if (group) {
      state.selectedEntities = group.filter(e => e.alive);
    }
    return;
  }

  // Space: pause
  if (key === ' ') {
    gameState.paused = !gameState.paused;
    return;
  }

  // Escape: cancel placement
  if (key === 'Escape') {
    state.placementMode = null;
    state.selectedEntities = [];
  }

  // Suppress unused parameter warning
  void playerFaction;
}

/**
 * Find an entity at a world position.
 */
function findEntityAtPosition(
  gameState: GameState,
  worldX: number,
  worldY: number,
  faction?: Faction,
): Entity | undefined {
  for (const entity of gameState.entities) {
    if (!entity.alive) continue;
    if (faction !== undefined && entity.faction !== faction) continue;

    if (entity.entityType === 'building') {
      if (worldX >= entity.x && worldX < entity.x + entity.width &&
          worldY >= entity.y && worldY < entity.y + entity.height) {
        return entity;
      }
    } else {
      const dx = worldX - entity.x;
      const dy = worldY - entity.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) return entity;
    }
  }
  return undefined;
}

/**
 * Convert screen coordinates to world coordinates.
 */
function screenToWorld(
  state: InputState,
  layout: HudLayout,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: screenX + state.camera.x,
    y: screenY + state.camera.y,
  };
}
