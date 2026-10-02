// Repeatable copy of the built WASM core into public/wasm/ so Vite ships
// game.js + game.wasm as static assets at /wasm/game.js and /wasm/game.wasm.
// Runs automatically via the "predev" and "prebuild" npm scripts.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontRoot = resolve(__dirname, "..");
const srcDir = resolve(frontRoot, "..", "game", "dist");
const destDir = resolve(frontRoot, "public", "wasm");

const files = ["game.js", "game.wasm"];

mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const f of files) {
  const src = resolve(srcDir, f);
  const dest = resolve(destDir, f);
  if (!existsSync(src)) {
    console.error(`[copy-wasm] missing source artifact: ${src}`);
    console.error("[copy-wasm] build the C++/WASM core first (game/build.sh).");
    process.exit(1);
  }
  copyFileSync(src, dest);
  copied++;
  console.log(`[copy-wasm] ${src} -> ${dest}`);
}

console.log(`[copy-wasm] copied ${copied} file(s).`);
