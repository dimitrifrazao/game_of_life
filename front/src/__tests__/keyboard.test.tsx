// =============================================================================
// keyboard.test.tsx — tests for keyboard shortcuts (Space, Enter, D/E/T/S/Z/M).
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMockLife } from "./mocks/life-mock";
import type { LifeApi } from "../wasm/life";

let mockLife: LifeApi;
vi.mock("../wasm/life", () => ({
  loadLife: () => Promise.resolve(mockLife),
}));
vi.mock("../render/GameCanvas", () => ({
  GameCanvas: vi.fn().mockReturnValue(null),
  VIEWPORT_DEFAULT: { zoom: 1, viewX: 0, viewY: 0 },
  ZOOM_STEP: 2,
}));

const { default: Game } = await import("../pages/Game");

describe("Keyboard shortcuts", () => {
  beforeEach(() => {
    mockLife = createMockLife(10, 10);
    window.location.hash = "#/game";
  });

  it("Space toggles Run/Stop", async () => {
    render(<Game />);
    await waitFor(() => expect(screen.getByText("Run")).not.toBeDisabled());
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(screen.getByText("Run")).toBeDisabled()); // now running
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(screen.getByText("Run")).not.toBeDisabled()); // stopped
  });

  it("Enter steps one gen when stopped", async () => {
    mockLife.set(0, 0, 1);
    render(<Game />);
    await waitFor(() => screen.getByText("Step"));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(mockLife.cells()[0]).toBe(2); // age incremented by mock step()
  });

  it("D/E/T/S/Z/M change the Mouse dropdown", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Mouse"));
    const sel = () => (screen.getByLabelText("Mouse") as HTMLSelectElement).value;
    fireEvent.keyDown(window, { key: "d" });
    expect(sel()).toBe("0"); // MOUSE_DRAW
    fireEvent.keyDown(window, { key: "e" });
    expect(sel()).toBe("1"); // MOUSE_ERASE
    fireEvent.keyDown(window, { key: "t" });
    expect(sel()).toBe("2"); // MOUSE_TOGGLE
    fireEvent.keyDown(window, { key: "s" });
    expect(sel()).toBe("3"); // MOUSE_STAMP
    fireEvent.keyDown(window, { key: "z" });
    expect(sel()).toBe("4"); // MOUSE_ZOOM
    fireEvent.keyDown(window, { key: "m" });
    expect(sel()).toBe("5"); // MOUSE_MOVE
  });

  it("shortcuts are ignored when Ctrl/Cmd is held", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Mouse"));
    const sel = () => (screen.getByLabelText("Mouse") as HTMLSelectElement).value;
    fireEvent.keyDown(window, { key: "d" });
    expect(sel()).toBe("0");
    // Now try with Ctrl — should not switch.
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(sel()).toBe("0"); // still Draw, not Erase
  });
});
