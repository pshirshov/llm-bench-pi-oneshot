import type { GameSpeed } from "../game/types.js";
import { canBuildBuilding, requirementsMet } from "../sim/behaviors.js";
import type { Building, Entity, Unit } from "../sim/entity.js";
import {
  BUILDING_REQUIREMENTS,
  BUILDING_STATS,
  BuildingRole,
  buildingName,
  type Faction,
  UNIT_REQUIREMENTS,
  UNIT_STATS,
  unitName,
  UnitRole,
} from "../sim/stats.js";
import type { World } from "../sim/world.js";
import type { Layout, Rect } from "../render/layout.js";
import { pointInRect } from "../render/layout.js";
import { THEMES } from "../sim/stats.js";

export type HudAction =
  | { kind: "train"; role: UnitRole }
  | { kind: "build"; role: BuildingRole }
  | { kind: "cancelTrain" }
  | { kind: "togglePause" }
  | { kind: "toggleSpeed" }
  | { kind: "menu" };

export interface HudButton {
  rect: Rect;
  action: HudAction;
  enabled: boolean;
  label: string;
  sub?: string;
  hotkey?: string;
}

export interface HudView {
  paused: boolean;
  speed: GameSpeed;
  seed: number;
  levelLabel: string;
}

const BUILDABLE_ROLES: readonly BuildingRole[] = [
  BuildingRole.Farm,
  BuildingRole.Barracks,
  BuildingRole.LumberMill,
  BuildingRole.GuardTower,
  BuildingRole.TownHall,
];

export class Hud {
  /** Compute clickable buttons for the current frame (used for drawing and hit-testing). */
  computeButtons(world: World, layout: Layout, selection: Set<number>, view: HudView): HudButton[] {
    const buttons: HudButton[] = [];
    const faction = world.playerFaction;

    // Top-bar controls (right-aligned).
    const tb = layout.topBar;
    const bw = 78;
    const bh = 22;
    const by = tb.y + 4;
    let bx = tb.w - bw - 6;
    buttons.push({ rect: { x: bx, y: by, w: bw, h: bh }, action: { kind: "menu" }, enabled: true, label: "Menu" });
    bx -= bw + 6;
    buttons.push({
      rect: { x: bx, y: by, w: bw, h: bh },
      action: { kind: "toggleSpeed" },
      enabled: true,
      label: `Speed ${view.speed}x`,
    });
    bx -= bw + 6;
    buttons.push({
      rect: { x: bx, y: by, w: bw, h: bh },
      action: { kind: "togglePause" },
      enabled: true,
      label: view.paused ? "Resume" : "Pause",
    });

    // Command panel depends on selection.
    const selected = [...selection].map((id) => world.getEntity(id)).filter(Boolean) as Entity[];
    const mine = selected.filter((e) => e.faction === faction);
    const producer = mine.find(
      (e): e is Building => e.kind === "building" && e.constructed && BUILDING_STATS[e.role].trains.length > 0,
    );
    const hasWorker = mine.some((e) => e.kind === "unit" && (e as Unit).role === UnitRole.Worker);

    const cp = layout.commandPanel;
    const cols = 3;
    const gap = 6;
    const cellW = (cp.w - gap * (cols - 1)) / cols;
    const cellH = 46;
    const cellAt = (i: number): Rect => ({
      x: cp.x + (i % cols) * (cellW + gap),
      y: cp.y + Math.floor(i / cols) * (cellH + gap),
      w: cellW,
      h: cellH,
    });

    if (producer) {
      let i = 0;
      for (const role of BUILDING_STATS[producer.role].trains) {
        const reqOk = requirementsMet(world, faction, UNIT_REQUIREMENTS[role]);
        const can = world.canTrain(faction, role);
        const stats = UNIT_STATS[role];
        buttons.push({
          rect: cellAt(i++),
          action: { kind: "train", role },
          enabled: reqOk && can.ok,
          label: unitName(faction, role),
          sub: `${stats.goldCost}g ${stats.woodCost ? stats.woodCost + "w" : ""}`,
        });
      }
      if (producer.trainingQueue.length > 0) {
        buttons.push({
          rect: cellAt(i++),
          action: { kind: "cancelTrain" },
          enabled: true,
          label: "Cancel",
        });
      }
    } else if (hasWorker) {
      let i = 0;
      for (const role of BUILDABLE_ROLES) {
        const reqOk = requirementsMet(world, faction, BUILDING_REQUIREMENTS[role]);
        const can = canBuildBuilding(world, faction, role);
        const stats = BUILDING_STATS[role];
        buttons.push({
          rect: cellAt(i++),
          action: { kind: "build", role },
          enabled: reqOk && can.ok,
          label: buildingName(faction, role),
          sub: `${stats.goldCost}g ${stats.woodCost}w`,
        });
      }
    }

    return buttons;
  }

  hitTest(buttons: HudButton[], x: number, y: number): HudButton | null {
    for (const b of buttons) {
      if (pointInRect(x, y, b.rect)) return b;
    }
    return null;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: World,
    layout: Layout,
    selection: Set<number>,
    view: HudView,
    buttons: HudButton[],
    hovered: HudButton | null,
  ): void {
    this.drawTopBar(ctx, world, layout, view);
    this.drawPanelBackground(ctx, layout.bottomPanel);
    this.drawSelectionPanel(ctx, world, layout, selection);
    this.drawButtons(ctx, buttons, hovered);
    if (view.paused) this.drawPausedBanner(ctx, layout);
  }

  private drawTopBar(ctx: CanvasRenderingContext2D, world: World, layout: Layout, view: HudView): void {
    const tb = layout.topBar;
    ctx.fillStyle = "#161616";
    ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(tb.x, tb.y + tb.h - 1, tb.w, 1);

    const fs = world.factions[world.playerFaction];
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "bold 14px 'Trebuchet MS', sans-serif";
    const y = tb.y + tb.h / 2;
    let x = 12;
    const item = (color: string, label: string): void => {
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
      x += ctx.measureText(label).width + 22;
    };
    item("#ffd84a", `⛁ ${Math.floor(fs.gold)}`);
    item("#b07a3c", `🪵 ${Math.floor(fs.wood)}`);
    const supplyColor = fs.supplyUsed >= fs.supplyCap ? "#ff6a6a" : "#d0d0d0";
    item(supplyColor, `▢ ${fs.supplyUsed}/${fs.supplyCap}`);
    item("#9fd0ff", `${THEMES[world.playerFaction].displayName}`);
    item("#bbbbbb", `${view.levelLabel}`);
    item("#888888", `Seed ${view.seed}`);
    item("#888888", `⏱ ${formatTime(world.time)}`);
  }

  private drawPanelBackground(ctx: CanvasRenderingContext2D, panel: Rect): void {
    ctx.fillStyle = "#161616";
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(panel.x, panel.y, panel.w, 1);
  }

  private drawSelectionPanel(
    ctx: CanvasRenderingContext2D,
    world: World,
    layout: Layout,
    selection: Set<number>,
  ): void {
    const sp = layout.selectionPanel;
    ctx.fillStyle = "#0e0e0e";
    ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
    ctx.strokeStyle = "#2a2a2a";
    ctx.strokeRect(sp.x + 0.5, sp.y + 0.5, sp.w - 1, sp.h - 1);

    const entities = [...selection].map((id) => world.getEntity(id)).filter(Boolean) as Entity[];
    if (entities.length === 0) {
      ctx.fillStyle = "#666";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No selection", sp.x + sp.w / 2, sp.y + sp.h / 2);
      return;
    }

    if (entities.length === 1) {
      this.drawSingleInfo(ctx, world.playerFaction, entities[0]!, sp);
    } else {
      this.drawGroupInfo(ctx, entities, sp);
    }
  }

  private drawSingleInfo(ctx: CanvasRenderingContext2D, faction: Faction, e: Entity, sp: Rect): void {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const name = e.kind === "unit" ? unitName(e.faction, e.role) : buildingName(e.faction, e.role);
    ctx.fillStyle = "#eaeaea";
    ctx.font = "bold 15px 'Trebuchet MS', sans-serif";
    ctx.fillText(name, sp.x + 10, sp.y + 8);

    // Portrait swatch.
    ctx.fillStyle = THEMES[e.faction].primary;
    ctx.fillRect(sp.x + 10, sp.y + 30, 46, 46);
    ctx.strokeStyle = THEMES[e.faction].dark;
    ctx.strokeRect(sp.x + 10, sp.y + 30, 46, 46);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#cfcfcf";
    const tx = sp.x + 66;
    let ty = sp.y + 30;
    const line = (s: string): void => {
      ctx.fillText(s, tx, ty);
      ty += 16;
    };
    line(`HP ${Math.ceil(e.hp)}/${e.maxHp}`);
    if (e.kind === "unit") {
      const st = UNIT_STATS[e.role];
      line(`Damage ${st.damage}  Armor ${st.armor}`);
      line(`Range ${st.range.toFixed(1)}  Sight ${st.sight}`);
      if (e.command.type !== "idle") line(`Order: ${e.command.type}`);
    } else {
      const st = BUILDING_STATS[e.role];
      if (!e.constructed) line(`Building… ${Math.floor(e.buildProgress * 100)}%`);
      if (st.supplyProvided > 0) line(`Supply +${st.supplyProvided}`);
      if (e.trainingQueue.length > 0) {
        line(`Training: ${unitName(faction, e.trainingQueue[0]!)}`);
        const total = UNIT_STATS[e.trainingQueue[0]!].trainTime;
        const frac = 1 - e.trainTimer / total;
        this.bar(ctx, tx, ty, 120, 8, frac, "#6cf");
        ty += 14;
        line(`Queue: ${e.trainingQueue.length}`);
      }
    }
  }

  private drawGroupInfo(ctx: CanvasRenderingContext2D, entities: Entity[], sp: Rect): void {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#eaeaea";
    ctx.font = "bold 14px 'Trebuchet MS', sans-serif";
    ctx.fillText(`${entities.length} selected`, sp.x + 10, sp.y + 6);
    const cell = 30;
    const perRow = Math.max(1, Math.floor((sp.w - 16) / (cell + 4)));
    let i = 0;
    for (const e of entities.slice(0, perRow * 3)) {
      const cx = sp.x + 10 + (i % perRow) * (cell + 4);
      const cy = sp.y + 28 + Math.floor(i / perRow) * (cell + 8);
      ctx.fillStyle = THEMES[e.faction].primary;
      ctx.fillRect(cx, cy, cell, cell);
      this.bar(ctx, cx, cy + cell + 1, cell, 3, e.hp / e.maxHp, this.hpColor(e.hp / e.maxHp));
      i++;
    }
  }

  private drawButtons(ctx: CanvasRenderingContext2D, buttons: HudButton[], hovered: HudButton | null): void {
    for (const b of buttons) {
      const isHover = b === hovered;
      ctx.fillStyle = !b.enabled ? "#2a2a2a" : isHover ? "#3a4a66" : "#27313f";
      ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      ctx.strokeStyle = b.enabled ? "#56657c" : "#333";
      ctx.strokeRect(b.rect.x + 0.5, b.rect.y + 0.5, b.rect.w - 1, b.rect.h - 1);

      ctx.fillStyle = b.enabled ? "#eaeaea" : "#666";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "12px 'Trebuchet MS', sans-serif";
      const cy = b.sub ? b.rect.y + b.rect.h / 2 - 7 : b.rect.y + b.rect.h / 2;
      ctx.fillText(fit(ctx, b.label, b.rect.w - 6), b.rect.x + b.rect.w / 2, cy);
      if (b.sub) {
        ctx.font = "10px sans-serif";
        ctx.fillStyle = b.enabled ? "#c9b56a" : "#5a5440";
        ctx.fillText(b.sub.trim(), b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2 + 9);
      }
    }
  }

  private drawPausedBanner(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const vp = layout.viewport;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PAUSED", vp.x + vp.w / 2, vp.y + vp.h / 2);
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string): void {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private hpColor(frac: number): string {
    if (frac > 0.6) return "#3fbf4f";
    if (frac > 0.3) return "#d9b53a";
    return "#d9453a";
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
