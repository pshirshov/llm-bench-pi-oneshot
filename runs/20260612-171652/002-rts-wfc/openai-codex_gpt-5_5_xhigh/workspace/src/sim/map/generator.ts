import { BALANCE } from '../stats';
import type { GameMap, Point, StartLocation, TileKind } from '../types';
import { gridDistance, inBounds } from '../utils';
import { findPath, pathDistance, type GridSpec } from '../pathfinding';
import { Mulberry32 } from '../prng';
import { createTile, getTile, isTileBuildable, isTileWalkable, setTileKind } from './tiles';
import { collapseWfc, validateAdjacency } from './wfc';

export interface LevelConfig {
  level: number;
  size: number;
  waterScale: number;
  rockScale: number;
  forestScale: number;
  aiDifficulty: number;
}

export interface PlayabilityReport {
  ok: boolean;
  landDistance: number;
  straightDistance: number;
  startBuildable: boolean;
  reachable: boolean;
  resourcesNear: boolean;
  fairResources: boolean;
}

const LEVELS: LevelConfig[] = [
  { level: 1, size: 32, waterScale: 0.65, rockScale: 0.65, forestScale: 0.9, aiDifficulty: 1 },
  { level: 2, size: 48, waterScale: 0.85, rockScale: 0.85, forestScale: 1.0, aiDifficulty: 2 },
  { level: 3, size: 64, waterScale: 1.05, rockScale: 1.05, forestScale: 1.05, aiDifficulty: 3 },
  { level: 4, size: 80, waterScale: 1.2, rockScale: 1.25, forestScale: 1.0, aiDifficulty: 4 },
  { level: 5, size: 96, waterScale: 1.35, rockScale: 1.4, forestScale: 0.9, aiDifficulty: 5 }
];

export function levelConfig(level: number): LevelConfig {
  const config = LEVELS[level - 1];
  if (config === undefined) {
    throw new Error(`invalid campaign level ${level}`);
  }
  return config;
}

export function createCampaignMap(campaignSeed: number, level: number): GameMap {
  const config = levelConfig(level);
  const levelSeed = (campaignSeed ^ Math.imul(level, 0x45d9f3b)) >>> 0;
  const basePrng = new Mulberry32(levelSeed);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptSeed = (levelSeed + Math.imul(attempt + 1, 0x9e3779b9)) >>> 0;
    const map = collapseWfc({ ...config, width: config.size, height: config.size, seed: attemptSeed }, basePrng.fork(attempt));
    if (map !== undefined) {
      repairMap(map, config, levelSeed);
      const report = analyzePlayability(map);
      if (validateAdjacency(map) && report.ok) {
        return map;
      }
    }
  }
  const fallback = createGrassMap(config.size, config.size, levelSeed, level);
  repairMap(fallback, config, levelSeed);
  if (!validateAdjacency(fallback)) {
    throw new Error('deterministic repair produced invalid adjacency');
  }
  return fallback;
}

export function analyzePlayability(map: GameMap): PlayabilityReport {
  const a = map.starts[0];
  const b = map.starts[1];
  const grid = mapGrid(map);
  const landDistance = pathDistance(grid, pointOf(a), pointOf(b));
  const straightDistance = gridDistance(pointOf(a), pointOf(b));
  const larger = Math.max(map.width, map.height);
  const reachable = landDistance !== undefined;
  const startBuildable = hasBuildableSquare(map, pointOf(a)) && hasBuildableSquare(map, pointOf(b));
  const resourcesNear = hasResourceNear(map, pointOf(a), 'goldMine') && hasResourceNear(map, pointOf(a), 'forest')
    && hasResourceNear(map, pointOf(b), 'goldMine') && hasResourceNear(map, pointOf(b), 'forest');
  const fairResources = resourceScore(map, pointOf(a)) >= 0.7 && resourceScore(map, pointOf(b)) >= 0.7;
  const distanceValue = landDistance ?? 0;
  return {
    ok: reachable && distanceValue >= larger * 0.6 && straightDistance >= larger * 0.4 && startBuildable && resourcesNear && fairResources,
    landDistance: distanceValue,
    straightDistance,
    startBuildable,
    reachable,
    resourcesNear,
    fairResources
  };
}

export function mapGrid(map: GameMap): GridSpec {
  return {
    width: map.width,
    height: map.height,
    isBlocked: (x, y) => !inBounds(map.width, map.height, x, y) || !isTileWalkable(getTile(map, x, y).kind)
  };
}

function repairMap(map: GameMap, config: LevelConfig, levelSeed: number): void {
  map.starts = startsFor(map.width, map.height);
  const startA = pointOf(map.starts[0]);
  const startB = pointOf(map.starts[1]);
  clearBase(map, startA);
  clearBase(map, startB);
  carveCorridor(map, startA, startB, config.level);
  addChokepoints(map, startA, startB, config.level, levelSeed);
  placeStartResources(map, startA, 1);
  placeStartResources(map, startB, -1);
  map.walkVersion += 1;
}

function startsFor(width: number, height: number): [StartLocation, StartLocation] {
  const margin = Math.max(6, Math.floor(Math.min(width, height) * 0.13));
  return [
    { player: 1, x: margin, y: margin },
    { player: 2, x: width - margin - 1, y: height - margin - 1 }
  ];
}

function clearBase(map: GameMap, center: Point): void {
  for (let y = center.y - 5; y <= center.y + 5; y += 1) {
    for (let x = center.x - 5; x <= center.x + 5; x += 1) {
      if (inBounds(map.width, map.height, x, y)) {
        setPlain(map, x, y, Math.abs(x - center.x) <= 3 && Math.abs(y - center.y) <= 3 ? 'grass' : 'dirt');
      }
    }
  }
}

function carveCorridor(map: GameMap, from: Point, to: Point, level: number): void {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * t);
    const y = Math.round(from.y + (to.y - from.y) * t);
    const width = level >= 4 && i > steps * 0.35 && i < steps * 0.65 ? 1 : 2;
    for (let dy = -width; dy <= width; dy += 1) {
      for (let dx = -width; dx <= width; dx += 1) {
        if (inBounds(map.width, map.height, x + dx, y + dy)) {
          setPlain(map, x + dx, y + dy, 'dirt');
        }
      }
    }
  }
}

function addChokepoints(map: GameMap, from: Point, to: Point, level: number, seed: number): void {
  if (level < 3) {
    return;
  }
  const midpoint = { x: Math.floor((from.x + to.x) / 2), y: Math.floor((from.y + to.y) / 2) };
  const half = Math.min(6 + level, Math.floor(map.width / 6));
  const orientation = seed % 2 === 0 ? 'vertical' : 'horizontal';
  for (let offset = -half; offset <= half; offset += 1) {
    for (let band = -1; band <= 1; band += 1) {
      const x = orientation === 'vertical' ? midpoint.x + band : midpoint.x + offset;
      const y = orientation === 'vertical' ? midpoint.y + offset : midpoint.y + band;
      if (inBounds(map.width, map.height, x, y) && Math.abs(offset) > 1) {
        setPlain(map, x, y, 'rock');
      }
    }
  }
}

function placeStartResources(map: GameMap, start: Point, direction: 1 | -1): void {
  placeGold(map, { x: start.x + direction * 6, y: start.y + 1 });
  placeForest(map, { x: start.x - direction * 5, y: start.y + 6 });
  placeForest(map, { x: start.x + direction * 2, y: start.y - 7 });
}

function placeGold(map: GameMap, point: Point): void {
  for (let y = point.y - 2; y <= point.y + 2; y += 1) {
    for (let x = point.x - 2; x <= point.x + 2; x += 1) {
      if (inBounds(map.width, map.height, x, y)) {
        setPlain(map, x, y, 'dirt');
      }
    }
  }
  if (inBounds(map.width, map.height, point.x, point.y)) {
    setPlain(map, point.x, point.y, 'goldMine');
    getTile(map, point.x, point.y).gold = BALANCE.mineGold;
  }
}

function placeForest(map: GameMap, point: Point): void {
  for (let y = point.y - 2; y <= point.y + 2; y += 1) {
    for (let x = point.x - 2; x <= point.x + 2; x += 1) {
      if (inBounds(map.width, map.height, x, y)) {
        setPlain(map, x, y, 'grass');
      }
    }
  }
  const trees = [point, { x: point.x + 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x - 1, y: point.y }];
  for (const tree of trees) {
    if (inBounds(map.width, map.height, tree.x, tree.y)) {
      setPlain(map, tree.x, tree.y, 'forest');
      getTile(map, tree.x, tree.y).wood = BALANCE.forestWood;
    }
  }
}

function hasBuildableSquare(map: GameMap, center: Point): boolean {
  for (let y = center.y - 2; y <= center.y + 2; y += 1) {
    for (let x = center.x - 2; x <= center.x + 2; x += 1) {
      if (!inBounds(map.width, map.height, x, y) || !isTileBuildable(getTile(map, x, y).kind)) {
        return false;
      }
    }
  }
  return true;
}

function hasResourceNear(map: GameMap, start: Point, kind: TileKind): boolean {
  for (let y = Math.max(0, start.y - 15); y <= Math.min(map.height - 1, start.y + 15); y += 1) {
    for (let x = Math.max(0, start.x - 15); x <= Math.min(map.width - 1, start.x + 15); x += 1) {
      if (getTile(map, x, y).kind === kind) {
        const result = findPath(mapGrid(map), start, nearestAdjacent(map, { x, y }));
        if (result.path.length <= 15) {
          return true;
        }
      }
    }
  }
  return false;
}

function nearestAdjacent(map: GameMap, point: Point): Point {
  for (let radius = 1; radius <= 2; radius += 1) {
    for (let y = point.y - radius; y <= point.y + radius; y += 1) {
      for (let x = point.x - radius; x <= point.x + radius; x += 1) {
        if (inBounds(map.width, map.height, x, y) && isTileWalkable(getTile(map, x, y).kind)) {
          return { x, y };
        }
      }
    }
  }
  return point;
}

function resourceScore(map: GameMap, start: Point): number {
  let gold = 0;
  let wood = 0;
  for (let y = Math.max(0, start.y - 15); y <= Math.min(map.height - 1, start.y + 15); y += 1) {
    for (let x = Math.max(0, start.x - 15); x <= Math.min(map.width - 1, start.x + 15); x += 1) {
      const tile = getTile(map, x, y);
      gold += tile.gold;
      wood += tile.wood;
    }
  }
  return Math.min(gold / BALANCE.mineGold, wood / (BALANCE.forestWood * 4));
}

function setPlain(map: GameMap, x: number, y: number, kind: TileKind): void {
  setTileKind(map, x, y, kind);
}

function createGrassMap(width: number, height: number, seed: number, level: number): GameMap {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => createTile('grass')),
    starts: startsFor(width, height),
    level,
    seed,
    walkVersion: 0
  };
}

function pointOf(start: StartLocation): Point {
  return { x: start.x, y: start.y };
}
