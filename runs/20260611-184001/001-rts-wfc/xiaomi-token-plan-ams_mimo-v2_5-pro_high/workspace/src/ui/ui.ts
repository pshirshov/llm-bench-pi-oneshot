/**
 * UI system: HUD updates, selection panel, build/train buttons.
 */
import { GameState, Entity, Faction, BuildingType, UnitType, TILE_SIZE, InputState, Camera } from '../engine/types.js';
import { getStats, getBuildingTypes, getUnitTrainTypes } from '../entities/stats.js';
import { canAfford, hasPrerequisites, deductCost, getEntityAtPixel, getEntitiesInRect } from '../entities/manager.js';
import { pixelToTile, tileToPixel } from '../pathfinding/astar.js';

/** Update HUD displays */
export function updateHUD(state: GameState): void {
  const [gold, wood, supplyUsed, supplyCap] = state.resources[state.playerFaction];

  const goldEl = document.getElementById('gold-display');
  const woodEl = document.getElementById('wood-display');
  const supplyEl = document.getElementById('supply-display');
  const speedEl = document.getElementById('speed-indicator');
  const seedEl = document.getElementById('seed-display');

  if (goldEl) goldEl.textContent = `🟡 ${gold}`;
  if (woodEl) woodEl.textContent = `🪵 ${wood}`;
  if (supplyEl) supplyEl.textContent = `👥 ${supplyUsed}/${supplyCap}`;
  if (speedEl) speedEl.textContent = state.paused ? '⏸ PAUSED' : `${state.speed}x`;
  if (seedEl) seedEl.textContent = `Seed: ${state.seed}`;
}

/** Update selection panel */
export function updateSelectionPanel(
  state: GameState,
  panel: HTMLElement,
  buildPanel: HTMLElement
): void {
  panel.innerHTML = '';
  buildPanel.style.display = 'none';
  buildPanel.innerHTML = '';

  const selected = state.selectedEntityIds
    .map(id => state.entities.find(e => e.id === id))
    .filter((e): e is Entity => e !== undefined && e.state !== 'dead');

  if (selected.length === 0) return;

  // Show portraits
  for (const entity of selected.slice(0, 12)) {
    const portrait = document.createElement('div');
    portrait.className = 'unit-portrait';
    portrait.innerHTML = `
      <div style="font-size:14px;">${getEntityIcon(entity)}</div>
      <div>${entity.stats.name}</div>
      <div class="hp-bar"><div class="hp-bar-fill" style="width:${(entity.hp / entity.maxHp) * 100}%"></div></div>
      <div style="font-size:10px;color:#aaa;">${entity.hp}/${entity.maxHp}</div>
    `;
    portrait.onclick = () => {
      state.selectedEntityIds = [entity.id];
      updateSelectionPanel(state, panel, buildPanel);
    };
    panel.appendChild(portrait);
  }

  // Show build/train buttons for single selection
  if (selected.length === 1) {
    const entity = selected[0];
    showEntityActions(entity, state, buildPanel);
  } else if (selected.length > 1) {
    // Show group actions
    showGroupActions(selected, state, buildPanel);
  }
}

function getEntityIcon(entity: Entity): string {
  const icons: Record<string, string> = {
    town_hall: '🏰', farm: '🌾', barracks: '⚔️',
    lumber_mill: '🪓', guard_tower: '🗼',
    worker: '👷', melee: '🗡️', ranged: '🏹', heavy: '🐴'
  };
  return icons[entity.type] || '?';
}

function showEntityActions(entity: Entity, state: GameState, buildPanel: HTMLElement): void {
  buildPanel.style.display = 'flex';
  const faction = entity.faction;

  // Worker: build options
  if (entity.type === 'worker' && entity.faction === state.playerFaction) {
    const buildTypes = getBuildingTypes(faction);
    for (const bt of buildTypes) {
      const btn = createBuildButton(bt.type, bt.stats, state, faction, entity);
      buildPanel.appendChild(btn);
    }
  }

  // Building with train queue: show queue and train options
  if (!entity.stats.isUnit && entity.faction === state.playerFaction) {
    // Show train queue
    if (entity.trainQueue.length > 0) {
      const queueDiv = document.createElement('div');
      queueDiv.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
      for (const item of entity.trainQueue) {
        const qItem = document.createElement('div');
        qItem.className = 'panel-btn';
        qItem.innerHTML = `${getEntityIcon({ type: item.type } as Entity)}
          <div class="progress-bar" style="width:${(item.progress / getStats(item.type, faction).buildTime) * 100}%"></div>`;
        queueDiv.appendChild(qItem);
      }
      buildPanel.appendChild(queueDiv);
    }

    // Show train options
    if (entity.type === 'town_hall' || entity.type === 'barracks') {
      const unitTypes = getUnitTrainTypes(faction);
      for (const ut of unitTypes) {
        if (entity.type === 'town_hall' && ut.type !== 'worker') continue;
        if (entity.type === 'barracks' && ut.type === 'worker') continue;

        const btn = createTrainButton(ut.type, ut.stats, state, faction, entity);
        buildPanel.appendChild(btn);
      }
    }
  }
}

function showGroupActions(entities: Entity[], state: GameState, buildPanel: HTMLElement): void {
  buildPanel.style.display = 'flex';
  const workers = entities.filter(e => e.type === 'worker' && e.faction === state.playerFaction);
  if (workers.length > 0) {
    const buildTypes = getBuildingTypes(state.playerFaction);
    for (const bt of buildTypes) {
      const btn = createBuildButton(bt.type, bt.stats, state, state.playerFaction, workers[0]);
      buildPanel.appendChild(btn);
    }
  }
}

function createBuildButton(
  type: BuildingType,
  stats: ReturnType<typeof getStats>,
  state: GameState,
  faction: Faction,
  _worker: Entity
): HTMLDivElement {
  const btn = document.createElement('div');
  btn.className = 'panel-btn';
  const affordable = canAfford(type, faction, state);
  const hasReqs = hasPrerequisites(type, faction, state);
  if (!affordable || !hasReqs) btn.classList.add('disabled');

  btn.innerHTML = `
    ${stats.name}
    <div class="cost">🟡${stats.goldCost} 🪵${stats.woodCost}</div>
  `;

  btn.onclick = () => {
    if (!affordable || !hasReqs) return;
    // Enter build placement mode
    const w = window as unknown as Record<string, unknown>;
    const input = w.__gameInput as InputState;
    if (input) {
      input.buildMode = type;
    }
  };

  return btn;
}

function createTrainButton(
  type: UnitType,
  stats: ReturnType<typeof getStats>,
  state: GameState,
  faction: Faction,
  building: Entity
): HTMLDivElement {
  const btn = document.createElement('div');
  btn.className = 'panel-btn';
  const affordable = canAfford(type, faction, state);
  const hasReqs = hasPrerequisites(type, faction, state);
  if (!affordable || !hasReqs) btn.classList.add('disabled');

  btn.innerHTML = `
    ${stats.name}
    <div class="cost">🟡${stats.goldCost} 🪵${stats.woodCost} 👥${stats.supplyCost}</div>
  `;

  btn.onclick = () => {
    if (!affordable || !hasReqs) return;
    if (building.trainQueue.length >= 5) return;
    deductCost(type, faction, state);
    building.trainQueue.push({ type, progress: 0 });
    building.state = 'training';
  };

  return btn;
}

/** Handle right-click command */
export function handleRightClick(
  state: GameState,
  worldX: number,
  worldY: number,
  _input: InputState
): void {
  const selected = state.selectedEntityIds
    .map(id => state.entities.find(e => e.id === id))
    .filter((e): e is Entity => e !== undefined && e.state !== 'dead');

  if (selected.length === 0) return;

  // Check if clicking on a resource tile
  const { tx, ty } = pixelToTile(worldX, worldY);
  const tile = state.tiles[ty]?.[tx];

  // Check if clicking on an entity
  const targetEntity = getEntityAtPixel(worldX, worldY, state.entities);

  for (const entity of selected) {
    if (entity.faction !== state.playerFaction) continue;

    // Worker harvesting
    if (entity.type === 'worker' && tile) {
      if (tile.type === 'gold_mine' && tile.resource > 0) {
        entity.harvestTileX = tx;
        entity.harvestTileY = ty;
        entity.carrying = null;
        entity.carryAmount = 0;
        entity.state = 'harvesting';
        const target = tileToPixel(tx, ty);
        entity.targetX = target.px;
        entity.targetY = target.py;
        entity.path = [];
        entity.pathIndex = 0;
        continue;
      }
      if (tile.type === 'forest' && tile.resource > 0) {
        entity.harvestTileX = tx;
        entity.harvestTileY = ty;
        entity.carrying = null;
        entity.carryAmount = 0;
        entity.state = 'harvesting';
        const target = tileToPixel(tx, ty);
        entity.targetX = target.px;
        entity.targetY = target.py;
        entity.path = [];
        entity.pathIndex = 0;
        continue;
      }
    }

    // Attack enemy
    if (targetEntity && targetEntity.faction !== entity.faction) {
      entity.attackTarget = targetEntity.id;
      entity.state = 'attacking';
      entity.targetX = targetEntity.x;
      entity.targetY = targetEntity.y;
      entity.path = [];
      entity.pathIndex = 0;
      continue;
    }

    // Move command
    entity.targetX = worldX;
    entity.targetY = worldY;
    entity.state = 'moving';
    entity.attackTarget = null;
    entity.path = [];
    entity.pathIndex = 0;
  }
}

/** Handle left-click (selection) */
export function handleLeftClick(
  state: GameState,
  worldX: number,
  worldY: number,
  shiftKey: boolean
): void {
  const entity = getEntityAtPixel(worldX, worldY, state.entities);

  if (entity) {
    if (shiftKey) {
      // Toggle selection
      const idx = state.selectedEntityIds.indexOf(entity.id);
      if (idx >= 0) {
        state.selectedEntityIds.splice(idx, 1);
      } else {
        state.selectedEntityIds.push(entity.id);
      }
    } else {
      state.selectedEntityIds = [entity.id];
    }
  } else if (!shiftKey) {
    state.selectedEntityIds = [];
  }
}

/** Handle box selection */
export function handleBoxSelect(
  state: GameState,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  shiftKey: boolean
): void {
  const selected = getEntitiesInRect(x1, y1, x2, y2, state.entities, state.playerFaction);
  if (shiftKey) {
    for (const e of selected) {
      if (!state.selectedEntityIds.includes(e.id)) {
        state.selectedEntityIds.push(e.id);
      }
    }
  } else {
    state.selectedEntityIds = selected.map(e => e.id);
  }
}

/** Handle minimap click */
export function handleMinimapClick(
  state: GameState,
  camera: Camera,
  minimapX: number,
  minimapY: number,
  minimapW: number,
  minimapH: number
): void {
  const worldX = (minimapX / minimapW) * state.mapWidth * TILE_SIZE;
  const worldY = (minimapY / minimapH) * state.mapHeight * TILE_SIZE;

  camera.x = worldX - camera.width / 2;
  camera.y = worldY - camera.height / 2;

  // Clamp
  camera.x = Math.max(0, Math.min(state.mapWidth * TILE_SIZE - camera.width, camera.x));
  camera.y = Math.max(0, Math.min(state.mapHeight * TILE_SIZE - camera.height, camera.y));
}
