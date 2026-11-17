/**
 * Central AdSense placement rules for the User app.
 *
 * Ads are opt-in, at most one unit is rendered per allowed page (limit is 2,
 * never adjacent), and owner dashboards are capped at one read-only unit.
 * Anything not explicitly allowed here renders nothing — most importantly the
 * live scoring screens, setup/forms/settings, auth pages, 404/error/offline and
 * the empty community pages.
 */
const clean = (value) => (value || '').trim()

export const SLOTS = {
  home: clean(import.meta.env.VITE_ADSENSE_SLOT_HOME),
  match: clean(import.meta.env.VITE_ADSENSE_SLOT_MATCH),
  team: clean(import.meta.env.VITE_ADSENSE_SLOT_TEAM),
  list: clean(import.meta.env.VITE_ADSENSE_SLOT_LIST),
}

export const MAX_AD_UNITS_PER_PAGE = 2

export const DENYLIST = [
  // Live scoring / match setup / innings break (owner side).
  /^\/organization\/[^/]+\/matches\/[^/]+\/score(?:\/|$)/,
  /\/score(?:\/|$)/,
  /\/(?:setup|wizard|innings[-/]?break)(?:\/|$)/i,
  // Forms, settings and account actions.
  /\/(?:settings|account|change-password|edit|create|new|form|forms)(?:\/|$)/i,
  /^\/my-players(?:\/|$)/,
  // Auth flows.
  /^\/(?:login|register|auth|forgot-password|reset-password|verify-email|verify-phone)(?:\/|$)/,
  // Error/offline/404 and placeholder (empty) pages.
  /^\/(?:offline|error|404|community)(?:\/|$)/,
]

// `inline: true` rules own their placement inside the page (between sections /
// below the scorecard). The rest are rendered by the shared route-level slot.
const RULES = [
  { pattern: /^\/$/, slotKey: 'home', kind: 'home', inline: true, max: MAX_AD_UNITS_PER_PAGE },
  { pattern: /^\/live\/?$/, slotKey: 'list', kind: 'list', max: MAX_AD_UNITS_PER_PAGE },
  {
    pattern: /^\/match(?:es)?\/[^/]+\/?$/,
    slotKey: 'match',
    kind: 'match',
    inline: true,
    max: MAX_AD_UNITS_PER_PAGE,
  },
  {
    pattern: /^\/cricket\/match\/[^/]+\/?$|^\/international\/(?:match\/)?[^/]+\/?$/,
    slotKey: 'match',
    kind: 'match',
    max: MAX_AD_UNITS_PER_PAGE,
  },
  { pattern: /^\/teams\/[^/]+\/?$/, slotKey: 'team', kind: 'team', max: MAX_AD_UNITS_PER_PAGE },
  { pattern: /^\/series\/[^/]+(?:\/[^/]+)*\/?$/, slotKey: 'list', kind: 'tournament', max: MAX_AD_UNITS_PER_PAGE },
  { pattern: /^\/rankings\/?$/, slotKey: 'list', kind: 'rankings', max: MAX_AD_UNITS_PER_PAGE },
  { pattern: /^\/(?:news|cricket-news)\/?$/, slotKey: 'list', kind: 'blogs', max: MAX_AD_UNITS_PER_PAGE },
  { pattern: /^\/(?:organization|dashboard)\/?$/, slotKey: 'list', kind: 'owner', owner: true, max: 1 },
]

export function isDenylisted(pathname) {
  return DENYLIST.some((pattern) => pattern.test(pathname || ''))
}

/**
 * @param {string} pathname
 * @param {'inline'|'route'} mode inline = page-level slot, route = shared slot
 */
export function getPlacement(pathname, mode = 'inline') {
  const path = pathname || ''
  if (isDenylisted(path)) return null
  const rule = RULES.find((entry) => entry.pattern.test(path))
  if (!rule) return null
  if (mode === 'route' && rule.inline) return null
  const slot = SLOTS[rule.slotKey]
  if (!slot) return null
  return { ...rule, slot, path }
}

/** Slots allowed on a path; used by tests to enforce the per-page cap. */
export function getSlotsForPath(pathname) {
  const placement = getPlacement(pathname, 'inline')
  return placement ? [placement.slot] : []
}
