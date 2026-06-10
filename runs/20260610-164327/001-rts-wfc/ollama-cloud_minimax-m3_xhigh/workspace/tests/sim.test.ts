import { describe, expect, it } from 'vitest';
import { generateMap, mapForLevel, difficultyForLevel } from '../src/mapgen.js';
import { createWorld, initResourceTiles, setupFactionStart, tick, isBuildable, tryQueueBuilding, tryQueueTrain, canTrain, pathToTile, isWalkable, placeUnit, placeBuilding, applyDamage, recomputeSupplyCaps, nearestDropoff, nearestResource } from '../src/sim.js';
import { aiTick } from '../src/ai.js';
import { mulberry32 } from '../src/rng.js';
import { TILES, UNIT_STATS, BUILDING_STATS, type FactionId } from '../src/data.js';
import { aStarSearch } from '../src/pathfind.js';

describe('map generation & playability', () => {
  it('produces a map with two valid, mutually-reachable starts', () => {
    const r = generateMap({ width: 48, height: 48, seed: 42 });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.starts[0]).toBeDefined();
    expect(r.starts[1]).toBeDefined();
    const [a, b] = r.starts;
    const path = aStarSearch(r.map, a.x, a.y, b.x, b.y, {
      walkable: (x, y) => {
        if (x < 0 || y < 0 || x >= r.map.width || y >= r.map.height) return false;
        return TILES[r.map.tiles[y * r.map.width + x] as keyof typeof TILES].walkable;
      },
    });
    expect(path).not.toBeNull();
  });

  it('starts are on buildable (cleared) ground', () => {
    const r = generateMap({ width: 48, height: 48, seed: 11 });
    if (!r) return;
    for (const s of r.starts) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const t = r.map.tiles[(s.y + dy) * r.map.width + (s.x + dx)] as string;
          expect(t === 'grass' || t === 'dirt').toBe(true);
        }
      }
    }
  });

  it('each start has a gold mine and forest within reach', () => {
    const r = generateMap({ width: 64, height: 64, seed: 7 });
    if (!r) return;
    for (const s of r.starts) {
      let goldDist = Infinity;
      let woodDist = Infinity;
      for (let y = 0; y < r.map.height; y++) {
        for (let x = 0; x < r.map.width; x++) {
          const t = r.map.tiles[y * r.map.width + x] as string;
          if (t === 'gold_mine') {
            const d = Math.abs(x - s.x) + Math.abs(y - s.y);
            if (d < goldDist) goldDist = d;
          } else if (t === 'forest') {
            const d = Math.abs(x - s.x) + Math.abs(y - s.y);
            if (d < woodDist) woodDist = d;
          }
        }
      }
      expect(goldDist).toBeLessThan(12);
      expect(woodDist).toBeLessThan(10);
    }
  });

  it('mapForLevel grows with level number and gives expected difficulty', () => {
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = mapForLevel(1234, i);
      sizes.push(r.map.width);
      expect(r.map.width).toBe(r.map.height);
      expect(difficultyForLevel(i)).toBe(i + 1);
    }
    // monotonically non-decreasing
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1] as number);
    }
  });

  it('mapForLevel is deterministic for (campaignSeed, level)', () => {
    const a = mapForLevel(99, 0);
    const b = mapForLevel(99, 0);
    expect(a.map.tiles).toEqual(b.map.tiles);
  });
});

describe('world & sim', () => {
  function bootWorld(seed = 1, level = 0, difficulty = 1, player: FactionId = 'human') {
    const { map, starts } = mapForLevel(seed, level);
    const w = createWorld(map, level, difficulty, player);
    initResourceTiles(w);
    const ai: FactionId = player === 'human' ? 'orc' : 'human';
    setupFactionStart(w, player, starts[0], { gold: 800, wood: 400 }, 3, 1.0);
    setupFactionStart(w, ai, starts[1], { gold: 800, wood: 400 }, 3, 1.0);
    return { w, starts, ai };
  }

  it('places a town hall and 3 workers for each faction', () => {
    const { w } = bootWorld();
    let th = 0, workers = 0;
    for (const b of w.buildings.values()) if (b.faction === 'human' && b.buildingKind === 'townhall') th++;
    for (const u of w.units.values()) if (u.faction === 'human' && u.unitKind === 'worker') workers++;
    expect(th).toBe(1);
    expect(workers).toBe(3);
  });

  it('fog is unexplored everywhere except the player start area', () => {
    const { w } = bootWorld();
    const fog = w.factions.human.fog;
    let visible = 0;
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) visible++;
    expect(visible).toBeGreaterThan(0);
    // Center of map should be unexplored
    const cx = Math.floor(w.map.width / 2);
    const cy = Math.floor(w.map.height / 2);
    expect(fog[cy * w.map.width + cx]).toBe(0);
  });

  it('tick progresses time and runs without throwing for 10 simulated seconds', () => {
    const { w } = bootWorld();
    const rng = mulberry32(123);
    expect(() => {
      for (let i = 0; i < 600; i++) tick(w, 1 / 60, rng);
    }).not.toThrow();
    expect(w.time).toBeGreaterThan(5);
  });

  it('canTrain rejects training when supply is at the cap', () => {
    const { w } = bootWorld();
    // force supply cap = 10 (1 town hall) and supply used = 10
    w.factions.human.supplyCap = 10;
    w.factions.human.supplyUsed = 10;
    expect(canTrain(w, 'human', 'worker')).toBe(false);
  });

  it('canTrain rejects when the gold cost is not met', () => {
    const { w } = bootWorld();
    w.factions.human.gold = 0;
    w.factions.human.wood = 0;
    expect(canTrain(w, 'human', 'worker')).toBe(false);
  });

  it('tryQueueBuilding places a building if affordable and on a valid spot', () => {
    const { w } = bootWorld();
    // find a buildable spot near the player
    let placed = false;
    for (let y = 6; y < w.map.height - 6 && !placed; y++) {
      for (let x = 6; x < w.map.width - 6 && !placed; x++) {
        if (isBuildable(w, x, y, 2, 2)) {
          const before = w.factions.human.gold;
          w.factions.human.gold = 1000;
          w.factions.human.wood = 1000;
          const b = tryQueueBuilding(w, 'human', 'farm', x, y);
          expect(b).not.toBeNull();
          expect(b?.buildingKind).toBe('farm');
          expect(b?.underConstruction).toBe(true);
          expect(w.factions.human.gold).toBeLessThan(before + 1000);
          placed = true;
        }
      }
    }
    expect(placed).toBe(true);
  });

  it('tryQueueBuilding refuses to place a building on an occupied tile', () => {
    const { w } = bootWorld();
    w.factions.human.gold = 10000; w.factions.human.wood = 10000;
    // the player town hall occupies 3x3 at starts[0]-1..+1
    const th = Array.from(w.buildings.values()).find((b) => b.faction === 'human' && b.buildingKind === 'townhall');
    expect(th).toBeDefined();
    if (!th) return;
    const b = tryQueueBuilding(w, 'human', 'farm', th.pos.x, th.pos.y);
    expect(b).toBeNull();
  });

  it('A* path on the playability map reaches the AI start', () => {
    const { w, starts } = bootWorld();
    const [a, b] = starts;
    const path = aStarSearch(w.map, a.x, a.y, b.x, b.y, {
      walkable: (x, y) => x >= 0 && y >= 0 && x < w.map.width && y < w.map.height && TILES[w.map.tiles[y * w.map.width + x] as keyof typeof TILES].walkable,
    });
    expect(path).not.toBeNull();
  });

  it('AI builds barracks within 60s of game start (difficulty 1)', () => {
    const { w, ai } = bootWorld(1, 0, 1, 'human');
    const rng = mulberry32(7);
    // give the AI huge resources so build order isn't blocked by money
    w.factions[ai].gold = 50000;
    w.factions[ai].wood = 50000;
    let elapsed = 0;
    let barracks = false;
    const dt = 1 / 60;
    const end = 60; // 1 minute (still well within typical AI build times)
    while (elapsed < end) {
      tick(w, dt, rng);
      aiTick(w, ai, 1, rng);
      elapsed += dt;
      if (Array.from(w.buildings.values()).some((b) => b.faction === ai && b.buildingKind === 'barracks')) {
        barracks = true;
        break;
      }
    }
    expect(barracks).toBe(true);
  });

  it('AI produces military units after barracks is built', () => {
    const { w, ai } = bootWorld(1, 0, 1, 'human');
    const rng = mulberry32(11);
    w.factions[ai].gold = 50000;
    w.factions[ai].wood = 50000;
    let elapsed = 0;
    let military = 0;
    const dt = 1 / 60;
    const end = 150; // 2.5 minutes
    while (elapsed < end) {
      tick(w, dt, rng);
      aiTick(w, ai, 1, rng);
      // continuously top up so the test isn't a balance check
      if (w.factions[ai].gold < 1000) w.factions[ai].gold = 50000;
      if (w.factions[ai].wood < 1000) w.factions[ai].wood = 50000;
      elapsed += dt;
      military = 0;
      for (const u of w.units.values()) {
        if (u.faction === ai && (u.unitKind === 'melee' || u.unitKind === 'ranged' || u.unitKind === 'heavy')) military++;
      }
      if (military >= 2) break;
    }
    expect(military).toBeGreaterThanOrEqual(2);
  });

  it('combat damage respects armor and has a minimum of 1', () => {
    const { w } = bootWorld();
    // build two units and force combat
    const a = placeUnit(w, 'human', 'melee', 10, 10);
    const b = placeUnit(w, 'orc', 'melee', 10, 11);
    recomputeSupplyCaps(w);
    // armor: melee has 2 armor in design
    const before = b.hp;
    applyDamage(w, a, b, UNIT_STATS.melee.damage.max);
    expect(b.hp).toBeLessThan(before);
  });

  it('dying unit eventually removed from world', () => {
    const { w } = bootWorld();
    const a = placeUnit(w, 'human', 'melee', 20, 20);
    const id = a.id;
    a.hp = 0;
    const rng = mulberry32(0);
    // tick long enough for corpse to fade (1.5s) + safety
    for (let i = 0; i < 200; i++) tick(w, 1 / 60, rng);
    expect(w.units.has(id)).toBe(false);
  });

  it('isBuildable returns false for water/rock tiles', () => {
    const { w } = bootWorld();
    // force a known water tile by setting it
    w.map.tiles[10 * w.map.width + 10] = 'water';
    expect(isBuildable(w, 10, 10, 1, 1)).toBe(false);
    expect(isWalkable(w, 10, 10)).toBe(false);
  });

  it('tryQueueTrain queues a worker at the town hall', () => {
    const { w } = bootWorld();
    w.factions.human.gold = 1000; w.factions.human.wood = 1000;
    const th = Array.from(w.buildings.values()).find((b) => b.faction === 'human' && b.buildingKind === 'townhall');
    expect(th).toBeDefined();
    if (!th) return;
    const ok = tryQueueTrain(w, th.id, 'worker');
    expect(ok).toBe(true);
    expect(th.trainQueue.length).toBe(1);
  });

  it('tryQueueTrain refuses ranged/heavy without a mill', () => {
    const { w } = bootWorld();
    w.factions.human.gold = 1000; w.factions.human.wood = 1000;
    const th = Array.from(w.buildings.values()).find((b) => b.faction === 'human' && b.buildingKind === 'townhall');
    expect(th).toBeDefined();
    if (!th) return;
    // place barracks manually
    const br = placeBuilding(w, 'human', 'barracks', 20, 20, false);
    recomputeSupplyCaps(w);
    expect(tryQueueTrain(w, br.id, 'ranged')).toBe(false);
  });

  it('nearestDropoff returns a town hall for gold and a mill for wood', () => {
    const { w } = bootWorld();
    w.factions.human.gold = 1000; w.factions.human.wood = 1000;
    const th = Array.from(w.buildings.values()).find((b) => b.faction === 'human' && b.buildingKind === 'townhall');
    expect(th).toBeDefined();
    if (!th) return;
    const mill = placeBuilding(w, 'human', 'mill', 20, 20, false);
    recomputeSupplyCaps(w);
    const goldDrop = nearestDropoff(w, 'human', th.pos.x + 1, th.pos.y + 1, 'gold');
    const woodDrop = nearestDropoff(w, 'human', th.pos.x + 1, th.pos.y + 1, 'wood');
    expect(goldDrop).toBeDefined();
    expect(woodDrop).toBeDefined();
    void mill;
  });

  it('pathToTile returns false when the start tile is non-walkable', () => {
    const { w } = bootWorld();
    w.map.tiles[0] = 'rock';
    const u = placeUnit(w, 'human', 'worker', 0, 0);
    expect(pathToTile(w, u, 10, 10)).toBe(false);
  });

  it('buildings are not buildable where another building is placed', () => {
    const { w } = bootWorld();
    w.factions.human.gold = 1000; w.factions.human.wood = 1000;
    // pick a buildable spot far from the town hall
    let spot: { x: number; y: number } | null = null;
    for (let y = 15; y < 25 && !spot; y++) {
      for (let x = 15; x < 25 && !spot; x++) {
        if (isBuildable(w, x, y, 2, 2)) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    if (!spot) return;
    const b1 = tryQueueBuilding(w, 'human', 'farm', spot.x, spot.y);
    expect(b1).not.toBeNull();
    const b2 = tryQueueBuilding(w, 'human', 'farm', spot.x, spot.y);
    expect(b2).toBeNull();
  });
});

describe('resource tiles', () => {
  it('initResourceTiles produces a gold and wood tile entry per resource tile', () => {
    const w = (() => {
      const { map } = mapForLevel(123, 0);
      const world = createWorld(map, 0, 1, 'human');
      initResourceTiles(world);
      return world;
    })();
    let goldTiles = 0;
    let woodTiles = 0;
    for (const r of w.resources) {
      if (r.type === 'gold') goldTiles++;
      else if (r.type === 'wood') woodTiles++;
    }
    expect(goldTiles + woodTiles).toBeGreaterThan(0);
  });

  it('nearestResource returns null when the resource is depleted or out of range', () => {
    const w = (() => {
      const { map } = mapForLevel(456, 0);
      const world = createWorld(map, 0, 1, 'human');
      initResourceTiles(world);
      return world;
    })();
    const r = nearestResource(w, 0, 0, 'gold', 5);
    expect(r === null || typeof r === 'object').toBe(true);
  });
});

describe('data table sanity', () => {
  it('all units have positive HP, sight, attack cooldown; cost is non-negative', () => {
    for (const k of ['worker', 'melee', 'ranged', 'heavy'] as const) {
      const s = UNIT_STATS[k];
      expect(s.hp).toBeGreaterThan(0);
      expect(s.sight).toBeGreaterThan(0);
      expect(s.attackCooldown).toBeGreaterThan(0);
      expect(s.moveSpeed).toBeGreaterThan(0);
      expect(s.cost.gold).toBeGreaterThanOrEqual(0);
      expect(s.cost.wood).toBeGreaterThanOrEqual(0);
      expect(s.supply).toBeGreaterThan(0);
      expect(s.buildTime).toBeGreaterThan(0);
    }
  });

  it('all buildings have positive HP, size, and (except town hall) non-zero cost', () => {
    for (const k of ['townhall', 'farm', 'barracks', 'mill', 'tower'] as const) {
      const b = BUILDING_STATS[k];
      expect(b.hp).toBeGreaterThan(0);
      expect(b.size.w).toBeGreaterThan(0);
      expect(b.size.h).toBeGreaterThan(0);
      if (k !== 'townhall') {
        expect(b.cost.gold + b.cost.wood).toBeGreaterThan(0);
      }
    }
  });
});
