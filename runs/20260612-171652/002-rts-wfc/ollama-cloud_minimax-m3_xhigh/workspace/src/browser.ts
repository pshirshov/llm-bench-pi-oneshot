// Browser entry: bootstrap the canvas, parse the URL, set up the game, run.

import { createGame, bindGameToCanvas, renderFrame, tickGame, Game } from "./main.js";
import { Faction } from "./sim/stats.js";
import { makeRandomSeed } from "./sim/rng.js";

function parseUrl(): { seed: number; level: number; faction: Faction } {
  const params = new URLSearchParams(window.location.search);
  let seed = parseInt(params.get("seed") ?? "", 10);
  if (isNaN(seed)) seed = makeRandomSeed();
  let level = parseInt(params.get("level") ?? "1", 10);
  if (isNaN(level)) level = 1;
  if (level < 1) level = 1;
  if (level > 5) level = 5;
  const f = params.get("faction");
  const faction: Faction = f === "orcs" ? "orcs" : "humans";
  return { seed, level, faction };
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 4;
}

function main(): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) {
    document.body.innerHTML = "<div style='color:#fff;padding:20px'>Canvas #game not found.</div>";
    return;
  }
  resizeCanvas(canvas);
  window.addEventListener("resize", () => resizeCanvas(canvas));
  const opts = parseUrl();
  let game: Game;
  try {
    game = createGame(canvas, opts);
  } catch (e) {
    document.body.innerHTML = `<div style='color:#f88;padding:20px'>Failed to create game: ${String(e)}</div>`;
    return;
  }
  bindGameToCanvas(game, canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    document.body.innerHTML = "<div style='color:#f88;padding:20px'>No 2D context available.</div>";
    return;
  }
  let lastTime = performance.now();
  function loop(now: number): void {
    const dt = now - lastTime;
    lastTime = now;
    if (dt < 100) tickGame(game);
    renderFrame(game, ctx);
    // Show outcome overlay.
    showOutcome(game);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function showOutcome(game: Game): void {
  const overlay = document.getElementById("overlay");
  if (!overlay) return;
  const w = game.world;
  if (w.outcome === "playing") {
    overlay.innerHTML = "";
    overlay.style.display = "none";
    return;
  }
  overlay.style.display = "block";
  overlay.style.position = "absolute";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.background = "rgba(0,0,0,0.7)";
  overlay.style.color = "#fff";
  overlay.style.fontFamily = "monospace";
  overlay.style.fontSize = "32px";
  overlay.style.textAlign = "center";
  overlay.style.paddingTop = "40vh";
  if (w.winner === game.playerFaction) {
    overlay.innerHTML = `VICTORY!<br/><span style='font-size:18px'>Click to continue</span>`;
  } else {
    overlay.innerHTML = `DEFEAT<br/><span style='font-size:18px'>Click to retry</span>`;
  }
  overlay.onclick = () => {
    overlay.onclick = null;
    if (w.winner === game.playerFaction && game.campaign.level < game.campaign.totalLevels) {
      const newLevel = game.campaign.level + 1;
      const newOpts = parseUrl();
      newOpts.level = newLevel;
      window.location.search = `?seed=${newOpts.seed}&level=${newLevel}&faction=${newOpts.faction}`;
    } else {
      window.location.reload();
    }
  };
}

main();
