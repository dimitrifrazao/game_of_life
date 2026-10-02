// =============================================================================
// wasm.test.ts — verify the LifeApi interface works correctly (via mock).
// =============================================================================

import { describe, it, expect } from "vitest";
import { createMockLife } from "./mocks/life-mock";

describe("LifeApi (mock)", () => {
  it("initializes with default dimensions", () => {
    const life = createMockLife();
    expect(life.width()).toBe(100);
    expect(life.height()).toBe(100);
    expect(life.cells().length).toBe(10000);
  });

  it("resize clamps to [1, 1000] and clears the grid", () => {
    const life = createMockLife();
    life.set(5, 5, 1);
    life.resize(0, 5000);
    expect(life.width()).toBe(1);
    expect(life.height()).toBe(1000);
    expect(life.cells()[0]).toBe(0); // cleared
  });

  it("set and toggle modify cells correctly", () => {
    const life = createMockLife(10, 10);
    life.set(3, 4, 1);
    expect(life.cells()[3 * 10 + 4]).toBe(1);
    life.toggle(3, 4);
    expect(life.cells()[3 * 10 + 4]).toBe(0);
    life.toggle(3, 4);
    expect(life.cells()[3 * 10 + 4]).toBe(1);
  });

  it("clear sets all cells to 0", () => {
    const life = createMockLife(10, 10);
    life.set(0, 0, 1);
    life.set(9, 9, 1);
    life.clear();
    expect(life.cells().every((v) => v === 0)).toBe(true);
  });

  it("step increments live cell ages", () => {
    const life = createMockLife(10, 10);
    life.set(2, 2, 1);
    expect(life.cells()[2 * 10 + 2]).toBe(1);
    life.step();
    expect(life.cells()[2 * 10 + 2]).toBe(2);
  });

  it("stepBy(n) advances n generations", () => {
    const life = createMockLife(10, 10);
    life.set(0, 0, 1);
    life.stepBy(5);
    expect(life.cells()[0]).toBe(6); // 1 + 5 increments
  });

  it("out-of-range set/toggle are no-ops", () => {
    const life = createMockLife(10, 10);
    life.set(-1, 0, 1);
    life.set(0, 10, 1);
    life.toggle(-1, -1);
    expect(life.cells().every((v) => v === 0)).toBe(true);
  });

  it("wrap get/set round-trips", () => {
    const life = createMockLife();
    expect(life.getWrap()).toBe(true);
    life.setWrap(false);
    expect(life.getWrap()).toBe(false);
  });

  it("algorithm get/set round-trips", () => {
    const life = createMockLife();
    expect(life.getAlgorithm()).toBe(0);
    life.setAlgorithm(1);
    expect(life.getAlgorithm()).toBe(1);
  });

  it("randomizeEx fills approximately density fraction", () => {
    const life = createMockLife(50, 50);
    life.randomizeEx(0.5, 0, 0);
    const alive = life.cells().reduce((s, v) => s + (v ? 1 : 0), 0);
    expect(alive).toBeGreaterThan(500); // ~1250 expected, wide bounds ok
    expect(alive).toBeLessThan(2000);
  });
});
