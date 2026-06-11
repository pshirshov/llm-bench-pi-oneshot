const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#game canvas element missing");

const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D canvas context unavailable");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = "#07090f";
ctx.fillRect(0, 0, canvas.width, canvas.height);
