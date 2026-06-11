import { describe, it, expect } from "vitest";
import {
  UNIT_STATS,
  BUILDING_STATS,
  UNIT_REQUIREMENTS,
  BUILDING_REQUIREMENTS,
  getUnitStats,
  getBuildingStats,
} from "../src/sim/stats.js";
import { UNIT_KINDS, BUILDING_KINDS } from "../src/game/types.js";
import type { BuildingKind } from "../src/game/types.js";

// ---------------------------------------------------------------------------
// (a) Mirroring: Human and Orc share identical numeric stats per role
// ---------------------------------------------------------------------------
describe("UNIT_STATS — faction mirroring", () => {
  const NUMERIC_UNIT_FIELDS: ReadonlyArray<
    keyof Omit<(typeof UNIT_STATS)[keyof typeof UNIT_STATS], "name">
  > = [
    "hp",
    "armor",
    "damage",
    "range",
    "attackCooldown",
    "moveSpeed",
    "sight",
    "goldCost",
    "woodCost",
    "supplyCost",
    "trainTime",
  ];

  for (const kind of UNIT_KINDS) {
    it(`${kind}: human and orc share the same numeric stats`, () => {
      const human = getUnitStats("human", kind);
      const orc = getUnitStats("orc", kind);
      for (const field of NUMERIC_UNIT_FIELDS) {
        expect(human[field]).toBe(orc[field]);
      }
      // Names must differ (mirrored numerically, distinct by name)
      expect(human.name).not.toBe(orc.name);
    });
  }

  it("all 8 unit table entries exist (4 kinds × 2 factions)", () => {
    expect(Object.keys(UNIT_STATS)).toHaveLength(8);
  });
});

describe("BUILDING_STATS — faction mirroring", () => {
  const NUMERIC_BUILDING_FIELDS: ReadonlyArray<
    keyof Omit<(typeof BUILDING_STATS)[keyof typeof BUILDING_STATS], "name">
  > = ["hp", "goldCost", "woodCost", "buildTime", "supplyProvided"];

  for (const kind of BUILDING_KINDS) {
    it(`${kind}: human and orc share the same numeric stats`, () => {
      const human = getBuildingStats("human", kind);
      const orc = getBuildingStats("orc", kind);
      for (const field of NUMERIC_BUILDING_FIELDS) {
        expect(human[field]).toBe(orc[field]);
      }
      // Footprint must match too
      expect(human.footprint.w).toBe(orc.footprint.w);
      expect(human.footprint.h).toBe(orc.footprint.h);
    });
  }

  it("all 10 building table entries exist (5 kinds × 2 factions)", () => {
    expect(Object.keys(BUILDING_STATS)).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// (b) All required fields are present and are valid positive numbers
// ---------------------------------------------------------------------------
describe("UNIT_STATS — field completeness", () => {
  const REQUIRED_NUMERIC: ReadonlyArray<
    keyof Omit<(typeof UNIT_STATS)[keyof typeof UNIT_STATS], "name">
  > = [
    "hp",
    "armor",
    "damage",
    "range",
    "attackCooldown",
    "moveSpeed",
    "sight",
    "goldCost",
    "woodCost",
    "supplyCost",
    "trainTime",
  ];

  for (const kind of UNIT_KINDS) {
    for (const faction of ["human", "orc"] as const) {
      it(`${faction} ${kind}: all numeric fields are finite and non-negative`, () => {
        const stats = getUnitStats(faction, kind);
        expect(typeof stats.name).toBe("string");
        expect(stats.name.length).toBeGreaterThan(0);
        for (const field of REQUIRED_NUMERIC) {
          const value = stats[field];
          expect(
            Number.isFinite(value),
            `${faction} ${kind}.${field} should be finite, got ${value}`,
          ).toBe(true);
          expect(
            value >= 0,
            `${faction} ${kind}.${field} should be >= 0, got ${value}`,
          ).toBe(true);
        }
        // hp, damage, range, sight, trainTime must be strictly positive
        expect(stats.hp).toBeGreaterThan(0);
        expect(stats.damage).toBeGreaterThan(0);
        expect(stats.range).toBeGreaterThan(0);
        expect(stats.sight).toBeGreaterThan(0);
        expect(stats.trainTime).toBeGreaterThan(0);
      });
    }
  }
});

describe("BUILDING_STATS — field completeness", () => {
  for (const kind of BUILDING_KINDS) {
    for (const faction of ["human", "orc"] as const) {
      it(`${faction} ${kind}: all numeric fields are finite and non-negative`, () => {
        const stats = getBuildingStats(faction, kind);
        expect(typeof stats.name).toBe("string");
        expect(stats.name.length).toBeGreaterThan(0);
        expect(Number.isFinite(stats.hp)).toBe(true);
        expect(stats.hp).toBeGreaterThan(0);
        expect(Number.isFinite(stats.goldCost)).toBe(true);
        expect(stats.goldCost).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(stats.woodCost)).toBe(true);
        expect(stats.woodCost).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(stats.buildTime)).toBe(true);
        expect(stats.buildTime).toBeGreaterThanOrEqual(0);
        expect(stats.footprint.w).toBeGreaterThan(0);
        expect(stats.footprint.h).toBeGreaterThan(0);
        expect(stats.supplyProvided).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (c) Prerequisites: ranged → LumberMill; heavy → Barracks + LumberMill
// ---------------------------------------------------------------------------
describe("UNIT_REQUIREMENTS — prerequisites", () => {
  it("worker has no prerequisites", () => {
    expect(UNIT_REQUIREMENTS.worker).toHaveLength(0);
  });

  it("infantry requires barracks only", () => {
    expect(UNIT_REQUIREMENTS.infantry).toContain("barracks" satisfies BuildingKind);
    expect(UNIT_REQUIREMENTS.infantry).not.toContain("lumberMill" satisfies BuildingKind);
  });

  it("ranged requires lumberMill", () => {
    expect(UNIT_REQUIREMENTS.ranged).toContain("lumberMill" satisfies BuildingKind);
  });

  it("ranged requires barracks", () => {
    expect(UNIT_REQUIREMENTS.ranged).toContain("barracks" satisfies BuildingKind);
  });

  it("heavy requires both barracks and lumberMill", () => {
    expect(UNIT_REQUIREMENTS.heavy).toContain("barracks" satisfies BuildingKind);
    expect(UNIT_REQUIREMENTS.heavy).toContain("lumberMill" satisfies BuildingKind);
  });

  it("heavy requires at least 2 prerequisites", () => {
    expect(UNIT_REQUIREMENTS.heavy.length).toBeGreaterThanOrEqual(2);
  });
});

describe("BUILDING_REQUIREMENTS — prerequisites", () => {
  it("townHall has no prerequisites", () => {
    expect(BUILDING_REQUIREMENTS.townHall).toHaveLength(0);
  });

  it("farm has no prerequisites", () => {
    expect(BUILDING_REQUIREMENTS.farm).toHaveLength(0);
  });

  it("barracks requires townHall", () => {
    expect(BUILDING_REQUIREMENTS.barracks).toContain(
      "townHall" satisfies BuildingKind,
    );
  });

  it("lumberMill requires barracks", () => {
    expect(BUILDING_REQUIREMENTS.lumberMill).toContain(
      "barracks" satisfies BuildingKind,
    );
  });

  it("guardTower requires barracks", () => {
    expect(BUILDING_REQUIREMENTS.guardTower).toContain(
      "barracks" satisfies BuildingKind,
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Supply: Town Hall and Farm provide supply; others provide 0
// ---------------------------------------------------------------------------
describe("BUILDING_STATS — supply", () => {
  it("townHall provides positive supply for both factions", () => {
    expect(getBuildingStats("human", "townHall").supplyProvided).toBeGreaterThan(0);
    expect(getBuildingStats("orc", "townHall").supplyProvided).toBeGreaterThan(0);
  });

  it("farm provides positive supply for both factions", () => {
    expect(getBuildingStats("human", "farm").supplyProvided).toBeGreaterThan(0);
    expect(getBuildingStats("orc", "farm").supplyProvided).toBeGreaterThan(0);
  });

  const NON_SUPPLY_BUILDINGS: BuildingKind[] = [
    "barracks",
    "lumberMill",
    "guardTower",
  ];
  for (const kind of NON_SUPPLY_BUILDINGS) {
    it(`${kind} provides 0 supply for both factions`, () => {
      expect(getBuildingStats("human", kind).supplyProvided).toBe(0);
      expect(getBuildingStats("orc", kind).supplyProvided).toBe(0);
    });
  }

  it("farm supply matches between human and orc (mirrored)", () => {
    const humanSupply = getBuildingStats("human", "farm").supplyProvided;
    const orcSupply = getBuildingStats("orc", "farm").supplyProvided;
    expect(humanSupply).toBe(orcSupply);
  });
});

// ---------------------------------------------------------------------------
// Additional: Human unit names match the spec
// ---------------------------------------------------------------------------
describe("Human unit names match spec", () => {
  it("worker is named Peasant for humans", () => {
    expect(getUnitStats("human", "worker").name).toBe("Peasant");
  });

  it("infantry is named Footman for humans", () => {
    expect(getUnitStats("human", "infantry").name).toBe("Footman");
  });

  it("ranged is named Archer for humans", () => {
    expect(getUnitStats("human", "ranged").name).toBe("Archer");
  });

  it("heavy is named Knight for humans", () => {
    expect(getUnitStats("human", "heavy").name).toBe("Knight");
  });
});

// ---------------------------------------------------------------------------
// Additional: Orc unit names match the spec
// ---------------------------------------------------------------------------
describe("Orc unit names match spec", () => {
  it("worker is named Peon for orcs", () => {
    expect(getUnitStats("orc", "worker").name).toBe("Peon");
  });

  it("infantry is named Grunt for orcs", () => {
    expect(getUnitStats("orc", "infantry").name).toBe("Grunt");
  });

  it("ranged is named Spearthrower for orcs", () => {
    expect(getUnitStats("orc", "ranged").name).toBe("Spearthrower");
  });

  it("heavy is named Ogre for orcs", () => {
    expect(getUnitStats("orc", "heavy").name).toBe("Ogre");
  });
});
