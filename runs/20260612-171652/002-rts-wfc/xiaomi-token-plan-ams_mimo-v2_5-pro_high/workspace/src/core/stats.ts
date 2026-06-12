/**
 * Data-driven stats table for all units and buildings.
 * Every numeric game value lives here — no magic numbers elsewhere.
 */

import type {
  Faction, FactionStats, UnitType, BuildingType,
} from './types';

// ── Unit stats ──────────────────────────────────────────────────
// HP ordering: heavy > melee > ranged > worker
// Damage ordering: heavy >= melee > worker; range: melee/worker=1, ranged>=4
// Move speed: all within 1.5x band, cross 1 tile in 0.3–1.2s
// Sight radius >= attack range for every combatant
// Mirror-match: 4–30 attacks to kill own mirror
// Cost & train time increase with power

const humanUnits: Record<UnitType, {
  hp: number; armor: number; damage: number; attackRange: number;
  attackCooldown: number; moveSpeed: number; sightRadius: number;
  goldCost: number; woodCost: number; supplyCost: number; trainTime: number;
}> = {
  worker: {
    hp: 50, armor: 0, damage: 5, attackRange: 1, attackCooldown: 20,
    moveSpeed: 2.0, sightRadius: 7, goldCost: 50, woodCost: 0, supplyCost: 1, trainTime: 80,
  },
  melee: {
    hp: 120, armor: 2, damage: 12, attackRange: 1, attackCooldown: 16,
    moveSpeed: 2.2, sightRadius: 7, goldCost: 100, woodCost: 50, supplyCost: 2, trainTime: 120,
  },
  ranged: {
    hp: 80, armor: 1, damage: 10, attackRange: 5, attackCooldown: 20,
    moveSpeed: 2.0, sightRadius: 8, goldCost: 120, woodCost: 80, supplyCost: 2, trainTime: 140,
  },
  heavy: {
    hp: 250, armor: 4, damage: 20, attackRange: 1, attackCooldown: 24,
    moveSpeed: 1.8, sightRadius: 7, goldCost: 250, woodCost: 150, supplyCost: 4, trainTime: 200,
  },
};

const orcUnits: Record<UnitType, {
  hp: number; armor: number; damage: number; attackRange: number;
  attackCooldown: number; moveSpeed: number; sightRadius: number;
  goldCost: number; woodCost: number; supplyCost: number; trainTime: number;
}> = {
  worker: {
    hp: 50, armor: 0, damage: 5, attackRange: 1, attackCooldown: 20,
    moveSpeed: 2.0, sightRadius: 7, goldCost: 50, woodCost: 0, supplyCost: 1, trainTime: 80,
  },
  melee: { // Grunt
    hp: 120, armor: 2, damage: 12, attackRange: 1, attackCooldown: 16,
    moveSpeed: 2.2, sightRadius: 7, goldCost: 100, woodCost: 50, supplyCost: 2, trainTime: 120,
  },
  ranged: { // Spearthrower
    hp: 80, armor: 1, damage: 10, attackRange: 5, attackCooldown: 20,
    moveSpeed: 2.0, sightRadius: 8, goldCost: 120, woodCost: 80, supplyCost: 2, trainTime: 140,
  },
  heavy: { // Ogre
    hp: 250, armor: 4, damage: 20, attackRange: 1, attackCooldown: 24,
    moveSpeed: 1.8, sightRadius: 7, goldCost: 250, woodCost: 150, supplyCost: 4, trainTime: 200,
  },
};

// ── Building stats ──────────────────────────────────────────────

const humanBuildings: Record<BuildingType, {
  hp: number; armor: number; supplyProvided: number;
  goldCost: number; woodCost: number; buildTime: number;
  width: number; height: number; sightRadius: number;
}> = {
  townHall: {
    hp: 1200, armor: 0, supplyProvided: 10, goldCost: 0, woodCost: 0,
    buildTime: 0, width: 4, height: 4, sightRadius: 10,
  },
  farm: {
    hp: 400, armor: 0, supplyProvided: 8, goldCost: 80, woodCost: 50,
    buildTime: 100, width: 3, height: 3, sightRadius: 6,
  },
  barracks: {
    hp: 800, armor: 0, supplyProvided: 0, goldCost: 150, woodCost: 100,
    buildTime: 150, width: 3, height: 3, sightRadius: 7,
  },
  lumberMill: {
    hp: 600, armor: 0, supplyProvided: 0, goldCost: 100, woodCost: 100,
    buildTime: 120, width: 3, height: 3, sightRadius: 6,
  },
  guardTower: {
    hp: 500, armor: 2, supplyProvided: 0, goldCost: 100, woodCost: 80,
    buildTime: 100, width: 2, height: 2, sightRadius: 10,
  },
  goldMine: {
    hp: 5000, armor: 0, supplyProvided: 0, goldCost: 0, woodCost: 0,
    buildTime: 0, width: 1, height: 1, sightRadius: 0,
  },
};

const orcBuildings: Record<BuildingType, {
  hp: number; armor: number; supplyProvided: number;
  goldCost: number; woodCost: number; buildTime: number;
  width: number; height: number; sightRadius: number;
}> = {
  townHall: {
    hp: 1200, armor: 0, supplyProvided: 10, goldCost: 0, woodCost: 0,
    buildTime: 0, width: 4, height: 4, sightRadius: 10,
  },
  farm: {
    hp: 400, armor: 0, supplyProvided: 8, goldCost: 80, woodCost: 50,
    buildTime: 100, width: 3, height: 3, sightRadius: 6,
  },
  barracks: {
    hp: 800, armor: 0, supplyProvided: 0, goldCost: 150, woodCost: 100,
    buildTime: 150, width: 3, height: 3, sightRadius: 7,
  },
  lumberMill: {
    hp: 600, armor: 0, supplyProvided: 0, goldCost: 100, woodCost: 100,
    buildTime: 120, width: 3, height: 3, sightRadius: 6,
  },
  guardTower: {
    hp: 500, armor: 2, supplyProvided: 0, goldCost: 100, woodCost: 80,
    buildTime: 100, width: 2, height: 2, sightRadius: 10,
  },
  goldMine: {
    hp: 5000, armor: 0, supplyProvided: 0, goldCost: 0, woodCost: 0,
    buildTime: 0, width: 1, height: 1, sightRadius: 0,
  },
};

// ── Faction stats assembly ──────────────────────────────────────

export const FACTION_STATS: Record<Faction, FactionStats> = {
  humans: {
    name: 'Humans',
    color: '#3366cc',
    minimapColor: '#4488ff',
    units: humanUnits,
    buildings: humanBuildings,
  },
  orcs: {
    name: 'Orcs',
    color: '#cc3333',
    minimapColor: '#ff4444',
    units: orcUnits,
    buildings: orcBuildings,
  },
};

/** Unit names per faction for display */
export const UNIT_NAMES: Record<Faction, Record<UnitType, string>> = {
  humans: { worker: 'Peasant', melee: 'Footman', ranged: 'Archer', heavy: 'Knight' },
  orcs: { worker: 'Peon', melee: 'Grunt', ranged: 'Spearthrower', heavy: 'Ogre' },
};

/** Building names per faction for display */
export const BUILDING_NAMES: Record<Faction, Record<BuildingType, string>> = {
  humans: {
    townHall: 'Town Hall', farm: 'Farm', barracks: 'Barracks',
    lumberMill: 'Lumber Mill', guardTower: 'Guard Tower', goldMine: 'Gold Mine',
  },
  orcs: {
    townHall: 'Great Hall', farm: 'Pig Farm', barracks: 'Barracks',
    lumberMill: 'War Mill', guardTower: 'Watch Tower', goldMine: 'Gold Mine',
  },
};

/** Tech tree requirements: which buildings are needed to train/build something */
export const TECH_REQUIREMENTS: Partial<Record<UnitType | BuildingType, BuildingType[]>> = {
  ranged: ['lumberMill'],
  heavy: ['barracks', 'lumberMill'],
  guardTower: ['lumberMill'],
  barracks: [],
  lumberMill: [],
  farm: [],
  goldMine: [],
};

/** Guard tower attack stats (treated as a ranged building) */
export const TOWER_ATTACK_DAMAGE = 15;
export const TOWER_ATTACK_RANGE = 6;
export const TOWER_ATTACK_COOLDOWN = 24; // ticks
