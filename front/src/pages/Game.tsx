// =============================================================================
// App.tsx - layout (square canvas + control buttons) and simulation loop.
//
// Buttons:
//   Random -> life.clear() then life.randomize(), re-upload + redraw.
//   Run    -> start a requestAnimationFrame loop stepping ~1 gen / second.
//   Stop   -> stop the loop.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { GameCanvas, type GameCanvasHandle } from "../render/GameCanvas";
import { VIEWPORT_DEFAULT, type Viewport } from "../render/GameCanvas";
import { loadLife, type LifeApi } from "../wasm/life";
import { saveWorld, pickWorldText, parseWorld, type SettingsData } from "../io/worldFile";
import { parseHash } from "../router";
import {
  getStampData,
  stampNames,
  STAMP_TYPE_LABELS,
} from "../stamps/patterns";
import { UndoManager } from "../edit/undo";
import {
  SPEED_DEFAULT,
  SPEED_MIN,
  SPEED_MAX,
  SPEED_STEP,
  speedToIntervalMs,
  GENS_PER_STEP_MIN,
  GENS_PER_STEP_MAX,
  GENS_PER_STEP_DEFAULT,
  DENSITY_DEFAULT,
  SYM_NONE,
  SYM_MIRROR_X,
  SYM_MIRROR_Y,
  SYM_MIRROR_BOTH,
  SYM_ROT2,
  SYM_ROT4,
  SYM_FULL,
  SYM_DEFAULT,
  NOISE_NONE,
  NOISE_VALUE,
  NOISE_FRACTAL,
  NOISE_CELLULAR,
  NOISE_DEFAULT,
  MOUSE_DRAW,
  MOUSE_ERASE,
  MOUSE_TOGGLE,
  MOUSE_STAMP,
  MOUSE_ZOOM,
  MOUSE_MOVE,
  MOUSE_MODE_DEFAULT,
  GRID_COLS,
  GRID_ROWS,
  DIM_MIN,
  DIM_MAX,
  OFF_COLOR,
  START_COLOR,
  END_COLOR,
  GRID_LINE_COLOR,
  COLOR_LERP_DEFAULT,
  COLOR_LERP_MIN,
  COLOR_LERP_MAX,
  LERP_SPACE_SRGB,
  LERP_SPACE_LINEAR,
  LERP_SPACE_OKLAB,
  LERP_SPACE_HSL_SHORT,
  LERP_SPACE_HSL_LONG,
  LERP_SPACE_DEFAULT,
  CELL_OVER_GRID_DEFAULT,
  SHOW_GRID_DEFAULT,
  SHOW_FPS_DEFAULT,
  FPS_FONT_FRACTION,
  DYING_COLOR,
  SHOW_DYING_DEFAULT,
  SHOW_GENERATIONS_DEFAULT,
  ALGO_BRUTE_FORCE,
  ALGO_HASHLIFE,
  ALGO_DEFAULT,
  hexToRgb,
  rgbToHex,
  type Rgb,
} from "../config";

export default function Game() {
  const [life, setLife] = useState<LifeApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEED_DEFAULT);
  const [wrap, setWrap] = useState<boolean>(true);

  // Generations advanced per update (fast-forward). Held in a ref so the
  // running loop reads live changes.
  const [gensPerStep, setGensPerStep] = useState<number>(GENS_PER_STEP_DEFAULT);
  const [gensPerStepDraft, setGensPerStepDraft] = useState<string>(
    String(GENS_PER_STEP_DEFAULT)
  );
  const gensPerStepRef = useRef<number>(GENS_PER_STEP_DEFAULT);
  useEffect(() => {
    gensPerStepRef.current = gensPerStep;
  }, [gensPerStep]);

  // World dimensions (committed) + the editable field drafts.
  const [cols, setCols] = useState<number>(GRID_COLS);
  const [rows, setRows] = useState<number>(GRID_ROWS);
  const [colsDraft, setColsDraft] = useState<string>(String(GRID_COLS));
  const [rowsDraft, setRowsDraft] = useState<string>(String(GRID_ROWS));

  // Cell colors + color-lerp (generations from start to end color).
  const [offColor, setOffColor] = useState<Rgb>(OFF_COLOR);
  const [startColor, setStartColor] = useState<Rgb>(START_COLOR);
  const [endColor, setEndColor] = useState<Rgb>(END_COLOR);
  const [colorLerp, setColorLerp] = useState<number>(COLOR_LERP_DEFAULT);
  const [colorLerpDraft, setColorLerpDraft] = useState<string>(
    String(COLOR_LERP_DEFAULT)
  );
  const [lerpSpace, setLerpSpace] = useState<number>(LERP_SPACE_DEFAULT);
  const [cellOverGrid, setCellOverGrid] = useState<boolean>(
    CELL_OVER_GRID_DEFAULT
  );
  const [gridLineColor, setGridLineColor] = useState<Rgb>(GRID_LINE_COLOR);
  const [showGrid, setShowGrid] = useState<boolean>(SHOW_GRID_DEFAULT);
  const [algorithm, setAlgorithm] = useState<number>(ALGO_DEFAULT);

  // Dying cell highlighting.
  const [showDying, setShowDying] = useState<boolean>(SHOW_DYING_DEFAULT);
  const [dyingColor, setDyingColor] = useState<Rgb>(DYING_COLOR);

  // Generation counter.
  const [showGenerations, setShowGenerations] = useState<boolean>(SHOW_GENERATIONS_DEFAULT);
  const [generation, setGeneration] = useState<number>(0);

  // FPS overlay: actual generations processed per second (floored).
  const [showFps, setShowFps] = useState<boolean>(SHOW_FPS_DEFAULT);
  const [fps, setFps] = useState<number>(0);
  const fpsCountRef = useRef<number>(0);
  const fpsWindowRef = useRef<number>(0);

  // Random world generation settings.
  const [density, setDensity] = useState<number>(DENSITY_DEFAULT);
  const [symmetry, setSymmetry] = useState<number>(SYM_DEFAULT);
  const [noise, setNoise] = useState<number>(NOISE_DEFAULT);

  // Mouse interaction mode (draw / erase / toggle).
  const [mouseMode, setMouseMode] = useState<number>(MOUSE_MODE_DEFAULT);

  // Stamp tool: type (still/osc/ship), pattern index, rotation (0/90/180/270).
  const [stampType, setStampType] = useState<number>(0);
  const [stampPattern, setStampPattern] = useState<number>(0);
  const [stampRotation, setStampRotation] = useState<number>(0);
  const stamp = useMemo(
    () => getStampData(stampType, stampPattern, stampRotation),
    [stampType, stampPattern, stampRotation]
  );

  // Camera viewport (zoom + pan). Reset on world replacement.
  const [viewport, setViewport] = useState<Viewport>(VIEWPORT_DEFAULT);
  const resetViewport = () => setViewport(VIEWPORT_DEFAULT);

  const canvasRef = useRef<GameCanvasHandle>(null);
  const rafRef = useRef<number | null>(null);
  const lastStepRef = useRef<number>(0);

  // Undo history (lazy init so we don't reallocate per render).
  const undoRef = useRef<UndoManager | null>(null);
  if (!undoRef.current) undoRef.current = new UndoManager();
  const undo = undoRef.current;

  // Stamp-mode keyboard shortcuts: R rotates, 1 cycles the type, 2 cycles the
  // pattern within the current type.
  useEffect(() => {
    if (mouseMode !== MOUSE_STAMP) return;
    const onKey = (e: KeyboardEvent) => {
      if (parseHash() !== "game") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Ignore when typing in an input/select/textarea.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "r" || e.key === "R") {
        setStampRotation((r) => (r + 90) % 360);
      } else if (e.key === "1") {
        // Cycle to the next stamp type; reset the pattern index like the
        // dropdown does so we don't land past the new type's length.
        setStampType((t) => (t + 1) % STAMP_TYPE_LABELS.length);
        setStampPattern(0);
      } else if (e.key === "2") {
        setStampPattern((p) => (p + 1) % stampNames(stampType).length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mouseMode, stampType]);

  // Space toggles Run/Stop; Enter steps one generation (only while stopped).
  useEffect(() => {
    if (!life) return;
    const onKey = (e: KeyboardEvent) => {
      if (parseHash() !== "game") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        if (running) {
          setRunning(false);
        } else {
          undo.clear();
          setRunning(true);
        }
      } else if (e.key === "Enter") {
        if (running) return;
        e.preventDefault();
        undo.clear();
        life.step();
        if (showDyingRef.current) life.markDying();
        setGeneration((g) => g + 1);
        canvasRef.current?.refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [life, running, undo]);

  // Mouse-mode keyboard shortcuts: d=draw, e=erase, t=toggle, s=stamp.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (parseHash() !== "game") return;
      // Skip when a modifier is held (so Ctrl+S, Cmd+S, etc. behave normally).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Skip when typing in an input/select/textarea.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      switch (e.key.toLowerCase()) {
        case "d":
          setMouseMode(MOUSE_DRAW);
          break;
        case "e":
          setMouseMode(MOUSE_ERASE);
          break;
        case "t":
          setMouseMode(MOUSE_TOGGLE);
          break;
        case "s":
          setMouseMode(MOUSE_STAMP);
          break;
        case "z":
          setMouseMode(MOUSE_ZOOM);
          break;
        case "m":
          setMouseMode(MOUSE_MOVE);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Z: undo the most recent edit (any mouse mode).
  useEffect(() => {
    if (!life) return;
    const onKey = (e: KeyboardEvent) => {
      if (parseHash() !== "game") return;
      const isUndo =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z");
      if (!isUndo) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const edit = undo.pop();
      if (!edit) return;
      // Defensive: world dims should match (we clear undo on resize/load).
      if (edit.width !== life.width() || edit.height !== life.height()) return;
      for (let i = 0; i < edit.indices.length; i++) {
        const idx = edit.indices[i];
        const r = (idx / edit.width) | 0;
        const c = idx % edit.width;
        life.set(r, c, edit.prev[i]);
      }
      canvasRef.current?.refresh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [life, undo]);

  // Whether Save includes UI settings (off by default).
  const [saveSettings, setSaveSettings] = useState<boolean>(false);

  // Whether Save includes the world data (on by default).
  const [saveWorldData, setSaveWorldData] = useState<boolean>(true);

  // Keep the latest speed in a ref so the running loop reads live updates
  // without needing to restart when the user changes the field.
  const intervalRef = useRef<number>(speedToIntervalMs(SPEED_DEFAULT));
  useEffect(() => {
    intervalRef.current = speedToIntervalMs(speed);
  }, [speed]);

  // Show-dying ref for the loop.
  const showDyingRef = useRef(showDying);
  useEffect(() => { showDyingRef.current = showDying; }, [showDying]);

  // Load the WASM core once on mount.
  useEffect(() => {
    let cancelled = false;
    loadLife()
      .then((api) => {
        if (!cancelled) {
          setLife(api);
          // Reflect the core's initial wrap state in the checkbox.
          setWrap(api.getWrap());
          setAlgorithm(api.getAlgorithm());
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Simulation loop: each generation takes at least `intervalRef` ms (the speed
  // value). We stamp the time just before processing; the next step fires once
  // that much wall-clock has elapsed - immediately if processing already overran
  // it. A value of 0 steps every animation frame (as fast as possible).
  useEffect(() => {
    if (!running || !life) return;

    lastStepRef.current = performance.now();
    fpsCountRef.current = 0;
    fpsWindowRef.current = performance.now();

    const tick = (now: number) => {
      if (now - lastStepRef.current >= intervalRef.current) {
        lastStepRef.current = now;
        life.stepBy(gensPerStepRef.current);
        if (showDyingRef.current) life.markDying();
        setGeneration((g) => g + gensPerStepRef.current);
        canvasRef.current?.refresh();
        fpsCountRef.current += 1;
      }
      // Publish the generations/second roughly twice a second.
      const elapsed = now - fpsWindowRef.current;
      if (elapsed >= 500) {
        setFps(Math.floor((fpsCountRef.current * 1000) / elapsed));
        fpsCountRef.current = 0;
        fpsWindowRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setFps(0); // no updates while stopped
    };
  }, [running, life]);

  const onRandom = () => {
    if (!life) return;
    life.randomizeEx(density, symmetry, noise);
    undo.clear();
    resetViewport();
    setGeneration(0);
    canvasRef.current?.refresh();
  };

  const onClear = () => {
    if (!life) return;
    life.clear();
    undo.clear();
    resetViewport();
    setGeneration(0);
    canvasRef.current?.refresh();
  };

  const onRun = () => {
    undo.clear();
    setRunning(true);
  };
  const onStop = () => setRunning(false);

  // Advance exactly one generation (only meaningful while stopped).
  const onStep = () => {
    if (!life || running) return;
    undo.clear();
    life.step();
    if (showDyingRef.current) life.markDying();
    setGeneration((g) => g + 1);
    canvasRef.current?.refresh();
  };

  // Gather the current UI settings into a plain JSON object (colors as hex).
  const collectSettings = (): SettingsData => ({
    speed,
    gensPerStep,
    wrap,
    algorithm,
    density,
    symmetry,
    noise,
    mouseMode,
    offColor: rgbToHex(offColor),
    startColor: rgbToHex(startColor),
    endColor: rgbToHex(endColor),
    gridLineColor: rgbToHex(gridLineColor),
    colorLerp,
    lerpSpace,
    cellOverGrid,
    showGrid,
    showFps,
  });

  // Apply a settings object from a loaded file, defensively (ignore bad fields).
  const applySettings = (s: SettingsData) => {
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
    const hex = (v: unknown) => (typeof v === "string" ? v : undefined);
    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v));

    let v: number | undefined;
    let b: boolean | undefined;
    let h: string | undefined;

    if ((v = num(s.speed)) !== undefined) setSpeed(clamp(v, SPEED_MIN, SPEED_MAX));
    if ((v = num(s.gensPerStep)) !== undefined) {
      const g = clamp(Math.floor(v), GENS_PER_STEP_MIN, GENS_PER_STEP_MAX);
      setGensPerStep(g);
      setGensPerStepDraft(String(g));
    }
    if ((b = bool(s.wrap)) !== undefined) {
      life?.setWrap(b);
      setWrap(b);
    }
    if ((v = num(s.algorithm)) !== undefined) {
      const a = v === ALGO_HASHLIFE ? ALGO_HASHLIFE : ALGO_BRUTE_FORCE;
      life?.setAlgorithm(a);
      setAlgorithm(a);
    }
    if ((v = num(s.density)) !== undefined) setDensity(clamp(v, 0, 1));
    if ((v = num(s.symmetry)) !== undefined) setSymmetry(v);
    if ((v = num(s.noise)) !== undefined) setNoise(v);
    if ((v = num(s.mouseMode)) !== undefined) setMouseMode(v);
    if ((h = hex(s.offColor)) !== undefined) setOffColor(hexToRgb(h));
    if ((h = hex(s.startColor)) !== undefined) setStartColor(hexToRgb(h));
    if ((h = hex(s.endColor)) !== undefined) setEndColor(hexToRgb(h));
    if ((h = hex(s.gridLineColor)) !== undefined) setGridLineColor(hexToRgb(h));
    if ((v = num(s.colorLerp)) !== undefined) {
      const c = clamp(Math.floor(v), COLOR_LERP_MIN, COLOR_LERP_MAX);
      setColorLerp(c);
      setColorLerpDraft(String(c));
    }
    if ((v = num(s.lerpSpace)) !== undefined) setLerpSpace(v);
    if ((b = bool(s.cellOverGrid)) !== undefined) setCellOverGrid(b);
    if ((b = bool(s.showGrid)) !== undefined) setShowGrid(b);
    if ((b = bool(s.showFps)) !== undefined) setShowFps(b);
  };

  // Save the current world to a .gol JSON file (settings included if opted in).
  const onSave = async () => {
    if (!life) return;
    if (!saveWorldData && !saveSettings) {
      alert("Select at least one of 'Save world data' or 'Save settings'.");
      return;
    }
    setRunning(false);
    try {
      await saveWorld(life, {
        includeWorld: saveWorldData,
        settings: saveSettings ? collectSettings() : null,
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to save world: ${(err as Error).message}`);
    }
  };

  // Load a .gol JSON file. Either world / settings / both may be present;
  // each section is applied only when present.
  const onLoad = async () => {
    if (!life) return;
    let text: string | null;
    try {
      text = await pickWorldText();
    } catch (err) {
      console.error(err);
      return;
    }
    if (text == null) return; // cancelled
    try {
      const file = parseWorld(text);
      setRunning(false);
      if (file.world) {
        const { width, height, cells } = file.world;
        life.resize(width, height); // clears + marks core dirty
        undo.clear();
        resetViewport();
        setGeneration(0);
        const view = life.cells(); // fresh Uint32Array over the resized buffer
        for (let i = 0; i < view.length; i++) view[i] = cells[i] ? 1 : 0;
        setCols(width);
        setRows(height);
        setColsDraft(String(width));
        setRowsDraft(String(height));
      }
      if (file.settings) applySettings(file.settings);
      // Render after React commits any dimension change so the texture is
      // sized correctly. (Skipped if neither world nor settings affects the
      // rendered grid, but harmless either way.)
      requestAnimationFrame(() => canvasRef.current?.refresh());
    } catch (err) {
      console.error(err);
      alert(`Failed to load world: ${(err as Error).message}`);
    }
  };

  const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    if (Number.isNaN(raw)) {
      setSpeed(SPEED_MIN);
      return;
    }
    setSpeed(Math.min(SPEED_MAX, Math.max(SPEED_MIN, raw)));
  };

  const onWrapChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!life) return;
    const enabled = e.target.checked;
    life.setWrap(enabled);
    setWrap(enabled);
  };

  const onAlgorithmChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!life) return;
    const algo = parseInt(e.target.value, 10);
    life.setAlgorithm(algo);
    setAlgorithm(algo);
  };

  // Resize the world to the committed dimensions. This CLEARS the grid (the
  // core reallocates), so stop the simulation first.
  const applyResize = (newCols: number, newRows: number) => {
    if (!life) return;
    setRunning(false);
    life.resize(newCols, newRows);
    undo.clear();
    resetViewport();
    setGeneration(0);
    // Read back the clamped values the core actually applied.
    const w = life.width();
    const h = life.height();
    setCols(w);
    setRows(h);
    setColsDraft(String(w));
    setRowsDraft(String(h));
    canvasRef.current?.refresh();
  };

  // Parse a draft field, clamp to [DIM_MIN, DIM_MAX], and commit if changed.
  const commitDim = (axis: "cols" | "rows", draft: string) => {
    const parsed = parseInt(draft, 10);
    const current = axis === "cols" ? cols : rows;
    if (Number.isNaN(parsed)) {
      // Revert the draft to the current committed value.
      if (axis === "cols") setColsDraft(String(cols));
      else setRowsDraft(String(rows));
      return;
    }
    const clamped = Math.min(DIM_MAX, Math.max(DIM_MIN, parsed));
    if (clamped === current) {
      // Normalize the draft text (e.g. "0050" -> "50") even if unchanged.
      if (axis === "cols") setColsDraft(String(cols));
      else setRowsDraft(String(rows));
      return;
    }
    if (axis === "cols") applyResize(clamped, rows);
    else applyResize(cols, clamped);
  };

  const onDimKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    axis: "cols" | "rows"
  ) => {
    if (e.key === "Enter") {
      commitDim(axis, (e.target as HTMLInputElement).value);
      (e.target as HTMLInputElement).blur();
    }
  };

  // Commit the color-lerp field, clamped to [COLOR_LERP_MIN, COLOR_LERP_MAX].
  const commitColorLerp = (draft: string) => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setColorLerpDraft(String(colorLerp));
      return;
    }
    const clamped = Math.min(COLOR_LERP_MAX, Math.max(COLOR_LERP_MIN, parsed));
    setColorLerp(clamped);
    setColorLerpDraft(String(clamped));
  };

  // Commit the generations-per-step field, clamped to its range.
  const commitGensPerStep = (draft: string) => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setGensPerStepDraft(String(gensPerStep));
      return;
    }
    const clamped = Math.min(
      GENS_PER_STEP_MAX,
      Math.max(GENS_PER_STEP_MIN, parsed)
    );
    setGensPerStep(clamped);
    setGensPerStepDraft(String(clamped));
  };

  return (
    <div className="game-layout">
      <section className="game-center">
        <div className="grid-wrap">
          {error ? (
            <div className="error">
              Failed to load the WASM core: {error}
              <br />
              Make sure <code>/wasm/game.js</code> and{" "}
              <code>/wasm/game.wasm</code> are present (run{" "}
              <code>npm run copy-wasm</code>).
            </div>
          ) : life ? (
            <GameCanvas
              ref={canvasRef}
              life={life}
              cols={cols}
              rows={rows}
              offColor={offColor}
              startColor={startColor}
              endColor={endColor}
              colorLerp={colorLerp}
              lerpSpace={lerpSpace}
              cellOverGrid={cellOverGrid}
              gridLineColor={gridLineColor}
              showGrid={showGrid}
              dyingColor={dyingColor}
              showDying={showDying}
              mouseMode={mouseMode}
              stamp={stamp}
              wrap={wrap}
              undo={undo}
              viewport={viewport}
              onViewportChange={setViewport}
            />
          ) : (
            <div className="loading">Loading WASM core…</div>
          )}
          {showFps && life && !error && (
            <div
              className="fps-overlay"
              style={{
                top: `${((1 - rows / Math.max(cols, rows)) / 2) * 100}%`,
                right: `${((1 - cols / Math.max(cols, rows)) / 2) * 100}%`,
                fontSize: `${FPS_FONT_FRACTION * 100}cqw`,
              }}
            >
              {fps}
            </div>
          )}
          {showGenerations && life && !error && (
            <div
              className="gen-overlay"
              style={{
                bottom: `${((1 - rows / Math.max(cols, rows)) / 2) * 100}%`,
                right: `${((1 - cols / Math.max(cols, rows)) / 2) * 100}%`,
                fontSize: `${FPS_FONT_FRACTION * 100}cqw`,
              }}
            >
              Gen {generation}
            </div>
          )}
        </div>
      </section>

      <aside className="game-sidebar">
        <div className="controls">
        <button onClick={onRandom} disabled={!life}>
          Random
        </button>
        <button onClick={onClear} disabled={!life}>
          Clear
        </button>
        <button onClick={onRun} disabled={!life || running}>
          Run
        </button>
        <button onClick={onStop} disabled={!life || !running}>
          Stop
        </button>
        <button onClick={onStep} disabled={!life || running}>
          Step
        </button>
        <button onClick={onSave} disabled={!life || (!saveWorldData && !saveSettings)}>
          Save
        </button>
        <button onClick={onLoad} disabled={!life}>
          Load
        </button>
        <label className="wrap-field">
          <input
            type="checkbox"
            checked={saveWorldData}
            onChange={(e) => setSaveWorldData(e.target.checked)}
            disabled={!life}
          />
          Save world data
        </label>
        <label className="wrap-field">
          <input
            type="checkbox"
            checked={saveSettings}
            onChange={(e) => setSaveSettings(e.target.checked)}
            disabled={!life}
          />
          Save settings
        </label>

        <label className="speed-field">
          Speed
          <input
            type="number"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={speed}
            onChange={onSpeedChange}
            disabled={!life}
          />
          <span className="speed-hint">
            {speed <= 0 ? "max" : `≤ ${(1000 / speed).toFixed(1)} gen/s`}
          </span>
        </label>

        <label className="dim-field">
          Gens/step
          <input
            type="number"
            min={GENS_PER_STEP_MIN}
            max={GENS_PER_STEP_MAX}
            step={1}
            value={gensPerStepDraft}
            onChange={(e) => setGensPerStepDraft(e.target.value)}
            onBlur={(e) => commitGensPerStep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitGensPerStep((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={!life}
          />
        </label>

        <label className="wrap-field">
          <input
            type="checkbox"
            checked={algorithm === ALGO_HASHLIFE ? false : wrap}
            onChange={onWrapChange}
            disabled={!life || algorithm === ALGO_HASHLIFE}
            title={
              algorithm === ALGO_HASHLIFE
                ? "Hashlife runs on an infinite plane and does not wrap"
                : undefined
            }
          />
          Wrap edges
        </label>

        <label className="algo-field">
          Algorithm
          <select
            value={algorithm}
            onChange={onAlgorithmChange}
            disabled={!life}
          >
            <option value={ALGO_BRUTE_FORCE}>Naive</option>
            <option value={ALGO_HASHLIFE}>Hashlife</option>
          </select>
        </label>

        <label className="dim-field">
          Width
          <input
            type="number"
            min={DIM_MIN}
            max={DIM_MAX}
            step={1}
            value={colsDraft}
            onChange={(e) => setColsDraft(e.target.value)}
            onBlur={(e) => commitDim("cols", e.target.value)}
            onKeyDown={(e) => onDimKeyDown(e, "cols")}
            disabled={!life}
          />
        </label>

        <label className="dim-field">
          Height
          <input
            type="number"
            min={DIM_MIN}
            max={DIM_MAX}
            step={1}
            value={rowsDraft}
            onChange={(e) => setRowsDraft(e.target.value)}
            onBlur={(e) => commitDim("rows", e.target.value)}
            onKeyDown={(e) => onDimKeyDown(e, "rows")}
            disabled={!life}
          />
        </label>
      </div>

      <div className="controls">
        <label className="dim-field">
          Density
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(density * 100)}
            onChange={(e) => setDensity(parseInt(e.target.value, 10) / 100)}
            disabled={!life}
          />
          <span className="speed-hint">{Math.round(density * 100)}%</span>
        </label>

        <label className="algo-field">
          Symmetry
          <select
            value={symmetry}
            onChange={(e) => setSymmetry(parseInt(e.target.value, 10))}
            disabled={!life}
          >
            <option value={SYM_NONE}>None</option>
            <option value={SYM_MIRROR_X}>Mirror X</option>
            <option value={SYM_MIRROR_Y}>Mirror Y</option>
            <option value={SYM_MIRROR_BOTH}>Mirror both</option>
            <option value={SYM_ROT2}>Rotate 180°</option>
            <option value={SYM_ROT4}>Rotate 90°</option>
            <option value={SYM_FULL}>Full (D4)</option>
          </select>
        </label>

        <label className="algo-field">
          Noise
          <select
            value={noise}
            onChange={(e) => setNoise(parseInt(e.target.value, 10))}
            disabled={!life}
          >
            <option value={NOISE_NONE}>None</option>
            <option value={NOISE_VALUE}>Value</option>
            <option value={NOISE_FRACTAL}>Fractal</option>
            <option value={NOISE_CELLULAR}>Cellular</option>
          </select>
        </label>

        <label className="algo-field">
          Mouse
          <select
            value={mouseMode}
            onChange={(e) => setMouseMode(parseInt(e.target.value, 10))}
            disabled={!life}
          >
            <option value={MOUSE_DRAW}>Draw</option>
            <option value={MOUSE_ERASE}>Erase</option>
            <option value={MOUSE_TOGGLE}>Toggle</option>
            <option value={MOUSE_STAMP}>Stamp</option>
            <option value={MOUSE_ZOOM}>Zoom</option>
            <option value={MOUSE_MOVE}>Move</option>
          </select>
        </label>

        <label className="algo-field">
          Type
          <select
            value={stampType}
            onChange={(e) => {
              setStampType(parseInt(e.target.value, 10));
              setStampPattern(0);
            }}
            disabled={!life || mouseMode !== MOUSE_STAMP}
          >
            {STAMP_TYPE_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="algo-field">
          Pattern
          <select
            value={stampPattern}
            onChange={(e) => setStampPattern(parseInt(e.target.value, 10))}
            disabled={!life || mouseMode !== MOUSE_STAMP}
          >
            {stampNames(stampType).map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="algo-field">
          Rotate
          <select
            value={stampRotation}
            onChange={(e) => setStampRotation(parseInt(e.target.value, 10))}
            disabled={!life || mouseMode !== MOUSE_STAMP}
          >
            <option value={0}>0°</option>
            <option value={90}>90°</option>
            <option value={180}>180°</option>
            <option value={270}>270°</option>
          </select>
        </label>
      </div>

      <div className="controls">
        <label className="color-field">
          Background
          <input
            type="color"
            value={rgbToHex(offColor)}
            onChange={(e) => setOffColor(hexToRgb(e.target.value))}
            disabled={!life}
          />
        </label>

        <label className="color-field">
          Start
          <input
            type="color"
            value={rgbToHex(startColor)}
            onChange={(e) => setStartColor(hexToRgb(e.target.value))}
            disabled={!life}
          />
        </label>

        <label className="color-field">
          End
          <input
            type="color"
            value={rgbToHex(endColor)}
            onChange={(e) => setEndColor(hexToRgb(e.target.value))}
            disabled={!life}
          />
        </label>

        <label className="color-field">
          Grid
          <input
            type="color"
            value={rgbToHex(gridLineColor)}
            onChange={(e) => setGridLineColor(hexToRgb(e.target.value))}
            disabled={!life || !showGrid}
          />
        </label>

        <label className="wrap-field">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            disabled={!life}
          />
          Show grid
        </label>

        <label className="wrap-field">
          <input
            type="checkbox"
            checked={showDying}
            onChange={(e) => setShowDying(e.target.checked)}
            disabled={!life}
          />
          Show dying
        </label>
        {showDying && (
          <label className="color-field">
            Dying color
            <input
              type="color"
              value={rgbToHex(dyingColor)}
              onChange={(e) => setDyingColor(hexToRgb(e.target.value))}
              disabled={!life}
            />
          </label>
        )}

        <label className="wrap-field">
          <input
            type="checkbox"
            checked={showFps}
            onChange={(e) => setShowFps(e.target.checked)}
            disabled={!life}
          />
          Show FPS
        </label>

        <label className="wrap-field">
          <input
            type="checkbox"
            checked={showGenerations}
            onChange={(e) => setShowGenerations(e.target.checked)}
            disabled={!life}
          />
          Show generations
        </label>

        <label className="dim-field">
          Color lerp
          <input
            type="number"
            min={COLOR_LERP_MIN}
            max={COLOR_LERP_MAX}
            step={1}
            value={colorLerpDraft}
            onChange={(e) => setColorLerpDraft(e.target.value)}
            onBlur={(e) => commitColorLerp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitColorLerp((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={!life}
          />
        </label>

        <label className="algo-field">
          Interpolation
          <select
            value={lerpSpace}
            onChange={(e) => setLerpSpace(parseInt(e.target.value, 10))}
            disabled={!life}
          >
            <option value={LERP_SPACE_SRGB}>sRGB</option>
            <option value={LERP_SPACE_LINEAR}>Linear RGB</option>
            <option value={LERP_SPACE_OKLAB}>OKLab</option>
            <option value={LERP_SPACE_HSL_SHORT}>HSL (short)</option>
            <option value={LERP_SPACE_HSL_LONG}>HSL (rainbow)</option>
          </select>
        </label>

        <label className="wrap-field">
          <input
            type="checkbox"
            checked={cellOverGrid}
            onChange={(e) => setCellOverGrid(e.target.checked)}
            disabled={!life}
          />
          Cells over grid
        </label>
      </div>
      </aside>
    </div>
  );
}
