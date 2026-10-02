// =============================================================================
// Tech.tsx - explains the non-trivial algorithms used in the app: the two Life
// engines (naive vs Hashlife), the random-world noise fields, and the color
// interpolation spaces.
// =============================================================================

export default function Tech() {
  return (
    <div className="page">
      <section className="page-section">
        <p>
          This page describes the algorithms behind three features of the app:
          the two stepping engines for Conway's Game of Life, the noise fields
          used to generate random worlds, and the color spaces used to
          interpolate a live cell's color as it ages.
        </p>
      </section>


      {/* ----- Naive vs Hashlife --------------------------------------- */}
      <section className="page-section">
        <h2>Naive vs Hashlife</h2>

        <h3>Naive (cell scan)</h3>
        <p>
          The straightforward approach: walk every cell on the grid, count its
          eight neighbors, apply Conway's rules, and write the result to a
          second buffer. After one full pass, swap buffers.
        </p>
        <p>
          For a grid of width <code>W</code> and height <code>H</code>, each
          generation costs <strong>O(W × H)</strong>. The work is independent of
          how many cells are alive - even an empty grid pays for every cell.
          The constant factor is tiny (a flat array scan is cache-friendly), and
          the implementation supports toroidal <strong>wraparound</strong> for
          free. Memory is <strong>O(W × H)</strong>.
        </p>
        <p>
          To advance <code>T</code> generations the cost is
          <strong> O(T · W · H)</strong>. Doubling <code>T</code> doubles the
          work; doubling the grid quadruples it.
        </p>

        <h3>Hashlife (Gosper, 1984)</h3>
        <p>
          Hashlife trades simplicity for two structural ideas: a{" "}
          <strong>quadtree</strong> representation of the universe and{" "}
          <strong>memoization</strong> of each subtree's future.
        </p>
        <p>
          A node of level <code>k</code> represents a 2<sup>k</sup> ×
          2<sup>k</sup> square. A leaf (level 0) is a single cell; every other
          node is a record of its four children (northwest, northeast,
          southwest, southeast), each one level smaller. So a level-3 node is
          an 8×8 block built from four 4×4 nodes, each built from four 2×2
          nodes, and so on. The universe is effectively unbounded - you just
          add levels at the root as live cells spread.
        </p>
        <p>
          Two optimizations make this fast:
        </p>
        <ol>
          <li>
            <strong>Hash-consing.</strong> Nodes are immutable and stored in a
            hash table keyed by their four children. Whenever the engine wants
            a node with a particular combination, it reuses the existing one
            instead of allocating a new copy. Identical sub-patterns - say a
            single still life appearing in a hundred places, or a vast empty
            region - collapse to <strong>one</strong> shared node in memory.
          </li>
          <li>
            <strong>Memoized successors.</strong> Each node caches its{" "}
            <em>result</em>: the state of its center, advanced{" "}
            <code>2<sup>j</sup></code> generations forward (with{" "}
            <code>j</code> up to <code>k − 2</code>). The recursion combines
            the results of nine overlapping sub-squares to compute the parent's
            result, hitting the cache at every level. The first time a pattern
            is seen, it's computed; every subsequent occurrence - anywhere in
            space <em>or</em> time - is one hash-map lookup.
          </li>
        </ol>
        <p>
          The complexity is hard to write as a clean Big-O because it depends
          on how repetitive the pattern is. The cost of advancing the universe
          is dominated by the number of <em>distinct</em> nodes the engine has
          to compute results for, not by the cell count or generation count
          directly. On highly structured patterns (oscillators, glider guns,
          mostly-empty space), advancing by huge numbers of generations is
          effectively logarithmic in the time jump, because the same nodes
          appear over and over. On chaotic random soups, almost every node is
          unique - the cache misses dominate and Hashlife is{" "}
          <em>slower</em> than the naive scan.
        </p>
        <p>
          Hashlife also operates on an <strong>infinite plane</strong>: there
          are no edges to wrap around, so the toroidal "Wrap edges" option is
          disabled while it's selected.
        </p>

        <h3>Why both?</h3>
        <p>
          The two engines suit different workloads:
        </p>
        <ul>
          <li>
            <strong>Naive</strong> wins on small bounded grids and chaotic
            random input - predictable, cache-friendly, supports wrap.
          </li>
          <li>
            <strong>Hashlife</strong> wins when the pattern has structure and
            you want to fast-forward many generations at once (the{" "}
            <em>Gens/step</em> field). On a structured pattern it can leap
            millions of generations in the time naive does one.
          </li>
        </ul>
        <p>
          The naive scan is the default. Native unit tests verify that
          Hashlife's interior matches naive (with wrap off) cell-for-cell over
          multiple generations across several random seeds, so both engines
          agree on the underlying simulation.
        </p>
      </section>


      {/* ----- Noise fields -------------------------------------------- */}
      <section className="page-section">
        <h2>Noise fields (random worlds)</h2>
        <p>
          The <em>Random</em> button fills the grid by combining three things:
          a <em>density</em> (target live-cell probability), an optional{" "}
          <em>symmetry</em>, and a <em>noise field</em>. The first two are
          straightforward (sample-then-mirror, etc.); the noise field is what
          decides which cells turn on. All four options are deterministic - the
          same seed reproduces the same world - and they cost{" "}
          <strong>O(W × H)</strong> with a small constant.
        </p>

        <h3>None (white noise)</h3>
        <p>
          Each cell is rolled independently: hash <code>(x, y, seed)</code>{" "}
          into a uniform value in [0, 1] and turn the cell on if the value is
          below <code>density</code>. There is no spatial structure - neighbors
          are uncorrelated. Patterns "die down" quickly because the initial
          state has no large connected regions.
        </p>

        <h3>Value noise</h3>
        <p>
          A simple smoothed lattice noise. Imagine an integer grid of feature
          points; assign each point a random value in [0, 1] (deterministically,
          via a hash). To compute the noise at a continuous point{" "}
          <code>(x, y)</code>, take the four enclosing lattice values and
          interpolate them bilinearly, smoothing the interpolation weights with
          the cubic <code>s(t) = t² · (3 − 2t)</code> so gradients are
          continuous. Threshold against <code>(1 − density)</code> to decide
          alive vs dead.
        </p>
        <p>
          The result is <strong>blobby</strong>: rounded regions of alive cells
          with a characteristic feature size set by the lattice scale.
        </p>

        <h3>Fractal (fBm)</h3>
        <p>
          Fractal Brownian motion: sum several octaves of value noise at
          doubling frequencies and halving amplitudes:
        </p>
        <pre className="code-block">
{`fbm(x, y) = Σ aᵢ · valueNoise(fᵢ · x, fᵢ · y)
  where fᵢ = 2ⁱ, aᵢ = 1/2ⁱ, i = 0..3`}
        </pre>
        <p>
          Each octave adds finer detail on top of the previous one. The result
          looks more organic than plain value noise - large blobs with small
          ripples on top, similar to landscape-generation noise. Costs ~4×
          a single value-noise sample.
        </p>

        <h3>Cellular (Worley)</h3>
        <p>
          Place one random "feature point" inside each lattice cell. For a
          query point <code>(x, y)</code>, return the distance to the{" "}
          <strong>nearest</strong> feature point (only the 3×3 neighborhood of
          cells around the query is checked - that's nine candidates). Threshold
          against <code>density</code> so cells <em>close</em> to a feature
          point are alive.
        </p>
        <p>
          The output is a cellular / clustered pattern that looks like
          biological colonies or stone tiling. It plays well with Game of
          Life: the round clusters seed lots of small interacting structures.
        </p>
      </section>


      {/* ----- Color interpolation ------------------------------------- */}
      <section className="page-section">
        <h2>Color interpolation (age-based lerp)</h2>
        <p>
          Each live cell tracks its <em>age</em>: the number of generations it
          has been continuously alive. The renderer interpolates from the{" "}
          <em>start color</em> (age 1) to the <em>end color</em> over{" "}
          <em>colorLerp</em> generations, using one of five color spaces - the
          choice affects how the gradient <em>feels</em>, not the endpoints.
        </p>
        <p>
          All inputs are sRGB hex colors and all outputs are sRGB pixels; the
          difference between modes is the math in the middle. The shader does
          the conversions branchlessly per fragment, controlled by a single
          <code> uLerpSpace</code> uniform.
        </p>

        <h3>sRGB (gamma space)</h3>
        <p>
          Linear interpolation per channel directly in gamma space:
        </p>
        <pre className="code-block">color = mix(a, b, t)</pre>
        <p>
          Cheapest. Looks fine for near-grayscale or low-saturation transitions,
          but mid-points often appear darker than expected because sRGB is{" "}
          <em>non-linear</em> in light intensity - a 0.5 sRGB value is roughly
          22% of full light, not 50%.
        </p>

        <h3>Linear RGB (energy-linear)</h3>
        <p>
          The "physically correct" way to mix two RGB colors. Decode each
          endpoint from sRGB to linear-light using the proper piecewise sRGB
          transfer curve (not a simple <code>pow(c, 2.2)</code>),{" "}
          interpolate in linear space, then encode the result back to sRGB:
        </p>
        <pre className="code-block">
{`color = linearToSrgb(
          mix(srgbToLinear(a), srgbToLinear(b), t)
        )`}
        </pre>
        <p>
          Mid-points are noticeably brighter than the sRGB blend for saturated
          colors. This is the correct space for compositing, anti-aliasing,
          and physically-based rendering.
        </p>

        <h3>OKLab (perceptual)</h3>
        <p>
          OKLab is a perceptually uniform color space published by Björn
          Ottosson in 2020. Equal Euclidean steps in OKLab look like equal
          perceptual color steps. The pipeline is:
        </p>
        <pre className="code-block">
{`color = linearToSrgb(
          oklabToLinear(
            mix(
              linearToOklab(srgbToLinear(a)),
              linearToOklab(srgbToLinear(b)),
              t
            )
          )
        )`}
        </pre>
        <p>
          OKLab transitions read as <em>smooth</em> to the eye - no sudden
          dark or muddy bands. Best for "designer-quality" gradients between
          arbitrarily colored endpoints.
        </p>

        <h3>HSL - shortest path</h3>
        <p>
          Convert both endpoints to HSL (hue / saturation / lightness),
          interpolate <code>S</code> and <code>L</code> linearly, and{" "}
          interpolate <code>H</code> along the <strong>shortest</strong>{" "}
          arc around the color wheel (i.e., choosing the direction with the
          smaller hue delta):
        </p>
        <pre className="code-block">
{`dh = hb - ha
dh = dh - round(dh)   // shortest signed delta in (-0.5, 0.5]
h  = fract(ha + t · dh)`}
        </pre>
        <p>
          Produces vivid spectral transitions (blue → red goes through
          magenta). Saturation and lightness still interpolate linearly, which
          can sometimes desaturate the midpoint of widely-separated colors.
        </p>

        <h3>HSL - rainbow (long path)</h3>
        <p>
          Same as the previous, but the hue interpolation takes the{" "}
          <em>opposite</em> direction around the wheel. Blue → red now sweeps
          through green and yellow - a full rainbow gradient. Useful when you
          want a long, colorful gradient between similar-hued endpoints.
        </p>
      </section>
    </div>
  );
}
