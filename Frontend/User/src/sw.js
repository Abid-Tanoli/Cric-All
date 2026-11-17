/**
 * CricAll service worker (vite-plugin-pwa `injectManifest`).
 *
 * Rules that keep deploys fresh instead of serving a stale UI:
 *  - `index.html` is never precached. Page navigations are NetworkFirst, so an
 *    online visit always renders the HTML that is on the server right now.
 *  - Hashed build assets are precached; their filenames change with the build.
 *  - Nothing under /api or /socket.io is ever cached.
 *  - Activation is owned by the page (`registerType: 'prompt'`): the app shows
 *    "New version available. Reload", and only then posts SKIP_WAITING here.
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute, setCatchHandler } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

const isApiOrRealtime = ({ url }) =>
  url.pathname.startsWith('/api') ||
  url.pathname.startsWith('/socket.io') ||
  url.pathname.includes('/socket.io/')

// NetworkOnly as an explicit first route: it also stops the routes below from
// ever matching API or Socket.IO traffic.
registerRoute(isApiOrRealtime, new NetworkOnly())

const isPageNavigation = ({ request, url }) =>
  request.mode === 'navigate' && !isApiOrRealtime({ url })

registerRoute(
  isPageNavigation,
  new NetworkFirst({
    cacheName: 'cricall-pages',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
)

// Same-origin images/fonts that are not part of the hashed bundle (app icons,
// logos). They rarely change, so CacheFirst is safe here.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    (request.destination === 'image' || request.destination === 'font'),
  new CacheFirst({
    cacheName: 'cricall-static',
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
)

// Only a failed navigation (offline with no cached shell) reaches this page.
setCatchHandler(async ({ request }) => {
  if (request.mode === 'navigate') {
    const offlinePage = await matchPrecache('/offline.html')
    if (offlinePage) return offlinePage
  }
  return Response.error()
})
