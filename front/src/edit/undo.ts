// =============================================================================
// undo.ts — unified edit history for draw / erase / toggle / stamp.
//
// An "edit" is the set of cells whose value changed plus their PREVIOUS value:
//   { indices: Int32Array, prev: Uint8Array, width, height }
// Undo pops the most recent edit and writes each prev value back at its index,
// which correctly reverts every mode (draw 0->1 restores 0; erase 1->0 restores
// 1; toggle restores its prev; stamp restores 0 only for the cells it newly lit
// — pre-existing live cells are not recorded and so are never disturbed).
//
// Stroke API (for drag-painting): beginStroke -> recordCell* -> endStroke.
// Atomic API (for stamp/single-click): pushAtomic.
//
// Caps: at most CAPACITY edits, and a soft total-cells cap. When either is
// exceeded, oldest edits are evicted (FIFO).
// =============================================================================

export interface Edit {
  indices: Int32Array;  // flat cell indices (row*width + col)
  prev: Uint8Array;     // previous values (0 or 1)
  width: number;        // world dims at edit time (for undo guard)
  height: number;
}

export const UNDO_CAPACITY = 10;
export const UNDO_MAX_CELLS = 400_000; // soft cap on total recorded cells

export class UndoManager {
  private stack: Edit[] = [];
  private totalCells = 0;
  private capacity: number;
  private maxCells: number;

  // In-flight stroke being assembled.
  private strokeIdx: number[] | null = null;
  private strokePrev: number[] | null = null;
  private strokeSeen: Set<number> | null = null;
  private strokeWidth = 0;
  private strokeHeight = 0;

  constructor(capacity = UNDO_CAPACITY, maxCells = UNDO_MAX_CELLS) {
    this.capacity = capacity;
    this.maxCells = maxCells;
  }

  /** Discard all history (called on Run/Step/Clear/Random/Resize/Load). */
  clear(): void {
    this.stack.length = 0;
    this.totalCells = 0;
    this.strokeIdx = null;
    this.strokePrev = null;
    this.strokeSeen = null;
  }

  size(): number {
    return this.stack.length;
  }

  /** Begin assembling a stroke (e.g., a drag in draw/erase/toggle mode). */
  beginStroke(width: number, height: number): void {
    this.strokeIdx = [];
    this.strokePrev = [];
    this.strokeSeen = new Set();
    this.strokeWidth = width;
    this.strokeHeight = height;
  }

  /**
   * Record a cell change (idempotent within the current stroke). Call this
   * BEFORE writing the new value so `prev` is still the old value.
   */
  recordCell(row: number, col: number, prev: number): void {
    if (this.strokeIdx == null || this.strokeSeen == null || this.strokePrev == null) {
      return;
    }
    const idx = row * this.strokeWidth + col;
    if (this.strokeSeen.has(idx)) return;
    this.strokeSeen.add(idx);
    this.strokeIdx.push(idx);
    this.strokePrev.push(prev ? 1 : 0);
  }

  /** End a stroke. Pushes a single edit if any cells were recorded. */
  endStroke(): void {
    if (this.strokeIdx == null || this.strokePrev == null) return;
    if (this.strokeIdx.length > 0) {
      this.push({
        indices: Int32Array.from(this.strokeIdx),
        prev: Uint8Array.from(this.strokePrev),
        width: this.strokeWidth,
        height: this.strokeHeight,
      });
    }
    this.strokeIdx = null;
    this.strokePrev = null;
    this.strokeSeen = null;
  }

  /** Push a one-shot edit (e.g., a stamp click). Empty input is a no-op. */
  pushAtomic(
    width: number,
    height: number,
    indices: number[] | Int32Array,
    prev: number[] | Uint8Array
  ): void {
    if (indices.length === 0) return;
    this.push({
      indices: indices instanceof Int32Array ? indices : Int32Array.from(indices),
      prev: prev instanceof Uint8Array ? prev : Uint8Array.from(prev),
      width,
      height,
    });
  }

  private push(edit: Edit): void {
    this.stack.push(edit);
    this.totalCells += edit.indices.length;
    while (
      this.stack.length > this.capacity ||
      this.totalCells > this.maxCells
    ) {
      const dropped = this.stack.shift();
      if (!dropped) break;
      this.totalCells -= dropped.indices.length;
    }
  }

  /** Pop the most recent edit (or null if empty). */
  pop(): Edit | null {
    const e = this.stack.pop();
    if (!e) return null;
    this.totalCells -= e.indices.length;
    return e;
  }
}
