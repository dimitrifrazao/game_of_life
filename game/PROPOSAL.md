# game/ — Implementation Proposal (game-dev agent)

**Owner:** game-dev (C++ + Emscripten/WebAssembly specialist)
**Status:** Proposal — awaiting orchestrator approval. No code written yet.

## 1. Goal

Implement Conway's Game of Life core logic in modern C++ and compile it to
WebAssembly with Emscripten, exposing a minimal, stable C API the React front
end can call directly and read cell state from WASM linear memory.

## 2. File layout

```
game/
├── PROPOSAL.md          (this file)
├── src/
│   └── life.cpp         core logic + exported C API
├── test/
│   └── test_life.cpp    native unit test suite (21 tests)
├── Makefile             build/test targets
├── build.sh             one-shot WASM build wrapper
└── dist/                build output (game.js + game.wasm)  [generated]
```

## 3. Rules, age tracking & edge behavior

- Classic Conway rules:
  - Live cell with 2 or 3 live neighbors survives; otherwise dies.
  - Dead cell with exactly 3 live neighbors becomes alive.
- **Cell age:** each cell stores a 32-bit age instead of a 0/1 flag.
  `age == 0` = dead; `age >= 1` = alive. A newborn cell starts at age 1; each
  generation a surviving cell's age increments by 1, capped at `MAX_AGE`
  (1,000,000). Turning a cell off then on again resets it to age 1. The front
  end uses age to lerp the live-cell color from a start color to an end color.
- Grid is **resizable** at runtime, **1..1000 per axis**, default **100 x 100**.
  `life_resize(w, h)` clamps each axis to `[1, 1000]` and clears the grid.
- **Edge behavior:** configurable at runtime via `life_set_wrap(int)`. Default is
  **wraparound ON** (toroidal): neighbor coordinates wrap around opposite edges,
  so a glider leaving one side reappears on the other. When disabled, edges are
  dead borders (cells outside the grid count as dead). `life_get_wrap()` reports
  the current mode.

## 4. Memory layout (contract with front-dev)

- **One `uint32_t` age per cell** (little-endian): `0` = dead, `>=1` = alive
  (generations alive, capped at 1,000,000).
- Row-major with the **current width** as stride: index = `row * life_width() + col`.
- Storage is two **max-sized static buffers** (1000 x 1000 = 1,000,000 `uint32`
  each). Only the first `life_width() * life_height()` entries are meaningful for
  the current grid. Because the buffers are statically allocated at the maximum
  size, the pointer returned by `life_cells()` is **always stable** — it never
  moves across `life_resize()` or `life_step()`.
- `life_cells()` returns a `uint8_t*` to the front buffer. The front end views it
  as a `Uint32Array(HEAPU8.buffer, ptr, width*height)` of ages, or as RGBA bytes
  (4 bytes/cell) to upload directly to a WebGL texture and decode the age in the
  shader. The view must be re-created using the current `width*height` after a
  resize (and because `ALLOW_MEMORY_GROWTH` may move the heap).
- Double-buffering is internal: `life_step()` computes the next generation into
  a back buffer then copies into the front buffer, so the `life_cells()` pointer
  stays stable across steps.

## 5. Exported C API (the contract)

All functions are `extern "C"` and exported via Emscripten.

```c
void      life_init(void);              // clear the grid
void      life_resize(int w, int h);    // resize world (each axis clamped 1..1000); clears
uint8_t*  life_cells(void);             // pointer to the cell buffer (uint32 age/cell; stable)
int       life_width(void);             // returns current width (default 100)
int       life_height(void);            // returns current height (default 100)
void      life_clear(void);             // set all cells to dead (age 0)
void      life_randomize(void);         // clear, then set ~50% of cells alive (age 1)
void      life_randomize_ex(float density, int symmetry, int noise); // density/symmetry/noise fill
void      life_step(void);              // advance one generation (updates ages)
void      life_toggle(int row, int col);// flip a cell (on => age 1, off => age 0)
uint32_t  life_get(int row, int col);   // read a cell's age (0 = dead)
void      life_set(int row, int col, uint8_t v); // set a cell (non-zero => age 1)
void      life_seed(uint32_t s);        // seed the PRNG for reproducible randomize
void      life_set_wrap(int enabled);   // enable/disable toroidal edge wraparound (default ON)
int       life_get_wrap(void);          // 1 if wraparound enabled, else 0
void      life_set_algorithm(int algo); // 0 = brute force, 1 = hashlife
int       life_get_algorithm(void);     // current algorithm
```

- `life_randomize()` uses a seeded PRNG (`<random>`, `std::mt19937`) and turns on
  each cell with probability 0.5 after clearing — satisfying "clear all then
  randomly turn on 50%".
- Bounds are checked in `life_toggle`/`life_get`/`life_set`; out-of-range is a
  no-op / returns 0.

## 6. Emscripten build

Toolchain: install/activate `emsdk` (latest). Verify version via the internet at
build time. Compile with `em++`.

Proposed flags:

```
em++ -std=c++17 -O3 src/life.cpp -o dist/game.js \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createLifeModule \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_life_init","_life_resize","_life_cells","_life_width","_life_height","_life_clear","_life_randomize","_life_step","_life_toggle","_life_get","_life_set","_life_seed","_life_set_wrap","_life_get_wrap","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8"]'
```

- `MODULARIZE` + `EXPORT_ES6` produces an ES module the React/Vite front end can
  `import` and instantiate: `const Module = await createLifeModule();`.
- `HEAPU8` is exported so the front end can read the cell buffer directly.
- Output artifacts: `dist/game.js` (glue) and `dist/game.wasm`.

## 7. Build commands

- `make` or `./build.sh` → produces `dist/game.js` + `dist/game.wasm`.
- `make test` → compiles and runs the unit test suite (`test/test_life.cpp` linked
  against `src/life.cpp`; 21 tests covering rules, edges, ages, hashlife, randomize,
  resize, and bounds). Runs in under 0.5 seconds.
- `make test-legacy` → builds and runs the old inline self-check (`#ifdef
  LIFE_NATIVE_TEST` in `life.cpp`) for back-compat.
- `make clean` → removes all built artifacts.

## 8. Resolved decisions

1. **Wraparound (toroidal) edges:** **enabled by default** (toroidal). A runtime
   toggle via `life_set_wrap(int)` / `life_get_wrap()`, surfaced in the front end
   as a "Wrap edges" checkbox (checked by default). When enabled, neighbor
   coordinates wrap around opposite edges, so a glider leaving one side reappears
   on the other; when disabled, edges are dead borders.
2. **Deterministic seeding:** **yes** — expose `void life_seed(uint32_t s)` so
   `life_randomize()` can be made reproducible for tests. Add `_life_seed` to
   `EXPORTED_FUNCTIONS`.
3. **Module format:** **ES6 module output** (`MODULARIZE=1` + `EXPORT_ES6=1`,
   `EXPORT_NAME=createLifeModule`), to match `front/PROPOSAL.md` which imports it
   via `import createLifeModule from "/wasm/game.js"` and instantiates with
   `await createLifeModule()`.
4. **Cell age:** cells store a 32-bit age (0 = dead, >=1 = generations alive,
   capped at 1,000,000) instead of a 0/1 flag. Newborns start at 1, survivors
   increment each generation, and turning a cell off then on resets it to 1. The
   buffer is therefore 4 bytes/cell; the front end decodes the age to drive the
   start→end color lerp. Verified by native tests (still-life block ages 1→2→3,
   re-toggle resets to 1).
5. **Algorithm selector (brute force / Hashlife):** `life_set_algorithm(int)` /
   `life_get_algorithm()` choose the stepping engine; default is brute force.
   - **Brute force** scans every cell each generation and supports toroidal
     wraparound.
   - **Hashlife** is Gosper's hashed quadtree with a memoized 1-generation
     successor (hash-consed nodes via an `unordered_map`, empty-node memoization,
     and a per-node cached result). The quadtree **root persists across steps**
     (Option A): it is rebuilt from the age buffer only when the grid is mutated
     (draw, clear, randomize, resize, or an algorithm switch — tracked by a dirty
     flag). Each `life_step()` pads the root, takes the successor, and reads the
     visible WxH window back into the age buffer. The universe is an effectively
     **infinite plane**, so Hashlife does **not** wrap, and cells that leave the
     window keep evolving off-screen (they don't clip at the edge and don't
     reappear on the opposite side).
   - Because edges are open (not clipped or wrapped), Hashlife differs from
     brute force only within `steps` cells of a border; the **interior matches
     brute force exactly** (verified by a native test comparing the central
     region over 12 generations across several seeds), plus glider-translation
     and age-tracking checks.
   - The node cache persists across steps (so repeated subpatterns reuse cached
     results); it is dropped (forcing a rebuild) if it exceeds ~1.5M nodes to
     bound memory.
   - Performance: persisting the root avoids an O(area) rebuild every generation,
     so Hashlife is much faster than the earlier rebuild-every-step version for
     repetitive/stable patterns.
   - **Fast-forward (`life_step_by(int gens)`):** advances `gens` generations per
     call. Hashlife implements this with a speed-parameterized, memoized
     successor — `successor(node, j)` returns the node center advanced `2^j`
     generations, and `gens` is decomposed into power-of-two supersteps. Every
     intermediate generation is computed exactly (not skipped); the work is
     shared/memoized, so jumping by huge `gens` on structured/repetitive patterns
     is near-instant — this is where Hashlife decisively beats brute force.
     Brute force's `life_step_by` just runs `gens` sequential scans. When
     `gens > 1`, surviving cells' ages advance by `gens` (an approximation, since
     intermediate generations aren't materialized); `gens = 1` is exact.
