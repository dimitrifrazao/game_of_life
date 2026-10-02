# back/ — Implementation Proposal (back-dev agent)

**Owner:** back-dev (Node.js + TypeScript specialist)
**Status:** Proposal — awaiting orchestrator approval. No code written yet.

## 1. Goal

A simple Node.js + TypeScript static file server so developers can serve the
front end build and the WebAssembly artifact and test the project on localhost.

## 2. Framework choice

Express (tiny, well understood) + TypeScript. Could also use Node's built-in
`http` to keep zero runtime deps; proposed Express for clean static + MIME
handling. Keep dependencies minimal.

## 3. File layout

```
back/
├── PROPOSAL.md
├── package.json
├── tsconfig.json
└── src/
    └── server.ts        Express static server with .wasm MIME handling
```

## 4. What it serves

- The front end production build (`front/dist/`).
- The WebAssembly artifacts (`game.wasm`, `game.js`) are copied into the front
  end build by the front-dev agent, so the back end serves a **single static
  root** (`front/dist/`) with no separate `/wasm` mount.

## 5. WASM MIME handling (critical)

- Serve `.wasm` with `Content-Type: application/wasm` so the browser can use
  `WebAssembly.instantiateStreaming`. Express static `setHeaders`:
  ```ts
  express.static(root, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
    },
  });
  ```
- COOP/COEP headers: only add `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` **if** the build ends up needing
  SharedArrayBuffer (e.g. pthreads). The current game core is single-threaded, so
  these are **not** added by default to keep things simple.

## 6. Config

- Port from `process.env.PORT`, default `3000`. Bind to `localhost`.
- A `--dir` / env option for the static root, defaulting to `../front/dist`.
- SPA fallback: serve `index.html` for unknown non-asset routes.

## 7. TypeScript setup

- `tsconfig.json` targeting `ES2020`, `module: NodeNext`, `outDir: dist`.
- Dev dependency `typescript`, `@types/express`, `@types/node`.

## 8. npm scripts

```json
{
  "build": "tsc",
  "start": "node dist/server.js",
  "dev": "tsc && node dist/server.js"
}
```

(Developer runs `npm run dev` / `npm start` manually; this server is long-running
and should not be auto-launched by the build.)

## 9. Security note

This server is **for localhost development only**. It is unauthenticated and is
not intended to be exposed publicly. This is called out explicitly so it is not
mistaken for a production server.

## 10. Resolved decisions

1. **Static root:** front-dev copies `game.wasm` / `game.js` into its build; the
   back end serves a single root (`front/dist/`). No separate `/wasm` route.
2. **Default port:** `3000`.
3. **Live reload:** not needed. Manual rebuild (`npm run build` / `npm start`)
   is fine for now.
