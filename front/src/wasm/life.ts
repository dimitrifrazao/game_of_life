// =============================================================================
// life.ts — loads the Emscripten WASM core and wraps its C API.
//
// The core is shipped as a static ES6 module at /wasm/game.js (copied from
// game/dist by scripts/copy-wasm.mjs). It exports a default factory
// `createLifeModule()` (EXPORT_NAME=createLifeModule).
//
// The world is resizable (1..1000 per axis). The cell buffer is backed by a
// max-sized static buffer in the core, so the pointer is stable; only the
// first width*height bytes are meaningful for the current grid.
// =============================================================================

// Minimal shape of the Emscripten module we rely on.
interface EmscriptenModule {
  HEAPU8: Uint8Array;
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[]
  ) => (...args: number[]) => number | void;
}

type LifeFactory = (moduleArg?: Record<string, unknown>) => Promise<EmscriptenModule>;

export interface LifeApi {
  /** Current grid width (columns). */
  width(): number;
  /** Current grid height (rows). */
  height(): number;
  /** Resize the world (each axis clamped to [1,1000]); clears the grid. */
  resize(width: number, height: number): void;
  /**
   * Re-create and return a fresh Uint32Array view of the active cell buffer.
   * Each entry is a cell AGE: 0 = dead, >=1 = alive (generations alive, capped).
   */
  cells(): Uint32Array;
  clear(): void;
  randomize(): void;
  /** Random fill with density (0..1), symmetry mode, and noise field. */
  randomizeEx(density: number, symmetry: number, noise: number): void;
  step(): void;
  /** Advance the grid by `gens` generations (Hashlife fast-forwards). */
  stepBy(gens: number): void;
  /** Mark alive cells that will die next generation (sets bit 31 in age). */
  markDying(): void;
  toggle(row: number, col: number): void;
  /** Set a cell on (v=1) or off (v=0). */
  set(row: number, col: number, v: number): void;
  seed(s: number): void;
  /** Enable/disable toroidal wraparound at the grid edges. */
  setWrap(enabled: boolean): void;
  /** Whether wraparound is currently enabled. */
  getWrap(): boolean;
  /** Select the stepping algorithm (0 = brute force, 1 = hashlife). */
  setAlgorithm(algo: number): void;
  /** Current stepping algorithm (0 = brute force, 1 = hashlife). */
  getAlgorithm(): number;
}

/**
 * Dynamically import the WASM glue module from the static /wasm/ path. Using a
 * runtime import with an ignored Vite hint keeps the bundler from trying to
 * resolve/transform the Emscripten output at build time.
 */
async function loadFactory(): Promise<LifeFactory> {
  const url = `${import.meta.env.BASE_URL}wasm/game.js`;
  const mod = (await import(/* @vite-ignore */ url)) as { default: LifeFactory };
  return mod.default;
}

export async function loadLife(): Promise<LifeApi> {
  const createLifeModule = await loadFactory();
  const Module = await createLifeModule();

  const life_init = Module.cwrap("life_init", null, []);
  const life_resize = Module.cwrap("life_resize", null, ["number", "number"]);
  const life_width = Module.cwrap("life_width", "number", []);
  const life_height = Module.cwrap("life_height", "number", []);
  const life_cells = Module.cwrap("life_cells", "number", []);
  const life_clear = Module.cwrap("life_clear", null, []);
  const life_randomize = Module.cwrap("life_randomize", null, []);
  const life_randomize_ex = Module.cwrap("life_randomize_ex", null, [
    "number",
    "number",
    "number",
  ]);
  const life_step = Module.cwrap("life_step", null, []);
  const life_step_by = Module.cwrap("life_step_by", null, ["number"]);
  const life_mark_dying = Module.cwrap("life_mark_dying", null, []);
  const life_toggle = Module.cwrap("life_toggle", null, ["number", "number"]);
  const life_set = Module.cwrap("life_set", null, ["number", "number", "number"]);
  const life_seed = Module.cwrap("life_seed", null, ["number"]);
  const life_set_wrap = Module.cwrap("life_set_wrap", null, ["number"]);
  const life_get_wrap = Module.cwrap("life_get_wrap", "number", []);
  const life_set_algorithm = Module.cwrap("life_set_algorithm", null, ["number"]);
  const life_get_algorithm = Module.cwrap("life_get_algorithm", "number", []);

  // Allocate + clear the grid (core defaults to 100x100).
  life_init();

  const api: LifeApi = {
    width(): number {
      return life_width() as number;
    },
    height(): number {
      return life_height() as number;
    },
    resize(width: number, height: number) {
      life_resize(Math.round(width), Math.round(height));
    },
    cells(): Uint32Array {
      // Re-create the view every time: ALLOW_MEMORY_GROWTH can detach/replace
      // the underlying ArrayBuffer, invalidating any previously held view. The
      // buffer holds one uint32 age per cell; the active region is width*height
      // entries from the (stable) byte pointer.
      const ptr = life_cells() as number;
      const count = (life_width() as number) * (life_height() as number);
      return new Uint32Array(Module.HEAPU8.buffer, ptr, count);
    },
    clear() {
      life_clear();
    },
    randomize() {
      life_randomize();
    },
    randomizeEx(density: number, symmetry: number, noise: number) {
      life_randomize_ex(density, symmetry, noise);
    },
    step() {
      life_step();
    },
    stepBy(gens: number) {
      life_step_by(Math.max(1, Math.floor(gens)));
    },
    markDying() {
      life_mark_dying();
    },
    toggle(row: number, col: number) {
      life_toggle(row, col);
    },
    set(row: number, col: number, v: number) {
      life_set(row, col, v);
    },
    seed(s: number) {
      life_seed(s);
    },
    setWrap(enabled: boolean) {
      life_set_wrap(enabled ? 1 : 0);
    },
    getWrap(): boolean {
      return (life_get_wrap() as number) !== 0;
    },
    setAlgorithm(algo: number) {
      life_set_algorithm(algo);
    },
    getAlgorithm(): number {
      return life_get_algorithm() as number;
    },
  };

  return api;
}
