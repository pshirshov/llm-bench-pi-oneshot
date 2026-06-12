/** Main game renderer. Draws the world state to a Canvas 2D context. */

import type { World } from "../sim/world";
import type { Viewport } from "../render/viewport";
import type { InputState } from "../ui/input";
import { FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE } from "../sim/constants";
import { FACTION_COLORS } from "../sim/stats";
import { drawTile, drawUnit, drawBuilding, drawProjectile } from "../render/sprites";
import { computeLayout, type HUDLayout, type HUDButton } from "../ui/layout";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout: HUDLayout | null = null;
  private buttons: HUDButton[] = [];

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  render(world: World, viewport: Viewport, inputState: InputState, canvasWidth: number, canvasHeight: number): void {
    this.layout = computeLayout(canvasWidth, canvasHeight);

    this.ctx.fillStyle = "#111";
    this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    this.drawMap(world, viewport, inputState);
    this.drawEntities(world, viewport, inputState);
    this.drawProjectiles(world, viewport);
    this.drawHUD(world, inputState, canvasWidth);
    this.drawMinimap(world, viewport, inputState);
    this.drawSelectionPanel(world, inputState);

    if (world.gameOver) {
      this.drawGameOver(world, canvasWidth, canvasHeight);
    }
  }

  private drawMap(world: World, viewport: Viewport, inputState: InputState): void {
    const ts = viewport.tileSize;
    const startCol = Math.floor(viewport.x);
    const startRow = Math.floor(viewport.y);
    const endCol = Math.min(startCol + viewport.visibleTilesX, world.map.width);
    const endRow = Math.min(startRow + viewport.visibleTilesY, world.map.height);
    const faction = inputState.seed >= 0 ? "human" : "human";

    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        if (row < 0 || col < 0) continue;
        const sx = (col - viewport.x) * ts;
        const sy = (row - viewport.y) * ts;
        const tile = world.map.getTile(col, row);
        const fogState = world.fog.getTile(faction, col, row);

        drawTile(this.ctx, tile, sx, sy, ts);

        if (fogState === FOG_UNEXPLORED) {
          this.ctx.fillStyle = "rgba(0,0,0,0.9)";
          this.ctx.fillRect(sx, sy, ts, ts);
        } else if (fogState === FOG_EXPLORED) {
          this.ctx.fillStyle = "rgba(0,0,0,0.5)";
          this.ctx.fillRect(sx, sy, ts, ts);
        }
      }
    }
  }

  private drawEntities(world: World, viewport: Viewport, inputState: InputState): void {
    const faction = inputState.seed >= 0 ? "human" : "human";

    for (const b of world.buildings) {
      if (b.hp <= 0) continue;
      const fogState = world.fog.getTile(faction, b.col, b.row);
      if (b.faction !== faction && fogState !== FOG_VISIBLE) continue;
      drawBuilding(this.ctx, b, viewport.x, viewport.y, viewport.tileSize);
    }

    for (const u of world.units) {
      if (u.hp <= 0) continue;
      const tileX = Math.floor(u.x);
      const tileY = Math.floor(u.y);
      const fogState = world.fog.getTile(faction, tileX, tileY);
      if (u.faction !== faction && fogState !== FOG_VISIBLE) continue;
      drawUnit(this.ctx, u, viewport.x, viewport.y, viewport.tileSize);

      if (inputState.selectedIds.includes(u.id)) {
        const sx = (u.x - viewport.x) * viewport.tileSize;
        const sy = (u.y - viewport.y) * viewport.tileSize;
        this.ctx.strokeStyle = "#00ff00";
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, viewport.tileSize * 0.5, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
  }

  private drawProjectiles(world: World, viewport: Viewport): void {
    for (const p of world.projectiles) {
      drawProjectile(this.ctx, p.x, p.y, viewport.x, viewport.y, viewport.tileSize, p.faction);
    }
  }

  private drawHUD(world: World, inputState: InputState, canvasWidth: number): void {
    if (!this.layout) return;
    const res = world.getResources("human");
    const supply = world.getSupply("human");

    this.ctx.fillStyle = "rgba(0,0,0,0.8)";
    this.ctx.fillRect(0, 0, canvasWidth, 32);
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "14px monospace";
    this.ctx.textAlign = "left";
    this.ctx.fillText(`Gold: ${Math.floor(res.gold)}  Wood: ${Math.floor(res.wood)}  Supply: ${supply.used}/${supply.cap}`, 8, 22);
    this.ctx.fillText(`Seed: ${inputState.seed}`, canvasWidth - 160, 22);
    this.ctx.fillText(inputState.paused ? "PAUSED" : `Speed: ${inputState.speed}x`, canvasWidth - 280, 22);
  }

  private drawMinimap(world: World, viewport: Viewport, inputState: InputState): void {
    if (!this.layout) return;
    const mm = this.layout.minimap;
    const scaleX = mm.w / world.map.width;
    const scaleY = mm.h / world.map.height;
    const faction = inputState.seed >= 0 ? "human" : "human";

    this.ctx.fillStyle = "#333";
    this.ctx.fillRect(mm.x, mm.y, mm.w, mm.h);

    for (let row = 0; row < world.map.height; row++) {
      for (let col = 0; col < world.map.width; col++) {
        const fogState = world.fog.getTile(faction, col, row);
        if (fogState === FOG_UNEXPLORED) continue;
        const tile = world.map.getTile(col, row);
        const colors: Record<string, string> = {
          grass: "#4a8c3f", dirt: "#a08050", forest: "#2d6b2d",
          water: "#3366aa", rock: "#808080", gold_mine: "#ccaa33",
          depleted_mine: "#776644", chopped_forest: "#7a9a4a",
        };
        this.ctx.fillStyle = fogState === FOG_EXPLORED ? "#444" : (colors[tile] ?? "#4a8c3f");
        this.ctx.fillRect(mm.x + col * scaleX, mm.y + row * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
      }
    }

    for (const u of world.units) {
      if (u.hp <= 0) continue;
      const fogState = world.fog.getTile(faction, Math.floor(u.x), Math.floor(u.y));
      if (u.faction !== faction && fogState !== FOG_VISIBLE) continue;
      this.ctx.fillStyle = FACTION_COLORS[u.faction];
      this.ctx.fillRect(mm.x + u.x * scaleX - 1, mm.y + u.y * scaleY - 1, 3, 3);
    }

    this.ctx.strokeStyle = "#fff";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      mm.x + viewport.x * scaleX,
      mm.y + viewport.y * scaleY,
      (viewport.width / viewport.tileSize) * scaleX,
      (viewport.height / viewport.tileSize) * scaleY
    );
  }

  private drawSelectionPanel(world: World, inputState: InputState): void {
    if (!this.layout) return;
    const panel = this.layout.selectionPanel;

    this.ctx.fillStyle = "rgba(20,20,40,0.9)";
    this.ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    this.ctx.strokeStyle = "#555";
    this.ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

    const selected = inputState.selectedIds
      .map(id => world.units.find(u => u.id === id) ?? world.buildings.find(b => b.id === id))
      .filter((x): x is NonNullable<typeof x> => x != null);

    this.ctx.fillStyle = "#fff";
    this.ctx.font = "12px monospace";
    this.ctx.textAlign = "left";
    let yOff = panel.y + 16;

    for (const entity of selected.slice(0, 3)) {
      if ("x" in entity) {
        const u = entity as typeof world.units[0];
        this.ctx.fillText(`${u.type} HP: ${u.hp}/${u.maxHp}`, panel.x + 8, yOff);
      } else {
        const b = entity as typeof world.buildings[0];
        this.ctx.fillText(`${b.type} HP: ${Math.floor(b.hp)}/${b.maxHp}`, panel.x + 8, yOff);
      }
      yOff += 16;
    }
  }

  private drawGameOver(world: World, canvasWidth: number, canvasHeight: number): void {
    this.ctx.fillStyle = "rgba(0,0,0,0.7)";
    this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    this.ctx.fillStyle = world.winner === "human" ? "#00ff00" : "#ff0000";
    this.ctx.font = "48px sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText(world.winner === "human" ? "VICTORY!" : "DEFEAT!", canvasWidth / 2, canvasHeight / 2);
  }
}