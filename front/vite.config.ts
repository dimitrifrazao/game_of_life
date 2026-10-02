import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Production build outputs to front/dist/ (default). The WASM core is shipped
// as a static asset from public/wasm/ (see scripts/copy-wasm.mjs).
export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so asset URLs need that
  // prefix. CI sets BASE_PATH; local dev and previews stay at the root.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // @ts-expect-error -- vitest augments UserConfig at runtime; tsc doesn't see it.
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
