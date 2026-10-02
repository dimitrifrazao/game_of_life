// =============================================================================
// App.tsx — top-level router shell. Renders the nav + all three pages, hiding
// inactive ones with display:none so the Game keeps its WASM core, simulation
// loop, undo history, and viewport state across navigation.
// =============================================================================

import { useEffect } from "react";
import { Nav } from "./components/Nav";
import { useRoute } from "./router";
import About from "./pages/About";
import Game from "./pages/Game";
import Rules from "./pages/Rules";
import Controls from "./pages/Controls";
import Tech from "./pages/Tech";

export default function App() {
  const route = useRoute();

  // When we return to the Game page, fire a resize so the canvas re-syncs in
  // case the window was resized while another page was visible (the canvas's
  // resize handler skips zero-sized rects, so it won't have run while hidden).
  useEffect(() => {
    if (route === "game") {
      // Defer one frame so the page's display:block is already applied.
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  }, [route]);

  return (
    <div className="layout">
      <Nav route={route} />
      <main className="content">
        <div hidden={route !== "about"}>
          <About />
        </div>
        <div hidden={route !== "game"}>
          <Game />
        </div>
        <div hidden={route !== "rules"}>
          <Rules />
        </div>
        <div hidden={route !== "controls"}>
          <Controls />
        </div>
        <div hidden={route !== "tech"}>
          <Tech />
        </div>
      </main>
    </div>
  );
}
