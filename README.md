# Conway's Game of Life — In-Browser Clone

An in-browser front end clone of [Conway's Game of Life](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life).

## Architecture

The project is split into three packages, each owned by a specialized agent and coordinated by a main orchestrator agent.

| Folder   | Responsibility                                                        | Tech                          |
|----------|-----------------------------------------------------------------------|-------------------------------|
| `game/`  | Core game logic + WebAssembly export                                  | C++ (C++17), Emscripten/WASM  |
| `front/` | UI, rendering, interaction, loading the WASM module                   | React, WebGL                  |
| `back/`  | Local dev server that serves the WASM file and front end assets       | Node.js, TypeScript           |

### Data flow

```
C++ core (game/)  --emcc-->  game.wasm + glue.js
        |                          |
        |  exported C API          v
        +-----------------> front/ (React + WebGL)
                                   ^
                                   |  served over localhost
                            back/ (Node + TS static server)
```

The C++ core exposes a minimal, stable C API (initialize, get cell buffer, step,
randomize, clear, toggle cell, read cell). The front end reads the cell buffer
directly from WASM linear memory and renders it with WebGL. The back end serves
the artifacts for localhost testing.

## Pages

The app is a multi-page single-page-app driven by a tiny hash router (works on
any static host, including GitHub Pages, with no rewrite rules). The layout is
a 3-column shell that fills the viewport — a vertical nav on the left, the
active page in the middle, and (on the Game page) a vertical controls sidebar
on the right.

- **About** (`#/about`) — project and author description (edit `src/pages/About.tsx`).
- **Game** (`#/game`, the default) — the interactive grid + all controls.
- **Rules** (`#/rules`) — Conway's Game of Life rules and pattern types.
- **Controls** (`#/controls`) — reference for every button, setting, and
  keyboard shortcut.
- **Tech** (`#/tech`) — explanations of the engines (naive vs Hashlife), noise
  fields, and color interpolation spaces used in the app.

All three pages stay mounted; switching tabs just hides the others (so the game
keeps running and preserves its state in the background).

## Product requirements

- 100 x 100 cell grid by default. The grid fits horizontally in the screen;
  cells keep a locked 1:1 aspect ratio (identical width and height).
- The world is resizable via **Width** and **Height** integer fields (each
  1–1000, default 100). The canvas keeps the same on-screen size; cells grow or
  shrink to fit. Cells always stay square — when width and height differ, the
  shorter axis is letterboxed with a black gap rather than stretching cells.
- Controls below the grid:
  - **Random** — clears all cells, then fills the grid using the Density,
    Symmetry, and Noise settings below.
  - **Density** — a slider (0–100%) for the live-cell probability of Random.
  - **Symmetry** — a dropdown imposing a symmetry on Random fills: None, Mirror
    X, Mirror Y, Mirror both, Rotate 180°, Rotate 90°, or Full (D4). (Rotational
    modes work best on square worlds.)
  - **Noise** — a dropdown for the Random spatial field: None (white noise),
    Value (smooth blobs), Fractal (organic detail), or Cellular (clustered).
  - **Clear** — sets all cells off.
  - **Run** — starts the simulation.
  - **Stop** — stops the simulation.
  - **Step** — advances a single generation; enabled only while stopped.
  - **Save** / **Load** — save the current world to, or load it from, a `.gol`
    JSON file. The file separates board data from settings:
    `{ version, world?: { width, height, cells }, settings? }`, where `cells` is
    a row-major array of 0/1. Save offers a name + directory dialog (File System
    Access API where available, otherwise a normal download); Load lets you pick
    a file and applies whichever sections it contains.
  - **Save world data** — a checkbox (on by default). When on, Save includes the
    current grid as `world` in the file. Loading a file with `world` resizes the
    grid to its dimensions and writes the cells; cell age resets on load.
  - **Save settings** — a checkbox (off by default). When on, Save also writes
    the current UI settings (speed, gens/step, wrap, algorithm, density,
    symmetry, noise, mouse mode, colors, color lerp, interpolation, and the
    grid/FPS toggles) under the file's `settings` key; loading such a file
    restores them.

    The Save button is disabled while both checkboxes are off — at least one of
    world/settings must be selected.
  - **Speed** — minimum milliseconds per generation (0–1000, default 100). Each
    generation takes at least this long, measured from when processing starts; if
    it already overran (e.g. a very large world), the next one runs immediately.
    `0` runs as fast as possible (one step per animation frame); `1000` is at
    most one generation per second.
  - **Gens/step** — generations advanced per update (1–1,000,000,000, default 1).
    `1` animates every generation. Larger values fast-forward: Hashlife jumps via
    memoized power-of-two supersteps (near-instant on structured patterns and the
    case where it decisively beats brute force); brute force runs that many
    sequential scans. Only periodic snapshots are rendered, and with `gens > 1`
    cell ages advance approximately (by the jump size).
  - **Wrap edges** — a checkbox (on by default). When checked, the grid is
    toroidal: cells at an edge consider neighbors on the opposite side (a glider
    leaving one side reappears on the other). When unchecked, edges are dead
    borders.
  - **Empty / Start / End** — RGB color pickers for the empty-cell color
    (labeled **Background**, default white), the live-cell start color (default
    dark blue), and the live-cell end color (default wine / dark red).
  - **Grid** — RGB color picker for the grid line color (default light gray),
    plus a **Show grid** checkbox (on by default) to toggle the grid lines.
  - **Show FPS** — a checkbox (off by default) that overlays the actual number
    of generations processed per second (floored integer) in red at the
    top-right of the world, sized ~5% of the world width.
  - **Color lerp** — an integer field (1–100,000,000, default 100,000) setting
    how many generations a live cell takes to lerp from the start color to the
    end color.
  - **Interpolation** — a dropdown choosing the color space used for the age
    lerp: **sRGB** (naive gamma-space, default), **Linear RGB** (physically
    correct blending), **OKLab** (perceptually uniform), **HSL (short)** (hue
    lerp, shortest path around the wheel), or **HSL (rainbow)** (hue lerp the
    long way for a full rainbow sweep). Computed in the fragment shader.
  - **Algorithm** — a dropdown to choose the stepping engine: **Naive**
    (default; scans every cell, supports wraparound) or **Hashlife** (Gosper's
    hashed quadtree with a persistent tree on an infinite plane). Hashlife does
    not wrap and lets cells drift off-screen, so the Wrap edges checkbox is
    disabled (and shown off) while it's selected; switching back to Naive
    restores your wrap setting.
- Live cells track an **age**: each on-cell starts at age 1 and gains 1 per
  generation (capped at 1,000,000); turning it off then on resets it to 1. The
  cell's color is the start→end lerp based on its age and the Color lerp value.
- Hovering over a cell highlights that cell's border.
- Clicking and dragging edits cells according to the **Mouse** mode dropdown:
  **Draw** turns cells on, **Erase** turns them off, **Toggle** flips them
  (default). Each distinct cell the pointer passes over during a drag is edited
  once.
- **Stamp** mouse mode places a prebuilt pattern. When selected, three dropdowns
  enable: **Type** (Still life / Oscillators / Spaceships), **Pattern** (10
  smallest/most-popular of that type), and **Rotate** (0/90/180/270°). Pressing
  the **R** key cycles the rotation to the next option. Hovering shows a live
  preview anchored at the cursor; clicking places it. The stamp wraps around
  edges when Wrap edges is on, otherwise it's clipped.
- **Mouse mode shortcuts** — pressing **D** sets Draw, **E** sets Erase, **T**
  sets Toggle, **S** sets Stamp, **Z** sets Zoom, **M** sets Move.
  Case-insensitive; ignored when modifiers (Ctrl/Cmd/Alt) are held or while
  typing in a field.
- **Simulation shortcuts** — **Space** toggles Run/Stop; **Enter** advances one
  generation (only when stopped). Skipped while typing in a field.
- **Stamp shortcuts** (only in Stamp mouse mode) — **R** cycles the rotation,
  **1** cycles the stamp type, **2** cycles to the next pattern within the
  current type.
- All keyboard shortcuts on the Game page are ignored while you're viewing any
  other page.
- **Zoom / Move** — view-transform modes. **Zoom**: click to zoom in 2× toward
  the click point; shift-click to zoom out 2×. Stops at the bounds (entire world
  fits at minimum, one cell fits a screen axis at maximum). **Move**: click and
  drag to pan, available only while zoomed in; the world point under the cursor
  follows the mouse, clamped to the world bounds (no overshoot). Resetting the
  world (Clear / Random / Resize / Load) resets the viewport to zoom 1.
- **Undo** — press **Ctrl+Z** (or **Cmd+Z** on macOS) to undo the last edit
  (draw / erase / toggle stroke, or stamp). Up to 10 edits are remembered. The
  undo history is cleared whenever the simulation advances (Run/Step) or the
  world is reset (Clear / Random / Width or Height change / Load).

## Agents

Custom Kiro agents live in `.kiro/agents/`:

- **main-orchestrator** (Claude Opus 4.8) — oversees the project and coordinates the subagents.
- **game-dev** — C++ game logic + Emscripten/WASM export. Owns `game/`.
- **game-test** — C++ unit testing. Owns `game/test/`.
- **front-dev** — React + WebGL rendering + WASM loading. Owns `front/`.
- **front-test** — React/front end testing (Vitest + RTL). Owns `front/src/__tests__/`.
- **back-dev** — Node.js + TypeScript dev server. Owns `back/`.

All agents have internet access for documentation and best-practice lookups.

## Running locally

### Prerequisites

- **Node.js** (v18+) and **npm**
- **Emscripten SDK** (for building the C++/WASM core)
- **clang++** (for native tests; included with Xcode on macOS)

### One-time setup

```bash
# 1. Install Emscripten (if you don't already have it)
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install latest
~/emsdk/emsdk activate latest

# 2. Install JS dependencies
cd front && npm install && cd ..
cd back && npm install && cd ..
```

### Build and serve

From the project root:

```bash
# Build the C++/WASM core
cd game && ./build.sh && cd ..

# Build the React front end (auto-copies the WASM into front/dist/)
cd front && npm run build && cd ..

# Start the local server
cd back && npm start
```

Then open **http://localhost:3000**.

One-liner (after setup):

```bash
( cd game && ./build.sh ) && ( cd front && npm run build ) && ( cd back && npm start )
```

### Development mode (Vite hot-reload)

If you're only editing the front end:

```bash
cd front && npm run dev
```

Vite prints a localhost URL (usually http://localhost:5173) and hot-reloads on
save. If you change C++ code, re-run `./build.sh` in `game/` and then
`npm run copy-wasm` in `front/` (or restart the dev server).

### Running tests

```bash
# C++ unit tests (21 tests, < 0.5s)
cd game && make test

# Front end tests (24 tests, Vitest + React Testing Library)
cd front && npm test
```

### Notes

- `build.sh` sources `~/emsdk/emsdk_env.sh` automatically, so you don't need
  to activate emsdk in your shell each session.
- The back end is a plain Express static server on port 3000. It serves
  `front/dist/` and `.wasm` files with the correct MIME type. It's for local
  testing only (unauthenticated, not for production).
- For production hosting (e.g. GitHub Pages), you only need the contents of
  `front/dist/`. No server required.

## Deployment (GitHub Pages)

The site is fully static: push to `main` and
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds `front/` and
publishes `front/dist/` to GitHub Pages. In the repo settings, set
**Pages → Build and deployment → Source** to **GitHub Actions** once.

A project site is served from `https://<user>.github.io/<repo>/`, so the build
needs that path prefix. The workflow passes it as `BASE_PATH`, derived from the
repo name, and `front/vite.config.ts` applies it as Vite's `base` (defaulting to
`/` for local dev). Nothing is hardcoded, so renaming the repo still works.

The WASM artifacts `game/dist/game.js` and `game/dist/game.wasm` are committed
on purpose: CI has no Emscripten toolchain, and `front`'s `prebuild` step copies
them into `public/wasm/`. **After changing C++ code, re-run `game/build.sh` and
commit the updated artifacts**, otherwise the deployed site keeps the old core.

Page navigation uses a hash router (`#/game`), so no redirect or 404 rules are
needed.
