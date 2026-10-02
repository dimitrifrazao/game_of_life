# front/ — Implementation Proposal (front-dev agent)

**Owner:** front-dev (React + WebGL + WASM loading specialist)
**Status:** Proposal — awaiting orchestrator approval. No code written yet.

## 1. Goal

A React app that loads the WebAssembly core (`game.js` + `game.wasm` from
`game/`), drives the simulation, and renders the 100 x 100 grid with WebGL.
Off cells white, live cells dark navy, with hover-highlight and click-to-toggle.

## 2. Build tool & file layout

Vite + React + TypeScript (fast dev server, native ESM, easy WASM handling).

```
front/
├── PROPOSAL.md
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx          React entry
    ├── App.tsx           top-level router shell (Nav + 3 pages mounted)
    ├── router.ts         zero-dep hash router (useRoute hook)
    ├── components/
    │   └── Nav.tsx       About / Game / Rules nav bar
    ├── pages/
    │   ├── About.tsx     project + author description (placeholder)
    │   ├── Game.tsx      the game UI (formerly App.tsx)
    │   ├── Rules.tsx     Conway's rules + pattern types
    │   └── Tech.tsx      algorithm notes (naive vs Hashlife, noise, color spaces)
    ├── config.ts         tunable look-and-feel constants (cell colors, hover
    │                      border color, grid-line color/width)
    ├── wasm/
    │   └── life.ts       loads createLifeModule(), wraps the C API
    ├── render/
    │   ├── GameCanvas.tsx WebGL canvas component + interaction handling
    │   ├── glRenderer.ts  WebGL setup, shaders, draw
    │   └── shaders.ts     vertex + fragment shader sources
    └── styles.css
```

## 3. Loading the WASM module

- `game-dev` emits an ES6 module (`createLifeModule`). Proposed integration:
  copy `game/dist/game.js` + `game.wasm` into `front/public/wasm/` (or a Vite
  alias) at build time so they ship as static assets.
- `life.ts`:
  ```ts
  import createLifeModule from "/wasm/game.js";
  const Module = await createLifeModule();
  const api = {
    init:      Module.cwrap("life_init", null, []),
    cells:     Module.cwrap("life_cells", "number", []),
    clear:     Module.cwrap("life_clear", null, []),
    randomize: Module.cwrap("life_randomize", null, []),
    step:      Module.cwrap("life_step", null, []),
    toggle:    Module.cwrap("life_toggle", null, ["number","number"]),
  };
  ```
- Read the buffer without copying:
  `new Uint8Array(Module.HEAPU8.buffer, api.cells(), 100*100)`.
  Re-create the view after any call that may grow memory (ALLOW_MEMORY_GROWTH).

## 4. WebGL rendering approach

- **Texture-based grid (chosen)** over per-cell instancing — simplest and fast
  for 10,000 cells:
  - Upload the 100x100 cell buffer as a `100x100` `LUMINANCE`/`R8` texture
    (`gl.texImage2D` with `UNSIGNED_BYTE`), `NEAREST` filtering.
  - Draw a single full-grid quad (2 triangles).
  - Fragment shader maps texel value → color: `0.0` → `OFF_COLOR` (white),
    `1.0` → `ON_COLOR` (dark navy, default vec3(0.039, 0.102, 0.251)). Both
    colors come from `config.ts` and are passed in as shader uniforms so they
    are configurable.
- **Grid lines / cell borders:** fragment shader draws thin borders by computing
  the fractional position within each cell (`fract(uv * 100.0)`) and darkening a
  thin band near cell edges. Border color/width come from `config.ts`.
- **Hover highlight:** pass the hovered cell (row,col) as a uniform `uHover`
  (vec2, or -1 when none). The fragment shader brightens/thickens the border of
  the cell whose integer coords match `uHover`, using the configurable
  `HOVER_BORDER_COLOR` from `config.ts`.

## 5. Layout & aspect ratio

- The grid container fits the screen width. The canvas is forced **square**
  (CSS `aspect-ratio: 1 / 1`, width = min(viewport width, some max)) and keeps
  the same on-screen size regardless of the world dimensions.
- **Cells are always square (locked aspect).** When the world is square (e.g.
  100x100) the grid fills the canvas. When width != height, the grid is drawn as
  a centered sub-rectangle: the larger axis (in cells) fills the canvas and the
  shorter axis is **letterboxed** with a black gap so cells never stretch.
- Buttons/fields row sits below the canvas.
- Device pixel ratio handled by sizing the drawing buffer to
  `cssSize * devicePixelRatio` for crisp rendering.

## 6. Interaction

- Mouse coordinates → cell: `col = floor(mouseX / cellPx)`,
  `row = floor(mouseY / cellPx)` using the canvas bounding rect.
- **Hover:** on `mousemove`, compute (row,col), set `uHover` uniform, redraw.
- **Click / drag-to-paint:** interaction is handled via `mousedown` + `mousemove`
  + `mouseup` (not a single `click`):
  - `mousedown` (primary button): start a paint drag, edit the cell under the
    cursor immediately, and record it in a per-drag `Set` of edited cells.
  - `mousemove` while the button is held: for each **new** cell the pointer
    enters (not already in the per-drag set), edit it once and re-upload. The set
    prevents a cell from flipping back and forth on jitter.
  - The edit action is set by the **Mouse** mode dropdown: Draw → `api.set(r,c,1)`,
    Erase → `api.set(r,c,0)`, Toggle → `api.toggle(r,c)` (default), Stamp → place
    a pattern.
  - `mouseup` (listened on `window`, so releasing off-canvas still ends the
    drag): clear the painting flag and the per-drag set.

### Stamp tool

- A **Stamp** mouse mode places prebuilt patterns. Three dropdowns (enabled only
  in stamp mode): **Type** (Still life / Oscillators / Spaceships), **Pattern**
  (10 per type), and **Rotate** (0/90/180/270°). Pressing the **R** key cycles
  the rotation to the next option (a `keydown` listener active only in stamp
  mode, ignored while typing in a field). Defaults: Still life, first pattern, 0°.
- Patterns live in `src/stamps/patterns.ts`, stored as RLE bodies sourced from
  [LifeWiki](https://conwaylife.com) and parsed to `{ width, height, cells }`;
  `getStampData(type, index, degrees)` parses + rotates on demand.
- **Preview** is a non-destructive shader overlay: the stamp is uploaded to a
  second WebGL texture and the fragment shader blends it (uniforms
  `uStampTex/uStampSize/uStampOrigin/uStampActive/uStampWrap/uStampColor`),
  anchored top-left at the hovered cell. It respects the wrap setting (wraps the
  preview around edges when on).
- **Click** commits the stamp via `api.set(r,c,1)` for each live pattern cell
  (additive). Placement wraps when Wrap edges is on, otherwise clips at the
  border. Stamping is per-click only (no continuous drag).

### Keyboard shortcuts

- **D / E / T / S / Z / M** — switch the Mouse mode to Draw / Erase / Toggle /
  Stamp / Zoom / Move respectively (case-insensitive). The handler is a window-
  level `keydown` listener that's suppressed when any modifier (Ctrl/Cmd/Alt) is
  held or when the focus is in an `<input>`, `<select>`, or `<textarea>`, so it
  doesn't collide with system shortcuts (e.g. Cmd+S) or text entry.
- **Space** — toggle Run/Stop. **Enter** — step one generation (only while
  stopped). Both call `preventDefault()` (so Space doesn't scroll the page or
  re-click a focused button), and they only fire on the Game route — pressing
  Space on About or Rules scrolls those pages normally.
- **R** (in stamp mode) — cycles the stamp rotation, see Stamp tool above.
- **Ctrl+Z / Cmd+Z** — undo, see below.
- All Game keyboard listeners read `parseHash()` and no-op when the current
  route isn't `game`, so editing while on About/Rules can't change game state
  in the background.

### Viewport (zoom & move)

- A camera transform owned by App: `Viewport = { zoom, viewX, viewY }`. The
  viewport size in cells is `(cols/zoom, rows/zoom)`, so cells stay square at
  every zoom level (the viewport keeps the world's aspect ratio, matching the
  canvas's letterboxed sub-rectangle).
- Renderer: `setView(viewX, viewY, viewW, viewH)` sets two new shader uniforms
  (`uViewOrigin`, `uViewSize`). The fragment shader maps `vUv -> uViewOrigin +
  vUv * uViewSize`, so cell sampling, grid lines, hover, and stamp preview all
  follow automatically — no per-feature changes needed.
- **Zoom mode (Z)**: mousedown zooms 2× in, shift-mousedown zooms 2× out. Zoom
  is clamped to `[1, min(cols, rows)]` (entire world fits at min; one cell along
  the shorter world axis at max). Zoom centers on the click point: the world
  point under the cursor stays under the cursor after zooming.
- **Move mode (M)**: click + drag pans the viewport; only enabled when
  `zoom > 1`. Pan is clamped so `viewX ∈ [0, cols - viewW]` (and similarly Y),
  so the world never crosses the canvas edges, regardless of the wrap setting.
- The viewport resets to default on Clear / Random / Resize / Load. It is
  preserved across Run / Step / Stop and across edits.
- Mouse→cell mapping (used by hover, paint, stamp) goes through the viewport:
  `col = floor(viewX + gx * viewW)`. Cursor styles (`zoom-in`, `grab`,
  `grabbing`) reflect the active mode.

### Undo (Ctrl/Cmd+Z)

- Unified history for **draw / erase / toggle / stamp** in `src/edit/undo.ts`.
  Each entry stores the cells that actually changed plus their previous values
  (`{ indices: Int32Array, prev: Uint8Array, width, height }`). Undo writes the
  prev values back at each index, so it correctly restores any prior state
  (including overlapping stamps and pre-existing live cells). Edits that don't
  actually change a cell (e.g. drawing on an already-alive cell) are not
  recorded.
- Drag-painting groups one stroke (mousedown → mouseup) into one edit. Stamps
  are one edit per click.
- Capacity: 10 entries plus a soft total-cells cap (~400k cells); FIFO eviction.
- Keyboard: window-level listener for **Ctrl+Z / Cmd+Z** (ignored while typing
  in inputs/selects).
- Cleared on Run, Step, Clear, Random, Width/Height resize, and Load — i.e.
  whenever the simulation advances or the world is reset.
  - A simple single press/release toggles exactly one cell, so click-to-toggle
    still works as before.

## 7. Simulation timing (speed = minimum ms per generation)

- A Run/Stop boolean controls a `requestAnimationFrame` loop. The time is stamped
  just before a generation is processed; the next generation fires once that much
  wall-clock has elapsed.
- **Speed field:** the minimum milliseconds a generation should take (range
  **0..1000**, default **100**), held in a ref so changes take effect live. If a
  generation takes longer than the value to process, the next one runs
  immediately (no negative wait). `0` runs as fast as possible (one step per
  animation frame); `1000` is at most one generation per second. A hint shows the
  approximate max rate (gen/s), or "max" at 0.
- **Run** starts the loop; **Stop** clears it. Rendering of hover/paint still
  works while stopped.

## 8. Buttons

- **Random** → `api.randomizeEx(density, symmetry, noise)` with the current
  generation settings, then refresh. Density is a 0–100% slider; Symmetry is a
  dropdown (None / Mirror X / Mirror Y / Mirror both / Rotate 180° / Rotate 90° /
  Full D4) implemented in the core via canonical-orbit representatives; Noise is a
  dropdown (None white noise / Value / Fractal / Cellular) implemented as
  hash-based noise fields in the core. Reproducible via the seeded PRNG.
- **Clear** → `api.clear();` → re-upload + redraw (sets all cells off).
- **Run** → start the timing loop.
- **Stop** → stop the timing loop.
- **Step** → advance one generation (`api.step()` + redraw); enabled only while
  stopped (disabled while running).
- **Save / Load** → persist the world as a `.gol` JSON file. Both top-level
  sections are independently optional:
  `{ version: 1, world?: { width, height, cells }, settings? }`. The user picks
  which to include with two checkboxes (**Save world data**, default on; **Save
  settings**, default off); the Save button is disabled when both are off.
  Implemented in `src/io/worldFile.ts`: it uses the File System Access API
  (`showSaveFilePicker` / `showOpenFilePicker`) for native name+directory dialogs
  where available, with anchor-download / file-input fallbacks. Load validates
  the file and applies whichever sections are present — present `world` resizes
  and rewrites the grid via the `Uint32Array` view (only on/off state, age
  resets to 1); present `settings` is applied defensively (unknown/invalid
  fields ignored). The `version` field allows future format extensions.
- **Speed** (field, not a button) → see §7; minimum ms/generation, 0..1000.
- **Wrap edges** (checkbox) → calls `api.setWrap(checked)` to toggle toroidal
  edge wraparound in the core. Checked = neighbors wrap around opposite edges (a
  glider leaving one side reappears on the other); unchecked = dead borders
  (default). Initialized from `api.getWrap()` on load.

## 9. Dev/build commands

- `npm install`
- `npm run dev` — Vite dev server (developer runs this manually).
- `npm run build` — outputs `front/dist/` for the back end to serve.

## 10. Resolved decisions

1. **Cell colors:** off = white `#ffffff`, on = dark navy `#0a1a40`
   (vec3(0.039,0.102,0.251)). Both are exposed as named, configurable
   constants/uniforms (e.g. `OFF_COLOR` / `ON_COLOR` in a single `config.ts`)
   so the user can change them later without touching shader logic.
2. **WASM artifact location:** front-dev copies `game.wasm` / `game.js` into the
   Vite build (`front/public/wasm/` → `front/dist/`); the back end serves the
   single `front/dist/` root. (See `back/PROPOSAL.md` §4/§10.)
3. **Hover border highlight color:** a mid-gray/navy accent border, also exposed
   as a configurable constant/uniform (e.g. `HOVER_BORDER_COLOR` in `config.ts`)
   so the user can change it later.

All tunable look-and-feel values (cell colors, hover border color, and the
grid-line color/width) will live in one `src/config.ts` module so they are easy
to find and edit.

## 11. Later additions (implemented)

These were added after the initial build, per user request:

- **Clear button:** sets all cells off via `api.clear()` + redraw.
- **Speed field:** numeric float input in range **1..1000** (default **1**).
  Generation interval = `1000 / value` ms (`speedToIntervalMs` in `config.ts`,
  with `SPEED_MIN` / `SPEED_MAX` / `SPEED_DEFAULT` / `SPEED_STEP`). Input is
  clamped to the range; speed changes apply live without restarting the loop.
- **Drag-to-paint:** holding the mouse button and moving toggles every distinct
  cell the pointer passes over (each cell once per drag, tracked in a `Set`).
  `mouseup` is handled on `window` so the drag ends even off-canvas.
- **Wrap edges checkbox:** toggles toroidal topology in the core via
  `api.setWrap()` / `api.getWrap()` (core functions `life_set_wrap` /
  `life_get_wrap`). Checked = wraparound on; unchecked = dead borders (default).
- **Resizable world (Width/Height fields):** two integer inputs (range
  **1..1000**, default **100**). Committing a field (blur or Enter) calls
  `api.resize(w, h)`, which clamps in the core and **clears** the grid, so the
  simulation is stopped on resize. The canvas keeps the **same on-screen size**
  (square). Cells stay **square** (locked aspect): the renderer draws the grid
  as a centered sub-rectangle where the larger axis fills the canvas and the
  shorter axis is **letterboxed** with a black gap (`GAP_COLOR`, the WebGL clear
  color). Mouse→cell mapping uses the renderer's layout, so clicks in the gap
  are ignored. Grid dimensions, texture size, and the quad are all dynamic.
- **Wrap edges default ON:** the checkbox now defaults to checked, matching the
  core's default toroidal topology.
- **Cell age + color lerp:** the core stores a 32-bit age per cell (see
  `game/PROPOSAL.md`). The cell buffer is read as a `Uint32Array` and uploaded as
  an **RGBA8 texture** (4 bytes = the little-endian age); the fragment shader
  decodes the age and colors a live cell by lerping from the **start color**
  (age 1) to the **end color** over **Color lerp** generations (clamped). Three
  `<input type="color">` pickers set the **empty** (default white), **start**
  (default dark blue `#0a1a40`), and **end** (default wine `#5e1620`) colors,
  and a **Color lerp** integer field (range **1..100000000**, default **100000**)
  sets the lerp length. Colors/lerp are pushed to the renderer as uniforms and
  update live without clearing the grid.
- **Grid-line thickness fix:** grid lines and the hover border are drawn with
  **anti-aliased coverage** (`smoothstep` over one device pixel, using `fwidth()`
  from the `OES_standard_derivatives` extension) so every line has a uniform
  visual width — no thick/thin lines from cells spanning a non-integer number of
  device pixels. The width is a **fraction of a cell** (`GRID_LINE_WIDTH`,
  default **0.05 = 5%**), so lines stay proportional as the world is resized;
  `HOVER_BORDER_WIDTH` is likewise a cell fraction.
- **Cells-over-grid checkbox:** a toggle (`uCellOverGrid` uniform, default off).
  When on, live cells paint over the grid lines within them (live regions look
  solid); when off, grid lines are drawn over everything.
- **Algorithm dropdown:** a select with **Naive** and **Hashlife**, wired
  to `api.setAlgorithm()` / `api.getAlgorithm()` (core `life_set_algorithm` /
  `life_get_algorithm`). Naive (brute-force cell scan) is the default. Hashlife
  uses a persistent quadtree on an infinite plane and does not wrap, so while it
  is selected the **Wrap edges** checkbox is shown unchecked and disabled;
  switching back to Naive restores the user's previous wrap choice (the core
  keeps the wrap value — only the naive engine reads it).
- **Background / Grid color pickers + Show grid:** the empty-cell color picker is
  labeled **Background**. A **Grid** color picker sets the grid line color
  (`uGridLineColor`, default light gray `#cccccc`), and a **Show grid** checkbox
  (`uShowGrid` uniform, default on) toggles grid lines on/off; the Grid color
  picker is disabled while the grid is hidden.
- **Show FPS overlay:** a checkbox (default off) overlays the measured
  generations-per-second (floored int) in red at the world's top-right. It's an
  absolutely-positioned HTML element inset to the world rectangle via percentages
  derived from cols/rows; the font size is `5cqw` (5% of the grid container
  width via CSS container units). The rate is counted in the simulation loop
  (steps per ~500 ms window) and is 0 while stopped.
- **Fast-forward (Gens/step field):** an integer field (1..1e9, default 1) sets
  how many generations each update advances, via `api.stepBy(gens)` (core
  `life_step_by`). With Hashlife this uses memoized power-of-two supersteps so
  large jumps are near-instant on structured patterns; brute force runs that many
  sequential scans. The loop calls `stepBy` once per update (so the FPS overlay
  counts updates/sec; multiply by Gens/step for generations/sec). With gens > 1,
  ages advance approximately (by the jump size).
- **Color interpolation space (Interpolation dropdown):** the age-based start→end
  lerp can run in **sRGB** (naive gamma space, default), **Linear RGB**
  (physically correct), **OKLab** (perceptually uniform), **HSL short** (hue lerp
  shortest path), or **HSL long** (hue lerp the long way — rainbow sweep).
  Selected via a `uLerpSpace` uniform; all conversions (sRGB⇄linear, linear⇄OKLab
  via Björn Ottosson's matrices, and sRGB⇄HSL) happen in the fragment shader, so
  it costs only a few ops per fragment and updates live.
- **Rendering fix:** the fragment shader thresholds cell state with
  `step(0.5/255.0, state)` because the `LUMINANCE`/`UNSIGNED_BYTE` texture
  normalizes a live byte (`1`) to `1/255`, not `1.0`.
