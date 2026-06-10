import { hashCombine } from '../core/rng';
import { Tile } from './tiles';
import { MapGenConfig } from './gamemap';

export interface LevelDef {
  id: number;
  name: string;
  size: number;
  difficulty: number; // 1..5, drives the AI
  mapGen: Omit<MapGenConfig, 'width' | 'height'>;
}

/** weights indexed by Tile: Grass, Dirt, Forest, Water, Rock, GoldMine */
const w = (
  grass: number,
  dirt: number,
  forest: number,
  water: number,
  rock: number,
  gold: number,
): number[] => {
  const arr: number[] = [];
  arr[Tile.Grass] = grass;
  arr[Tile.Dirt] = dirt;
  arr[Tile.Forest] = forest;
  arr[Tile.Water] = water;
  arr[Tile.Rock] = rock;
  arr[Tile.GoldMine] = gold;
  return arr;
};

/**
 * Campaign: maps grow, terrain tightens (more water/rock chokepoints),
 * resources thin out, AI difficulty rises 1..5.
 */
export const LEVELS: readonly LevelDef[] = [
  {
    id: 1,
    name: 'Greenfields',
    size: 32,
    difficulty: 1,
    mapGen: { weights: w(46, 16, 22, 6, 8, 2.0), goldPerMine: 12000, woodPerTree: 150, clearRadius: 5 },
  },
  {
    id: 2,
    name: 'Timber Marches',
    size: 48,
    difficulty: 2,
    mapGen: { weights: w(38, 15, 28, 9, 9, 1.4), goldPerMine: 11000, woodPerTree: 140, clearRadius: 5 },
  },
  {
    id: 3,
    name: 'The Fords',
    size: 64,
    difficulty: 3,
    mapGen: { weights: w(30, 15, 26, 17, 11, 1.0), goldPerMine: 10000, woodPerTree: 130, clearRadius: 5 },
  },
  {
    id: 4,
    name: 'Stonegap',
    size: 80,
    difficulty: 4,
    mapGen: { weights: w(24, 14, 26, 18, 17, 0.7), goldPerMine: 9000, woodPerTree: 120, clearRadius: 5 },
  },
  {
    id: 5,
    name: 'The Sundered Vale',
    size: 96,
    difficulty: 5,
    mapGen: { weights: w(20, 13, 26, 22, 18, 0.5), goldPerMine: 8000, woodPerTree: 110, clearRadius: 5 },
  },
];

/** Each level's map derives deterministically from (campaign seed, level number). */
export function levelSeed(campaignSeed: number, level: number): number {
  return hashCombine(campaignSeed, level * 2654435761);
}

export function mapGenConfigFor(level: LevelDef): MapGenConfig {
  return { width: level.size, height: level.size, ...level.mapGen };
}
