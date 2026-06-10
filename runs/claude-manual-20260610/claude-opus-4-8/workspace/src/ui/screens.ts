import { LEVELS } from "../game/campaign.js";
import { Faction, THEMES } from "../sim/stats.js";

/** Lightweight DOM overlay screens (menus, level select, results). The match itself renders on canvas. */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
}

function panel(): HTMLDivElement {
  const overlay = el("div", {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(circle at 50% 30%, #1c2438, #07090f)",
    zIndex: "10",
  });
  const box = el("div", {
    background: "rgba(12,16,24,0.92)",
    border: "1px solid #2c3a52",
    borderRadius: "10px",
    padding: "28px 34px",
    minWidth: "440px",
    maxWidth: "640px",
    boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
    color: "#e6e6e6",
    fontFamily: "'Trebuchet MS', sans-serif",
  });
  overlay.appendChild(box);
  return overlay;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el("button", {
    display: "block",
    width: "100%",
    margin: "8px 0",
    padding: "12px",
    fontSize: "15px",
    fontWeight: "bold",
    color: primary ? "#fff" : "#cfe0ff",
    background: primary ? "#3a5fa0" : "#1d2a3e",
    border: "1px solid #3a5680",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: "inherit",
  });
  b.textContent = label;
  b.addEventListener("mouseenter", () => (b.style.filter = "brightness(1.2)"));
  b.addEventListener("mouseleave", () => (b.style.filter = "none"));
  b.addEventListener("click", onClick);
  return b;
}

export interface MainMenuCallbacks {
  onStart(faction: Faction, seed: number): void;
  onLevelSelect(faction: Faction, seed: number): void;
}

export function showMainMenu(
  host: HTMLElement,
  initial: { faction: Faction; seed: number },
  cb: MainMenuCallbacks,
): void {
  host.innerHTML = "";
  const overlay = panel();
  const box = overlay.firstChild as HTMLDivElement;

  box.appendChild(
    el("h1", { margin: "0 0 4px", fontSize: "40px", letterSpacing: "2px", color: "#e9c46a" }, "WARBAND"),
  );
  box.appendChild(
    el("p", { margin: "0 0 18px", color: "#8aa" }, "A real-time strategy of axes, arrows and ambition."),
  );

  let faction = initial.faction;
  box.appendChild(el("div", { fontSize: "13px", color: "#9ab", marginBottom: "6px" }, "Choose your faction"));
  const row = el("div", { display: "flex", gap: "10px", marginBottom: "18px" });
  const factionButtons: HTMLButtonElement[] = [];
  const refresh = (): void => {
    for (const fb of factionButtons) {
      const f = fb.dataset.faction as Faction;
      fb.style.outline = f === faction ? "2px solid #e9c46a" : "none";
    }
  };
  for (const f of [Faction.Human, Faction.Orc]) {
    const fb = el("button", {
      flex: "1",
      padding: "14px",
      cursor: "pointer",
      borderRadius: "6px",
      border: "1px solid #333",
      background: THEMES[f].dark,
      color: "#fff",
      fontWeight: "bold",
      fontFamily: "inherit",
      fontSize: "15px",
    });
    fb.textContent = THEMES[f].displayName;
    fb.dataset.faction = f;
    fb.addEventListener("click", () => {
      faction = f;
      refresh();
    });
    factionButtons.push(fb);
    row.appendChild(fb);
  }
  box.appendChild(row);
  refresh();

  // Seed input.
  const seedRow = el("div", { display: "flex", gap: "8px", alignItems: "center", marginBottom: "18px" });
  seedRow.appendChild(el("label", { fontSize: "13px", color: "#9ab" }, "Campaign seed"));
  const seedInput = el("input", {
    flex: "1",
    padding: "8px",
    background: "#0b0f16",
    color: "#e6e6e6",
    border: "1px solid #2c3a52",
    borderRadius: "5px",
    fontFamily: "monospace",
  }) as HTMLInputElement;
  seedInput.type = "number";
  seedInput.value = String(initial.seed);
  seedRow.appendChild(seedInput);
  box.appendChild(seedRow);

  const readSeed = (): number => {
    const n = Number.parseInt(seedInput.value, 10);
    return Number.isFinite(n) ? n >>> 0 : initial.seed;
  };

  box.appendChild(button("Start Campaign", () => cb.onStart(faction, readSeed()), true));
  box.appendChild(button("Select Level", () => cb.onLevelSelect(faction, readSeed())));

  box.appendChild(
    el(
      "p",
      { marginTop: "16px", fontSize: "11px", color: "#566", lineHeight: "1.5" },
      "Tip: left-click / drag to select, right-click to order, A then click to attack-move, Ctrl+1–9 to set control groups, Space to pause.",
    ),
  );

  host.appendChild(overlay);
}

export interface LevelSelectCallbacks {
  onPick(index: number): void;
  onBack(): void;
}

export function showLevelSelect(
  host: HTMLElement,
  highestUnlocked: number,
  cb: LevelSelectCallbacks,
): void {
  host.innerHTML = "";
  const overlay = panel();
  const box = overlay.firstChild as HTMLDivElement;
  box.appendChild(el("h2", { margin: "0 0 16px", color: "#e9c46a" }, "Select Level"));

  for (const lvl of LEVELS) {
    const unlocked = lvl.index <= highestUnlocked;
    const b = el("button", {
      display: "block",
      width: "100%",
      textAlign: "left",
      margin: "8px 0",
      padding: "12px 14px",
      borderRadius: "6px",
      border: "1px solid #2c3a52",
      background: unlocked ? "#16223a" : "#13161c",
      color: unlocked ? "#e6e6e6" : "#555",
      cursor: unlocked ? "pointer" : "not-allowed",
      fontFamily: "inherit",
    });
    b.innerHTML = "";
    b.appendChild(
      el(
        "div",
        { fontWeight: "bold", fontSize: "15px" },
        `${unlocked ? "" : "🔒 "}Level ${lvl.index + 1}: ${lvl.name}`,
      ),
    );
    b.appendChild(
      el(
        "div",
        { fontSize: "12px", color: unlocked ? "#8aa" : "#444", marginTop: "3px" },
        `${lvl.size}×${lvl.size}  ·  Difficulty ${lvl.difficulty}  ·  ${lvl.blurb}`,
      ),
    );
    if (unlocked) b.addEventListener("click", () => cb.onPick(lvl.index));
    box.appendChild(b);
  }

  box.appendChild(button("Back", cb.onBack));
  host.appendChild(overlay);
}

export interface ResultCallbacks {
  onContinue(): void;
  onMenu(): void;
}

export function showResult(
  host: HTMLElement,
  info: { result: "won" | "lost"; levelName: string; nextLevel: number | null },
  cb: ResultCallbacks,
): void {
  host.innerHTML = "";
  const overlay = panel();
  overlay.style.background = "rgba(3,5,9,0.55)";
  const box = overlay.firstChild as HTMLDivElement;
  const won = info.result === "won";
  box.appendChild(
    el(
      "h1",
      { margin: "0 0 8px", fontSize: "34px", color: won ? "#7ee08a" : "#e07a7a" },
      won ? "Victory!" : "Defeat",
    ),
  );
  box.appendChild(
    el(
      "p",
      { margin: "0 0 18px", color: "#9ab" },
      won
        ? info.nextLevel === null
          ? `You have conquered ${info.levelName} — and the entire campaign!`
          : `You have conquered ${info.levelName}.`
        : `Your forces were wiped out at ${info.levelName}.`,
    ),
  );

  if (won && info.nextLevel !== null) {
    box.appendChild(button("Next Level", cb.onContinue, true));
  } else if (!won) {
    box.appendChild(button("Retry", cb.onContinue, true));
  }
  box.appendChild(button("Main Menu", cb.onMenu));
  host.appendChild(overlay);
}

export function clearOverlay(host: HTMLElement): void {
  host.innerHTML = "";
}
