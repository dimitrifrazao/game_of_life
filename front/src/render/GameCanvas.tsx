// =============================================================================
// GameCanvas.tsx — square WebGL canvas + mouse interaction (hover / paint).
//
// Owns the GridRenderer, handles devicePixelRatio sizing, mousemove hover
// highlighting, and drag-to-paint toggling. Exposes an imperative handle so the
// parent (App) can re-upload + redraw after Random / Run / Resize.
//
// The canvas is square but the grid may be non-square; the grid is drawn as a
// centered, square-celled sub-rectangle (letterboxed). Mouse->cell mapping uses
// the renderer's layout so clicks in the letterbox gap are ignored.
// =============================================================================

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { GridRenderer } from "./glRenderer";
import type { LifeApi } from "../wasm/life";
import {
  MOUSE_DRAW,
  MOUSE_ERASE,
  MOUSE_STAMP,
  MOUSE_TOGGLE,
  MOUSE_ZOOM,
  MOUSE_MOVE,
  type Rgb,
} from "../config";
import type { StampData } from "../stamps/patterns";
import type { UndoManager } from "../edit/undo";

/** Viewport (camera) in cell coords. zoom=1 shows the full world. */
export interface Viewport {
  zoom: number;
  viewX: number; // top-left col of the viewport in world cells
  viewY: number; // top-left row of the viewport in world cells
}

export const VIEWPORT_DEFAULT: Viewport = { zoom: 1, viewX: 0, viewY: 0 };
export const ZOOM_STEP = 2;

export interface GameCanvasHandle {
  /** Re-read the cell buffer, upload to texture, and redraw. */
  refresh(): void;
}

interface Props {
  life: LifeApi;
  /** Current grid dimensions (columns x rows). */
  cols: number;
  rows: number;
  /** Empty-cell color. */
  offColor: Rgb;
  /** Live-cell color at age 1. */
  startColor: Rgb;
  /** Live-cell color when fully aged. */
  endColor: Rgb;
  /** Generations to lerp from start to end color. */
  colorLerp: number;
  /** Color interpolation space (0 = sRGB, 1 = linear, 2 = OKLab). */
  lerpSpace: number;
  /** Whether live cells render over the grid lines within them. */
  cellOverGrid: boolean;
  /** Grid line color. */
  gridLineColor: Rgb;
  /** Whether grid lines are shown. */
  showGrid: boolean;
  /** Dying cell color. */
  dyingColor: Rgb;
  /** Whether dying cells are highlighted. */
  showDying: boolean;
  /** Mouse interaction mode (draw / erase / toggle / stamp). */
  mouseMode: number;
  /** Live-cell color (used for the stamp preview tint). */
  /** The stamp pattern to preview/place (used in stamp mode). */
  stamp: StampData;
  /** Whether edges wrap (affects stamp placement and preview). */
  wrap: boolean;
  /** Edit history (records strokes and stamp placements). */
  undo: UndoManager;
  /** Camera viewport (zoom + pan) in cell coords. */
  viewport: Viewport;
  /** Called when zoom/pan changes the viewport. */
  onViewportChange: (v: Viewport) => void;
}

export const GameCanvas = forwardRef<GameCanvasHandle, Props>(function GameCanvas(
  {
    life,
    cols,
    rows,
    offColor,
    startColor,
    endColor,
    colorLerp,
    lerpSpace,
    cellOverGrid,
    gridLineColor,
    showGrid,
    dyingColor,
    showDying,
    mouseMode,
    stamp,
    wrap,
    undo,
    viewport,
    onViewportChange,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GridRenderer | null>(null);

  // Keep the latest dims in refs so event handlers (registered once) read
  // current values without re-binding.
  const colsRef = useRef(cols);
  const rowsRef = useRef(rows);
  colsRef.current = cols;
  rowsRef.current = rows;

  // Latest mouse mode in a ref so the (stable) handlers read current value.
  const mouseModeRef = useRef(mouseMode);
  mouseModeRef.current = mouseMode;

  // Latest stamp + wrap in refs for the stable handlers.
  const stampRef = useRef(stamp);
  stampRef.current = stamp;
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;

  // Latest viewport in a ref so mouse handlers always read fresh values.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Move-mode drag state (null = not dragging).
  const moveDragRef = useRef<
    | {
        startView: Viewport;
        startClientX: number;
        startClientY: number;
        rectWidth: number;
        rectHeight: number;
        moved: boolean;
      }
    | null
  >(null);
  // Re-rendered class for "grabbing" cursor while panning.
  const [dragging, setDragging] = useState(false);
  // Track whether Shift is held so the zoom cursor flips to "zoom-out".
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    // Reset when the window loses focus (we may miss the keyup otherwise).
    const onBlur = () => setShiftHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Helper: clamped viewport given world dims.
  const clampViewport = (v: Viewport, W: number, H: number): Viewport => {
    const maxZoom = Math.min(W, H);
    const zoom = Math.max(1, Math.min(maxZoom, v.zoom));
    const viewW = W / zoom;
    const viewH = H / zoom;
    const viewX = Math.max(0, Math.min(W - viewW, v.viewX));
    const viewY = Math.max(0, Math.min(H - viewH, v.viewY));
    return { zoom, viewX, viewY };
  };

  // Apply the current mouse mode to a cell: draw=on, erase=off, toggle=flip.
  // Only for paint modes (draw/erase/toggle); other modes never call this.
  // Returns whether the cell actually changed and its previous value, so the
  // undo manager can record only meaningful edits.
  const applyCell = (row: number, col: number): { changed: boolean; prev: 0 | 1 } => {
    const mode = mouseModeRef.current;
    const view = life.cells();
    const idx = row * colsRef.current + col;
    const prev: 0 | 1 = view[idx] ? 1 : 0;
    let next: 0 | 1 = prev;
    if (mode === MOUSE_DRAW) next = 1;
    else if (mode === MOUSE_ERASE) next = 0;
    else if (mode === MOUSE_TOGGLE) next = prev ? 0 : 1;
    else return { changed: false, prev }; // not a paint mode
    if (next === prev) return { changed: false, prev };
    if (mode === MOUSE_DRAW || mode === MOUSE_ERASE) life.set(row, col, next);
    else life.toggle(row, col);
    return { changed: true, prev };
  };

  const isPaintMode = (mode: number) =>
    mode === MOUSE_DRAW || mode === MOUSE_ERASE || mode === MOUSE_TOGGLE;

  // Drag-to-paint state: while the mouse is held down, every distinct cell the
  // pointer passes over is toggled once. `paintedRef` tracks which cells we've
  // already toggled during the current drag so we don't flip a cell back and
  // forth when the mouse jitters within it.
  const paintingRef = useRef(false);
  const paintedRef = useRef<Set<number>>(new Set());

  // Re-upload current cells + redraw.
  const refresh = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.uploadCells(life.cells());
    renderer.draw();
  };

  useImperativeHandle(ref, () => ({ refresh }));

  // Initialize the renderer once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new GridRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setDimensions(colsRef.current, rowsRef.current);
    renderer.setOffColor(offColor);
    renderer.setStartColor(startColor);
    renderer.setEndColor(endColor);
    renderer.setColorLerp(colorLerp);
    renderer.setLerpSpace(lerpSpace);
    renderer.setCellOverGrid(cellOverGrid);
    renderer.setGridLineColor(gridLineColor);
    renderer.setShowGrid(showGrid);
    renderer.setDyingColor(dyingColor);
    renderer.setShowDying(showDying);
    renderer.setStampColor(startColor);
    renderer.setStampWrap(wrap);
    renderer.uploadStamp(stamp.cells, stamp.width, stamp.height);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      // Skip while hidden (display:none gives zero-size rects); the next time
      // the canvas becomes visible the App fires a resize event to re-sync.
      if (rect.width === 0 || rect.height === 0) return;
      const pixelW = Math.max(1, Math.round(rect.width * dpr));
      const pixelH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      renderer.resize(pixelW, pixelH);
      renderer.uploadCells(life.cells());
      renderer.draw();
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [life]);

  // Apply dimension changes to the renderer and redraw.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setDimensions(cols, rows);
    renderer.uploadCells(life.cells());
    renderer.draw();
  }, [cols, rows, life]);

  // Apply color / color-lerp changes to the renderer and redraw.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setOffColor(offColor);
    renderer.setStartColor(startColor);
    renderer.setEndColor(endColor);
    renderer.setColorLerp(colorLerp);
    renderer.setLerpSpace(lerpSpace);
    renderer.setCellOverGrid(cellOverGrid);
    renderer.setGridLineColor(gridLineColor);
    renderer.setShowGrid(showGrid);
    renderer.setDyingColor(dyingColor);
    renderer.setShowDying(showDying);
    renderer.setStampColor(startColor);
    renderer.draw();
  }, [offColor, startColor, endColor, colorLerp, lerpSpace, cellOverGrid, gridLineColor, showGrid, dyingColor, showDying]);

  // Re-upload the stamp pattern + wrap when they change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.uploadStamp(stamp.cells, stamp.width, stamp.height);
    renderer.setStampWrap(wrap);
    renderer.draw();
  }, [stamp, wrap]);

  // Hide the stamp preview whenever we leave stamp mode (e.g., the user
  // switches to Draw via dropdown or keyboard while the preview is showing).
  useEffect(() => {
    if (mouseMode === MOUSE_STAMP) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStampActive(false);
    renderer.draw();
  }, [mouseMode]);

  // Push viewport (camera) updates into the renderer.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const W = colsRef.current;
    const H = rowsRef.current;
    const viewW = W / viewport.zoom;
    const viewH = H / viewport.zoom;
    renderer.setView(viewport.viewX, viewport.viewY, viewW, viewH);
    renderer.draw();
  }, [viewport, cols, rows]);

  // Map a mouse event to (row, col) within the grid, or null if outside the
  // grid's drawn sub-rectangle (the letterbox gap returns null). Viewport-aware:
  // returns world cell coords through the current zoom/pan.
  const eventToCell = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): { row: number; col: number } | null => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width; // 0..1 across canvas
    const y = (e.clientY - rect.top) / rect.height; // 0..1 down canvas
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;

    // Convert canvas fraction -> grid-local fraction using the letterbox layout.
    const { offX, offY, fracW, fracH } = renderer.getLayout();
    const gx = (x - offX) / fracW;
    const gy = (y - offY) / fracH;
    if (gx < 0 || gy < 0 || gx >= 1 || gy >= 1) return null; // in the gap

    // Apply the camera viewport.
    const v = viewportRef.current;
    const W = colsRef.current;
    const H = rowsRef.current;
    const viewW = W / v.zoom;
    const viewH = H / v.zoom;
    const col = Math.floor(v.viewX + gx * viewW);
    const row = Math.floor(v.viewY + gy * viewH);
    if (col < 0 || col >= W || row < 0 || row >= H) return null;
    return { row, col };
  };

  // Convert a mouse event to (gx, gy) in the grid sub-rectangle's [0,1] space,
  // or null if outside it. Used by zoom/pan handlers that need precise
  // (sub-cell) screen positions.
  const eventToGridFrac = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): { gx: number; gy: number } | null => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;
    const { offX, offY, fracW, fracH } = renderer.getLayout();
    const gx = (x - offX) / fracW;
    const gy = (y - offY) / fracH;
    if (gx < 0 || gy < 0 || gx >= 1 || gy >= 1) return null;
    return { gx, gy };
  };

  const cellKey = (row: number, col: number) => row * colsRef.current + col;

  // Zoom toward a click point: the world point under (gx,gy) stays under the
  // cursor after the zoom. `zoomIn` true => 2x in, false => 2x out (shift).
  const handleZoomClick = (gx: number, gy: number, zoomIn: boolean) => {
    const W = colsRef.current;
    const H = rowsRef.current;
    const v = viewportRef.current;
    const factor = zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP;
    const target = clampViewport({ ...v, zoom: v.zoom * factor }, W, H);
    if (target.zoom === v.zoom) return; // already at limit, no-op
    // Pworld stays at (gx,gy) on screen.
    const oldViewW = W / v.zoom, oldViewH = H / v.zoom;
    const newViewW = W / target.zoom, newViewH = H / target.zoom;
    const Pworld_x = v.viewX + gx * oldViewW;
    const Pworld_y = v.viewY + gy * oldViewH;
    onViewportChange(
      clampViewport(
        {
          zoom: target.zoom,
          viewX: Pworld_x - gx * newViewW,
          viewY: Pworld_y - gy * newViewH,
        },
        W,
        H
      )
    );
  };

  // Place the current stamp with its top-left at (originRow, originCol).
  // Stamping is additive: only cells that go 0->1 are written and recorded, so
  // pre-existing live cells are never disturbed (and undo only removes the
  // cells this stamp actually added).
  const commitStamp = (originRow: number, originCol: number) => {
    const s = stampRef.current;
    const W = colsRef.current;
    const H = rowsRef.current;
    const wrapOn = wrapRef.current;
    const view = life.cells();
    const indices: number[] = [];
    const prevs: number[] = [];
    const seen = new Set<number>();
    for (let j = 0; j < s.height; j++) {
      for (let i = 0; i < s.width; i++) {
        if (!s.cells[j * s.width + i]) continue;
        let c = originCol + i;
        let r = originRow + j;
        if (wrapOn) {
          c = ((c % W) + W) % W;
          r = ((r % H) + H) % H;
        } else if (c < 0 || c >= W || r < 0 || r >= H) {
          continue; // clip
        }
        const idx = r * W + c;
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (view[idx]) continue; // already alive: don't overwrite or record
        life.set(r, c, 1);
        indices.push(idx);
        prevs.push(0);
      }
    }
    if (indices.length > 0) undo.pushAtomic(W, H, indices, prevs);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const mode = mouseModeRef.current;

    // Move-mode panning: update viewport from the drag delta.
    if (mode === MOUSE_MOVE) {
      const drag = moveDragRef.current;
      if (drag) {
        const W = colsRef.current;
        const H = rowsRef.current;
        const v0 = drag.startView;
        const layout = renderer.getLayout();
        const gridPxW = drag.rectWidth * layout.fracW;
        const gridPxH = drag.rectHeight * layout.fracH;
        const viewW = W / v0.zoom;
        const viewH = H / v0.zoom;
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true;
        const next = clampViewport(
          {
            zoom: v0.zoom,
            viewX: v0.viewX - dx * (viewW / gridPxW),
            viewY: v0.viewY - dy * (viewH / gridPxH),
          },
          W,
          H
        );
        onViewportChange(next);
      }
      // No hover/paint in move mode.
      renderer.setHover(-1, -1);
      renderer.setStampActive(false);
      renderer.draw();
      return;
    }

    // No hover or paint in zoom mode.
    if (mode === MOUSE_ZOOM) {
      renderer.setHover(-1, -1);
      renderer.setStampActive(false);
      renderer.draw();
      return;
    }

    const cell = eventToCell(e);

    // Stamp mode: move the preview to the hovered cell (no painting).
    if (mode === MOUSE_STAMP) {
      if (cell) {
        renderer.setStampActive(true);
        renderer.setStampOrigin(cell.col, cell.row);
      } else {
        renderer.setStampActive(false);
      }
      renderer.setHover(-1, -1);
      renderer.draw();
      return;
    }

    // Hover highlight (paint modes).
    if (cell) {
      renderer.setHover(cell.col, cell.row);
    } else {
      renderer.setHover(-1, -1);
    }

    // Drag-to-paint: edit each new cell the pointer enters during a drag.
    if (paintingRef.current && cell && isPaintMode(mode)) {
      const key = cellKey(cell.row, cell.col);
      if (!paintedRef.current.has(key)) {
        paintedRef.current.add(key);
        const { changed, prev } = applyCell(cell.row, cell.col);
        if (changed) {
          undo.recordCell(cell.row, cell.col, prev);
          renderer.uploadCells(life.cells());
        }
      }
    }

    renderer.draw();
  };

  const onMouseLeave = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setHover(-1, -1);
    renderer.setStampActive(false);
    renderer.draw();
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    // Only react to the primary (left) button.
    if (e.button !== 0) return;
    const mode = mouseModeRef.current;

    // Zoom: click toward the cursor; shift-click to zoom out.
    if (mode === MOUSE_ZOOM) {
      const frac = eventToGridFrac(e);
      if (!frac) return;
      handleZoomClick(frac.gx, frac.gy, !e.shiftKey);
      return;
    }

    // Move (pan): only when zoomed in (viewport smaller than the world).
    if (mode === MOUSE_MOVE) {
      const v = viewportRef.current;
      if (v.zoom <= 1) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      moveDragRef.current = {
        startView: v,
        startClientX: e.clientX,
        startClientY: e.clientY,
        rectWidth: rect.width,
        rectHeight: rect.height,
        moved: false,
      };
      setDragging(true);
      return;
    }

    const cell = eventToCell(e);
    if (!cell) return;

    // Stamp mode: place the stamp once at the click (no drag painting).
    if (mode === MOUSE_STAMP) {
      commitStamp(cell.row, cell.col);
      renderer.uploadCells(life.cells());
      renderer.draw();
      return;
    }

    // Paint modes (draw/erase/toggle): begin a drag stroke.
    if (!isPaintMode(mode)) return;
    paintingRef.current = true;
    paintedRef.current = new Set();
    undo.beginStroke(colsRef.current, rowsRef.current);

    // Edit the cell under the initial press immediately.
    paintedRef.current.add(cellKey(cell.row, cell.col));
    const { changed, prev } = applyCell(cell.row, cell.col);
    if (changed) undo.recordCell(cell.row, cell.col, prev);
    renderer.uploadCells(life.cells());
    renderer.draw();
  };

  // End the drag on mouseup anywhere (the button may be released off-canvas).
  useEffect(() => {
    const endPaint = () => {
      paintingRef.current = false;
      paintedRef.current.clear();
      undo.endStroke();
      if (moveDragRef.current) {
        moveDragRef.current = null;
        setDragging(false);
      }
    };
    window.addEventListener("mouseup", endPaint);
    return () => window.removeEventListener("mouseup", endPaint);
  }, [undo]);

  // CSS class on the canvas for cursor styling, based on current mouse mode.
  const cursorClass =
    mouseMode === MOUSE_ZOOM
      ? shiftHeld
        ? "cursor-zoom-out"
        : "cursor-zoom"
      : mouseMode === MOUSE_MOVE
        ? dragging
          ? "cursor-grabbing"
          : "cursor-grab"
        : "";

  // Force the browser to re-evaluate the cursor when the mode changes while
  // the mouse is stationary (browsers only update the rendered cursor on
  // mousemove). Briefly toggling cursor:none triggers a repaint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = "none";
    const id = requestAnimationFrame(() => {
      canvas.style.cursor = "";
    });
    return () => cancelAnimationFrame(id);
  }, [mouseMode, shiftHeld]);

  return (
    <canvas
      ref={canvasRef}
      className={`game-canvas ${cursorClass}`.trim()}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseLeave={onMouseLeave}
    />
  );
});
