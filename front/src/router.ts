// =============================================================================
// router.ts — tiny zero-dependency hash router for static hosting.
//
// URLs look like "<base>#/about", "<base>#/game", "<base>#/rules". The browser
// never sends the part after "#" to the server, so this works on any static
// host (GitHub Pages included) without rewrites or 404-fallback tricks.
// =============================================================================

import { useEffect, useState } from "react";

export type Route = "about" | "game" | "rules" | "controls" | "tech";

export const ROUTES: Route[] = ["about", "game", "rules", "controls", "tech"];
export const DEFAULT_ROUTE: Route = "game";

/** Parse the current location.hash into a Route. Falls back to the default. */
export function parseHash(): Route {
  const m = window.location.hash.match(/^#\/([\w-]+)/);
  const r = m?.[1] as Route | undefined;
  return r && ROUTES.includes(r) ? r : DEFAULT_ROUTE;
}

/** React hook: returns the current route and re-renders on hashchange. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}
