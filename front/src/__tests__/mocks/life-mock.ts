// =============================================================================
// life-mock.ts — in-memory mock of the LifeApi interface for tests. Implements
// the same API surface as the real WASM module but runs in plain JS so it works
// in jsdom without any .wasm binary.
// =============================================================================

import type { LifeApi } from "../../wasm/life";

export function createMockLife(initialW = 100, initialH = 100): LifeApi {
  let w = initialW;
  let h = initialH;
  let buf = new Uint32Array(w * h);
  let wrapOn = true;
  let algo = 0;

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  return {
    width() { return w; },
    height() { return h; },
    resize(nw: number, nh: number) {
      w = clamp(Math.round(nw), 1, 1000);
      h = clamp(Math.round(nh), 1, 1000);
      buf = new Uint32Array(w * h);
    },
    cells() { return buf; },
    clear() { buf.fill(0); },
    randomize() {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.random() > 0.5 ? 1 : 0;
    },
    randomizeEx(density: number, _sym: number, _noise: number) {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.random() < density ? 1 : 0;
    },
    step() {
      // Simplified: just increment all live cells' age (no actual Life rules).
      for (let i = 0; i < buf.length; i++) if (buf[i]) buf[i]++;
    },
    stepBy(gens: number) {
      for (let g = 0; g < gens; g++) this.step();
    },
    toggle(row: number, col: number) {
      if (row < 0 || row >= h || col < 0 || col >= w) return;
      const i = row * w + col;
      buf[i] = buf[i] ? 0 : 1;
    },
    set(row: number, col: number, v: number) {
      if (row < 0 || row >= h || col < 0 || col >= w) return;
      buf[row * w + col] = v ? 1 : 0;
    },
    seed(_s: number) { /* no-op in mock */ },
    setWrap(enabled: boolean) { wrapOn = enabled; },
    getWrap() { return wrapOn; },
    setAlgorithm(a: number) { algo = a; },
    getAlgorithm() { return algo; },
    markDying() { /* no-op in mock */ },
  };
}
