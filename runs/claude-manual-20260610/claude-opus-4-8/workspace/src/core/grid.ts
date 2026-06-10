/**
 * A dense 2D grid stored row-major in a flat array. Generic over cell type.
 */
export class Grid<T> {
  readonly width: number;
  readonly height: number;
  readonly cells: T[];

  constructor(width: number, height: number, fill: (x: number, y: number) => T) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Grid dimensions must be positive, got ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.cells = new Array<T>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.cells[y * width + x] = fill(x, y);
      }
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  get(x: number, y: number): T {
    if (!this.inBounds(x, y)) {
      throw new Error(`Grid.get out of bounds: (${x}, ${y})`);
    }
    return this.cells[y * this.width + x] as T;
  }

  set(x: number, y: number, value: T): void {
    if (!this.inBounds(x, y)) {
      throw new Error(`Grid.set out of bounds: (${x}, ${y})`);
    }
    this.cells[y * this.width + x] = value;
  }

  /** Mutate every cell in place. */
  fillAll(value: T): void {
    this.cells.fill(value);
  }
}
