// ---------------------------------------------------------------------------
// Tournament hub tab registry
// ---------------------------------------------------------------------------
//
// The hub's sub-navigation is data-driven: the tab bar, the deep-link URLs and
// the "hide an empty tab" rules all read from this one array. Adding a future
// tab (the oct12-knockout branch is expected to bring "Bracket" and "Awards")
// is a single entry here plus the tab component — no changes to the layout.
//
// Each entry:
//   key         stable id used in state/tests
//   label       button text
//   path        URL suffix under /series/:id ; "" is the hub root (Home)
//   gate        optional key into `visibility` — when the tournament admin
//               sets visibility[gate] = false the tab disappears for this
//               tournament only (global VITE_SHOW_* flags are never touched)
//   isAvailable optional predicate over the hub context; hides a tab that would
//               otherwise render empty (Photos with no photos, etc.)
//
// `path` values are registered as routes in `Frontend/User/src/App.jsx`, so a
// new tab's path is reachable by deep link the moment it appears here.
//
// Order here IS the tab-bar order: Home | Fixtures & Results | Table | Stats |
// Teams | Photos | Videos | Articles.

export const TOURNAMENT_TABS = Object.freeze([
  {
    key: "home",
    label: "Home",
    path: "",
    isAvailable: () => true,
  },
  {
    key: "fixtures",
    label: "Fixtures & Results",
    path: "fixtures",
    isAvailable: (ctx) => (ctx?.counts?.matches || 0) > 0,
  },
  {
    key: "table",
    label: "Table",
    path: "table",
    gate: "table",
    // A knockout has no points rows but does have a bracket.
    isAvailable: (ctx) =>
      (ctx?.standings?.length || 0) > 0 ||
      (ctx?.bracket?.stages || []).some((stage) => (stage.matches || []).length > 0),
  },
  {
    key: "stats",
    label: "Stats",
    path: "stats",
    gate: "stats",
    isAvailable: (ctx) => Boolean(ctx?.stats) && ctx.stats.empty !== true,
  },
  {
    key: "teams",
    label: "Teams",
    path: "teams",
    gate: "teams",
    isAvailable: (ctx) => (ctx?.teams?.length || 0) > 0 || (ctx?.squads?.length || 0) > 0,
  },
  {
    key: "photos",
    label: "Photos",
    path: "photos",
    gate: "photos",
    isAvailable: (ctx) => (ctx?.counts?.photos || 0) > 0,
  },
  {
    key: "videos",
    label: "Videos",
    path: "videos",
    gate: "videos",
    isAvailable: (ctx) => (ctx?.counts?.videos || 0) > 0,
  },
  {
    key: "articles",
    label: "Articles",
    path: "articles",
    gate: "articles",
    isAvailable: (ctx) => (ctx?.counts?.articles || 0) > 0,
  },
]);

/**
 * The tabs a given tournament actually shows, in registry order.
 *
 * A tab is hidden when its `gate` is explicitly false in the tournament's
 * `visibility` settings or when its `isAvailable` predicate says there is
 * nothing to render.
 *
 * @param {object} ctx
 * @param {object} [ctx.visibility] per-tournament visibility flags
 * @param {object} [ctx.counts]     { matches, photos, videos, articles }
 * @param {object} [ctx.stats]      the stats payload (may be null)
 * @param {object[]} [ctx.standings]
 * @param {object[]} [ctx.teams]
 * @param {object[]} [ctx.squads]
 */
export function resolveTabs(ctx = {}) {
  const visibility = ctx.visibility || {};
  return TOURNAMENT_TABS.filter((tab) => {
    if (tab.gate && visibility[tab.gate] === false) return false;
    return tab.isAvailable ? tab.isAvailable(ctx) : true;
  });
}

/** True when `key` is in the resolved, visible set. */
export function isTabVisible(key, ctx = {}) {
  return resolveTabs(ctx).some((tab) => tab.key === key);
}

/** Finds a tab by its URL path segment ("" for Home). */
export function tabByPath(path, ctx = {}) {
  const wanted = path || "";
  return resolveTabs(ctx).find((tab) => tab.path === wanted) || null;
}

export default { TOURNAMENT_TABS, resolveTabs, isTabVisible, tabByPath };
