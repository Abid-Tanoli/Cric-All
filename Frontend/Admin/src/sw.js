/**
 * CricAll Admin service worker (vite-plugin-pwa `injectManifest`).
 *
 * This is an admin-only app on its own origin. It precaches just the hashed app
 * shell plus the offline page. No API response, upload, or user-specific data is
 * ever cached; navigations are NetworkOnly so an offline visit shows a plain
 * offline page instead of a stale admin console.
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute, setCatchHandler } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST || [])

const isApiOrRealtime = ({ url }) =>
  url.pathname.startsWith('/api') ||
  url.pathname.startsWith('/socket.io') ||
  url.pathname.includes('/socket.io/')

// Private uploads (avatars, documents, match media) must never enter a cache.
const isPrivateUpload = ({ url }) => url.pathname.startsWith('/uploads/')

const isSameOriginNavigation = ({ request, url }) =>
  request.mode === 'navigate' && url.origin === self.location.origin

// Explicit NetworkOnly routes come first so nothing below can cache these.
registerRoute(isApiOrRealtime, new NetworkOnly())
registerRoute(isPrivateUpload, new NetworkOnly())

// `serve -s dist` maps SPA routes to index.html on the network. We deliberately
// do not cache that HTML: offline admin functionality is not supported.
registerRoute(isSameOriginNavigation, new NetworkOnly())

// Only a failed navigation (offline with no network shell) reaches the offline
// page. All other failed requests stay network failures.
setCatchHandler(async ({ request }) => {
  if (request.mode === 'navigate') {
    const offlinePage = await matchPrecache('/offline.html')
    if (offlinePage) return offlinePage
  }
  return Response.error()
})
