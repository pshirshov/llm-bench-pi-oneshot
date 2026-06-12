/** A* pathfinding on tile grid. 8-directional, no corner cutting. */

import type { TileCoord } from "./types";
import { GameMap } from "./map";
import { isWalkable } from "./tile";

interface AStarNode {
  col: number;
  row: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

const SQRT2 = Math.SQRT2;

function heuristic(a: TileCoord, b: TileCoord): number {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
}

function canMoveDiagonal(map: GameMap, fc: number, fr: number, tc: number, tr: number): boolean {
  return isWalkable(map.getTile(fc, tr)) && isWalkable(map.getTile(tc, fr));
}

/** A* pathfinding. Returns array of tile coords from start to end (exclusive of start),
  * or null if no path exists. */
export function findPath(
  map: GameMap, start: TileCoord, end: TileCoord,
  occupied: Set<string> = new Set()
): TileCoord[] | null {
  if (!map.inBounds(end.col, end.row)) return null;

  const startKey = `${start.col},${start.row}`;
  const endKey = `${end.col},${end.row}`;

  // If end is unwalkable, find nearest walkable tile
  let actualEnd: TileCoord = end;
  if (!map.isWalkable(end.col, end.row) || occupied.has(endKey)) {
    const nearest = findNearestWalkable(map, end, occupied);
    if (!nearest) return null;
    actualEnd = nearest;
  }

  if (!map.isWalkable(start.col, start.row)) return null;

  const openMap = new Map<string, AStarNode>();
  const closedSet = new Set<string>();
  const openList: AStarNode[] = [];

  const startNode: AStarNode = {
    col: start.col, row: start.row,
    g: 0, h: heuristic(start, actualEnd),
    f: heuristic(start, actualEnd), parent: null,
  };
  openList.push(startNode);
  openMap.set(startKey, startNode);

  const dirs: [number, number, number][] = [
    [-1, -1, SQRT2], [0, -1, 1], [1, -1, SQRT2],
    [-1, 0, 1],                     [1, 0, 1],
    [-1, 1, SQRT2],  [0, 1, 1],  [1, 1, SQRT2],
  ];

  const MAX_NODES = map.width * map.height * 2;

  while (openList.length > 0 && closedSet.size < MAX_NODES) {
    // Find lowest f in open list
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bestIdx].f) bestIdx = i;
    }
    const current = openList[bestIdx];
    openList.splice(bestIdx, 1);

    const curKey = `${current.col},${current.row}`;
    openMap.delete(curKey);

    if (current.col === actualEnd.col && current.row === actualEnd.row) {
      // Reconstruct path
      const path: TileCoord[] = [];
      let node: AStarNode | null = current;
      while (node && node.parent) {
        path.unshift({ col: node.col, row: node.row });
        node = node.parent;
      }
      return path;
    }

    closedSet.add(curKey);

    for (const [dc, dr, cost] of dirs) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (!map.inBounds(nc, nr)) continue;

      const nKey = `${nc},${nr}`;
      if (closedSet.has(nKey)) continue;

      // Check walkability (allow occupied tiles only at the destination)
      if (!map.isWalkable(nc, nr) && nKey !== endKey) continue;

      // Check corner cutting for diagonal moves
      if (dc !== 0 && dr !== 0) {
        if (!canMoveDiagonal(map, current.col, current.row, nc, nr)) continue;
      }

      // Allow walking through occupied tiles only if at destination
      if (occupied.has(nKey) && nKey !== endKey) continue;

      const g = current.g + cost;
      const existing = openMap.get(nKey);
      if (existing && g >= existing.g) continue;

      const h = heuristic({ col: nc, row: nr }, actualEnd);
      const node: AStarNode = { col: nc, row: nr, g, h, f: g + h, parent: current };

      if (existing) {
        openList.splice(openList.indexOf(existing), 1);
      }
      openList.push(node);
      openMap.set(nKey, node);
    }
  }

  return null; // No path found
}

/** Find nearest walkable tile to target. */
export function findNearestWalkable(
  map: GameMap, target: TileCoord, occupied: Set<string>
): TileCoord | null {
  if (map.isWalkable(target.col, target.row) && !occupied.has(`${target.col},${target.row}`)) {
    return target;
  }
  // BFS from target outward
  const visited = new Set<string>();
  const queue: TileCoord[] = [{ col: target.col, row: target.row }];
  visited.add(`${target.col},${target.row}`);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]) {
      const nc = cur.col + dc;
      const nr = cur.row + dr;
      const key = `${nc},${nr}`;
      if (visited.has(key) || !map.inBounds(nc, nr)) continue;
      visited.add(key);
      if (map.isWalkable(nc, nr) && !occupied.has(key)) return { col: nc, row: nr };
      queue.push({ col: nc, row: nr });
    }
  }
  return null;
}

/** Compute land-path distance between two points (8-directional). */
export function landPathDistance(map: GameMap, a: TileCoord, b: TileCoord): number | null {
  const path = findPath(map, a, b);
  if (!path) return null;
  let dist = 0;
  let prev = a;
  for (const p of path) {
    const dx = Math.abs(p.col - prev.col);
    const dy = Math.abs(p.row - prev.row);
    dist += (dx > 0 && dy > 0) ? SQRT2 : Math.max(dx, dy);
    prev = p;
  }
  return dist;
}