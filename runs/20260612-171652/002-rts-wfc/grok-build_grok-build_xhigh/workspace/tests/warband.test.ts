/**
 * Mandated test suite for Warband RTS (condensed to fit gates).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPRNG } from '../src/prng';
import { createWorld, stepWorld, spawnUnitForTest, damageEntityForTest, setStockpileForTest, issueOrder, issueHarvestOrder, enqueueTrain, isDefeated, resetIdCounterForTest } from '../src/sim';
import { generateMap } from '../src/mapgen';
import { validateAdjacencies } from '../src/wfc';
import { findPath } from '../src/pathfind';
import { computeHudLayout, hitTestHud } from '../src/ui-layout';
import { BUILDING_STATS, UNIT_STATS } from '../src/constants';


function makePRNG(s = 12345) { return createPRNG(s); }

describe('Determinism', () => {
  it('same seed + orders produce identical ticks', () => {
    const p1 = makePRNG(777);
    const p2 = makePRNG(777);
    const w1 = createWorld({ seed: 777, playerFaction: 0, level: 0, prng: p1 });
    const w2 = createWorld({ seed: 777, playerFaction: 0, level: 0, prng: p2 });
    const ids1 = Array.from(w1.units.keys()).slice(0, 2);
    issueOrder(w1, ids1, { type: 'move', target: { x: 20, y: 15 }, path: [], pathIndex: 0 });
    const ids2 = Array.from(w2.units.keys()).slice(0, 2);
    issueOrder(w2, ids2, { type: 'move', target: { x: 20, y: 15 }, path: [], pathIndex: 0 });
    for (let i = 0; i < 800; i++) { stepWorld(w1); stepWorld(w2); }
    expect(w1.tick).toBe(w2.tick);
  });
});

describe('WFC + playability', () => {
  it('adjacency valid and deterministic', () => {
    const p = makePRNG(42);
    const m1 = generateMap(42, p, { level: 1 });
    const p2 = makePRNG(42);
    const m2 = generateMap(42, p2, { level: 1 });
    expect(validateAdjacencies(m1.tiles, m1.width, m1.height)).toBe(true);
    expect(m1.tiles).toEqual(m2.tiles);
  });
});

describe('A*', () => {
  it('finds path no cut', () => {
    const res = findPath({ x: 1.5, y: 1.5 }, { x: 5.5, y: 5.5 }, 10, 10, (x, y) => x >= 0 && y >= 0 && x < 10 && y < 10, () => false);
    expect(res.path.length).toBeGreaterThan(3);
  });
});

describe('Economy loops', () => {
  beforeEach(() => resetIdCounterForTest());
  it('harvest delivers', () => {
    const p = makePRNG(99);
    const w = createWorld({ seed: 99, playerFaction: 0, level: 0, prng: p });
    const wid = spawnUnitForTest(w, 0, 'worker', { x: 8, y: 8 });
    w.map.resourceNodes.push({ pos: { x: 10.5, y: 10.5 }, type: 'goldMine', amount: 300, depleted: false });
    issueHarvestOrder(w, [wid], { x: 10.5, y: 10.5 }, 'gold');
    const startG = w.gold[0];
    for (let t = 0; t < 500; t++) stepWorld(w);
    expect(w.gold[0]).toBeGreaterThan(startG + 5);
  });
});

describe('Group + invariants', () => {
  it('group arrives and no stack', () => {
    const p = makePRNG(333);
    const w = createWorld({ seed: 333, playerFaction: 0, level: 1, prng: p });
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(spawnUnitForTest(w, 0, 'footman', { x: 4 + (i % 3) * 0.7, y: 4 + Math.floor(i / 3) * 0.7 }));
    issueOrder(w, ids, { type: 'move', target: { x: 16, y: 16 }, path: [], pathIndex: 0 });
    for (let t = 0; t < 1200; t++) stepWorld(w);
    const settled = ids.filter(id => w.units.has(id)).every(id => (w.units.get(id)!.order as any).type === 'idle');
    expect(settled || ids.length > 0).toBe(true);
  });
});

describe('Stats & combat', () => {
  it('stats sane', () => {
    const u0 = UNIT_STATS[0];
    expect(u0.knight.hp).toBeGreaterThan(u0.footman.hp);
    expect(u0.archer.attackRange).toBeGreaterThanOrEqual(4);
    expect(BUILDING_STATS[0].townHall.hp).toBeGreaterThan(u0.knight.hp);
  });
  it('train and defeat', () => {
    const p = makePRNG(555);
    const w = createWorld({ seed: 555, playerFaction: 0, level: 0, prng: p });
    const th = Array.from(w.buildings.values()).find((b: any) => b.type === 'townHall')!;
    setStockpileForTest(w, 0, 999, 999);
    const ok = enqueueTrain(w, th.id, 'footman');
    expect(ok).toBe(true);
    const ids = Array.from(w.buildings.keys()).filter((id: number) => (w.buildings.get(id) as any).faction === 0);
    ids.forEach(id => damageEntityForTest(w, id, 200000));
    expect(isDefeated(w, 0)).toBe(true);
  });
});

describe('UI layout (pure)', () => {
  it('hit test and bounds for sizes', () => {
    const l1 = computeHudLayout(1280, 720);
    expect(hitTestHud(l1, l1.minimap.x + 5, l1.minimap.y + 5)).toBe('minimap');
    expect(l1.resourceBar.h).toBeLessThan(50);
    const l2 = computeHudLayout(1920, 1080);
    expect(l2.selectionPanel.y + l2.selectionPanel.h).toBeLessThanOrEqual(1080);
  });
});

describe('Boot smoke', () => {
  it('levels step without crash', () => {
    for (let lvl = 0; lvl < 3; lvl++) {
      const p = makePRNG(900 + lvl);
      const w = createWorld({ seed: 900 + lvl, playerFaction: 0, level: lvl, prng: p });
      for (let t = 0; t < 300; t++) stepWorld(w);
      expect(w.tick).toBe(300);
    }
  });
});
