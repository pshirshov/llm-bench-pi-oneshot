import { isLandTile, tileBlocksMovement } from './data';
import { SeededRandom, mixSeed } from './random';
import type { GameMap, LevelDefinition, Point, StartLocation, TileType } from './types';

export const TILE_ORDER: readonly TileType[] = ['grass', 'dirt', 'forest', 'water', 'rock', 'gold'];

const TILE_INDEX = new Map<TileType, number>(TILE_ORDER.map((tile, index) => [tile, index]));
const ALL_MASK = (1 << TILE_ORDER.length) - 1;

export const ADJACENCY_RULES: Record<TileType, readonly TileType[]> = {
  grass: ['grass', 'dirt', 'forest', 'gold'],
  dirt: ['grass', 'dirt', 'forest', 'water', 'rock', 'gold'],
  forest: ['grass', 'dirt', 'forest', 'rock'],
  water: ['dirt', 'water'],
  rock: ['dirt', 'forest', 'rock'],
  gold: ['grass', 'dirt'],
};

const ADJACENCY_MASKS: Record<TileType, number> = TILE_ORDER.reduce<Record<TileType, number>>((acc, tile) => {
  acc[tile] = maskFromTiles(ADJACENCY_RULES[tile]);
  return acc;
}, {
  grass: 0,
  dirt: 0,
  forest: 0,
  water: 0,
  rock: 0,
  gold: 0,
});

export const LEVELS: readonly LevelDefinition[] = [
  {
    level: 1,
    name: 'Border Skirmish',
    width: 32,
    height: 32,
    difficulty: 1,
    waterWeight: 0.55,
    rockWeight: 0.45,
    forestWeight: 2.8,
    description: 'Small open battlefield with plentiful wood and a forgiving first attack wave.',
  },
  {
    level: 2,
    name: 'Pine Ford',
    width: 48,
    height: 48,
    difficulty: 2,
    waterWeight: 0.95,
    rockWeight: 0.7,
    forestWeight: 2.5,
    description: 'Rivers and heavier forests create the first meaningful movement lanes.',
  },
  {
    level: 3,
    name: 'Stone March',
    width: 64,
    height: 64,
    difficulty: 3,
    waterWeight: 1.05,
    rockWeight: 1.25,
    forestWeight: 2.2,
    description: 'Mountains and clearings reward scouting and tower placement.',
  },
  {
    level: 4,
    name: 'Blackwater Pass',
    width: 80,
    height: 80,
    difficulty: 4,
    waterWeight: 1.45,
    rockWeight: 1.45,
    forestWeight: 1.95,
    description: 'Scarcer clear land and long paths make attack timing important.',
  },
  {
    level: 5,
    name: 'Crownfall Basin',
    width: 96,
    height: 96,
    difficulty: 5,
    waterWeight: 1.75,
    rockWeight: 1.8,
    forestWeight: 1.75,
    description: 'Large constrained basin with tight chokepoints and the strongest AI economy.',
  },
];

interface CollapseWeights {
  grass: number;
  dirt: number;
  forest: number;
  water: number;
  rock: number;
  gold: number;
}

export function levelSeed(campaignSeed: number, level: number): number {
  return mixSeed(campaignSeed >>> 0, level * 1009 + 17);
}

export function getLevelDefinition(level: number): LevelDefinition {
  const found = LEVELS.find((candidate) => candidate.level === level);
  if (found === undefined) {
    throw new Error(`unknown level ${level}`);
  }
  return found;
}

export function tileCanNeighbor(a: TileType, b: TileType): boolean {
  return ADJACENCY_RULES[a].includes(b) && ADJACENCY_RULES[b].includes(a);
}

export function generateLevelMap(campaignSeed: number, levelNumber: number): GameMap {
  const definition = getLevelDefinition(levelNumber);
  const seed = levelSeed(campaignSeed, levelNumber);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rng = new SeededRandom(mixSeed(seed, attempt + 1));
    const collapsed = collapseWfc(definition.width, definition.height, weightsForLevel(definition), rng);
    if (collapsed === null) {
      continue;
    }
    return ensurePlayableMap(collapsed, definition, new SeededRandom(mixSeed(seed, 10_000 + attempt)));
  }
  throw new Error(`failed to generate playable level ${levelNumber} for seed ${campaignSeed}`);
}

export function mapHash(map: GameMap): string {
  let hash = 2166136261;
  for (const tile of map.tiles) {
    const index = TILE_INDEX.get(tile);
    if (index === undefined) {
      throw new Error(`unknown tile ${tile}`);
    }
    hash ^= index + 1;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  for (const start of map.starts) {
    hash ^= (start.x * 31 + start.y * 131) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function validateAdjacency(tiles: readonly TileType[], width: number, height: number): boolean {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tiles[indexOf(x, y, width)]!;
      const right = x + 1 < width ? tiles[indexOf(x + 1, y, width)] : undefined;
      const down = y + 1 < height ? tiles[indexOf(x, y + 1, width)] : undefined;
      if (right !== undefined && !tileCanNeighbor(tile, right)) {
        return false;
      }
      if (down !== undefined && !tileCanNeighbor(tile, down)) {
        return false;
      }
    }
  }
  return true;
}

function collapseWfc(width: number, height: number, weights: CollapseWeights, rng: SeededRandom): TileType[] | null {
  const domains = new Int32Array(width * height);
  domains.fill(ALL_MASK);
  const versions = new Int32Array(width * height);
  const heap = new EntropyHeap();
  for (let cell = 0; cell < width * height; cell += 1) {
    pushEntropy(heap, cell, domains[cell]!, versions[cell]!, weights, rng);
  }

  while (true) {
    const cell = popMinimumEntropyCell(heap, domains, versions);
    if (cell === -1) {
      return masksToTiles(domains);
    }
    const tile = chooseTileFromMask(domains[cell]!, weights, rng);
    domains[cell] = bitFor(tile);
    versions[cell] = versions[cell]! + 1;
    if (!propagate(domains, versions, heap, width, height, weights, rng, [cell])) {
      return null;
    }
  }
}

function popMinimumEntropyCell(heap: EntropyHeap, domains: Int32Array, versions: Int32Array): number {
  while (heap.size() > 0) {
    const node = heap.pop();
    if (node === undefined) {
      throw new Error('heap size reported an element but pop returned undefined');
    }
    if (node.version !== versions[node.cell]) {
      continue;
    }
    if (countBits(domains[node.cell]!) <= 1) {
      continue;
    }
    return node.cell;
  }
  return -1;
}

function propagate(
  domains: Int32Array,
  versions: Int32Array,
  heap: EntropyHeap,
  width: number,
  height: number,
  weights: CollapseWeights,
  rng: SeededRandom,
  queue: number[],
): boolean {
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor]!;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const allowedAround = allowedNeighborMask(domains[cell]!);
    const neighbors = [
      x > 0 ? cell - 1 : -1,
      x + 1 < width ? cell + 1 : -1,
      y > 0 ? cell - width : -1,
      y + 1 < height ? cell + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0) {
        continue;
      }
      const oldMask = domains[neighbor]!;
      const newMask = oldMask & allowedAround;
      if (newMask === 0) {
        return false;
      }
      if (newMask !== oldMask) {
        domains[neighbor] = newMask;
        versions[neighbor] = versions[neighbor]! + 1;
        if (countBits(newMask) > 1) {
          pushEntropy(heap, neighbor, newMask, versions[neighbor]!, weights, rng);
        }
        queue.push(neighbor);
      }
    }
  }
  return true;
}

interface EntropyNode {
  cell: number;
  entropy: number;
  version: number;
}

class EntropyHeap {
  private readonly nodes: EntropyNode[] = [];

  public size(): number {
    return this.nodes.length;
  }

  public push(node: EntropyNode): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  public pop(): EntropyNode | undefined {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (first === undefined || last === undefined) {
      return undefined;
    }
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.nodes[parent]!.entropy <= this.nodes[current]!.entropy) {
        return;
      }
      this.swap(parent, current);
      current = parent;
    }
  }

  private bubbleDown(index: number): void {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;
      if (left < this.nodes.length && this.nodes[left]!.entropy < this.nodes[smallest]!.entropy) {
        smallest = left;
      }
      if (right < this.nodes.length && this.nodes[right]!.entropy < this.nodes[smallest]!.entropy) {
        smallest = right;
      }
      if (smallest === current) {
        return;
      }
      this.swap(current, smallest);
      current = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const node = this.nodes[a]!;
    this.nodes[a] = this.nodes[b]!;
    this.nodes[b] = node;
  }
}

function pushEntropy(heap: EntropyHeap, cell: number, mask: number, version: number, weights: CollapseWeights, rng: SeededRandom): void {
  heap.push({ cell, entropy: entropyForMask(mask, weights) + rng.next() * 0.000001, version });
}

function masksToTiles(domains: Int32Array): TileType[] {
  const tiles: TileType[] = [];
  for (const mask of domains) {
    if (countBits(mask) !== 1) {
      throw new Error('cannot convert uncollapsed domain to tile');
    }
    tiles.push(tileFromBit(mask));
  }
  return tiles;
}

function ensurePlayableMap(rawTiles: readonly TileType[], definition: LevelDefinition, rng: SeededRandom): GameMap {
  const tiles = rawTiles.slice();
  const width = definition.width;
  const height = definition.height;
  const margin = Math.max(7, Math.floor(Math.min(width, height) / 8));
  const yJitter = Math.floor(height / 5);
  const playerStart: StartLocation = {
    x: margin,
    y: Math.floor(height / 2) + rng.range(-yJitter, yJitter + 1),
    label: 'player',
  };
  const aiStart: StartLocation = {
    x: width - margin - 1,
    y: height - playerStart.y - 1,
    label: 'ai',
  };

  clearBuildableArea(tiles, width, height, playerStart, 5 + Math.floor(definition.level / 2));
  clearBuildableArea(tiles, width, height, aiStart, 5 + Math.floor(definition.level / 2));
  carveDirtCorridor(tiles, width, height, playerStart, aiStart, 2);
  placeFairResources(tiles, width, height, playerStart, aiStart, definition.level);
  normalizeAdjacencyBuffers(tiles, width, height);

  const starts: [StartLocation, StartLocation] = [playerStart, aiStart];
  const map = makeMap(width, height, tiles, starts);
  if (!validatePlayability(map)) {
    throw new Error('deterministic repair failed to create a playable RTS map');
  }
  return map;
}

function weightsForLevel(definition: LevelDefinition): CollapseWeights {
  return {
    grass: Math.max(3.2 - definition.level * 0.18, 2.2),
    dirt: 2.1,
    forest: definition.forestWeight,
    water: definition.waterWeight,
    rock: definition.rockWeight,
    gold: Math.max(0.14 - definition.level * 0.012, 0.08),
  };
}

function makeMap(width: number, height: number, tiles: readonly TileType[], starts: [StartLocation, StartLocation]): GameMap {
  const gold = new Int32Array(width * height);
  const wood = new Int32Array(width * height);
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i]!;
    if (tile === 'gold') {
      gold[i] = 2600;
    }
    if (tile === 'forest') {
      wood[i] = 90;
    }
  }
  return { width, height, tiles: tiles.slice(), gold, wood, starts };
}

function validatePlayability(map: GameMap): boolean {
  if (map.starts.length !== 2) {
    return false;
  }
  if (!validateAdjacency(map.tiles, map.width, map.height)) {
    return false;
  }
  const [a, b] = map.starts;
  if (!hasBuildablePatch(map, a) || !hasBuildablePatch(map, b)) {
    return false;
  }
  if (!reachableByLand(map, a, b)) {
    return false;
  }
  return nearbyResource(map, a, 'gold') && nearbyResource(map, a, 'forest') && nearbyResource(map, b, 'gold') && nearbyResource(map, b, 'forest');
}

function hasBuildablePatch(map: GameMap, start: Point): boolean {
  let count = 0;
  for (let y = start.y - 3; y <= start.y + 3; y += 1) {
    for (let x = start.x - 3; x <= start.x + 3; x += 1) {
      if (inBounds(x, y, map.width, map.height) && isLandTile(map.tiles[indexOf(x, y, map.width)]!)) {
        count += 1;
      }
    }
  }
  return count >= 36;
}

function reachableByLand(map: GameMap, start: Point, goal: Point): boolean {
  const queue: Point[] = [{ x: start.x, y: start.y }];
  const visited = new Uint8Array(map.width * map.height);
  visited[indexOf(start.x, start.y, map.width)] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (current.x === goal.x && current.y === goal.y) {
      return true;
    }
    for (const next of cardinalNeighbors(current)) {
      if (!inBounds(next.x, next.y, map.width, map.height)) {
        continue;
      }
      const index = indexOf(next.x, next.y, map.width);
      if (visited[index] === 1 || tileBlocksMovement(map.tiles[index]!)) {
        continue;
      }
      visited[index] = 1;
      queue.push(next);
    }
  }
  return false;
}

function nearbyResource(map: GameMap, start: Point, tile: TileType): boolean {
  const radius = 11;
  for (let y = start.y - radius; y <= start.y + radius; y += 1) {
    for (let x = start.x - radius; x <= start.x + radius; x += 1) {
      if (!inBounds(x, y, map.width, map.height)) {
        continue;
      }
      const dx = x - start.x;
      const dy = y - start.y;
      if (dx * dx + dy * dy <= radius * radius && map.tiles[indexOf(x, y, map.width)] === tile) {
        return true;
      }
    }
  }
  return false;
}

function clearBuildableArea(tiles: TileType[], width: number, height: number, center: Point, radius: number): void {
  for (let y = center.y - radius - 1; y <= center.y + radius + 1; y += 1) {
    for (let x = center.x - radius - 1; x <= center.x + radius + 1; x += 1) {
      if (!inBounds(x, y, width, height)) {
        continue;
      }
      const dx = x - center.x;
      const dy = y - center.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) {
        tiles[indexOf(x, y, width)] = distance <= radius - 1 ? 'grass' : 'dirt';
      } else if (distance <= radius + 1) {
        tiles[indexOf(x, y, width)] = 'dirt';
      }
    }
  }
}

function carveDirtCorridor(tiles: TileType[], width: number, height: number, start: Point, end: Point, radius: number): void {
  let x = start.x;
  let y = start.y;
  while (x !== end.x || y !== end.y) {
    paintDisc(tiles, width, height, { x, y }, radius, 'dirt');
    if (x !== end.x) {
      x += Math.sign(end.x - x);
    }
    if (y !== end.y && Math.abs(end.x - x) % 3 === 0) {
      y += Math.sign(end.y - y);
    }
  }
  paintDisc(tiles, width, height, end, radius, 'dirt');
}

function placeFairResources(tiles: TileType[], width: number, height: number, playerStart: Point, aiStart: Point, level: number): void {
  const mineDistance = 7 + Math.floor(level / 2);
  const forestDistance = 8 + Math.floor(level / 2);
  const playerMine = clampPoint({ x: playerStart.x + mineDistance, y: playerStart.y + 2 }, width, height);
  const aiMine = clampPoint({ x: aiStart.x - mineDistance, y: aiStart.y - 2 }, width, height);
  const playerForest = clampPoint({ x: playerStart.x + 1, y: playerStart.y - forestDistance }, width, height);
  const aiForest = clampPoint({ x: aiStart.x - 1, y: aiStart.y + forestDistance }, width, height);
  placeGoldMine(tiles, width, height, playerMine);
  placeGoldMine(tiles, width, height, aiMine);
  placeForestPatch(tiles, width, height, playerForest, 3 + Math.floor(level / 3));
  placeForestPatch(tiles, width, height, aiForest, 3 + Math.floor(level / 3));
}

function placeGoldMine(tiles: TileType[], width: number, height: number, center: Point): void {
  paintDisc(tiles, width, height, center, 2, 'grass');
  for (const neighbor of cardinalNeighbors(center)) {
    if (inBounds(neighbor.x, neighbor.y, width, height)) {
      tiles[indexOf(neighbor.x, neighbor.y, width)] = 'grass';
    }
  }
  tiles[indexOf(center.x, center.y, width)] = 'gold';
}

function placeForestPatch(tiles: TileType[], width: number, height: number, center: Point, radius: number): void {
  paintDisc(tiles, width, height, center, radius + 1, 'dirt');
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      if (!inBounds(x, y, width, height)) {
        continue;
      }
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy <= radius * radius) {
        tiles[indexOf(x, y, width)] = 'forest';
      }
    }
  }
}

function normalizeAdjacencyBuffers(tiles: TileType[], width: number, height: number): void {
  let changed = true;
  let passes = 0;
  while (changed && passes < 8) {
    changed = false;
    passes += 1;
    const copy = tiles.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = copy[indexOf(x, y, width)]!;
        for (const neighbor of cardinalNeighbors({ x, y })) {
          if (!inBounds(neighbor.x, neighbor.y, width, height)) {
            continue;
          }
          const neighborIndex = indexOf(neighbor.x, neighbor.y, width);
          const neighborTile = copy[neighborIndex]!;
          if (tileCanNeighbor(tile, neighborTile)) {
            continue;
          }
          tiles[neighborIndex] = 'dirt';
          changed = true;
        }
      }
    }
  }
}

function paintDisc(tiles: TileType[], width: number, height: number, center: Point, radius: number, tile: TileType): void {
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      if (!inBounds(x, y, width, height)) {
        continue;
      }
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy <= radius * radius) {
        tiles[indexOf(x, y, width)] = tile;
      }
    }
  }
}

function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.max(3, Math.min(width - 4, point.x)),
    y: Math.max(3, Math.min(height - 4, point.y)),
  };
}

function cardinalNeighbors(point: Point): Point[] {
  return [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 },
  ];
}

function allowedNeighborMask(mask: number): number {
  let result = 0;
  for (const tile of TILE_ORDER) {
    if ((mask & bitFor(tile)) !== 0) {
      result |= ADJACENCY_MASKS[tile];
    }
  }
  return result;
}

function chooseTileFromMask(mask: number, weights: CollapseWeights, rng: SeededRandom): TileType {
  return rng.weighted(
    TILE_ORDER.filter((tile) => (mask & bitFor(tile)) !== 0).map((tile) => ({ value: tile, weight: weights[tile] })),
  );
}

function entropyForMask(mask: number, weights: CollapseWeights): number {
  let total = 0;
  let weightedLog = 0;
  for (const tile of TILE_ORDER) {
    if ((mask & bitFor(tile)) === 0) {
      continue;
    }
    const weight = weights[tile];
    total += weight;
    weightedLog += weight * Math.log(weight);
  }
  return Math.log(total) - weightedLog / total;
}

function maskFromTiles(tiles: readonly TileType[]): number {
  let mask = 0;
  for (const tile of tiles) {
    mask |= bitFor(tile);
  }
  return mask;
}

function bitFor(tile: TileType): number {
  const index = TILE_INDEX.get(tile);
  if (index === undefined) {
    throw new Error(`unknown tile ${tile}`);
  }
  return 1 << index;
}

function tileFromBit(mask: number): TileType {
  for (const tile of TILE_ORDER) {
    if (mask === bitFor(tile)) {
      return tile;
    }
  }
  throw new Error(`mask ${mask} does not contain exactly one tile`);
}

function countBits(mask: number): number {
  let value = mask;
  let count = 0;
  while (value !== 0) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}
