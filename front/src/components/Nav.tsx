// =============================================================================
// Nav.tsx - top navigation bar (About / Game / Rules). Hash-router based, so
// links are plain anchors with #/<route> hrefs.
// =============================================================================

import type { Route } from "../router";

interface NavLink {
  id: Route;
  label: string;
}

const LINKS: NavLink[] = [
  { id: "about", label: "About" },
  { id: "game", label: "Game" },
  { id: "rules", label: "Rules" },
  { id: "controls", label: "Controls" },
  { id: "tech", label: "Tech" },
];

interface Props {
  route: Route;
}

export function Nav({ route }: Props) {
  return (
    <nav className="app-nav">
      {LINKS.map((l) => (
        <a
          key={l.id}
          href={`#/${l.id}`}
          className={`nav-link ${route === l.id ? "active" : ""}`}
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
