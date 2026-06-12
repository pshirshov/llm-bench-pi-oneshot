/** Simulation constants. Every sim-time figure in the game is derived from TICK_RATE. */

/** Ticks per second. All durations are in ticks; divide by TICK_RATE to get seconds. */
export const TICK_RATE = 20;

/** Default map dimensions for campaign levels 1-5. */
export const LEVEL_SIZES: readonly [number, number][] = [
  [32, 32],
  [40, 40],
  [48, 48],
  [56, 56],
  [64, 64],
];

/** AI difficulty per campaign level (1-5). */
export const LEVEL_DIFFICULTY = [1, 2, 3, 4, 5] as const;

/** Maximum generation retries before deterministic repair. */
export const MAX_GEN_RETRIES = 10;

/** Maximum repath attempts before giving up and going idle. */
export const MAX_REPATH_ATTEMPTS = 3;

/** Maximum ticks a unit may go without making progress before going idle. */
export const PROGRESS_WATCHDOG_TICKS = 200;

/** Minimum separation between start locations as fraction of map dimension. */
export const START_SEPARATION_LAND = 0.6;
export const START_SEPARATION_EUCLIDEAN = 0.4;

/** Maximum land-path distance from start to nearest gold mine / forest. */
export const START_RESOURCE_RANGE = 15;

/** Maximum resource unfairness between starts (ratio). */
export const START_FAIRNESS_RATIO = 0.3;

/** Minimum buildable area around each start (tiles). */
export const START_AREA_SIZE = 5;

/** Unit collision radius — no two unit centers may be closer than this. */
export const UNIT_COLLISION_RADIUS = 0.5;

/** Stuck detection: how many ticks before a unit considers itself stuck. */
export const STUCK_TICK_THRESHOLD = 10;

/** Maximum ticks for a group to traverse a chokepoint (C2 test). */
export const GROUP_ARRIVAL_TICKS = 60 * TICK_RATE;

/** Projectile speed in tiles per tick. */
export const PROJECTILE_SPEED = 0.5;

/** Fog of war: explored tiles show last-seen terrain. */
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

/** Game speed multipliers. */
export const SPEED_NORMAL = 1;
export const SPEED_FAST = 2;