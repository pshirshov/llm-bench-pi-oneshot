/** Viewport/camera management. */

export class Viewport {
  x: number = 0;
  y: number = 0;
  width: number;
  height: number;
  scrollSpeed: number = 0.5;
  mapWidth: number;
  mapHeight: number;

  constructor(width: number, height: number, mapWidth: number, mapHeight: number) {
    this.width = width;
    this.height = height;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
  }

  get tileSize(): number {
    return 32;
  }

  get visibleTilesX(): number {
    return Math.ceil(this.width / this.tileSize) + 1;
  }

  get visibleTilesY(): number {
    return Math.ceil(this.height / this.tileSize) + 1;
  }

  scroll(dx: number, dy: number): void {
    this.x += dx * this.scrollSpeed;
    this.y += dy * this.scrollSpeed;
    this.clamp();
  }

  centerOn(x: number, y: number): void {
    this.x = x - this.width / (2 * this.tileSize);
    this.y = y - this.height / (2 * this.tileSize);
    this.clamp();
  }

  clamp(): void {
    const maxX = this.mapWidth - this.width / this.tileSize;
    const maxY = this.mapHeight - this.height / this.tileSize;
    this.x = Math.max(0, Math.min(maxX, this.x));
    this.y = Math.max(0, Math.min(maxY, this.y));
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx / this.tileSize + this.x,
      y: sy / this.tileSize + this.y,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.tileSize,
      y: (wy - this.y) * this.tileSize,
    };
  }

  screenToTile(sx: number, sy: number): { col: number; row: number } {
    const world = this.screenToWorld(sx, sy);
    return { col: Math.floor(world.x), row: Math.floor(world.y) };
  }
}