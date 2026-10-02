# front/ — Game of Life (React + WebGL + WASM)

In-browser Conway's Game of Life. React + TypeScript + Vite, rendering a
100×100 grid with WebGL by uploading the WASM cell buffer as a texture.

## Prerequisites

The C++/WASM core must be built first so `game/dist/game.js` and
`game/dist/game.wasm` exist (see `../game`). The `copy-wasm` step copies them
into `public/wasm/` so they ship as static assets at `/wasm/game.js` and
`/wasm/game.wasm`.

## Run locally

```bash
npm install
npm run dev      # Vite dev server (runs copy-wasm first via predev)
```

Open the printed local URL.

## Production build

```bash
npm run build    # runs copy-wasm (prebuild), type-checks, outputs front/dist/
```

The build output in `front/dist/` includes `wasm/game.js` and `wasm/game.wasm`.

## Controls

- **Random** — clear, then randomize (~50% live cells).
- **Run** — advance ~1 generation per second.
- **Stop** — pause the loop.
- **Hover** a cell to highlight its border; **click** a cell to toggle it.

## Look & feel

All tunable colors/widths live in `src/config.ts` (cell colors, hover border
color/width, grid-line color/width). They are passed into the shader as
uniforms, so changing them requires no shader edits.
