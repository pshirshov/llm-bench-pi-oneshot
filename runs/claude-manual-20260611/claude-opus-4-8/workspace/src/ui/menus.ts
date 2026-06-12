/**
 * Lightweight DOM overlay menus.
 *
 * Each menu is created lazily on first `show*` call and kept in the DOM,
 * toggled visible/hidden via CSS display.
 *
 * Guard: all DOM access is wrapped in functions that check for a global
 * `document` so the module can be imported in Node (test) environments
 * without crashing — as long as callers do not invoke `show*` / `hide*` in
 * a headless context.
 *
 * T17/T18 wire these into the screen flow.
 */

// ---------------------------------------------------------------------------
// Utility: safe document access
// ---------------------------------------------------------------------------

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  return e;
}

function css(e: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(e.style, styles);
}

// ---------------------------------------------------------------------------
// Shared overlay style
// ---------------------------------------------------------------------------

function applyOverlayStyle(root: HTMLElement): void {
  css(root, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.80)",
    color: "#ffffff",
    fontFamily: "sans-serif",
    zIndex: "100",
  });
}

function applyBoxStyle(box: HTMLElement): void {
  css(box, {
    background: "#1a1a2e",
    border: "2px solid #4169e1",
    borderRadius: "8px",
    padding: "32px 40px",
    minWidth: "320px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    alignItems: "center",
  });
}

// ---------------------------------------------------------------------------
// Callbacks type
// ---------------------------------------------------------------------------

import type { Faction } from "../game/types.js";

export interface MainMenuCallbacks {
  onStart: (seed: string) => void;
}

/** One row in the level-select list: a level the player may or may not enter. */
export interface LevelSelectEntry {
  readonly index: number;
  readonly name: string;
  /** Map dimensions, shown as a subtitle (e.g. "32x32"). */
  readonly width: number;
  readonly height: number;
  /** AI difficulty (1..5), shown as a subtitle. */
  readonly difficulty: number;
  /** Whether the level is unlocked (locked levels render disabled). */
  readonly unlocked: boolean;
}

export interface LevelSelectCallbacks {
  /** The levels to list, in order. */
  readonly levels: readonly LevelSelectEntry[];
  /** The campaign seed in effect (shown so the player can confirm it). */
  readonly seed: number;
  /** The faction currently picked by the player (the AI takes the other). */
  readonly faction: Faction;
  /** Invoked when the player toggles the faction pick. */
  onFaction: (faction: Faction) => void;
  /** Invoked when the player chooses an unlocked level to start. */
  onSelect: (levelIndex: number) => void;
  /** Invoked on the Back button. */
  onBack: () => void;
}

export interface VictoryCallbacks {
  /** Subtitle line (e.g. "Greenfields cleared"). */
  readonly subtitle?: string;
  /** Advance to the next level; omitted when the final level was just cleared. */
  onNext?: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

export interface DefeatCallbacks {
  /** Subtitle line (e.g. "Greenfields"). */
  readonly subtitle?: string;
  onRestart: () => void;
  onMainMenu: () => void;
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

let mainMenuEl: HTMLElement | null = null;

/**
 * Shows the main menu overlay.  Creates the DOM element on first call.
 * No-op in headless environments (no `document`).
 */
export function showMainMenu(callbacks: MainMenuCallbacks): void {
  if (!hasDocument()) return;

  if (mainMenuEl === null) {
    mainMenuEl = buildMainMenu(callbacks);
    document.body.appendChild(mainMenuEl);
  }
  mainMenuEl.style.display = "flex";
}

/** Hides the main menu. No-op if never shown or no `document`. */
export function hideMainMenu(): void {
  if (mainMenuEl !== null) {
    mainMenuEl.style.display = "none";
  }
}

function buildMainMenu(callbacks: MainMenuCallbacks): HTMLElement {
  const root = el("div", "menu-main");
  applyOverlayStyle(root);

  const box = el("div");
  applyBoxStyle(box);

  const title = el("h1");
  title.textContent = "Warband";
  css(title, { margin: "0", fontSize: "36px", letterSpacing: "4px" });
  box.appendChild(title);

  // Seed input
  const seedLabel = el("label");
  seedLabel.textContent = "Seed (optional):";
  css(seedLabel, { alignSelf: "flex-start", fontSize: "13px" });
  box.appendChild(seedLabel);

  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.placeholder = "e.g. 12345";
  css(seedInput, {
    width: "100%",
    padding: "6px 10px",
    borderRadius: "4px",
    border: "1px solid #555",
    background: "#111",
    color: "#fff",
    fontSize: "14px",
    boxSizing: "border-box",
  });
  box.appendChild(seedInput);

  const startBtn = document.createElement("button");
  startBtn.textContent = "Start Game";
  css(startBtn, {
    padding: "10px 32px",
    fontSize: "16px",
    cursor: "pointer",
    background: "#4169e1",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
  });
  startBtn.addEventListener("click", () => {
    callbacks.onStart(seedInput.value.trim());
  });
  box.appendChild(startBtn);

  root.appendChild(box);
  return root;
}

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------

let levelSelectEl: HTMLElement | null = null;

/**
 * Shows the level-select overlay. Rebuilt from scratch on every call (unlike the
 * static main menu) because its contents — locked/unlocked state, the active
 * seed, and the faction pick — change between shows. No-op in headless
 * environments.
 */
export function showLevelSelect(callbacks: LevelSelectCallbacks): void {
  if (!hasDocument()) return;

  if (levelSelectEl !== null) {
    levelSelectEl.remove();
    levelSelectEl = null;
  }
  levelSelectEl = buildLevelSelect(callbacks);
  document.body.appendChild(levelSelectEl);
  levelSelectEl.style.display = "flex";
}

/** Hides the level-select overlay. */
export function hideLevelSelect(): void {
  if (levelSelectEl !== null) {
    levelSelectEl.style.display = "none";
  }
}

/** Builds the faction toggle row (Humans / Orcs); the picked side is highlighted. */
function buildFactionPicker(callbacks: LevelSelectCallbacks): HTMLElement {
  const row = el("div");
  css(row, { display: "flex", gap: "8px", width: "100%" });

  const options: readonly { faction: Faction; label: string; color: string }[] = [
    { faction: "human", label: "Humans", color: "#4169e1" },
    { faction: "orc", label: "Orcs", color: "#8b0000" },
  ];

  for (const opt of options) {
    const picked = callbacks.faction === opt.faction;
    const btn = document.createElement("button");
    btn.textContent = opt.label;
    css(btn, {
      flex: "1",
      padding: "8px 0",
      fontSize: "14px",
      cursor: "pointer",
      background: picked ? opt.color : "#222",
      color: "#fff",
      border: picked ? "2px solid #fff" : "1px solid #555",
      borderRadius: "4px",
      fontWeight: picked ? "bold" : "normal",
    });
    btn.addEventListener("click", () => callbacks.onFaction(opt.faction));
    row.appendChild(btn);
  }
  return row;
}

function buildLevelSelect(callbacks: LevelSelectCallbacks): HTMLElement {
  const root = el("div", "menu-level-select");
  applyOverlayStyle(root);

  const box = el("div");
  applyBoxStyle(box);

  const title = el("h2");
  title.textContent = "Campaign";
  css(title, { margin: "0" });
  box.appendChild(title);

  const seedLine = el("div");
  seedLine.textContent = `Seed: ${callbacks.seed}`;
  css(seedLine, { fontSize: "12px", color: "#aaa" });
  box.appendChild(seedLine);

  const factionLabel = el("label");
  factionLabel.textContent = "Faction (AI takes the other):";
  css(factionLabel, { alignSelf: "flex-start", fontSize: "13px" });
  box.appendChild(factionLabel);
  box.appendChild(buildFactionPicker(callbacks));

  for (const lvl of callbacks.levels) {
    const btn = document.createElement("button");
    const lockTag = lvl.unlocked ? "" : "  [locked]";
    btn.textContent = `${lvl.index + 1}. ${lvl.name} — ${lvl.width}x${lvl.height}, AI ${lvl.difficulty}${lockTag}`;
    css(btn, {
      padding: "8px 16px",
      fontSize: "14px",
      cursor: lvl.unlocked ? "pointer" : "not-allowed",
      background: lvl.unlocked ? "#333" : "#1a1a1a",
      color: lvl.unlocked ? "#fff" : "#666",
      border: "1px solid #555",
      borderRadius: "4px",
      width: "100%",
      textAlign: "left",
    });
    btn.disabled = !lvl.unlocked;
    if (lvl.unlocked) {
      const levelIndex = lvl.index;
      btn.addEventListener("click", () => callbacks.onSelect(levelIndex));
    }
    box.appendChild(btn);
  }

  const backBtn = document.createElement("button");
  backBtn.textContent = "Back";
  css(backBtn, {
    padding: "8px 24px",
    fontSize: "14px",
    cursor: "pointer",
    background: "transparent",
    color: "#aaa",
    border: "1px solid #555",
    borderRadius: "4px",
    width: "100%",
  });
  backBtn.addEventListener("click", () => callbacks.onBack());
  box.appendChild(backBtn);

  root.appendChild(box);
  return root;
}

// ---------------------------------------------------------------------------
// Victory / Defeat
// ---------------------------------------------------------------------------

let resultEl: HTMLElement | null = null;

/** Replaces any current result overlay with a freshly-built one and shows it. */
function showResult(root: HTMLElement): void {
  if (resultEl !== null) {
    resultEl.remove();
  }
  resultEl = root;
  document.body.appendChild(root);
  root.style.display = "flex";
}

/**
 * Shows the victory overlay (rebuilt each call so the subtitle and the optional
 * "Next Level" button reflect the level just cleared). No-op in headless
 * environments.
 */
export function showVictory(callbacks: VictoryCallbacks): void {
  if (!hasDocument()) return;
  const buttons: ResultButton[] = [];
  if (callbacks.onNext !== undefined) {
    buttons.push({ label: "Next Level", primary: true, onClick: callbacks.onNext });
  }
  buttons.push({ label: "Replay", primary: callbacks.onNext === undefined, onClick: callbacks.onRestart });
  buttons.push({ label: "Main Menu", primary: false, onClick: callbacks.onMainMenu });
  showResult(buildResultScreen("Victory!", "#ffd700", callbacks.subtitle, buttons));
}

/** Hides the result overlay (shared by victory + defeat). */
export function hideVictory(): void {
  if (resultEl !== null) resultEl.style.display = "none";
}

/**
 * Shows the defeat overlay (rebuilt each call so the subtitle reflects the lost
 * level). No-op in headless environments.
 */
export function showDefeat(callbacks: DefeatCallbacks): void {
  if (!hasDocument()) return;
  const buttons: ResultButton[] = [
    { label: "Retry", primary: true, onClick: callbacks.onRestart },
    { label: "Main Menu", primary: false, onClick: callbacks.onMainMenu },
  ];
  showResult(buildResultScreen("Defeat", "#cc2200", callbacks.subtitle, buttons));
}

/** Hides the result overlay (shared by victory + defeat). */
export function hideDefeat(): void {
  if (resultEl !== null) resultEl.style.display = "none";
}

interface ResultButton {
  readonly label: string;
  readonly primary: boolean;
  readonly onClick: () => void;
}

function buildResultScreen(
  heading: string,
  headingColor: string,
  subtitle: string | undefined,
  buttons: readonly ResultButton[],
): HTMLElement {
  const root = el("div", "menu-result");
  applyOverlayStyle(root);

  const box = el("div");
  applyBoxStyle(box);

  const title = el("h1");
  title.textContent = heading;
  css(title, { margin: "0", fontSize: "48px", color: headingColor });
  box.appendChild(title);

  if (subtitle !== undefined) {
    const sub = el("div");
    sub.textContent = subtitle;
    css(sub, { fontSize: "15px", color: "#ccc" });
    box.appendChild(sub);
  }

  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.textContent = b.label;
    css(btn, {
      padding: "10px 32px",
      fontSize: "16px",
      cursor: "pointer",
      background: b.primary ? "#4169e1" : "transparent",
      color: b.primary ? "#fff" : "#aaa",
      border: b.primary ? "none" : "1px solid #555",
      borderRadius: "4px",
      width: "100%",
    });
    btn.addEventListener("click", b.onClick);
    box.appendChild(btn);
  }

  root.appendChild(box);
  return root;
}
