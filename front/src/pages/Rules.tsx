// =============================================================================
// Rules.tsx - explains Conway's Game of Life rules. The rules are part of the
// canonical definition; feel free to expand or rewrite as needed.
// =============================================================================

export default function Rules() {
  return (
    <div className="page">
      <section className="page-section">
        <h2>What is Conway's Game of Life?</h2>
        <p>
          The Game of Life is a cellular automaton devised by mathematician John
          Conway in 1970. It is a zero-player game: once you set up an initial
          configuration of live and dead cells, the simulation unfolds on its
          own according to a small set of rules.
        </p>
        <p>
          Despite the simple rules, complex and beautiful patterns emerge -
          oscillators, gliders, glider guns, and even structures capable of
          universal computation.
        </p>
      </section>

      <section className="page-section">
        <h2>The grid</h2>
        <p>
          The world is a two-dimensional grid of square cells. Each cell is in
          one of two states: <strong>alive</strong> or <strong>dead</strong>.
          Every cell has eight neighbors - the cells touching it horizontally,
          vertically, or diagonally.
        </p>
      </section>

      <section className="page-section">
        <h2>The rules</h2>
        <p>
          At each step (a "generation"), every cell looks at its eight neighbors
          and applies these four rules simultaneously:
        </p>
        <ol>
          <li>
            <strong>Underpopulation.</strong> A live cell with fewer than two
            live neighbors dies.
          </li>
          <li>
            <strong>Survival.</strong> A live cell with two or three live
            neighbors stays alive.
          </li>
          <li>
            <strong>Overpopulation.</strong> A live cell with more than three
            live neighbors dies.
          </li>
          <li>
            <strong>Reproduction.</strong> A dead cell with exactly three live
            neighbors becomes alive.
          </li>
        </ol>
        <p>
          That's it. Every other cell stays in its current state. The next
          generation is computed from the current one in a single synchronous
          step - no cell "moves first."
        </p>
      </section>

      <section className="page-section">
        <h2>Patterns to try</h2>
        <ul>
          <li>
            <strong>Still lifes</strong> - patterns that never change (e.g.
            block, beehive, loaf).
          </li>
          <li>
            <strong>Oscillators</strong> - patterns that return to themselves
            after a fixed number of generations (e.g. blinker, toad, pulsar).
          </li>
          <li>
            <strong>Spaceships</strong> - patterns that translate across the
            grid over time (e.g. glider, lightweight spaceship).
          </li>
          <li>
            <strong>Methuselahs</strong> - small initial patterns that take a
            very long time to stabilize. Despite having only a few cells, they
            produce enormous, complex evolutions before eventually settling into
            a mix of still lifes, oscillators, and escaping spaceships. The most
            famous is the R-pentomino (5 cells), which takes 1,103 generations
            to stabilize. Others include the Acorn (7 cells, 5,206 generations)
            and Diehard (7 cells, which dies completely after 130 generations).
          </li>
        </ul>
      </section>
    </div>
  );
}
