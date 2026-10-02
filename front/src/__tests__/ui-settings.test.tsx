// =============================================================================
// ui-settings.test.tsx — integration tests for settings UI: dropdowns,
// checkboxes, and number inputs.
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

describe("Game page settings", () => {
  beforeEach(() => {
    mockLife = createMockLife(100, 100);
    window.location.hash = "#/game";
  });

  it("Algorithm dropdown defaults to Naive (0) and can switch to Hashlife", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Algorithm"));
    const select = screen.getByLabelText("Algorithm") as HTMLSelectElement;
    expect(select.value).toBe("0");
    fireEvent.change(select, { target: { value: "1" } });
    expect(mockLife.getAlgorithm()).toBe(1);
  });

  it("Wrap edges checkbox starts checked (Naive default) and disables under Hashlife", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Wrap edges"));
    const wrap = screen.getByLabelText("Wrap edges") as HTMLInputElement;
    // Naive is default → wrap is checked and enabled.
    expect(wrap.checked).toBe(true);
    expect(wrap).not.toBeDisabled();
    // Switch to Hashlife → wrap is unchecked and disabled.
    const algo = screen.getByLabelText("Algorithm") as HTMLSelectElement;
    fireEvent.change(algo, { target: { value: "1" } });
    await waitFor(() => expect(wrap).toBeDisabled());
    expect(wrap.checked).toBe(false);
    // Switch back to naive → wrap re-enabled.
    fireEvent.change(algo, { target: { value: "0" } });
    await waitFor(() => expect(wrap).not.toBeDisabled());
  });

  it("Show grid checkbox toggles", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Show grid"));
    const cb = screen.getByLabelText("Show grid") as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });

  it("Show FPS checkbox defaults off", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Show FPS"));
    const cb = screen.getByLabelText("Show FPS") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("Mouse mode dropdown defaults to Toggle", async () => {
    render(<Game />);
    await waitFor(() => screen.getByLabelText("Mouse"));
    const sel = screen.getByLabelText("Mouse") as HTMLSelectElement;
    expect(sel.value).toBe("2"); // MOUSE_TOGGLE = 2
  });
});
