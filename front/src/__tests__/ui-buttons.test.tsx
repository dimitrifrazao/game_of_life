// =============================================================================
// ui-buttons.test.tsx — integration tests for the Game page buttons (Random,
// Clear, Run, Stop, Step, Save, Load) and their enabled/disabled states.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMockLife } from "./mocks/life-mock";
import type { LifeApi } from "../wasm/life";

// Mock the WASM loader to return our in-memory mock immediately.
let mockLife: LifeApi;
vi.mock("../wasm/life", () => ({
  loadLife: () => Promise.resolve(mockLife),
}));

// Mock the GameCanvas (WebGL can't run in jsdom).
vi.mock("../render/GameCanvas", () => ({
  GameCanvas: vi.fn().mockReturnValue(null),
  VIEWPORT_DEFAULT: { zoom: 1, viewX: 0, viewY: 0 },
  ZOOM_STEP: 2,
}));

// We need to import Game after mocks are set up.
const { default: Game } = await import("../pages/Game");

describe("Game page buttons", () => {
  beforeEach(() => {
    mockLife = createMockLife(10, 10);
    window.location.hash = "#/game";
  });

  it("renders all primary buttons", async () => {
    render(<Game />);
    await waitFor(() => expect(screen.getByText("Random")).toBeInTheDocument());
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.getByText("Step")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Load")).toBeInTheDocument();
  });

  it("Run is enabled and Stop is disabled initially", async () => {
    render(<Game />);
    await waitFor(() => expect(screen.getByText("Run")).not.toBeDisabled());
    expect(screen.getByText("Stop")).toBeDisabled();
    expect(screen.getByText("Step")).not.toBeDisabled();
  });

  it("clicking Run disables Run and enables Stop", async () => {
    render(<Game />);
    await waitFor(() => screen.getByText("Run"));
    fireEvent.click(screen.getByText("Run"));
    expect(screen.getByText("Run")).toBeDisabled();
    expect(screen.getByText("Stop")).not.toBeDisabled();
    expect(screen.getByText("Step")).toBeDisabled();
  });

  it("Clear zeroes all cells", async () => {
    mockLife.set(3, 3, 1);
    render(<Game />);
    await waitFor(() => screen.getByText("Clear"));
    fireEvent.click(screen.getByText("Clear"));
    expect(mockLife.cells().every((v) => v === 0)).toBe(true);
  });

  it("Random fills cells (non-zero count)", async () => {
    render(<Game />);
    await waitFor(() => screen.getByText("Random"));
    fireEvent.click(screen.getByText("Random"));
    const alive = mockLife.cells().reduce((s, v) => s + (v ? 1 : 0), 0);
    expect(alive).toBeGreaterThan(0);
  });
});
