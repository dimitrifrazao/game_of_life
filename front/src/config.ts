// =============================================================================
// config.ts — ALL tunable look-and-feel values live here.
//
// Edit these constants to change the appearance of the grid. Colors are RGB
// triples in the 0..1 range (what WebGL shaders expect). Helper hexToRgb lets
// you express a color as a familiar hex string.
// =============================================================================

export type Rgb = readonly [number, number, number];

/** Convert "#rrggbb" (or "rrggbb") to a normalized [r,g,b] in 0..1. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

/** Convert a normalized [r,g,b] (0..1) back to a "#rrggbb" string. */
export function rgbToHex(rgb: Rgb): string {
  const c = (v: number) => {
    const n = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

// --- Cell colors -------------------------------------------------------------

/** Color of dead/off (empty) cells. Default: white. User-editable. */
export const OFF_COLOR: Rgb = hexToRgb("#ffffff");

/**
 * Start color of a live cell (age 1). Default: rgb(0, 150, 255). User-editable.
 */
export const START_COLOR: Rgb = hexToRgb("#0096ff");

/**
 * End color a live cell lerps toward as it ages. Default: rgb(255, 38, 0).
 * User-editable.
 */
export const END_COLOR: Rgb = hexToRgb("#ff2600");

/**
 * Number of generations over which a live cell's color lerps from START_COLOR
 * (age 1) to END_COLOR. A cell of age >= COLOR_LERP renders as END_COLOR.
 */
export const COLOR_LERP_MIN = 1;
export const COLOR_LERP_MAX = 100000000;
export const COLOR_LERP_DEFAULT = 10;

/** Default dying-cell color (shown when a cell will die next generation). */
export const DYING_COLOR: Rgb = hexToRgb("#ffff00");

/** Whether dying cells are highlighted by default. */
export const SHOW_DYING_DEFAULT = false;

/**
 * Color interpolation space for the age-based start→end lerp:
 *   0 = sRGB        (naive channel-wise, gamma space)
 *   1 = linear-light RGB (physically correct blending)
 *   2 = OKLab       (perceptually uniform)
 *   3 = HSL hue, shortest path around the color wheel
 *   4 = HSL hue, long way around the wheel (rainbow sweep)
 */
export const LERP_SPACE_SRGB = 0;
export const LERP_SPACE_LINEAR = 1;
export const LERP_SPACE_OKLAB = 2;
export const LERP_SPACE_HSL_SHORT = 3;
export const LERP_SPACE_HSL_LONG = 4;
export const LERP_SPACE_DEFAULT = LERP_SPACE_SRGB;

// --- Hover highlight ---------------------------------------------------------

/** Border color drawn around the cell the mouse is hovering over. */
export const HOVER_BORDER_COLOR: Rgb = hexToRgb("#3a4a78");

/**
 * Hover border thickness as a fraction of one cell (e.g. 0.1 = 10% of a cell).
 * Scales with cell size and is anti-aliased for a uniform look.
 */
export const HOVER_BORDER_WIDTH = 0.1;

// --- Grid lines --------------------------------------------------------------

/** Color of the thin grid lines / cell borders. Default: light gray. */
export const GRID_LINE_COLOR: Rgb = hexToRgb("#cccccc");

/**
 * Grid line thickness as a fraction of one cell (e.g. 0.05 = 5% of a cell), so
 * lines stay proportional as the world is resized. Drawn with anti-aliased
 * coverage (screen-space derivatives) so every line is a uniform width.
 */
export const GRID_LINE_WIDTH = 0.05;

/** Whether live cells render over (hide) the grid lines within them. Default off. */
export const CELL_OVER_GRID_DEFAULT = false;

/** Whether the grid lines are shown. Default on. */
export const SHOW_GRID_DEFAULT = true;

/** Whether the FPS (generations/second) overlay is shown. Default off. */
export const SHOW_FPS_DEFAULT = false;

/** Whether the generation counter overlay is shown. Default off. */
export const SHOW_GENERATIONS_DEFAULT = false;

/** FPS overlay font size as a fraction of the world width (~5%). */
export const FPS_FONT_FRACTION = 0.05;

// --- Algorithm ---------------------------------------------------------------

/** Stepping algorithm identifiers (must match the WASM core). */
export const ALGO_BRUTE_FORCE = 0;
export const ALGO_HASHLIFE = 1;
export const ALGO_DEFAULT = ALGO_BRUTE_FORCE;

// --- Grid dimensions ---------------------------------------------------------

/** Default world size (columns x rows). The world is resizable at runtime. */
export const GRID_COLS = 50;
export const GRID_ROWS = 50;

/** Min/max for each world axis (matches the WASM core's clamp). */
export const DIM_MIN = 1;
export const DIM_MAX = 1000;

/**
 * Color of the letterbox gap shown on the short axis when width != height
 * (cells stay square, so the grid does not fill the square canvas). Default
 * black, per spec.
 */
export const GAP_COLOR: Rgb = hexToRgb("#000000");

// --- Simulation timing -------------------------------------------------------

/** Milliseconds between generations while running (~1 generation / second). */
export const STEP_INTERVAL_MS = 1000;

/**
 * Speed field = the MINIMUM time (in milliseconds) one generation should take,
 * measured from the start of processing. After a step we look at how long has
 * elapsed: if it already meets/exceeds the value we run the next generation
 * immediately; otherwise we wait until it does. So:
 *   value = 0    -> run as fast as possible (one step per animation frame)
 *   value = 1000 -> at most one generation per second
 * If a generation takes longer than the value to process (e.g. a huge world),
 * it simply runs as fast as it can.
 */
export const SPEED_MIN = 0;
export const SPEED_MAX = 1000;
export const SPEED_DEFAULT = 100;
export const SPEED_STEP = 1;

/** The minimum generation interval in ms is just the (clamped) speed value. */
export function speedToIntervalMs(value: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

// --- Fast-forward (generations advanced per update) --------------------------

/**
 * How many generations each update advances. 1 = normal (animate every
 * generation). Larger values fast-forward: Hashlife jumps via memoized
 * power-of-two supersteps (near-instant on structured patterns); brute force
 * runs that many sequential scans. Only periodic snapshots are rendered.
 */
export const GENS_PER_STEP_MIN = 1;
export const GENS_PER_STEP_MAX = 1000000000;
export const GENS_PER_STEP_DEFAULT = 1;

// --- Random world generation -------------------------------------------------

/** Live-cell probability for the Random button (0..1). */
export const DENSITY_DEFAULT = 0.5;

/** Symmetry modes (must match the WASM core's gen::Symmetry). */
export const SYM_NONE = 0;
export const SYM_MIRROR_X = 1;
export const SYM_MIRROR_Y = 2;
export const SYM_MIRROR_BOTH = 3;
export const SYM_ROT2 = 4;
export const SYM_ROT4 = 5;
export const SYM_FULL = 6;
export const SYM_DEFAULT = SYM_NONE;

/** Noise fields (must match the WASM core's gen::Noise). */
export const NOISE_NONE = 0;
export const NOISE_VALUE = 1;
export const NOISE_FRACTAL = 2;
export const NOISE_CELLULAR = 3;
export const NOISE_DEFAULT = NOISE_NONE;

// --- Mouse interaction mode --------------------------------------------------

/** What clicking/dragging on a cell does. */
export const MOUSE_DRAW = 0; // turn cells on
export const MOUSE_ERASE = 1; // turn cells off
export const MOUSE_TOGGLE = 2; // flip cells (default)
export const MOUSE_STAMP = 3; // place a stamp pattern
export const MOUSE_ZOOM = 4; // click to zoom in (shift-click out)
export const MOUSE_MOVE = 5; // click + drag to pan the viewport
export const MOUSE_MODE_DEFAULT = MOUSE_TOGGLE;

// --- Layout ------------------------------------------------------------------

/** Maximum rendered size (px) of the square grid; it still fits screen width. */
export const MAX_CANVAS_SIZE_PX = 800;
