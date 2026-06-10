// ─── Canvas 2D Renderer ───

import {
  FogState, UnitType, BuildingType, UnitState, BuildingState,
  GameScreen, TileType, Building as BuildingType_entity,
} from './types';
import { GameState } from './game';
import {
  TILE_SIZE, TILE_COLORS, TILE_COLORS_DIM, FACTION_COLORS, FACTION_COLORS_DARK,
  UNIT_NAMES, BUILDING_NAMES, UNIT_STATS, BUILDING_STATS,
  MINIMAP_SIZE, TOP_BAR_H, BOTTOM_PANEL_H,
} from './constants';

const MINIMAP_PAD = 4;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  render(state: GameState): void {
    this.ctx.clearRect(0, 0, this.width, this.height);

    switch (state.screen) {
      case GameScreen.Menu:
        this.renderMenu(state);
        break;
      case GameScreen.LevelSelect:
        this.renderLevelSelect(state);
        break;
      case GameScreen.Playing:
        this.renderGame(state);
        break;
      case GameScreen.Victory:
        this.renderGame(state);
        this.renderOverlay(state, 'VICTORY!', '#4488ff');
        break;
      case GameScreen.Defeat:
        this.renderGame(state);
        this.renderOverlay(state, 'DEFEAT', '#ff4444');
        break;
    }
  }

  // ─── Menu screens ───

  private renderMenu(state: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WARBAND', this.width / 2, this.height / 3);

    ctx.font = '18px monospace';
    ctx.fillText('A Real-Time Strategy Game', this.width / 2, this.height / 3 + 40);

    ctx.font = '24px monospace';
    ctx.fillStyle = '#88cc88';
    ctx.fillText('Click to Start', this.width / 2, this.height / 2 + 20);

    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Seed: ' + state.seed, this.width / 2, this.height - 40);
  }

  private renderLevelSelect(state: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SELECT LEVEL', this.width / 2, 60);

    const levels = [
      { name: 'The Plains', size: '32×32', diff: 1 },
      { name: 'River Valley', size: '48×48', diff: 2 },
      { name: 'Highland Pass', size: '64×64', diff: 3 },
      { name: 'Marshlands', size: '80×80', diff: 4 },
      { name: 'The Citadel', size: '96×96', diff: 5 },
    ];

    const startY = 120;
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i];
      const unlocked = i === 0 || state.levelResults.get(i);
      const y = startY + i * 70;
      const x = this.width / 2;

      ctx.fillStyle = unlocked ? '#2a4a2a' : '#2a2a2a';
      ctx.fillRect(x - 200, y, 400, 55);

      ctx.strokeStyle = unlocked ? '#448844' : '#444';
      ctx.strokeRect(x - 200, y, 400, 55);

      ctx.fillStyle = unlocked ? '#e0e0e0' : '#666';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Level ${i + 1}: ${lv.name}`, x, y + 25);

      ctx.font = '14px monospace';
      ctx.fillText(`${lv.size} — Difficulty ${lv.diff}`, x, y + 45);
    }

    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    ctx.fillText('Press ESC to return to menu', this.width / 2, this.height - 30);
  }

  // ─── Game rendering ───

  private renderGame(state: GameState): void {
    const vpX = Math.floor(state.camera.x);
    const vpY = Math.floor(state.camera.y);
    const vpW = Math.floor(this.width / TILE_SIZE);
    const vpH = Math.floor((this.height - TOP_BAR_H - BOTTOM_PANEL_H) / TILE_SIZE);

    this.renderTerrain(state, vpX, vpY, vpW, vpH);
    this.renderBuildings(state);
    this.renderUnits(state);
    this.renderProjectiles(state);
    this.renderCorpses(state);
    this.renderFog(state, vpX, vpY, vpW, vpH);
    this.renderSelection(state);
    this.renderBuildPreview(state);
    this.renderTopBar(state);
    this.renderBottomPanel(state);
    this.renderMinimap(state);
  }

  private renderTerrain(state: GameState, vpX: number, vpY: number, vpW: number, vpH: number): void {
    const ctx = this.ctx;
    const offX = -(state.camera.x - vpX) * TILE_SIZE;
    const offY = -(state.camera.y - vpY) * TILE_SIZE + TOP_BAR_H;

    for (let ty = Math.max(0, vpY - 1); ty < Math.min(state.map.height, vpY + vpH + 2); ty++) {
      for (let tx = Math.max(0, vpX - 1); tx < Math.min(state.map.width, vpX + vpW + 2); tx++) {
        const tile = state.map.tiles[ty][tx];
        const sx = (tx - vpX) * TILE_SIZE + offX;
        const sy = (ty - vpY) * TILE_SIZE + offY;
        if (sx < -TILE_SIZE || sx > this.width || sy < TOP_BAR_H - TILE_SIZE || sy > this.height - BOTTOM_PANEL_H) continue;

        const fog = state.fog[ty]?.[tx] ?? FogState.Unexplored;
        let color: string;

        if (fog === FogState.Unexplored) {
          color = '#111';
        } else if (fog === FogState.Explored) {
          color = TILE_COLORS_DIM[tile.type] || '#333';
        } else {
          color = TILE_COLORS[tile.type] || '#888';
        }

        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);

        // Resource indicator
        if (fog === FogState.Visible && tile.resourceAmount > 0) {
          if (tile.type === TileType.GoldMine) {
            ctx.fillStyle = '#ff0';
            ctx.fillRect(sx + TILE_SIZE * 0.3, sy + TILE_SIZE * 0.3, TILE_SIZE * 0.4, TILE_SIZE * 0.4);
          } else if (tile.type === TileType.Forest) {
            ctx.fillStyle = '#1a3a0e';
            ctx.beginPath();
            ctx.moveTo(sx + TILE_SIZE / 2, sy + TILE_SIZE * 0.1);
            ctx.lineTo(sx + TILE_SIZE * 0.8, sy + TILE_SIZE * 0.9);
            ctx.lineTo(sx + TILE_SIZE * 0.2, sy + TILE_SIZE * 0.9);
            ctx.fill();
          }
        }
      }
    }
  }

  private renderBuildings(state: GameState): void {
    const ctx = this.ctx;

    for (const building of state.buildings.values()) {
      if (building.state === BuildingState.Destroyed) continue;

      const stats = BUILDING_STATS[building.type];
      const bx = building.tileX;
      const by = building.tileY;

      // Check visibility
      let anyVisible = building.faction === state.playerFaction;
      if (!anyVisible) {
        for (let dy = 0; dy < stats.footprintH && !anyVisible; dy++) {
          for (let dx = 0; dx < stats.footprintW && !anyVisible; dx++) {
            const tx = bx + dx;
            const ty = by + dy;
            if (tx >= 0 && tx < state.map.width && ty >= 0 && ty < state.map.height) {
              if (state.fog[ty][tx] === FogState.Visible) anyVisible = true;
            }
          }
        }
      }
      if (!anyVisible) continue;

      const sx = (bx - state.camera.x) * TILE_SIZE;
      const sy = (by - state.camera.y) * TILE_SIZE + TOP_BAR_H;
      const sw = stats.footprintW * TILE_SIZE;
      const sh = stats.footprintH * TILE_SIZE;

      const color = building.faction === state.playerFaction ?
        (building.state === BuildingState.Constructing ? '#666' : FACTION_COLORS[building.faction]) :
        FACTION_COLORS[building.faction];

      ctx.fillStyle = color;
      ctx.fillRect(sx + 2, sy + 2, sw - 4, sh - 4);

      ctx.strokeStyle = building.faction === state.playerFaction ? '#fff' : '#aaa';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 2, sy + 2, sw - 4, sh - 4);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(getBuildingLabel(building.type), sx + sw / 2, sy + sh / 2 + 4);

      if (building.state === BuildingState.Constructing) {
        ctx.fillStyle = '#333';
        ctx.fillRect(sx + 4, sy - 8, sw - 8, 4);
        ctx.fillStyle = '#ff0';
        ctx.fillRect(sx + 4, sy - 8, (sw - 8) * building.buildProgress, 4);
      }

      if (building.hp < building.maxHp) {
        const hpRatio = building.hp / building.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(sx + 4, sy - 4, sw - 8, 3);
        ctx.fillStyle = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f00';
        ctx.fillRect(sx + 4, sy - 4, (sw - 8) * hpRatio, 3);
      }

      if (building.trainingQueue.length > 0) {
        const item = building.trainingQueue[0];
        ctx.fillStyle = '#333';
        ctx.fillRect(sx + 4, sy + sh, sw - 8, 3);
        ctx.fillStyle = '#4af';
        ctx.fillRect(sx + 4, sy + sh, (sw - 8) * item.progress, 3);
      }
    }
  }

  private renderUnits(state: GameState): void {
    const ctx = this.ctx;

    for (const unit of state.units.values()) {
      if (unit.state === UnitState.Dead) continue;

      if (unit.faction !== state.playerFaction) {
        const tx = Math.round(unit.x);
        const ty = Math.round(unit.y);
        if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) continue;
        if (state.fog[ty][tx] !== FogState.Visible) continue;
      }

      const sx = (unit.x - state.camera.x) * TILE_SIZE + TILE_SIZE / 2;
      const sy = (unit.y - state.camera.y) * TILE_SIZE + TOP_BAR_H + TILE_SIZE / 2;

      if (sx < -TILE_SIZE || sx > this.width + TILE_SIZE || sy < TOP_BAR_H - TILE_SIZE || sy > this.height) continue;

      const color = FACTION_COLORS[unit.faction];
      const radius = unit.type === UnitType.Heavy ? 8 : unit.type === UnitType.Worker ? 5 : 6;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(getUnitSymbol(unit.type), sx, sy + 3);

      if (unit.carryingAmount > 0) {
        ctx.fillStyle = unit.carryingType === 'gold' ? '#ff0' : '#840';
        ctx.fillRect(sx + radius, sy - radius, 4, 4);
      }

      if (unit.hp < unit.maxHp) {
        const hpRatio = unit.hp / unit.maxHp;
        const barW = 16;
        ctx.fillStyle = '#333';
        ctx.fillRect(sx - barW / 2, sy - radius - 6, barW, 3);
        ctx.fillStyle = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f00';
        ctx.fillRect(sx - barW / 2, sy - radius - 6, barW * hpRatio, 3);
      }
    }
  }

  private renderProjectiles(state: GameState): void {
    const ctx = this.ctx;
    for (const proj of state.projectiles.values()) {
      const sx = (proj.x - state.camera.x) * TILE_SIZE + TILE_SIZE / 2;
      const sy = (proj.y - state.camera.y) * TILE_SIZE + TOP_BAR_H + TILE_SIZE / 2;
      ctx.fillStyle = FACTION_COLORS[proj.faction];
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderCorpses(state: GameState): void {
    const ctx = this.ctx;
    for (const corpse of state.corpses) {
      const sx = (corpse.x - state.camera.x) * TILE_SIZE + TILE_SIZE / 2;
      const sy = (corpse.y - state.camera.y) * TILE_SIZE + TOP_BAR_H + TILE_SIZE / 2;
      const alpha = Math.max(0, Math.min(1, corpse.fadeTimer / 3));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = FACTION_COLORS_DARK[corpse.faction];
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private renderFog(state: GameState, vpX: number, vpY: number, vpW: number, vpH: number): void {
    const ctx = this.ctx;
    for (let ty = Math.max(0, vpY - 1); ty < Math.min(state.map.height, vpY + vpH + 2); ty++) {
      for (let tx = Math.max(0, vpX - 1); tx < Math.min(state.map.width, vpX + vpW + 2); tx++) {
        const fog = state.fog[ty]?.[tx];
        if (fog === FogState.Visible) continue;
        const sx = (tx - state.camera.x) * TILE_SIZE;
        const sy = (ty - state.camera.y) * TILE_SIZE + TOP_BAR_H;
        if (fog === FogState.Unexplored) {
          ctx.fillStyle = '#111';
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        } else if (fog === FogState.Explored) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  private renderSelection(state: GameState): void {
    const ctx = this.ctx;
    for (const id of state.selectedUnitIds) {
      const unit = state.units.get(id);
      if (!unit) continue;
      const sx = (unit.x - state.camera.x) * TILE_SIZE + TILE_SIZE / 2;
      const sy = (unit.y - state.camera.y) * TILE_SIZE + TOP_BAR_H + TILE_SIZE / 2;
      ctx.strokeStyle = '#0f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (state.selectedBuildingId !== null) {
      const building = state.buildings.get(state.selectedBuildingId);
      if (building) {
        const stats = BUILDING_STATS[building.type];
        const sx = (building.tileX - state.camera.x) * TILE_SIZE;
        const sy = (building.tileY - state.camera.y) * TILE_SIZE + TOP_BAR_H;
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, stats.footprintW * TILE_SIZE, stats.footprintH * TILE_SIZE);
      }
    }
  }

  private renderBuildPreview(_state: GameState): void {
    // Build preview drawn from input handler's mouse position
  }

  // ─── UI ───

  private renderTopBar(state: GameState): void {
    const ctx = this.ctx;
    const supply = getSupplyForUI(state);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, TOP_BAR_H);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';

    const res = state.resources[state.playerFaction];
    ctx.fillText(`Gold: ${Math.floor(res.gold)}`, 10, 24);
    ctx.fillText(`Wood: ${Math.floor(res.wood)}`, 130, 24);
    ctx.fillText(`Supply: ${supply.used}/${supply.cap}`, 250, 24);
    ctx.fillText(`Time: ${Math.floor(state.time)}s`, 400, 24);
    ctx.fillText(`Seed: ${state.seed}`, 530, 24);

    ctx.fillText(state.speed === 2 ? '[2x]' : '[1x]', this.width - 80, 24);

    if (state.paused) {
      ctx.fillStyle = '#ff0';
      ctx.fillText('PAUSED', this.width / 2, 24);
    }
  }

  private renderBottomPanel(state: GameState): void {
    const ctx = this.ctx;
    const panelY = this.height - BOTTOM_PANEL_H;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, panelY, this.width, BOTTOM_PANEL_H);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, panelY);
    ctx.lineTo(this.width, panelY);
    ctx.stroke();

    const infoX = MINIMAP_SIZE + 20;
    const infoY = panelY + 10;

    if (state.selectedUnitIds.length > 0) {
      this.renderUnitInfo(state, infoX, infoY);
    } else if (state.selectedBuildingId !== null) {
      this.renderBuildingInfo(state, infoX, infoY);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = '14px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Select a unit or building', infoX, infoY + 20);
    }
  }

  private renderUnitInfo(state: GameState, x: number, y: number): void {
    const ctx = this.ctx;
    const unitIds = state.selectedUnitIds;

    if (unitIds.length === 1) {
      const unit = state.units.get(unitIds[0]);
      if (!unit) return;

      ctx.fillStyle = FACTION_COLORS[unit.faction];
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(UNIT_NAMES[unit.faction][unit.type], x, y + 16);

      ctx.fillStyle = '#ccc';
      ctx.font = '12px monospace';
      ctx.fillText(`HP: ${unit.hp}/${unit.maxHp}`, x, y + 36);
      ctx.fillText(`ATK: ${unit.attackDamage}  ARM: ${unit.armor}  RNG: ${unit.attackRange}`, x, y + 52);

      const stateText = unit.state === UnitState.Idle ? 'Idle' :
        unit.state === UnitState.Moving ? 'Moving' :
          unit.state === UnitState.Attacking ? 'Attacking' :
            unit.state === UnitState.Harvesting ? 'Harvesting' :
              unit.state === UnitState.Returning ? 'Returning' :
                unit.state === UnitState.Building ? 'Building' :
                  unit.state === UnitState.Repairing ? 'Repairing' : String(unit.state);
      ctx.fillText(`State: ${stateText}`, x, y + 68);

      if (unit.carryingAmount > 0) {
        ctx.fillText(`Carrying: ${Math.floor(unit.carryingAmount)} ${unit.carryingType}`, x, y + 84);
      }

      // Build buttons for workers
      if (unit.type === UnitType.Worker) {
        this.renderBuildButtons(state, x, y + 100);
      }
    } else {
      ctx.fillStyle = '#ccc';
      ctx.font = '14px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${unitIds.length} units selected`, x, y + 16);
    }
  }

  private renderBuildButtons(state: GameState, x: number, y: number): void {
    const ctx = this.ctx;
    const buildOptions: [BuildingType, string, number, number][] = [
      [BuildingType.Farm, 'Farm (F)', 100, 50],
      [BuildingType.Barracks, 'Barracks (B)', 200, 100],
      [BuildingType.LumberMill, 'Lumber Mill (L)', 150, 0],
      [BuildingType.GuardTower, 'Tower (G)', 120, 60],
    ];

    for (let i = 0; i < buildOptions.length; i++) {
      const [, label, goldCost, woodCost] = buildOptions[i];
      const res = state.resources[state.playerFaction];
      const canAfford = res.gold >= goldCost && res.wood >= woodCost;
      const bx = x + i * 105;
      const by = y;

      ctx.fillStyle = canAfford ? '#2a4a2a' : '#3a2a2a';
      ctx.fillRect(bx, by, 100, 30);
      ctx.strokeStyle = canAfford ? '#4a4' : '#644';
      ctx.strokeRect(bx, by, 100, 30);

      ctx.fillStyle = canAfford ? '#e0e0e0' : '#888';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 4, by + 12);
      ctx.fillText(`G:${goldCost} W:${woodCost}`, bx + 4, by + 24);
    }
  }

  private renderBuildingInfo(state: GameState, x: number, y: number): void {
    const ctx = this.ctx;
    const building = state.buildings.get(state.selectedBuildingId!);
    if (!building) return;

    ctx.fillStyle = FACTION_COLORS[building.faction];
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(BUILDING_NAMES[building.type], x, y + 16);

    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.fillText(`HP: ${building.hp}/${building.maxHp}`, x, y + 36);

    if (building.state === BuildingState.Constructing) {
      ctx.fillText(`Building: ${Math.floor(building.buildProgress * 100)}%`, x, y + 52);
    }

    if (building.trainingQueue.length > 0) {
      const item = building.trainingQueue[0];
      ctx.fillText(`Training: ${UNIT_NAMES[building.faction][item.unitType]} (${Math.floor(item.progress * 100)}%)`, x, y + 68);
    }

    if (building.state === BuildingState.Complete) {
      this.renderTrainButtons(state, building, x, y + 90);
    }
  }

  private renderTrainButtons(state: GameState, building: BuildingType_entity, x: number, y: number): void {
    if (building.type === BuildingType.TownHall) {
      this.drawTrainButton(state, UnitType.Worker, building, x, y);
    } else if (building.type === BuildingType.Barracks) {
      this.drawTrainButton(state, UnitType.Infantry, building, x, y);
      const hasLumberMill = [...state.buildings.values()].some(
        b => b.faction === building.faction && b.type === BuildingType.LumberMill && b.state === BuildingState.Complete
      );
      if (hasLumberMill) {
        this.drawTrainButton(state, UnitType.Ranged, building, x + 120, y);
        this.drawTrainButton(state, UnitType.Heavy, building, x + 240, y);
      }
    }
  }

  private drawTrainButton(state: GameState, unitType: UnitType, building: BuildingType_entity, x: number, y: number): void {
    const ctx = this.ctx;
    const stats = UNIT_STATS[unitType];
    const supply = getSupplyForUI(state);
    const canAfford = state.resources[state.playerFaction].gold >= stats.goldCost &&
      state.resources[state.playerFaction].wood >= stats.woodCost &&
      supply.used + stats.supplyCost <= supply.cap;
    const queueFull = building.trainingQueue.length >= 5;

    ctx.fillStyle = canAfford && !queueFull ? '#2a4a2a' : '#3a2a2a';
    ctx.fillRect(x, y, 110, 40);
    ctx.strokeStyle = canAfford ? '#4a4' : '#644';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, 110, 40);

    ctx.fillStyle = canAfford ? '#e0e0e0' : '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(UNIT_NAMES[state.playerFaction][unitType], x + 4, y + 14);
    ctx.fillText(`G:${stats.goldCost} W:${stats.woodCost}`, x + 4, y + 28);
  }

  private renderMinimap(state: GameState): void {
    const ctx = this.ctx;
    const panelY = this.height - BOTTOM_PANEL_H;
    const mmX = MINIMAP_PAD;
    const mmY = panelY + MINIMAP_PAD;

    ctx.fillStyle = '#111';
    ctx.fillRect(mmX, mmY, MINIMAP_SIZE, MINIMAP_SIZE);

    const scaleX = MINIMAP_SIZE / state.map.width;
    const scaleY = MINIMAP_SIZE / state.map.height;

    for (let ty = 0; ty < state.map.height; ty++) {
      for (let tx = 0; tx < state.map.width; tx++) {
        const fog = state.fog[ty]?.[tx];
        if (fog === FogState.Unexplored) continue;

        const tile = state.map.tiles[ty][tx];
        const color = fog === FogState.Explored
          ? (TILE_COLORS_DIM[tile.type] || '#333')
          : (TILE_COLORS[tile.type] || '#888');

        ctx.fillStyle = color;
        ctx.fillRect(mmX + tx * scaleX, mmY + ty * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
      }
    }

    for (const building of state.buildings.values()) {
      if (building.state === BuildingState.Destroyed) continue;
      const stats = BUILDING_STATS[building.type];
      const bx = building.tileX + stats.footprintW / 2;
      const by = building.tileY + stats.footprintH / 2;
      const fog = state.fog[building.tileY]?.[building.tileX];

      if (building.faction === state.playerFaction || fog === FogState.Visible) {
        ctx.fillStyle = FACTION_COLORS[building.faction];
        ctx.fillRect(mmX + bx * scaleX - 1, mmY + by * scaleY - 1, 3, 3);
      }
    }

    for (const unit of state.units.values()) {
      if (unit.state === UnitState.Dead) continue;
      const tx = Math.round(unit.x);
      const ty = Math.round(unit.y);
      if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) continue;

      if (unit.faction === state.playerFaction) {
        ctx.fillStyle = FACTION_COLORS[unit.faction];
        ctx.fillRect(mmX + tx * scaleX, mmY + ty * scaleY, 2, 2);
      } else if (state.fog[ty][tx] === FogState.Visible) {
        ctx.fillStyle = FACTION_COLORS[unit.faction];
        ctx.fillRect(mmX + tx * scaleX, mmY + ty * scaleY, 2, 2);
      }
    }

    const vpW = Math.floor(this.width / TILE_SIZE);
    const vpH = Math.floor((this.height - TOP_BAR_H - BOTTOM_PANEL_H) / TILE_SIZE);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX + state.camera.x * scaleX, mmY + state.camera.y * scaleY, vpW * scaleX, vpH * scaleY);

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(mmX, mmY, MINIMAP_SIZE, MINIMAP_SIZE);
  }

  private renderOverlay(_state: GameState, text: string, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = color;
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, this.width / 2, this.height / 2 - 30);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = '24px monospace';
    ctx.fillText('Press ENTER to continue', this.width / 2, this.height / 2 + 40);
  }
}

// ─── Helpers ───

function getBuildingLabel(type: BuildingType): string {
  switch (type) {
    case BuildingType.TownHall: return 'TH';
    case BuildingType.Farm: return 'FM';
    case BuildingType.Barracks: return 'BK';
    case BuildingType.LumberMill: return 'LM';
    case BuildingType.GuardTower: return 'GT';
    default: return '??';
  }
}

function getUnitSymbol(type: UnitType): string {
  switch (type) {
    case UnitType.Worker: return 'W';
    case UnitType.Infantry: return 'I';
    case UnitType.Ranged: return 'R';
    case UnitType.Heavy: return 'H';
    default: return '?';
  }
}

function getSupplyForUI(state: GameState): { used: number; cap: number } {
  let cap = 0;
  let used = 0;

  for (const building of state.buildings.values()) {
    if (building.faction === state.playerFaction && building.state === BuildingState.Complete) {
      cap += BUILDING_STATS[building.type].supplyProvided;
    }
  }

  for (const unit of state.units.values()) {
    if (unit.faction === state.playerFaction && unit.state !== UnitState.Dead) {
      used += unit.supplyCost;
    }
  }

  return { used, cap };
}