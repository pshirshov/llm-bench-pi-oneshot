import { BUILDING_STATS, BUILD_BUTTON_ORDER, FACTIONS, TILE_COLORS, TRAIN_BUTTON_ORDER, UNIT_STATS, displayBuildingName, displayUnitName } from './data';
import { calculateSupply } from './mechanics';
import { entityCenter, type GameSimulation } from './simulation';
import type { BuildingType, Entity, FactionId, GameStatus, Point, Rect, UnitType } from './types';
import { TILE_SIZE } from './types';
import { LEVELS, mapHash } from './wfc';

export const TOP_BAR_HEIGHT = 38;
export const HUD_HEIGHT = 170;
export const MINIMAP_SIZE = 142;

export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActionButton {
  id: string;
  rect: Rect;
  label: string;
  enabled: boolean;
}

export interface MenuButton {
  id: string;
  rect: Rect;
  enabled: boolean;
}

export interface GameHitboxes {
  actionButtons: ActionButton[];
  minimap: Rect;
  world: Rect;
  pauseButton: Rect;
  speedButton: Rect;
}

export interface MenuHitboxes {
  buttons: MenuButton[];
}

export interface BuildPlacementRender {
  buildingType: BuildingType;
  tileX: number;
  tileY: number;
  valid: boolean;
}

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(960, window.innerWidth);
  const height = Math.max(640, window.innerHeight);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('2D canvas context unavailable');
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

export function renderMenu(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  campaignSeed: number,
  selectedFaction: FactionId,
  selectedLevel: number,
  unlockedLevel: number,
): MenuHitboxes {
  const width = cssWidth(canvas);
  const height = cssHeight(canvas);
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#151c25');
  gradient.addColorStop(1, '#2b2117');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#f5df9c';
  ctx.font = 'bold 64px serif';
  ctx.textAlign = 'center';
  ctx.fillText('Warband', width / 2, 105);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#d7d0bd';
  ctx.fillText('A deterministic Canvas RTS campaign', width / 2, 138);
  ctx.fillText(`Campaign seed: ${campaignSeed}`, width / 2, 166);

  const buttons: MenuButton[] = [];
  const factionY = 210;
  const humanRect = { x: width / 2 - 230, y: factionY, width: 180, height: 56 };
  const orcRect = { x: width / 2 + 50, y: factionY, width: 180, height: 56 };
  drawButton(ctx, humanRect, 'Humans', selectedFaction === 'humans', true);
  drawButton(ctx, orcRect, 'Orcs', selectedFaction === 'orcs', true);
  buttons.push({ id: 'faction:humans', rect: humanRect, enabled: true }, { id: 'faction:orcs', rect: orcRect, enabled: true });

  ctx.fillStyle = '#f1ead8';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Campaign Levels', width / 2, 318);
  const levelStartX = width / 2 - 390;
  for (const level of LEVELS) {
    const index = level.level - 1;
    const rect = { x: levelStartX + index * 160, y: 350, width: 140, height: 106 };
    const enabled = level.level <= unlockedLevel;
    drawButton(ctx, rect, `${level.level}. ${level.name}`, selectedLevel === level.level, enabled);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = enabled ? '#ded7c4' : '#777';
    wrapText(ctx, level.description, rect.x + 10, rect.y + 48, rect.width - 20, 15, 3);
    buttons.push({ id: `level:${level.level}`, rect, enabled });
  }

  const startRect = { x: width / 2 - 130, y: height - 135, width: 260, height: 62 };
  drawButton(ctx, startRect, selectedLevel <= unlockedLevel ? 'Start Battle' : 'Locked', false, selectedLevel <= unlockedLevel);
  buttons.push({ id: 'start', rect: startRect, enabled: selectedLevel <= unlockedLevel });

  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#c7c0ae';
  ctx.fillText('Win a level to unlock the next. Add ?seed=<number> to the URL for reproducible campaigns.', width / 2, height - 38);
  return { buttons };
}

export function renderGame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sim: GameSimulation,
  camera: Camera,
  selectedIds: ReadonlySet<number>,
  placement: BuildPlacementRender | null,
  transientMessage: string,
  paused: boolean,
  speed: 1 | 2,
  attackMovePending: boolean,
): GameHitboxes {
  const width = cssWidth(canvas);
  const height = cssHeight(canvas);
  const worldRect = { x: 0, y: TOP_BAR_HEIGHT, width, height: Math.max(1, height - TOP_BAR_HEIGHT - HUD_HEIGHT) };
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, width, height);
  drawWorld(ctx, sim, camera, selectedIds, placement, worldRect);
  drawTopBar(ctx, sim, width, paused, speed);
  const hitboxes = drawHud(ctx, sim, selectedIds, width, height, transientMessage, attackMovePending);
  drawMinimap(ctx, sim, camera, hitboxes.minimap);
  if (sim.status === 'victory' || sim.status === 'defeat') {
    drawEndOverlay(ctx, width, height, sim.status, sim.message);
  }
  return { ...hitboxes, world: worldRect };
}

export function worldToScreen(point: Point, camera: Camera, worldRect: Rect): Point {
  return {
    x: worldRect.x + (point.x - camera.x) * TILE_SIZE,
    y: worldRect.y + (point.y - camera.y) * TILE_SIZE,
  };
}

export function screenToWorld(point: Point, camera: Camera, worldRect: Rect): Point {
  return {
    x: camera.x + (point.x - worldRect.x) / TILE_SIZE,
    y: camera.y + (point.y - worldRect.y) / TILE_SIZE,
  };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

export function cssWidth(canvas: HTMLCanvasElement): number {
  return canvas.width / (window.devicePixelRatio || 1);
}

export function cssHeight(canvas: HTMLCanvasElement): number {
  return canvas.height / (window.devicePixelRatio || 1);
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  sim: GameSimulation,
  camera: Camera,
  selectedIds: ReadonlySet<number>,
  placement: BuildPlacementRender | null,
  worldRect: Rect,
): void {
  const startX = Math.max(0, Math.floor(camera.x));
  const endX = Math.min(sim.map.width - 1, Math.ceil(camera.x + camera.width));
  const startY = Math.max(0, Math.floor(camera.y));
  const endY = Math.min(sim.map.height - 1, Math.ceil(camera.y + camera.height));
  ctx.save();
  ctx.beginPath();
  ctx.rect(worldRect.x, worldRect.y, worldRect.width, worldRect.height);
  ctx.clip();
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const screen = worldToScreen({ x, y }, camera, worldRect);
      const fog = sim.fogAt(0, x, y);
      if (fog === 0) {
        ctx.fillStyle = '#000';
        ctx.fillRect(screen.x, screen.y, TILE_SIZE + 1, TILE_SIZE + 1);
        continue;
      }
      const tile = sim.map.tiles[y * sim.map.width + x]!;
      ctx.fillStyle = TILE_COLORS[tile];
      ctx.fillRect(screen.x, screen.y, TILE_SIZE + 1, TILE_SIZE + 1);
      drawTileDetail(ctx, tile, screen.x, screen.y);
      if (fog === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(screen.x, screen.y, TILE_SIZE + 1, TILE_SIZE + 1);
        const snapshot = sim.snapshotAt(0, x, y);
        if (snapshot !== undefined) {
          drawSnapshot(ctx, snapshot, camera, worldRect);
        }
      }
    }
  }

  for (const corpse of sim.corpses) {
    const tileX = Math.floor(corpse.x);
    const tileY = Math.floor(corpse.y);
    if (sim.fogAt(0, tileX, tileY) !== 2) {
      continue;
    }
    const screen = worldToScreen({ x: corpse.x, y: corpse.y }, camera, worldRect);
    ctx.globalAlpha = Math.max(0, corpse.remaining / corpse.total) * 0.55;
    ctx.fillStyle = corpse.color;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, corpse.radius * TILE_SIZE, corpse.radius * TILE_SIZE * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const entities = [...sim.entities.values()].sort((a, b) => entityCenter(a).y - entityCenter(b).y);
  for (const entity of entities) {
    if (entity.owner !== 0 && !sim.isEntityVisibleToSide(entity, 0)) {
      continue;
    }
    drawEntity(ctx, entity, camera, worldRect, selectedIds.has(entity.id));
  }

  for (const projectile of sim.projectiles) {
    const screen = worldToScreen({ x: projectile.x, y: projectile.y }, camera, worldRect);
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (placement !== null) {
    const stats = BUILDING_STATS[placement.buildingType];
    const screen = worldToScreen({ x: placement.tileX, y: placement.tileY }, camera, worldRect);
    ctx.fillStyle = placement.valid ? 'rgba(80, 220, 80, 0.35)' : 'rgba(220, 60, 60, 0.38)';
    ctx.fillRect(screen.x, screen.y, stats.footprint.width * TILE_SIZE, stats.footprint.height * TILE_SIZE);
    ctx.strokeStyle = placement.valid ? '#75ff75' : '#ff6666';
    ctx.lineWidth = 2;
    ctx.strokeRect(screen.x, screen.y, stats.footprint.width * TILE_SIZE, stats.footprint.height * TILE_SIZE);
  }

  ctx.restore();
}

function drawTileDetail(ctx: CanvasRenderingContext2D, tile: string, x: number, y: number): void {
  if (tile === 'forest') {
    ctx.fillStyle = '#143f20';
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 5);
    ctx.lineTo(x + 27, y + 25);
    ctx.lineTo(x + 5, y + 25);
    ctx.closePath();
    ctx.fill();
  } else if (tile === 'water') {
    ctx.strokeStyle = 'rgba(170,210,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 12);
    ctx.quadraticCurveTo(x + 12, y + 8, x + 20, y + 12);
    ctx.quadraticCurveTo(x + 26, y + 16, x + 31, y + 12);
    ctx.stroke();
  } else if (tile === 'gold') {
    ctx.fillStyle = '#ffd75a';
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 4);
    ctx.lineTo(x + 27, y + 16);
    ctx.lineTo(x + 17, y + 28);
    ctx.lineTo(x + 5, y + 17);
    ctx.closePath();
    ctx.fill();
  } else if (tile === 'rock') {
    ctx.fillStyle = '#555a61';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 25);
    ctx.lineTo(x + 12, y + 8);
    ctx.lineTo(x + 22, y + 6);
    ctx.lineTo(x + 28, y + 25);
    ctx.closePath();
    ctx.fill();
  }
}

function drawEntity(ctx: CanvasRenderingContext2D, entity: Entity, camera: Camera, worldRect: Rect, selected: boolean): void {
  const faction = FACTIONS[entity.faction];
  const center = entityCenter(entity);
  const screen = worldToScreen(center, camera, worldRect);
  if (entity.kind === 'building' && entity.building !== undefined) {
    const topLeft = worldToScreen({ x: entity.x, y: entity.y }, camera, worldRect);
    const width = entity.building.footprint.width * TILE_SIZE;
    const height = entity.building.footprint.height * TILE_SIZE;
    ctx.fillStyle = entity.completed ? faction.dark : '#6b604c';
    ctx.fillRect(topLeft.x + 2, topLeft.y + 2, width - 4, height - 4);
    ctx.strokeStyle = faction.color;
    ctx.lineWidth = selected ? 4 : 2;
    ctx.strokeRect(topLeft.x + 3, topLeft.y + 3, width - 6, height - 6);
    ctx.fillStyle = faction.accent;
    if (entity.type === 'guardTower') {
      ctx.fillRect(topLeft.x + width * 0.35, topLeft.y + 6, width * 0.3, height - 12);
    } else if (entity.type === 'farm') {
      ctx.beginPath();
      ctx.moveTo(topLeft.x + width / 2, topLeft.y + 6);
      ctx.lineTo(topLeft.x + width - 8, topLeft.y + height / 2);
      ctx.lineTo(topLeft.x + 8, topLeft.y + height / 2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(topLeft.x + width * 0.25, topLeft.y + height * 0.25, width * 0.5, height * 0.5);
    }
    drawHealthBar(ctx, topLeft.x + 4, topLeft.y - 8, width - 8, entity.hp / entity.maxHp);
    if (!entity.completed) {
      drawProgressBar(ctx, topLeft.x + 4, topLeft.y + height + 3, width - 8, entity.buildProgress / entity.buildTime, '#d7b356');
    }
    return;
  }

  if (selected) {
    ctx.strokeStyle = '#f1e36f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y + 8, entity.radius * TILE_SIZE * 1.4, entity.radius * TILE_SIZE * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = faction.color;
  ctx.beginPath();
  if (entity.type === 'worker') {
    ctx.rect(screen.x - 8, screen.y - 9, 16, 18);
  } else if (entity.type === 'ranged') {
    ctx.moveTo(screen.x, screen.y - 12);
    ctx.lineTo(screen.x + 12, screen.y + 10);
    ctx.lineTo(screen.x - 12, screen.y + 10);
    ctx.closePath();
  } else if (entity.type === 'heavy') {
    ctx.arc(screen.x, screen.y, 13, 0, Math.PI * 2);
  } else {
    ctx.rect(screen.x - 10, screen.y - 10, 20, 20);
  }
  ctx.fill();
  ctx.strokeStyle = faction.dark;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (entity.unit?.carried !== null && entity.unit?.carried !== undefined) {
    ctx.fillStyle = entity.unit.carried.kind === 'gold' ? '#ffd75a' : '#8b5a2b';
    ctx.fillRect(screen.x + 5, screen.y - 17, 8, 8);
  }
  drawHealthBar(ctx, screen.x - 15, screen.y - 21, 30, entity.hp / entity.maxHp);
}

function drawSnapshot(ctx: CanvasRenderingContext2D, snapshot: { faction: FactionId; x: number; y: number; width: number; height: number }, camera: Camera, worldRect: Rect): void {
  const topLeft = worldToScreen({ x: snapshot.x, y: snapshot.y }, camera, worldRect);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = FACTIONS[snapshot.faction].color;
  ctx.fillRect(topLeft.x + 4, topLeft.y + 4, snapshot.width * TILE_SIZE - 8, snapshot.height * TILE_SIZE - 8);
  ctx.globalAlpha = 1;
}

function drawTopBar(ctx: CanvasRenderingContext2D, sim: GameSimulation, width: number, paused: boolean, speed: 1 | 2): void {
  const player = sim.players[0];
  const supply = sim.getSupply(0);
  ctx.fillStyle = '#161a1e';
  ctx.fillRect(0, 0, width, TOP_BAR_HEIGHT);
  ctx.fillStyle = '#d7c78f';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Gold ${player.resources.gold}`, 14, 24);
  ctx.fillText(`Wood ${player.resources.wood}`, 130, 24);
  ctx.fillText(`Supply ${supply.used}/${supply.cap}`, 252, 24);
  ctx.fillText(`Seed ${sim.campaignSeed}  Level ${sim.level}  Map ${mapHash(sim.map)}`, 405, 24);
  ctx.textAlign = 'right';
  ctx.fillStyle = paused ? '#ffcf6e' : '#d7c78f';
  ctx.fillText(`${paused ? 'Paused' : 'Running'} ${speed}x`, width - 16, 24);
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  sim: GameSimulation,
  selectedIds: ReadonlySet<number>,
  width: number,
  height: number,
  message: string,
  attackMovePending: boolean,
): Omit<GameHitboxes, 'world'> {
  const hudY = height - HUD_HEIGHT;
  ctx.fillStyle = '#14110e';
  ctx.fillRect(0, hudY, width, HUD_HEIGHT);
  ctx.strokeStyle = '#4d3e2a';
  ctx.strokeRect(0, hudY, width, HUD_HEIGHT);

  const minimap = { x: 14, y: hudY + 14, width: MINIMAP_SIZE, height: MINIMAP_SIZE };
  const pauseButton = { x: width - 190, y: hudY + 12, width: 78, height: 30 };
  const speedButton = { x: width - 102, y: hudY + 12, width: 78, height: 30 };
  drawButton(ctx, pauseButton, 'Space', false, true);
  drawButton(ctx, speedButton, 'Speed', false, true);

  const selected = [...selectedIds].map((id) => sim.entities.get(id)).filter((entity): entity is Entity => entity !== undefined);
  drawSelectionPanel(ctx, sim, selected, { x: 174, y: hudY + 12, width: 330, height: HUD_HEIGHT - 24 });
  const actionButtons = drawActionButtons(ctx, sim, selected, { x: 520, y: hudY + 52, width: width - 730, height: HUD_HEIGHT - 64 }, attackMovePending);

  ctx.textAlign = 'left';
  ctx.font = '14px sans-serif';
  ctx.fillStyle = message.length > 0 ? '#ffcf6e' : '#bfb7a6';
  ctx.fillText(message.length > 0 ? message : 'A: attack-move  |  Right-click: order  |  Ctrl+1..9: assign group', 520, hudY + 32);
  return { actionButtons, minimap, pauseButton, speedButton };
}

function drawSelectionPanel(ctx: CanvasRenderingContext2D, sim: GameSimulation, selected: readonly Entity[], rect: Rect): void {
  ctx.fillStyle = '#211a14';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#5d4931';
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.textAlign = 'left';
  if (selected.length === 0) {
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#d3c7b0';
    ctx.fillText('No selection', rect.x + 14, rect.y + 28);
    return;
  }
  const primary = selected[0]!;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#f2e0a2';
  ctx.fillText(entityDisplayName(primary), rect.x + 14, rect.y + 26);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#d7cfbd';
  ctx.fillText(`${selected.length} selected`, rect.x + 14, rect.y + 48);
  ctx.fillText(`HP ${Math.ceil(primary.hp)}/${primary.maxHp}  Armor ${primary.armor}`, rect.x + 14, rect.y + 68);
  if (primary.kind === 'unit') {
    ctx.fillText(`Damage ${primary.attackDamage}  Range ${primary.attackRange.toFixed(1)}`, rect.x + 14, rect.y + 88);
    if (primary.unit?.carried !== null && primary.unit?.carried !== undefined) {
      ctx.fillText(`Carrying ${primary.unit.carried.amount} ${primary.unit.carried.kind}`, rect.x + 14, rect.y + 108);
    }
  } else if (primary.building !== undefined) {
    const supply = calculateSupply(sim.players[primary.owner], sim.entities.values());
    ctx.fillText(`Supply ${supply.used}/${supply.cap}`, rect.x + 14, rect.y + 88);
    const queue = primary.building.trainQueue[0];
    if (queue !== undefined) {
      ctx.fillText(`Training ${displayUnitName(primary.faction, queue.unitType)}`, rect.x + 14, rect.y + 108);
      drawProgressBar(ctx, rect.x + 14, rect.y + 116, rect.width - 28, 1 - queue.remaining / queue.total, '#6fa8dc');
    }
  }

  let iconX = rect.x + 180;
  let iconY = rect.y + 18;
  for (const entity of selected.slice(0, 12)) {
    ctx.fillStyle = FACTIONS[entity.faction].color;
    ctx.fillRect(iconX, iconY, 28, 28);
    ctx.fillStyle = '#111';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(entity.kind === 'unit' ? (entity.type as string).slice(0, 1).toUpperCase() : 'B', iconX + 14, iconY + 18);
    iconX += 34;
    if (iconX > rect.x + rect.width - 34) {
      iconX = rect.x + 180;
      iconY += 34;
    }
  }
}

function drawActionButtons(
  ctx: CanvasRenderingContext2D,
  sim: GameSimulation,
  selected: readonly Entity[],
  rect: Rect,
  attackMovePending: boolean,
): ActionButton[] {
  const buttons: ActionButton[] = [];
  const buttonWidth = 112;
  const buttonHeight = 32;
  let x = rect.x;
  let y = rect.y;
  function add(id: string, label: string, enabled: boolean): void {
    const buttonRect = { x, y, width: buttonWidth, height: buttonHeight };
    drawButton(ctx, buttonRect, label, id === 'command:attackMove' && attackMovePending, enabled);
    buttons.push({ id, rect: buttonRect, label, enabled });
    x += buttonWidth + 8;
    if (x + buttonWidth > rect.x + rect.width) {
      x = rect.x;
      y += buttonHeight + 8;
    }
  }
  if (selected.length === 0) {
    add('noop', 'Select units', false);
    return buttons;
  }
  const ownSelected = selected.filter((entity) => entity.owner === 0);
  const workers = ownSelected.filter((entity) => entity.kind === 'unit' && entity.type === 'worker');
  if (workers.length > 0) {
    for (const building of BUILD_BUTTON_ORDER) {
      const stats = BUILDING_STATS[building];
      const player = sim.players[0];
      add(`build:${building}`, `${displayBuildingName(player.faction, building)} ${stats.goldCost}/${stats.woodCost}`, player.resources.gold >= stats.goldCost && player.resources.wood >= stats.woodCost);
    }
  }
  const primary = ownSelected[0];
  if (primary?.kind === 'building' && primary.building !== undefined && primary.completed) {
    const stats = BUILDING_STATS[primary.type as BuildingType];
    for (const unit of TRAIN_BUTTON_ORDER) {
      if (!stats.trains.includes(unit)) {
        continue;
      }
      const unitStats = UNIT_STATS[unit];
      add(`train:${unit}`, `${displayUnitName(primary.faction, unit)} ${unitStats.goldCost}/${unitStats.woodCost}`, true);
    }
  }
  if (ownSelected.some((entity) => entity.kind === 'unit')) {
    add('command:attackMove', 'Attack-Move', true);
    add('command:stop', 'Stop', true);
  }
  return buttons;
}

function drawMinimap(ctx: CanvasRenderingContext2D, sim: GameSimulation, camera: Camera, rect: Rect): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  const scaleX = rect.width / sim.map.width;
  const scaleY = rect.height / sim.map.height;
  for (let y = 0; y < sim.map.height; y += 1) {
    for (let x = 0; x < sim.map.width; x += 1) {
      const fog = sim.fogAt(0, x, y);
      if (fog === 0) {
        ctx.fillStyle = '#000';
      } else {
        const tile = sim.map.tiles[y * sim.map.width + x]!;
        ctx.fillStyle = fog === 2 ? TILE_COLORS[tile] : '#252525';
      }
      ctx.fillRect(rect.x + x * scaleX, rect.y + y * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
    }
  }
  for (const entity of sim.entities.values()) {
    if (entity.owner !== 0 && !sim.isEntityVisibleToSide(entity, 0)) {
      continue;
    }
    const center = entityCenter(entity);
    ctx.fillStyle = FACTIONS[entity.faction].color;
    ctx.fillRect(rect.x + center.x * scaleX - 1, rect.y + center.y * scaleY - 1, 3, 3);
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + camera.x * scaleX, rect.y + camera.y * scaleY, camera.width * scaleX, camera.height * scaleY);
  ctx.strokeStyle = '#907448';
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function drawEndOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, status: GameStatus, message: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = status === 'victory' ? '#f8df72' : '#d86a5b';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText(status === 'victory' ? 'Victory' : 'Defeat', width / 2, height / 2 - 30);
  ctx.fillStyle = '#f4ead0';
  ctx.font = '20px sans-serif';
  ctx.fillText(message, width / 2, height / 2 + 10);
  ctx.font = '16px sans-serif';
  ctx.fillText('Press Escape to return to level select.', width / 2, height / 2 + 45);
}

function drawButton(ctx: CanvasRenderingContext2D, rect: Rect, label: string, active: boolean, enabled: boolean): void {
  ctx.fillStyle = !enabled ? '#34302a' : active ? '#72552b' : '#2b241d';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = active ? '#f4d06f' : '#7d6746';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  ctx.fillStyle = enabled ? '#f1ead8' : '#7a7366';
  ctx.textAlign = 'center';
  ctx.font = rect.height > 45 ? 'bold 16px sans-serif' : '12px sans-serif';
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + Math.min(rect.height / 2 + 5, 24));
}

function drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, ratio: number): void {
  ctx.fillStyle = '#260b0b';
  ctx.fillRect(x, y, width, 5);
  ctx.fillStyle = ratio > 0.5 ? '#4bd64b' : ratio > 0.25 ? '#d6c14b' : '#d64b4b';
  ctx.fillRect(x, y, Math.max(0, Math.min(1, ratio)) * width, 5);
}

function drawProgressBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, ratio: number, color: string): void {
  ctx.fillStyle = '#201b17';
  ctx.fillRect(x, y, width, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, ratio)) * width, 8);
  ctx.strokeStyle = '#6f5b3a';
  ctx.strokeRect(x, y, width, 8);
}

function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'unit') {
    return displayUnitName(entity.faction, entity.type as UnitType);
  }
  return displayBuildingName(entity.faction, entity.type as BuildingType);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): void {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines += 1;
      if (lines >= maxLines) {
        return;
      }
    } else {
      line = candidate;
    }
  }
  if (line.length > 0 && lines < maxLines) {
    ctx.fillText(line, x, y + lines * lineHeight);
  }
}
