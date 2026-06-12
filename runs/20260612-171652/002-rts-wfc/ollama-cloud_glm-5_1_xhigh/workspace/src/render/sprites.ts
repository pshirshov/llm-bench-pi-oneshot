/** Programmatic sprite drawing. No external assets. */

import type { Faction, TileType, Unit, Building } from "../sim/types";
import { FACTION_COLORS, BUILDING_STATS } from "../sim/stats";
import { tileColor, tileBorderColor } from "../sim/tile";

export function drawTile(ctx: CanvasRenderingContext2D, tileType: TileType, x: number, y: number, size: number): void {
  ctx.fillStyle = tileColor(tileType);
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = tileBorderColor(tileType);
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, size, size);

  // Details for special tiles
  if (tileType === "gold_mine") {
    ctx.fillStyle = "#ffdd00";
    ctx.fillRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4);
  } else if (tileType === "forest") {
    ctx.fillStyle = "#1a4d1a";
    ctx.beginPath();
    ctx.moveTo(x + size * 0.5, y + size * 0.15);
    ctx.lineTo(x + size * 0.2, y + size * 0.75);
    ctx.lineTo(x + size * 0.8, y + size * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5c3a1e";
    ctx.fillRect(x + size * 0.45, y + size * 0.7, size * 0.1, size * 0.25);
  } else if (tileType === "rock") {
    ctx.fillStyle = "#a0a0a0";
    ctx.beginPath();
    ctx.moveTo(x + size * 0.3, y + size * 0.7);
    ctx.lineTo(x + size * 0.5, y + size * 0.2);
    ctx.lineTo(x + size * 0.7, y + size * 0.7);
    ctx.closePath();
    ctx.fill();
  } else if (tileType === "depleted_mine") {
    ctx.fillStyle = "#555544";
    ctx.fillRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4);
    ctx.strokeStyle = "#333322";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + size * 0.3, y + size * 0.3);
    ctx.lineTo(x + size * 0.7, y + size * 0.7);
    ctx.stroke();
  }
}

export function drawUnit(ctx: CanvasRenderingContext2D, unit: Unit, camX: number, camY: number, tileSize: number): void {
  const sx = (unit.x - camX) * tileSize;
  const sy = (unit.y - camY) * tileSize;
  const color = FACTION_COLORS[unit.faction];
  const size = tileSize * 0.4;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Unit type indicator
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.max(8, tileSize * 0.3)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = unit.type === "worker" ? "W" : unit.type === "melee" ? "M" : unit.type === "ranged" ? "R" : "H";
  ctx.fillText(label, sx, sy);

  // HP bar
  const hpPct = unit.hp / unit.maxHp;
  const barW = tileSize * 0.6;
  const barH = 3;
  const barX = sx - barW / 2;
  const barY = sy - size - 4;
  ctx.fillStyle = "#000000";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hpPct > 0.5 ? "#00ff00" : hpPct > 0.25 ? "#ffff00" : "#ff0000";
  ctx.fillRect(barX, barY, barW * hpPct, barH);

  // Cargo indicator
  if (unit.cargo.type) {
    ctx.fillStyle = unit.cargo.type === "gold" ? "#ffdd00" : "#8B4513";
    ctx.fillRect(sx + size * 0.7, sy - size * 0.7, 4, 4);
  }
}

export function drawBuilding(ctx: CanvasRenderingContext2D, building: Building, camX: number, camY: number, tileSize: number): void {
  const bStats = BUILDING_STATS[building.type];

  const sx = (building.col - camX) * tileSize;
  const sy = (building.row - camY) * tileSize;
  const bw = bStats.width * tileSize;
  const bh = bStats.height * tileSize;

  const color = FACTION_COLORS[building.faction];
  ctx.fillStyle = building.isComplete ? color : "#666666";
  ctx.fillRect(sx, sy, bw, bh);
  ctx.strokeStyle = building.isComplete ? "#ffffff" : "#999999";
  ctx.lineWidth = 1;
  ctx.strokeRect(sx, sy, bw, bh);

  // Building label
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.max(9, tileSize * 0.35)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels: Record<string, string> = {
    town_hall: "TH", farm: "FM", barracks: "BR",
    lumber_mill: "LM", guard_tower: "GT",
  };
  ctx.fillText(labels[building.type] ?? "?", sx + bw / 2, sy + bh / 2);

  // Construction progress bar
  if (!building.isComplete) {
    const pct = building.hp / building.maxHp;
    ctx.fillStyle = "#333";
    ctx.fillRect(sx, sy - 6, bw, 4);
    ctx.fillStyle = "#ffcc00";
    ctx.fillRect(sx, sy - 6, bw * pct, 4);
  }

  // HP bar for completed buildings
  if (building.isComplete) {
    const hpPct = building.hp / building.maxHp;
    const barW = bw * 0.8;
    ctx.fillStyle = "#000";
    ctx.fillRect(sx + bw * 0.1, sy + bh - 4, barW, 3);
    ctx.fillStyle = hpPct > 0.5 ? "#00ff00" : hpPct > 0.25 ? "#ffff00" : "#ff0000";
    ctx.fillRect(sx + bw * 0.1, sy + bh - 4, barW * hpPct, 3);
  }
}

export function drawProjectile(ctx: CanvasRenderingContext2D, px: number, py: number, camX: number, camY: number, tileSize: number, faction: Faction): void {
  const sx = (px - camX) * tileSize;
  const sy = (py - camY) * tileSize;
  ctx.fillStyle = faction === "human" ? "#ffff00" : "#ff6600";
  ctx.beginPath();
  ctx.arc(sx, sy, 2, 0, Math.PI * 2);
  ctx.fill();
}