import type { BuildingData, Faction, UnitData, Tile, BuildingType } from './types';

export const UNIT_DATA: Record<Faction, UnitData> = {
  human: {
    worker: {
      hp: 45, armor: 0, damage: 2, attackRange: 0.8, attackCooldown: 22,
      speed: 0.95, sight: 4, goldCost: 65, woodCost: 0, supply: 1, trainTime: 55,
      name: 'Peasant'
    },
    inf: {
      hp: 70, armor: 2, damage: 7, attackRange: 0.9, attackCooldown: 24,
      speed: 1.05, sight: 5, goldCost: 95, woodCost: 0, supply: 1, trainTime: 70,
      name: 'Footman'
    },
    ranged: {
      hp: 35, armor: 0, damage: 6, attackRange: 5.0, attackCooldown: 32,
      speed: 0.9, sight: 7, goldCost: 85, woodCost: 40, supply: 1, trainTime: 80,
      name: 'Archer'
    },
    heavy: {
      hp: 120, armor: 4, damage: 14, attackRange: 1.1, attackCooldown: 30,
      speed: 0.75, sight: 5, goldCost: 185, woodCost: 55, supply: 2, trainTime: 110,
      name: 'Knight'
    }
  },
  orc: {
    worker: {
      hp: 45, armor: 0, damage: 2, attackRange: 0.8, attackCooldown: 22,
      speed: 0.95, sight: 4, goldCost: 65, woodCost: 0, supply: 1, trainTime: 55,
      name: 'Peon'
    },
    inf: {
      hp: 70, armor: 2, damage: 7, attackRange: 0.9, attackCooldown: 24,
      speed: 1.05, sight: 5, goldCost: 95, woodCost: 0, supply: 1, trainTime: 70,
      name: 'Grunt'
    },
    ranged: {
      hp: 35, armor: 0, damage: 6, attackRange: 5.0, attackCooldown: 32,
      speed: 0.9, sight: 7, goldCost: 85, woodCost: 40, supply: 1, trainTime: 80,
      name: 'Spearthrower'
    },
    heavy: {
      hp: 120, armor: 4, damage: 14, attackRange: 1.1, attackCooldown: 30,
      speed: 0.75, sight: 5, goldCost: 185, woodCost: 55, supply: 2, trainTime: 110,
      name: 'Ogre'
    }
  }
};

export const BUILDING_DATA: Record<Faction, BuildingData> = {
  human: {
    th: { hp: 1400, goldCost: 400, woodCost: 200, supply: 10, buildTime: 180, footprintW: 3, footprintH: 3, name: 'Town Hall' },
    farm: { hp: 260, goldCost: 140, woodCost: 85, supply: 6, buildTime: 80, footprintW: 2, footprintH: 2, name: 'Farm' },
    barracks: { hp: 720, goldCost: 180, woodCost: 110, supply: 0, buildTime: 140, footprintW: 3, footprintH: 2, name: 'Barracks' },
    lumbermill: { hp: 420, goldCost: 120, woodCost: 150, supply: 0, buildTime: 100, footprintW: 2, footprintH: 2, name: 'Lumber Mill' },
    tower: { hp: 260, goldCost: 120, woodCost: 90, supply: 0, buildTime: 75, footprintW: 1, footprintH: 1, name: 'Guard Tower' }
  },
  orc: {
    th: { hp: 1400, goldCost: 400, woodCost: 200, supply: 10, buildTime: 180, footprintW: 3, footprintH: 3, name: 'Great Hall' },
    farm: { hp: 260, goldCost: 140, woodCost: 85, supply: 6, buildTime: 80, footprintW: 2, footprintH: 2, name: 'Pig Farm' },
    barracks: { hp: 720, goldCost: 180, woodCost: 110, supply: 0, buildTime: 140, footprintW: 3, footprintH: 2, name: 'Barracks' },
    lumbermill: { hp: 420, goldCost: 120, woodCost: 150, supply: 0, buildTime: 100, footprintW: 2, footprintH: 2, name: 'Lumber Mill' },
    tower: { hp: 260, goldCost: 120, woodCost: 90, supply: 0, buildTime: 75, footprintW: 1, footprintH: 1, name: 'Watch Tower' }
  }
};

export const FACTION_COLORS: Record<Faction, { primary: string; secondary: string; accent: string }> = {
  human: { primary: '#3a6db5', secondary: '#c9b070', accent: '#e8d8a0' },
  orc: { primary: '#3f6f3f', secondary: '#9c6b3a', accent: '#c8a050' }
};

export const TILE_COLORS: Record<string, string> = {
  grass: '#3a6f3a',
  dirt: '#7a6644',
  forest: '#1f4a1f',
  water: '#2a5a8a',
  rock: '#555555',
  goldmine: '#d4af37'
};

export const TILE_WALKABLE: Record<Tile, boolean> = {
  grass: true, dirt: true, forest: false, water: false, rock: false, goldmine: true
};

export const TILE_HARVESTABLE: Record<Tile, 'gold' | 'wood' | null> = {
  grass: null, dirt: null, forest: 'wood', water: null, rock: null, goldmine: 'gold'
};

// Build order for AI (building types sequence)
export const AI_BUILD_ORDER: BuildingType[] = ['farm', 'barracks', 'farm', 'lumbermill', 'farm', 'tower', 'barracks', 'tower'];
