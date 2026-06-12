// Order types: the simulation's input API. Every order issued by the player or
// AI becomes one of these; the per-unit order processor advances them. Orders
// have an explicit `kind` and a discriminated payload.

import { BuildingKind, UnitKind } from "./stats.js";

export type Order =
  | MoveOrder
  | AttackOrder
  | AttackMoveOrder
  | HarvestOrder
  | BuildOrder
  | RepairOrder
  | TrainOrder;

export type OrderKind = Order["kind"];

export interface MoveOrder {
  readonly kind: "move";
  readonly x: number;
  readonly y: number;
}

export interface AttackOrder {
  readonly kind: "attack";
  readonly target: number; // entity id
}

export interface AttackMoveOrder {
  readonly kind: "attackMove";
  readonly x: number;
  readonly y: number;
}

export interface HarvestOrder {
  readonly kind: "harvest";
  /** Tile coordinate of the resource source (gold mine or forest). */
  readonly tx: number;
  readonly ty: number;
}

export interface BuildOrder {
  readonly kind: "build";
  readonly building: BuildingKind;
  readonly x: number;
  readonly y: number;
}

export interface RepairOrder {
  readonly kind: "repair";
  readonly target: number; // entity id
}

export interface TrainOrder {
  readonly kind: "train";
  readonly building: number; // entity id
  readonly unit: UnitKind;
}

export type OrderPhase =
  | "idle"
  | "moving"
  | "gathering"
  | "returning"
  | "building"
  | "repairing"
  | "training"
  | "attacking"
  | "patrolling";

export interface UnitOrderState {
  order: Order | null;
  phase: OrderPhase;
  /** Path of next tiles to step through (consumed head-first). */
  path: Array<[number, number]>;
  /** Sub-tile sub-tile movement accumulator (in tile units). */
  moveProgress: number;
  /** Gather / build progress accumulator (in sim-seconds). */
  workProgress: number;
  /** Attack cooldown accumulator. */
  attackCooldown: number;
  /** Number of times we've tried to repath for the current order. */
  repathAttempts: number;
  /** Cargos carried. */
  cargo: { gold: number; wood: number };
  /** Watchdog: ticks spent in the current order phase. */
  watchdog: number;
  /** Last observed snapshot for the watchdog (position tile, phase, cargo). */
  lastSnapshot: { tx: number; ty: number; phase: OrderPhase; cargoKey: string };
}

export function newOrderState(): UnitOrderState {
  return {
    order: null,
    phase: "idle",
    path: [],
    moveProgress: 0,
    workProgress: 0,
    attackCooldown: 0,
    repathAttempts: 0,
    cargo: { gold: 0, wood: 0 },
    watchdog: 0,
    lastSnapshot: { tx: -1, ty: -1, phase: "idle", cargoKey: "" },
  };
}
