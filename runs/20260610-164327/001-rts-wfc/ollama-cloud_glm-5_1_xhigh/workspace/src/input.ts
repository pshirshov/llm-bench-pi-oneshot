// ─── Input handling ───

import {
  UnitType, BuildingType, GameScreen, UnitState, BuildingState, Vec2, FogState, Unit, Building,
} from './types';
import { GameState } from './game';
import {
  issueMoveCommand, issueAttackCommand, issueAttackMoveCommand,
  issueHarvestCommand, issueBuildCommand, issueTrainCommand, issueRepairCommand,
  canPlaceBuilding, createGameState,
} from './game';
import {
  TILE_SIZE, MINIMAP_SIZE, TOP_BAR_H, BOTTOM_PANEL_H, BUILDING_STATS,
} from './constants';
import { Renderer } from './renderer';

export class InputHandler {
  private canvas: HTMLCanvasElement;
  private keys: Set<string> = new Set();
  private mouseDown: boolean = false;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private selectStart: Vec2 | null = null;
  private selectEnd: Vec2 | null = null;
  private isDragging: boolean = false;
  private isMinimapDrag: boolean = false;
  private scrollSpeed: number = 15;
  public needsRestart: boolean = false;
  public restartLevel: number = 0;
  public restartSeed: number = 0;

  constructor(canvas: HTMLCanvasElement, _renderer: Renderer) {
    this.canvas = canvas;
  }

  init(state: GameState): void {
    window.addEventListener('keydown', (e) => this.onKeyDown(e, state));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e, state));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e, state));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e, state));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(state: GameState, dt: number): void {
    if (state.screen !== GameScreen.Playing) return;

    // Keyboard scrolling
    const scrollX = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    const scrollY = (this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('ArrowUp') ? 1 : 0);
    if (scrollX !== 0 || scrollY !== 0) {
      state.camera.x += scrollX * this.scrollSpeed * dt;
      state.camera.y += scrollY * this.scrollSpeed * dt;
    }

    // Edge scrolling
    const edgeMargin = 20;
    if (this.mouseX < edgeMargin && this.mouseX >= 0) state.camera.x -= this.scrollSpeed * dt;
    if (this.mouseX > this.canvas.width - edgeMargin) state.camera.x += this.scrollSpeed * dt;
    if (this.mouseY < TOP_BAR_H + edgeMargin && this.mouseY >= TOP_BAR_H) state.camera.y -= this.scrollSpeed * dt;
    if (this.mouseY > this.canvas.height - BOTTOM_PANEL_H - edgeMargin) state.camera.y += this.scrollSpeed * dt;

    // Clamp camera
    const maxCamX = state.map.width - this.canvas.width / TILE_SIZE;
    const maxCamY = state.map.height - (this.canvas.height - TOP_BAR_H - BOTTOM_PANEL_H) / TILE_SIZE;
    state.camera.x = Math.max(0, Math.min(maxCamX, state.camera.x));
    state.camera.y = Math.max(0, Math.min(maxCamY, state.camera.y));

    // Update build placement validity
    if (state.buildMode !== null) {
      const pos = this.screenToTile(state, this.mouseX, this.mouseY);
      if (pos) {
        state.buildValid = canPlaceBuilding(state, state.buildMode, pos.x, pos.y, state.playerFaction);
      }
    }
  }

  private onKeyDown(e: KeyboardEvent, state: GameState): void {
    this.keys.add(e.key);

    if (e.key === ' ') {
      state.paused = !state.paused;
      e.preventDefault();
      return;
    }

    if (e.key === '+' || e.key === '=') {
      state.speed = state.speed === 1 ? 2 : 1;
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      if (state.buildMode !== null) {
        state.buildMode = null;
        state.buildValid = false;
      } else if (state.screen === GameScreen.LevelSelect) {
        state.screen = GameScreen.Menu;
      } else {
        state.selectedUnitIds = [];
        state.selectedBuildingId = null;
      }
      return;
    }

    if (e.key === 'Enter') {
      if (state.screen === GameScreen.Victory || state.screen === GameScreen.Defeat) {
        state.screen = GameScreen.LevelSelect;
      }
      return;
    }

    // Control groups
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
      const group = parseInt(e.key);
      state.controlGroups.set(group, {
        unitIds: [...state.selectedUnitIds],
        buildingId: state.selectedBuildingId,
      });
      e.preventDefault();
      return;
    }

    if (!e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
      const group = parseInt(e.key);
      const cg = state.controlGroups.get(group);
      if (cg) {
        state.selectedUnitIds = [...cg.unitIds];
        state.selectedBuildingId = cg.buildingId;
      }
      return;
    }

    // Training hotkeys
    if (state.selectedBuildingId !== null) {
      const building = state.buildings.get(state.selectedBuildingId);
      if (building && building.state === BuildingState.Complete) {
        if (e.key === 'w' || e.key === 'W') {
          if (building.type === BuildingType.TownHall) {
            issueTrainCommand(state, building.id, UnitType.Worker);
          }
        }
        if (e.key === 'i' || e.key === 'I') {
          if (building.type === BuildingType.Barracks) {
            issueTrainCommand(state, building.id, UnitType.Infantry);
          }
        }
        if (e.key === 'r' || e.key === 'R') {
          if (building.type === BuildingType.Barracks) {
            issueTrainCommand(state, building.id, UnitType.Ranged);
          }
        }
        if (e.key === 'h' || e.key === 'H') {
          if (building.type === BuildingType.Barracks) {
            issueTrainCommand(state, building.id, UnitType.Heavy);
          }
        }
      }
    }

    // Build hotkeys
    if (state.selectedUnitIds.length === 1) {
      const unit = state.units.get(state.selectedUnitIds[0]);
      if (unit && unit.type === UnitType.Worker) {
        const buildKeys: Record<string, BuildingType> = {
          'b': BuildingType.Barracks,
          'f': BuildingType.Farm,
          'l': BuildingType.LumberMill,
          'g': BuildingType.GuardTower,
          't': BuildingType.TownHall,
        };
        const bt = buildKeys[e.key.toLowerCase()];
        if (bt) {
          state.buildMode = bt;
          e.preventDefault();
        }
      }
    }

    // S = stop
    if (e.key === 's' || e.key === 'S') {
      for (const id of state.selectedUnitIds) {
        const unit = state.units.get(id);
        if (unit) {
          unit.state = UnitState.Idle;
          unit.targetId = null;
          unit.targetPos = null;
          unit.path = [];
        }
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key);
  }

  private onMouseDown(e: MouseEvent, state: GameState): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;

    // Menu
    if (state.screen === GameScreen.Menu) {
      state.screen = GameScreen.LevelSelect;
      return;
    }

    // Level select
    if (state.screen === GameScreen.LevelSelect) {
      this.handleLevelSelectClick(e, state);
      return;
    }

    if (state.screen !== GameScreen.Playing) return;

    // Minimap click
    const mmX = 4;
    const mmY = this.canvas.height - BOTTOM_PANEL_H + 4;
    if (e.clientX >= mmX && e.clientX <= mmX + MINIMAP_SIZE &&
      e.clientY >= mmY && e.clientY <= mmY + MINIMAP_SIZE) {
      this.isMinimapDrag = true;
      this.jumpToMinimapPos(e, state);
      return;
    }

    // Bottom panel
    if (e.clientY >= this.canvas.height - BOTTOM_PANEL_H) {
      this.handlePanelClick(e, state);
      return;
    }

    // Top bar
    if (e.clientY < TOP_BAR_H) return;

    if (e.button === 0) {
      // Left click
      if (state.buildMode !== null) {
        const tile = this.screenToTile(state, e.clientX, e.clientY);
        if (tile && state.buildValid) {
          const workerId = state.selectedUnitIds[0];
          if (workerId) {
            issueBuildCommand(state, workerId, state.buildMode, tile.x, tile.y);
          }
          state.buildMode = null;
          state.buildValid = false;
        }
        return;
      }

      this.selectStart = { x: e.clientX, y: e.clientY };
      this.selectEnd = { x: e.clientX, y: e.clientY };
      this.isDragging = false;
      this.mouseDown = true;
    } else if (e.button === 2) {
      this.handleRightClick(e, state);
    }
  }

  private onMouseMove(e: MouseEvent, state: GameState): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;

    if (this.isMinimapDrag && this.mouseDown) {
      this.jumpToMinimapPos(e, state);
      return;
    }

    if (this.mouseDown && this.selectStart) {
      this.selectEnd = { x: e.clientX, y: e.clientY };
      const dx = this.selectEnd.x - this.selectStart.x;
      const dy = this.selectEnd.y - this.selectStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this.isDragging = true;
      }
    }
  }

  private onMouseUp(e: MouseEvent, state: GameState): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;

    if (this.isMinimapDrag) {
      this.isMinimapDrag = false;
      this.mouseDown = false;
      return;
    }

    if (e.button === 0 && this.mouseDown) {
      if (this.isDragging && this.selectStart && this.selectEnd) {
        this.handleBoxSelect(state, e.shiftKey);
      } else {
        this.handleSingleSelect(e, state, e.shiftKey);
      }
    }

    this.mouseDown = false;
    this.isDragging = false;
    this.selectStart = null;
    this.selectEnd = null;
  }

  private handleSingleSelect(e: MouseEvent, state: GameState, additive: boolean): void {
    const tile = this.screenToTile(state, e.clientX, e.clientY);
    if (!tile) return;

    const clickedUnit = this.findUnitAtScreenPos(state, e.clientX, e.clientY);
    if (clickedUnit && clickedUnit.faction === state.playerFaction) {
      if (!additive) {
        state.selectedUnitIds = [clickedUnit.id];
        state.selectedBuildingId = null;
      } else {
        const idx = state.selectedUnitIds.indexOf(clickedUnit.id);
        if (idx >= 0) state.selectedUnitIds.splice(idx, 1);
        else state.selectedUnitIds.push(clickedUnit.id);
      }
      return;
    }

    const clickedBuilding = this.findBuildingAtTile(state, tile.x, tile.y);
    if (clickedBuilding && clickedBuilding.faction === state.playerFaction) {
      state.selectedBuildingId = clickedBuilding.id;
      state.selectedUnitIds = [];
      return;
    }

    if (!additive) {
      state.selectedUnitIds = [];
      state.selectedBuildingId = null;
    }
  }

  private handleBoxSelect(state: GameState, additive: boolean): void {
    if (!this.selectStart || !this.selectEnd) return;
    const x1 = Math.min(this.selectStart.x, this.selectEnd.x);
    const y1 = Math.min(this.selectStart.y, this.selectEnd.y);
    const x2 = Math.max(this.selectStart.x, this.selectEnd.x);
    const y2 = Math.max(this.selectStart.y, this.selectEnd.y);

    const selected: number[] = [];
    for (const unit of state.units.values()) {
      if (unit.faction !== state.playerFaction || unit.state === UnitState.Dead) continue;
      const sx = (unit.x - state.camera.x) * TILE_SIZE + TILE_SIZE / 2;
      const sy = (unit.y - state.camera.y) * TILE_SIZE + TOP_BAR_H + TILE_SIZE / 2;
      if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
        selected.push(unit.id);
      }
    }

    if (!additive) {
      state.selectedUnitIds = selected;
      state.selectedBuildingId = null;
    } else {
      state.selectedUnitIds = [...new Set([...state.selectedUnitIds, ...selected])];
    }
  }

  private handleRightClick(e: MouseEvent, state: GameState): void {
    if (state.selectedUnitIds.length === 0 && state.selectedBuildingId === null) return;

    const tile = this.screenToTile(state, e.clientX, e.clientY);
    if (!tile) return;
    if (tile.x < 0 || tile.x >= state.map.width || tile.y < 0 || tile.y >= state.map.height) return;

    // Enemy unit
    const enemyUnit = this.findUnitAtScreenPos(state, e.clientX, e.clientY);
    if (enemyUnit && enemyUnit.faction !== state.playerFaction) {
      issueAttackCommand(state, state.selectedUnitIds, enemyUnit.id);
      return;
    }

    // Enemy building
    const building = this.findBuildingAtTile(state, tile.x, tile.y);
    if (building && building.faction !== state.playerFaction) {
      issueAttackCommand(state, state.selectedUnitIds, building.id);
      return;
    }

    // Resource tile
    const mapTile = state.map.tiles[tile.y][tile.x];
    if (mapTile.type === 'gold_mine' || mapTile.type === 'forest') {
      const workers = state.selectedUnitIds.filter(id => {
        const u = state.units.get(id);
        return u && u.type === UnitType.Worker;
      });
      if (workers.length > 0) {
        issueHarvestCommand(state, workers, tile.x, tile.y);
        return;
      }
    }

    // Own damaged building → repair
    if (building && building.faction === state.playerFaction && building.hp < building.maxHp) {
      issueRepairCommand(state, state.selectedUnitIds, building.id);
      return;
    }

    // Move or attack-move
    const isAttackMove = this.keys.has('a') || this.keys.has('A');
    if (isAttackMove) {
      issueAttackMoveCommand(state, state.selectedUnitIds, tile.x, tile.y);
    } else {
      issueMoveCommand(state, state.selectedUnitIds, tile.x, tile.y);
    }
  }

  private handlePanelClick(e: MouseEvent, state: GameState): void {
    const panelY = this.canvas.height - BOTTOM_PANEL_H;
    const infoX = MINIMAP_SIZE + 20;
    const infoY = panelY + 10;

    // Train buttons
    if (state.selectedBuildingId !== null) {
      const building = state.buildings.get(state.selectedBuildingId);
      if (building && building.state === BuildingState.Complete) {
        const btnY = infoY + 90;
        const btnW = 110;
        const btnH = 40;

        if (building.type === BuildingType.TownHall) {
          if (e.clientX >= infoX && e.clientX <= infoX + btnW &&
            e.clientY >= btnY && e.clientY <= btnY + btnH) {
            issueTrainCommand(state, building.id, UnitType.Worker);
          }
        } else if (building.type === BuildingType.Barracks) {
          if (e.clientX >= infoX && e.clientX <= infoX + btnW &&
            e.clientY >= btnY && e.clientY <= btnY + btnH) {
            issueTrainCommand(state, building.id, UnitType.Infantry);
          }
          const hasLumberMill = [...state.buildings.values()].some(
            b => b.faction === building.faction && b.type === BuildingType.LumberMill && b.state === BuildingState.Complete
          );
          if (hasLumberMill) {
            if (e.clientX >= infoX + 120 && e.clientX <= infoX + 120 + btnW &&
              e.clientY >= btnY && e.clientY <= btnY + btnH) {
              issueTrainCommand(state, building.id, UnitType.Ranged);
            }
            if (e.clientX >= infoX + 240 && e.clientX <= infoX + 240 + btnW &&
              e.clientY >= btnY && e.clientY <= btnY + btnH) {
              issueTrainCommand(state, building.id, UnitType.Heavy);
            }
          }
        }
      }
    }
  }

  private handleLevelSelectClick(e: MouseEvent, state: GameState): void {
    const levels = 5;
    const startY = 120;
    for (let i = 0; i < levels; i++) {
      const y = startY + i * 70;
      const x = this.canvas.width / 2;
      if (e.clientX >= x - 200 && e.clientX <= x + 200 &&
        e.clientY >= y && e.clientY <= y + 55) {
        const unlocked = i === 0 || state.levelResults.get(i);
        if (unlocked) {
          const newSeed = state.campaignSeed + i * 1000;
          this.needsRestart = true;
          this.restartLevel = i + 1;
          this.restartSeed = newSeed;
          const newState = createGameState(newSeed, state.playerFaction, i + 1);
          Object.assign(state, newState);
          state.screen = GameScreen.Playing;
        }
      }
    }
  }

  private jumpToMinimapPos(e: MouseEvent, state: GameState): void {
    const mmX = 4;
    const mmY = this.canvas.height - BOTTOM_PANEL_H + 4;
    const relX = (e.clientX - mmX) / MINIMAP_SIZE;
    const relY = (e.clientY - mmY) / MINIMAP_SIZE;
    const vpW = this.canvas.width / TILE_SIZE;
    const vpH = (this.canvas.height - TOP_BAR_H - BOTTOM_PANEL_H) / TILE_SIZE;
    state.camera.x = Math.max(0, Math.min(state.map.width - vpW, relX * state.map.width - vpW / 2));
    state.camera.y = Math.max(0, Math.min(state.map.height - vpH, relY * state.map.height - vpH / 2));
  }

  private screenToTile(state: GameState, sx: number, sy: number): Vec2 | null {
    const x = Math.floor((sx / TILE_SIZE) + state.camera.x);
    const y = Math.floor(((sy - TOP_BAR_H) / TILE_SIZE) + state.camera.y);
    return { x, y };
  }

  private findUnitAtScreenPos(state: GameState, sx: number, sy: number): Unit | null {
    const tileX = (sx / TILE_SIZE) + state.camera.x;
    const tileY = ((sy - TOP_BAR_H) / TILE_SIZE) + state.camera.y;

    let closest: Unit | null = null;
    let closestDist = 0.5;

    for (const unit of state.units.values()) {
      if (unit.state === UnitState.Dead) continue;
      if (unit.faction !== state.playerFaction) {
        const tx = Math.round(unit.x);
        const ty = Math.round(unit.y);
        if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) continue;
        if (state.fog[ty][tx] !== FogState.Visible) continue;
      }
      const dist = Math.sqrt((unit.x - tileX) ** 2 + (unit.y - tileY) ** 2);
      if (dist < closestDist) {
        closestDist = dist;
        closest = unit;
      }
    }

    return closest;
  }

  private findBuildingAtTile(state: GameState, tx: number, ty: number): Building | null {
    for (const building of state.buildings.values()) {
      if (building.state === BuildingState.Destroyed) continue;
      const stats = BUILDING_STATS[building.type];
      if (tx >= building.tileX && tx < building.tileX + stats.footprintW &&
        ty >= building.tileY && ty < building.tileY + stats.footprintH) {
        return building;
      }
    }
    return null;
  }

  getSelectionRect(): { x1: number; y1: number; x2: number; y2: number } | null {
    if (this.isDragging && this.selectStart && this.selectEnd) {
      return {
        x1: this.selectStart.x,
        y1: this.selectStart.y,
        x2: this.selectEnd.x,
        y2: this.selectEnd.y,
      };
    }
    return null;
  }
}