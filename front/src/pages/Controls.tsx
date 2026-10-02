// =============================================================================
// Controls.tsx - reference for the app's buttons, settings, and shortcuts.
// =============================================================================

export default function Controls() {
  return (
    <div className="page">
      <section className="page-section">
        <p>
          The Game page has an interactive canvas in the center and a
          controls sidebar on the right. This page explains every control and
          keyboard shortcut.
        </p>
      </section>

      <section className="page-section">
        <h2>The canvas</h2>
        <p>
          The canvas shows the world as a grid of square cells. Empty cells are
          the <em>background</em> color; live cells are colored by their age
          (see <em>Colors</em> below). Grid lines are drawn between cells
          unless disabled. When you zoom in and pan, the cells outside the
          viewport are hidden and cells outside the world are letterboxed with
          a black bar.
        </p>
      </section>


      <section className="page-section">
        <h2>Simulation buttons</h2>
        <ul>
          <li>
            <strong>Random</strong> - clear the grid, then randomly turn on
            cells using the current <em>Density</em>, <em>Symmetry</em>, and{" "}
            <em>Noise</em> settings.
          </li>
          <li>
            <strong>Clear</strong> - set every cell to dead.
          </li>
          <li>
            <strong>Run</strong> - start the simulation.
          </li>
          <li>
            <strong>Stop</strong> - pause the simulation.
          </li>
          <li>
            <strong>Step</strong> - advance one generation (enabled only while
            stopped).
          </li>
          <li>
            <strong>Save</strong> / <strong>Load</strong> - save the current
            world (and/or settings) to a <code>.gol</code> JSON file, or load
            a saved file. Uses your browser's file picker where available;
            otherwise falls back to a plain download / file input. The two
            checkboxes below decide what's included:
            <ul>
              <li>
                <strong>Save world data</strong> - include the current grid.
                Loading a file with world data resizes the grid to match and
                rewrites the cells (cell age resets to 1).
              </li>
              <li>
                <strong>Save settings</strong> - include the current UI
                settings (colors, speed, algorithm, etc.). Loading a file with
                settings applies whichever fields are present.
              </li>
            </ul>
            The Save button is disabled if both checkboxes are off.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <h2>Simulation timing</h2>
        <ul>
          <li>
            <strong>Speed</strong> - minimum milliseconds per generation
            (0–1000). Each generation takes at least this long, measured from
            the start of processing; if the world is too large to process in
            that time the next generation runs immediately. <code>0</code> runs
            as fast as your monitor allows; <code>1000</code> is at most one
            generation per second.
          </li>
          <li>
            <strong>Gens/step</strong> - how many generations each update
            advances (1 to 1&nbsp;000&nbsp;000&nbsp;000, default 1). At 1 you
            see every generation. Larger values fast-forward: only every Nth
            generation is rendered, but every intermediate generation is still
            computed. Hashlife takes advantage of this to leap huge jumps on
            structured patterns.
          </li>
          <li>
            <strong>Algorithm</strong> - <em>Naive</em> (a straightforward cell
            scan, default) or <em>Hashlife</em> (Gosper's hashed quadtree).
            Naive supports wrap and is faster on chaotic dense worlds;
            Hashlife runs on an infinite plane and shines with large Gens/step
            on structured patterns. See the Tech page for the details.
          </li>
          <li>
            <strong>Wrap edges</strong> - toroidal topology: a shape leaving
            one side reappears on the other. Only available with the Naive
            algorithm; disabled and unchecked while Hashlife is selected.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <h2>World size</h2>
        <ul>
          <li>
            <strong>Width</strong> / <strong>Height</strong> - integer fields
            (1–1000). Committing a new value (Enter or blur) resizes the grid
            and clears it. Cells stay square: if width and height differ the
            shorter axis is letterboxed with a black bar.
          </li>
        </ul>
      </section>


      <section className="page-section">
        <h2>Random-world generation</h2>
        <p>These three controls shape what the <em>Random</em> button produces:</p>
        <ul>
          <li>
            <strong>Density</strong> - a slider (0–100%) for the target live-
            cell probability. Around 30–40% tends to produce long, interesting
            evolutions.
          </li>
          <li>
            <strong>Symmetry</strong> - force a symmetry on the random fill:
            None, Mirror X, Mirror Y, Mirror both, Rotate 180°, Rotate 90°, or
            Full D4. Rotational modes work best on square worlds; symmetric
            initial states often produce dramatically more interesting
            evolutions.
          </li>
          <li>
            <strong>Noise</strong> - the spatial field used to place cells:{" "}
            <em>None</em> (independent per-cell white noise, the classic
            random), <em>Value</em> (smooth blobs), <em>Fractal</em> (organic
            fBm detail at multiple scales), or <em>Cellular</em> (clustered,
            colony-like). See the Tech page for how each is generated.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <h2>Mouse modes</h2>
        <p>
          Clicking and dragging on the canvas edits it according to the{" "}
          <strong>Mouse</strong> dropdown. Each distinct cell the pointer
          passes over during a drag is edited once.
        </p>
        <ul>
          <li>
            <strong>Draw</strong> - turn cells on.
          </li>
          <li>
            <strong>Erase</strong> - turn cells off.
          </li>
          <li>
            <strong>Toggle</strong> - flip each cell (default).
          </li>
          <li>
            <strong>Stamp</strong> - place a prebuilt pattern (a "stamp") on
            click. See <em>Stamp tool</em> below.
          </li>
          <li>
            <strong>Zoom</strong> - click to zoom in 2× toward the cursor;
            Shift-click to zoom out 2×. Stops at the bounds (whole world fits
            → one cell fills a screen axis).
          </li>
          <li>
            <strong>Move</strong> - click and drag to pan the viewport (only
            when zoomed in). The world can't be dragged past its edges.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <h2>Stamp tool</h2>
        <p>
          When Mouse is set to Stamp, hovering the canvas shows a preview of a
          pattern anchored at the cursor; clicking places it (additive - cells
          already alive are not disturbed). Stamps wrap around the grid edges
          only when <em>Wrap edges</em> is on; otherwise they clip.
        </p>
        <ul>
          <li>
            <strong>Type</strong> - the category: Still life, Oscillators, or
            Spaceships.
          </li>
          <li>
            <strong>Pattern</strong> - one of 10 patterns of the selected
            type. Each type is roughly ordered from smallest / most common at
            the top.
          </li>
          <li>
            <strong>Rotate</strong> - rotate the stamp by 0 / 90 / 180 / 270°.
          </li>
        </ul>
      </section>


      <section className="page-section">
        <h2>Colors</h2>
        <p>
          Live cells track their <em>age</em> - how many generations they've
          been continuously alive - and the renderer lerps their color from a
          start to an end color based on that age.
        </p>
        <ul>
          <li>
            <strong>Background</strong> - color of empty (dead) cells.
          </li>
          <li>
            <strong>Start</strong> - a live cell's color at age 1.
          </li>
          <li>
            <strong>End</strong> - a live cell's color once it's fully aged
            (age ≥ <em>Color lerp</em>).
          </li>
          <li>
            <strong>Grid</strong> - color of the grid lines between cells.
          </li>
          <li>
            <strong>Color lerp</strong> - an integer (1 to 100&nbsp;000&nbsp;000)
            setting how many generations a live cell takes to fully lerp from
            Start to End.
          </li>
          <li>
            <strong>Interpolation</strong> - the color space used for the age
            lerp: <em>sRGB</em>, <em>Linear RGB</em>, <em>OKLab</em>,{" "}
            <em>HSL (short)</em>, or <em>HSL (rainbow)</em>. See the Tech page
            for what each looks like and why.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <h2>Grid rendering</h2>
        <ul>
          <li>
            <strong>Show grid</strong> - toggle the grid lines on or off.
          </li>
          <li>
            <strong>Cells over grid</strong> - when on, live cells paint over
            the grid lines within them (so a connected live region reads as
            one solid shape); when off, grid lines are drawn on top of
            everything.
          </li>
          <li>
            <strong>Show FPS</strong> - overlay the current updates-per-second
            in red at the top-right of the world. This is the update rate;
            multiply by <em>Gens/step</em> to get generations per second.
          </li>
          <li>
            <strong>Show dying</strong> - when on, cells that are alive now but
            will die next generation are highlighted in the <em>Dying color</em>
            (default yellow). This gives a visual preview of which cells are about
            to disappear. The check is computed in WASM after each generation
            step as an extra neighbor-count pass (same O(W*H) cost as the step
            itself). The color picker appears when the checkbox is on.
          </li>
          <li>
            <strong>Show generations</strong> - when on, displays the current
            generation number at the bottom-right of the world. The counter
            starts at 0 and increments by the Gens/step value each update. It
            resets to 0 whenever the world is cleared, randomized, resized, or
            loaded from a file.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <h2>Keyboard shortcuts</h2>
        <p>
          All shortcuts are active only on this page and are ignored while a
          text input, number field, dropdown, or textarea has focus.
        </p>
        <ul>
          <li><strong>D / E / T / S / Z / M</strong> - set the Mouse mode to Draw / Erase / Toggle / Stamp / Zoom / Move.</li>
          <li><strong>Space</strong> - toggle Run / Stop.</li>
          <li><strong>Enter</strong> - step one generation (only when stopped).</li>
          <li><strong>Ctrl+Z / Cmd+Z</strong> - undo the last edit (up to 10 recent edits).</li>
          <li><strong>R</strong> - (stamp mode) cycle the stamp rotation.</li>
          <li><strong>1</strong> - (stamp mode) cycle the stamp type.</li>
          <li><strong>2</strong> - (stamp mode) cycle to the next pattern within the current type.</li>
          <li><strong>Shift</strong> - (zoom mode) hold to switch the click to zoom out; the cursor changes to reflect it.</li>
        </ul>
      </section>
    </div>
  );
}
