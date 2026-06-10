import './style.css';
import { BUILDING_STATS } from './data';
import { seedFromQuery } from './random';
import {
  HUD_HEIGHT,
  TOP_BAR_HEIGHT,
  cssHeight,
  cssWidth,
  pointInRect,
  renderGame,
  renderMenu,
  resizeCanvas,
  screenToWorld,
  type ActionButton,
  type BuildPlacementRender,
  type Camera,
  type GameHitboxes,
  type MenuHitboxes,
} from './renderer';
import { GameSimulation } from './simulation';
import type { BuildingType, Entity, FactionId, Point, Rect, UnitType } from './types';
import { TILE_SIZE } from './types';
import { LEVELS } from './wfc';

const STEP_SECONDS = 1 / 60;
const STORAGE_KEY = 'warband-unlocked-level';

const queriedCanvas = document.querySelector<HTMLCanvasElement>('#game');
if (queriedCanvas === null) {
  throw new Error('missing #game canvas');
}
const canvas: HTMLCanvasElement = queriedCanvas;
const queriedContext = canvas.getContext('2d');
if (queriedContext === null) {
  throw new Error('2D canvas context unavailable');
}
const context: CanvasRenderingContext2D = queriedContext;

const campaignSeed = seedFromQuery(window.location.search);
let selectedFaction: FactionId = 'humans';
let selectedLevel = 1;
let unlockedLevel = loadUnlockedLevel();
let sim: GameSimulation | null = null;
const camera: Camera = { x: 0, y: 0, width: 20, height: 15 };
let paused = false;
let speed: 1 | 2 = 1;
let accumulator = 0;
let lastTimestamp = 0;
let selectedIds = new Set<number>();
let controlGroups: Array<Set<number>> = Array.from({ length: 10 }, () => new Set<number>());
let buildPlacement: BuildingType | null = null;
let attackMovePending = false;
let message = '';
let messageTimer = 0;
let menuHitboxes: MenuHitboxes = { buttons: [] };
let gameHitboxes: GameHitboxes | null = null;
let mouse = { x: 0, y: 0 };
let dragStart: Point | null = null;
let dragCurrent: Point | null = null;
let minimapDragging = false;
let victoryHandledForLevel = 0;
const keys = new Set<string>();

resizeCanvas(canvas);
updateCameraSize();

window.addEventListener('resize', () => {
  resizeCanvas(canvas);
  updateCameraSize();
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

canvas.addEventListener('mousemove', (event) => {
  mouse = canvasPoint(event);
  if (dragStart !== null) {
    dragCurrent = mouse;
  }
  if (minimapDragging) {
    handleMinimapPoint(mouse);
  }
});

canvas.addEventListener('mousedown', (event) => {
  mouse = canvasPoint(event);
  if (event.button === 0) {
    handleLeftDown(mouse);
  } else if (event.button === 2) {
    handleRightClick(mouse);
  }
});

window.addEventListener('mouseup', (event) => {
  const point = canvasPoint(event);
  if (event.button === 0) {
    handleLeftUp(point, event.shiftKey);
  }
  minimapDragging = false;
});

window.addEventListener('keydown', (event) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
  handleKeyDown(event);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

requestAnimationFrame(loop);

function loop(timestamp: number): void {
  const realDt = lastTimestamp === 0 ? 0 : Math.min(0.1, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  updateCameraFromInput(realDt);
  updateMessage(realDt);

  if (sim !== null && sim.status === 'playing' && !paused) {
    accumulator += realDt * speed;
    const maxSteps = 12;
    let steps = 0;
    while (accumulator >= STEP_SECONDS && steps < maxSteps) {
      sim.update(STEP_SECONDS);
      accumulator -= STEP_SECONDS;
      steps += 1;
    }
    if (steps === maxSteps) {
      accumulator = 0;
    }
  }

  if (sim !== null && sim.status === 'victory' && victoryHandledForLevel !== sim.level) {
    unlockedLevel = Math.max(unlockedLevel, Math.min(LEVELS.length, sim.level + 1));
    saveUnlockedLevel(unlockedLevel);
    victoryHandledForLevel = sim.level;
  }

  if (sim === null) {
    menuHitboxes = renderMenu(context, canvas, campaignSeed, selectedFaction, selectedLevel, unlockedLevel);
  } else {
    updateCameraSize();
    gameHitboxes = renderGame(context, canvas, sim, camera, selectedIds, currentPlacement(), message, paused, speed, attackMovePending);
    drawSelectionDrag(context);
  }
  requestAnimationFrame(loop);
}

function handleLeftDown(point: Point): void {
  if (sim === null) {
    handleMenuClick(point);
    return;
  }
  const hitboxes = gameHitboxes;
  if (hitboxes === null) {
    return;
  }
  if (pointInRect(point, hitboxes.minimap)) {
    minimapDragging = true;
    handleMinimapPoint(point);
    return;
  }
  if (pointInRect(point, hitboxes.pauseButton)) {
    paused = !paused;
    showMessage(paused ? 'Paused.' : 'Resumed.');
    return;
  }
  if (pointInRect(point, hitboxes.speedButton)) {
    toggleSpeed();
    return;
  }
  const action = hitboxes.actionButtons.find((button) => button.enabled && pointInRect(point, button.rect));
  if (action !== undefined) {
    handleActionButton(action);
    return;
  }
  if (pointInRect(point, hitboxes.world)) {
    dragStart = point;
    dragCurrent = point;
  }
}

function handleLeftUp(point: Point, shiftKey: boolean): void {
  if (sim === null || dragStart === null || gameHitboxes === null) {
    dragStart = null;
    dragCurrent = null;
    return;
  }
  const distanceSquared = (point.x - dragStart.x) ** 2 + (point.y - dragStart.y) ** 2;
  if (distanceSquared < 25) {
    const world = screenToWorld(point, camera, gameHitboxes.world);
    const entity = sim.entityAtWorld(world, 0);
    if (!shiftKey) {
      selectedIds = new Set<number>();
    }
    if (entity !== null && entity.owner === 0) {
      if (shiftKey && selectedIds.has(entity.id)) {
        selectedIds.delete(entity.id);
      } else {
        selectedIds.add(entity.id);
      }
    }
  } else {
    const a = screenToWorld(dragStart, camera, gameHitboxes.world);
    const b = screenToWorld(point, camera, gameHitboxes.world);
    const entities = sim.entitiesInWorldRect({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, 0);
    const units = entities.filter((entity) => entity.kind === 'unit');
    const chosen = units.length > 0 ? units : entities;
    if (!shiftKey) {
      selectedIds = new Set<number>();
    }
    for (const entity of chosen) {
      selectedIds.add(entity.id);
    }
  }
  dragStart = null;
  dragCurrent = null;
}

function handleRightClick(point: Point): void {
  if (sim === null || gameHitboxes === null || !pointInRect(point, gameHitboxes.world)) {
    return;
  }
  const world = screenToWorld(point, camera, gameHitboxes.world);
  if (buildPlacement !== null) {
    const stats = BUILDING_STATS[buildPlacement];
    const tileX = Math.floor(world.x - stats.footprint.width / 2);
    const tileY = Math.floor(world.y - stats.footprint.height / 2);
    const worker = selectedWorker();
    if (worker === null) {
      showMessage('Select a worker to place the building.');
      return;
    }
    const result = sim.placeBuilding(worker.id, buildPlacement, tileX, tileY);
    if (result.ok) {
      showMessage(`${stats.humanName} foundation placed.`);
      buildPlacement = null;
    } else {
      showMessage(result.reason);
    }
    return;
  }
  const ownUnits = selectedOwnUnits();
  if (ownUnits.length === 0) {
    return;
  }
  const target = sim.entityAtWorld(world, 0);
  if (attackMovePending) {
    sim.issueMove(ownUnits.map((entity) => entity.id), world, true);
    attackMovePending = false;
    showMessage('Attack-move ordered.');
    return;
  }
  if (target !== null && target.owner !== 0) {
    sim.issueAttack(ownUnits.map((entity) => entity.id), target.id);
    showMessage('Attack ordered.');
    return;
  }
  if (target !== null && target.owner === 0 && target.hp < target.maxHp && ownUnits.some((entity) => entity.type === 'worker')) {
    sim.issueRepair(ownUnits.map((entity) => entity.id), target.id);
    showMessage('Repair ordered.');
    return;
  }
  const tileX = Math.floor(world.x);
  const tileY = Math.floor(world.y);
  if (tileX >= 0 && tileY >= 0 && tileX < sim.map.width && tileY < sim.map.height) {
    const tile = sim.map.tiles[tileY * sim.map.width + tileX];
    if (tile === 'gold' && ownUnits.some((entity) => entity.type === 'worker')) {
      sim.issueHarvest(ownUnits.map((entity) => entity.id), 'gold', { x: tileX, y: tileY });
      showMessage('Gold harvesting ordered.');
      return;
    }
    if (tile === 'forest' && ownUnits.some((entity) => entity.type === 'worker')) {
      sim.issueHarvest(ownUnits.map((entity) => entity.id), 'wood', { x: tileX, y: tileY });
      showMessage('Wood harvesting ordered.');
      return;
    }
  }
  sim.issueMove(ownUnits.map((entity) => entity.id), world, false);
  showMessage('Move ordered.');
}

function handleMenuClick(point: Point): void {
  const button = menuHitboxes.buttons.find((candidate) => candidate.enabled && pointInRect(point, candidate.rect));
  if (button === undefined) {
    return;
  }
  if (button.id.startsWith('faction:')) {
    selectedFaction = button.id.endsWith('humans') ? 'humans' : 'orcs';
  } else if (button.id.startsWith('level:')) {
    selectedLevel = Number.parseInt(button.id.slice('level:'.length), 10);
  } else if (button.id === 'start') {
    startGame();
  }
}

function handleActionButton(button: ActionButton): void {
  if (sim === null) {
    return;
  }
  if (button.id.startsWith('build:')) {
    buildPlacement = button.id.slice('build:'.length) as BuildingType;
    attackMovePending = false;
    showMessage('Move the preview and right-click to place the foundation.');
    return;
  }
  if (button.id.startsWith('train:')) {
    const unitType = button.id.slice('train:'.length) as UnitType;
    const building = selectedPrimaryBuilding();
    if (building === null) {
      return;
    }
    const result = sim.queueTraining(building.id, unitType);
    showMessage(result.ok ? 'Training started.' : result.reason);
    return;
  }
  if (button.id === 'command:attackMove') {
    attackMovePending = true;
    buildPlacement = null;
    showMessage('Right-click the destination for attack-move.');
    return;
  }
  if (button.id === 'command:stop') {
    sim.issueStop([...selectedIds]);
    attackMovePending = false;
    showMessage('Orders stopped.');
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (sim === null) {
    if (event.code === 'Enter') {
      startGame();
    }
    return;
  }
  if (event.code === 'Escape') {
    if (sim.status === 'victory' || sim.status === 'defeat') {
      sim = null;
      selectedIds = new Set<number>();
      buildPlacement = null;
      attackMovePending = false;
    } else {
      buildPlacement = null;
      attackMovePending = false;
      showMessage('Pending command cancelled.');
    }
    return;
  }
  if (event.code === 'Space') {
    paused = !paused;
    showMessage(paused ? 'Paused.' : 'Resumed.');
    return;
  }
  if (event.code === 'KeyT') {
    toggleSpeed();
    return;
  }
  if (event.code === 'KeyA') {
    attackMovePending = true;
    buildPlacement = null;
    showMessage('Right-click the destination for attack-move.');
    return;
  }
  if (/^Digit[1-9]$/.test(event.code)) {
    const group = Number.parseInt(event.code.slice('Digit'.length), 10);
    if (event.ctrlKey || event.metaKey) {
      controlGroups[group] = new Set([...selectedIds].filter((id) => sim?.entities.get(id)?.owner === 0));
      showMessage(`Control group ${group} assigned.`);
    } else {
      selectedIds = new Set([...controlGroups[group] ?? []].filter((id) => sim?.entities.has(id) === true));
      showMessage(`Control group ${group} selected.`);
    }
  }
}

function startGame(): void {
  sim = new GameSimulation({ campaignSeed, level: selectedLevel, playerFaction: selectedFaction });
  selectedIds = new Set<number>();
  controlGroups = Array.from({ length: 10 }, () => new Set<number>());
  buildPlacement = null;
  attackMovePending = false;
  paused = false;
  speed = 1;
  victoryHandledForLevel = 0;
  const start = sim.map.starts[0];
  updateCameraSize();
  centerCameraOn({ x: start.x, y: start.y });
  showMessage('Establish your economy, scout through fog, and destroy every enemy building.');
}

function updateCameraSize(): void {
  const worldHeight = Math.max(1, cssHeight(canvas) - TOP_BAR_HEIGHT - HUD_HEIGHT);
  camera.width = cssWidth(canvas) / TILE_SIZE;
  camera.height = worldHeight / TILE_SIZE;
  clampCamera();
}

function updateCameraFromInput(dt: number): void {
  if (sim === null || gameHitboxes === null) {
    return;
  }
  const scrollSpeed = 13;
  let dx = 0;
  let dy = 0;
  if (keys.has('ArrowLeft')) {
    dx -= 1;
  }
  if (keys.has('ArrowRight')) {
    dx += 1;
  }
  if (keys.has('ArrowUp')) {
    dy -= 1;
  }
  if (keys.has('ArrowDown')) {
    dy += 1;
  }
  const edge = 18;
  const width = cssWidth(canvas);
  const height = cssHeight(canvas);
  if (mouse.y >= TOP_BAR_HEIGHT && mouse.y <= height - HUD_HEIGHT) {
    if (mouse.x < edge) {
      dx -= 1;
    } else if (mouse.x > width - edge) {
      dx += 1;
    }
    if (mouse.y < TOP_BAR_HEIGHT + edge) {
      dy -= 1;
    } else if (mouse.y > height - HUD_HEIGHT - edge) {
      dy += 1;
    }
  }
  if (dx !== 0 || dy !== 0) {
    const length = Math.hypot(dx, dy);
    camera.x += (dx / length) * scrollSpeed * dt;
    camera.y += (dy / length) * scrollSpeed * dt;
    clampCamera();
  }
}

function clampCamera(): void {
  if (sim === null) {
    return;
  }
  camera.x = Math.max(0, Math.min(sim.map.width - camera.width, camera.x));
  camera.y = Math.max(0, Math.min(sim.map.height - camera.height, camera.y));
}

function centerCameraOn(point: Point): void {
  camera.x = point.x - camera.width / 2;
  camera.y = point.y - camera.height / 2;
  clampCamera();
}

function handleMinimapPoint(point: Point): void {
  if (sim === null || gameHitboxes === null) {
    return;
  }
  const rect = gameHitboxes.minimap;
  const x = ((point.x - rect.x) / rect.width) * sim.map.width;
  const y = ((point.y - rect.y) / rect.height) * sim.map.height;
  centerCameraOn({ x, y });
}

function currentPlacement(): BuildPlacementRender | null {
  if (sim === null || buildPlacement === null || gameHitboxes === null) {
    return null;
  }
  const world = screenToWorld(mouse, camera, gameHitboxes.world);
  const stats = BUILDING_STATS[buildPlacement];
  const tileX = Math.floor(world.x - stats.footprint.width / 2);
  const tileY = Math.floor(world.y - stats.footprint.height / 2);
  return {
    buildingType: buildPlacement,
    tileX,
    tileY,
    valid: sim.canPlaceBuilding(0, buildPlacement, tileX, tileY),
  };
}

function drawSelectionDrag(ctx: CanvasRenderingContext2D): void {
  if (dragStart === null || dragCurrent === null) {
    return;
  }
  const rect = normalizeRect(dragStart, dragCurrent);
  ctx.strokeStyle = '#f1e36f';
  ctx.fillStyle = 'rgba(241, 227, 111, 0.12)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function selectedOwnUnits(): Entity[] {
  if (sim === null) {
    return [];
  }
  return [...selectedIds]
    .map((id) => sim?.entities.get(id))
    .filter((entity): entity is Entity => entity !== undefined && entity.owner === 0 && entity.kind === 'unit');
}

function selectedWorker(): Entity | null {
  return selectedOwnUnits().find((entity) => entity.type === 'worker') ?? null;
}

function selectedPrimaryBuilding(): Entity | null {
  if (sim === null) {
    return null;
  }
  for (const id of selectedIds) {
    const entity = sim.entities.get(id);
    if (entity !== undefined && entity.owner === 0 && entity.kind === 'building') {
      return entity;
    }
  }
  return null;
}

function toggleSpeed(): void {
  speed = speed === 1 ? 2 : 1;
  showMessage(`Simulation speed ${speed}x.`);
}

function showMessage(text: string): void {
  message = text;
  messageTimer = 4;
}

function updateMessage(dt: number): void {
  if (messageTimer <= 0) {
    message = '';
    return;
  }
  messageTimer -= dt;
  if (messageTimer <= 0) {
    message = '';
  }
}

function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function canvasPoint(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function loadUnlockedLevel(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return 1;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    return Math.max(1, Math.min(LEVELS.length, parsed));
  } catch {
    return 1;
  }
}

function saveUnlockedLevel(level: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(level));
  } catch {
    // Local storage can be disabled; campaign unlocks still work for the current session.
  }
}
