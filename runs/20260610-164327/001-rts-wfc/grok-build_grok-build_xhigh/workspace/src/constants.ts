export const TILE_PX = 16;
export const VIEW_W = 60; // tiles visible horizontally at base zoom
export const VIEW_H = 45;
export const CANVAS_W = 960;
export const CANVAS_H = 720;
export const MINIMAP_SIZE = 160;

export const SIM_HZ = 60;
export const SIM_DT = 1000 / SIM_HZ;

export const MAX_UNITS = 200;
export const MAX_BUILDINGS = 50;

export const MAP_SIZES: number[] = [32, 40, 48, 64, 80];
export const AI_DIFFICULTIES: number[] = [1, 2, 3, 4, 5];
export const NUM_LEVELS = 5;

// Resource defaults
export const START_GOLD = 800;
export const START_WOOD = 400;
export const START_FOOD = 5; // initial from TH

// Supply
export const SUPPLY_TH = 10;
export const SUPPLY_FARM = 6;

// Harvest
export const HARVEST_GOLD_RATE = 8; // per trip amount
export const HARVEST_WOOD_RATE = 6;
export const HARVEST_TIME = 45; // ticks to load
export const RETURN_TIME = 20;

// Build / train times (in sim ticks)
export const WORKER_BUILD_RATE = 1.2; // progress per tick per worker

// Speeds (tiles per second)
export const SPEED_WORKER = 0.95;
export const SPEED_INF = 1.05;
export const SPEED_RANGED = 0.9;
export const SPEED_HEAVY = 0.75;

// Combat
export const PROJECTILE_SPEED = 6.0; // tiles/sec
export const CORPSE_FADE_TICKS = 90;

// Sight / ranges (tiles)
export const SIGHT_WORKER = 4;
export const SIGHT_INF = 5;
export const SIGHT_RANGED = 7;
export const SIGHT_HEAVY = 5;
export const TOWER_RANGE = 6.5;
export const TOWER_SIGHT = 7;

// AI params
export const AI_FIRST_WAVE_DELAY_TICKS = 60 * 60 * 3.5; // ~3.5min at 60hz base
export const WAVE_BASE_SIZE = 4;

// Path
export const PATH_REPLAN_INTERVAL = 30; // ticks
export const STUCK_THRESHOLD = 45;

// Control groups
export const NUM_CONTROL_GROUPS = 9;
