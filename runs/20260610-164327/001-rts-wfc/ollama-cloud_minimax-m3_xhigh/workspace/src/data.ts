// Faction, tile, unit, building data tables. Everything is data-driven.

export type FactionId = 'human' | 'orc';

export interface FactionDef {
  id: FactionId;
  name: string;
  primary: string;   // main color
  secondary: string; // accent
  dark: string;      // outline
  baseName: string;  // 'Town Hall' | 'Great Hall'
  workerName: string; // 'Peasant' | 'Peon'
  meleeName: string;  // 'Footman' | 'Grunt'
  rangedName: string; // 'Archer' | 'Spearthrower'
  heavyName: string;  // 'Knight' | 'Ogre'
  farmName: string;   // 'Farm' | 'Pig Farm'
  barracksName: string;
  millName: string;   // 'Lumber Mill' | 'War Mill'
  towerName: string;
  // draw offsets/colors for placeholder art; same idea on both sides
  unitAccent: string;
  buildingRoof: string;
  buildingWall: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  human: {
    id: 'human',
    name: 'Humans',
    primary: '#3a7bd5',
    secondary: '#cfd8e8',
    dark: '#0e1a33',
    baseName: 'Town Hall',
    workerName: 'Peasant',
    meleeName: 'Footman',
    rangedName: 'Archer',
    heavyName: 'Knight',
    farmName: 'Farm',
    barracksName: 'Barracks',
    millName: 'Lumber Mill',
    towerName: 'Guard Tower',
    unitAccent: '#ffffff',
    buildingRoof: '#8a2a1f',
    buildingWall: '#bca888',
  },
  orc: {
    id: 'orc',
    name: 'Orcs',
    primary: '#3aa15a',
    secondary: '#222',
    dark: '#0a1a0a',
    baseName: 'Great Hall',
    workerName: 'Peon',
    meleeName: 'Grunt',
    rangedName: 'Spearthrower',
    heavyName: 'Ogre',
    farmName: 'Pig Farm',
    barracksName: 'Barracks',
    millName: 'War Mill',
    towerName: 'Guard Tower',
    unitAccent: '#ff4040',
    buildingRoof: '#2a1a08',
    buildingWall: '#5a4a30',
  },
};

// Tile set used by WFC. Each tile is a domain for adjacency constraints.
export type TileId =
  | 'grass'
  | 'dirt'
  | 'forest'
  | 'water'
  | 'rock'
  | 'gold_mine';

export interface TileDef {
  id: TileId;
  weight: number;          // prior weight used in constraint ranking & fallback
  walkable: boolean;       // units can pass through
  buildable: boolean;      // buildings can be placed
  blocksSight: boolean;    // line-of-sight blocker (forest/rock)
  resource: 'gold' | 'wood' | null;
  color: string;           // base render color
  borderColor: string;
  hp: number;              // for forest tiles (wood remaining) and gold mines (gold remaining); 0 = infinite
}

export const TILES: Record<TileId, TileDef> = {
  grass:     { id: 'grass',     weight: 14, walkable: true,  buildable: true,  blocksSight: false, resource: null,  color: '#3aa15a', borderColor: '#2a7a40', hp: 0 },
  dirt:      { id: 'dirt',      weight: 3,  walkable: true,  buildable: true,  blocksSight: false, resource: null,  color: '#9b7a3a', borderColor: '#6b4a1c', hp: 0 },
  forest:    { id: 'forest',    weight: 5,  walkable: true,  buildable: false, blocksSight: true,  resource: 'wood', color: '#1f4a23', borderColor: '#0a1a08', hp: 100 },
  water:     { id: 'water',     weight: 4,  walkable: false, buildable: false, blocksSight: false, resource: null,  color: '#2c5a9b', borderColor: '#1a3a6b', hp: 0 },
  rock:      { id: 'rock',      weight: 1,  walkable: false, buildable: false, blocksSight: true,  resource: null,  color: '#666',    borderColor: '#333',    hp: 0 },
  gold_mine: { id: 'gold_mine', weight: 1,  walkable: true,  buildable: false, blocksSight: false, resource: 'gold', color: '#c79c2e', borderColor: '#7a5a00', hp: 800 },
};

export const TILE_IDS: TileId[] = ['grass', 'dirt', 'forest', 'water', 'rock', 'gold_mine'];

// Unit stats. Single data-driven table; both factions share it with per-faction overrides.
export type UnitKind = 'worker' | 'melee' | 'ranged' | 'heavy';

export interface UnitStats {
  kind: UnitKind;
  hp: number;
  armor: number;
  damage: { min: number; max: number };
  attackRange: number;     // tiles
  attackCooldown: number;  // seconds
  moveSpeed: number;       // tiles per second
  sight: number;           // tiles
  cost: { gold: number; wood: number };
  supply: number;          // supply cost
  buildTime: number;       // seconds
  // index into the per-faction name list
  nameIdx: 0 | 1 | 2 | 3;
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  worker: {
    kind: 'worker', hp: 30, armor: 0, damage: { min: 2, max: 4 },
    attackRange: 1, attackCooldown: 1.2, moveSpeed: 1.6, sight: 4,
    cost: { gold: 400, wood: 0 }, supply: 1, buildTime: 10, nameIdx: 0,
  },
  melee: {
    kind: 'melee', hp: 60, armor: 2, damage: { min: 6, max: 9 },
    attackRange: 1, attackCooldown: 1.4, moveSpeed: 1.5, sight: 5,
    cost: { gold: 600, wood: 0 }, supply: 2, buildTime: 18, nameIdx: 1,
  },
  ranged: {
    kind: 'ranged', hp: 50, armor: 0, damage: { min: 7, max: 10 },
    attackRange: 4, attackCooldown: 1.6, moveSpeed: 1.4, sight: 6,
    cost: { gold: 500, wood: 50 }, supply: 2, buildTime: 22, nameIdx: 2,
  },
  heavy: {
    kind: 'heavy', hp: 140, armor: 4, damage: { min: 12, max: 18 },
    attackRange: 1, attackCooldown: 1.8, moveSpeed: 1.2, sight: 6,
    cost: { gold: 1200, wood: 100 }, supply: 4, buildTime: 30, nameIdx: 3,
  },
};

export const UNIT_KINDS: UnitKind[] = ['worker', 'melee', 'ranged', 'heavy'];

// Building stats. w*h is footprint in tiles.
export type BuildingKind = 'townhall' | 'farm' | 'barracks' | 'mill' | 'tower';

export interface BuildingStats {
  kind: BuildingKind;
  hp: number;
  armor: number;
  size: { w: number; h: number };
  cost: { gold: number; wood: number };
  buildTime: number;     // seconds (worker on-site construction)
  providesSupply: number; // food cap delta
  attackDamage?: { min: number; max: number }; // towers
  attackRange?: number;                       // tiles
  attackCooldown?: number;                    // seconds
  nameIdx: 0 | 1 | 2 | 3 | 4;
}

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  townhall: {
    kind: 'townhall', hp: 1200, armor: 20,
    size: { w: 3, h: 3 },
    cost: { gold: 0, wood: 0 },
    buildTime: 0, providesSupply: 10, nameIdx: 0,
  },
  farm: {
    kind: 'farm', hp: 400, armor: 0,
    size: { w: 2, h: 2 },
    cost: { gold: 400, wood: 50 },
    buildTime: 30, providesSupply: 8, nameIdx: 1,
  },
  barracks: {
    kind: 'barracks', hp: 800, armor: 10,
    size: { w: 3, h: 2 },
    cost: { gold: 700, wood: 200 },
    buildTime: 50, providesSupply: 0, nameIdx: 2,
  },
  mill: {
    kind: 'mill', hp: 600, armor: 5,
    size: { w: 2, h: 2 },
    cost: { gold: 500, wood: 100 },
    buildTime: 35, providesSupply: 0, nameIdx: 3,
  },
  tower: {
    kind: 'tower', hp: 500, armor: 8,
    size: { w: 1, h: 1 },
    cost: { gold: 600, wood: 100 },
    buildTime: 40, providesSupply: 0,
    attackDamage: { min: 8, max: 12 }, attackRange: 5, attackCooldown: 1.4,
    nameIdx: 4,
  },
};

export const BUILDING_KINDS: BuildingKind[] = ['townhall', 'farm', 'barracks', 'mill', 'tower'];

export function buildingName(f: FactionDef, b: BuildingStats): string {
  switch (b.nameIdx) {
    case 0: return f.baseName;
    case 1: return f.farmName;
    case 2: return f.barracksName;
    case 3: return f.millName;
    case 4: return f.towerName;
  }
}

export function unitName(f: FactionDef, u: UnitStats): string {
  switch (u.nameIdx) {
    case 0: return f.workerName;
    case 1: return f.meleeName;
    case 2: return f.rangedName;
    case 3: return f.heavyName;
  }
}

export const STARTING_RESOURCES = { gold: 800, wood: 400, supply: 0 };
export const STARTING_UNITS_PER_FACTION = 3; // workers
export const STARTING_BUILDING_HP = 0.5;     // town hall starts at 50% HP (under construction complete)
