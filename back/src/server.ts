/**
 * Conway's Game of Life — localhost development static file server.
 *
 * ⚠️  DEVELOPMENT ONLY: This server is unauthenticated and is intended solely
 * for serving the front end build on localhost during development. It is NOT
 * hardened for, or intended for, production / public exposure.
 *
 * It serves a single static root (the front end build at ../front/dist), which
 * already contains the WebAssembly artifacts (game.wasm / game.js) copied in by
 * the front-dev build. .wasm files are served with `Content-Type:
 * application/wasm` so the browser can use WebAssembly.instantiateStreaming.
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port from env, default 3000. Bind to localhost only.
const PORT = Number(process.env.PORT) || 3000;
const HOST = "localhost";

// Static root is configurable via STATIC_DIR. Default to ../front/dist resolved
// relative to the compiled server (dist/server.js -> ../front/dist).
const STATIC_DIR = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.resolve(__dirname, "../../front/dist");

const app = express();

// Serve the single static root. Set Content-Type: application/wasm for .wasm
// files so WebAssembly.instantiateStreaming works in the browser.
// NOTE: We intentionally do NOT add COOP/COEP headers — the game core is
// single-threaded, so SharedArrayBuffer is not required. Keep it simple.
app.use(
  express.static(STATIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".wasm")) {
        res.setHeader("Content-Type", "application/wasm");
      }
    },
  })
);

// SPA fallback: serve index.html for unknown non-asset routes. Requests that
// look like asset files (have an extension) fall through to a 404.
app.get("*", (req, res, next) => {
  if (path.extname(req.path)) {
    next();
    return;
  }
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`[game-of-life] Development server running at http://${HOST}:${PORT}`);
  console.log(`[game-of-life] Serving static root: ${STATIC_DIR}`);
  console.log("[game-of-life] DEVELOPMENT ONLY — unauthenticated, not for production use.");
});
