import { registerSW } from 'virtual:pwa-register'
import { emitPwaEvent } from './pwaEvents'

/**
 * Service worker registration.
 *
 * `registerType: 'prompt'` (vite.config.js) means a new service worker installs
 * and then WAITS. Nothing is swapped under the user's feet; the app shows the
 * "New version available. Reload" toast and `applyPwaUpdate()` activates the
 * waiting worker and reloads once, so a deploy is picked up immediately instead
 * of after the old precache is evicted.
 */
let updateSW = null
let registration = null
let lastUpdateCheck = 0

const UPDATE_CHECK_INTERVAL_MS = 60 * 1000

/** Activate a waiting service worker (if any) and reload into the new build. */
export function applyPwaUpdate() {
  if (typeof updateSW === 'function') return updateSW(true)
  if (typeof window !== 'undefined') window.location.reload()
  return undefined
}

/** Ask the browser to look for a new sw.js. Throttled: focus fires a lot. */
export function checkForPwaUpdate() {
  if (!registration?.update) return
  const now = Date.now()
  if (now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return
  lastUpdateCheck = now
  try {
    Promise.resolve(registration.update()).catch(() => {})
  } catch {
    /* A failed update check is never fatal. */
  }
}

export function setupPwa() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      emitPwaEvent('need-refresh')
    },
    onOfflineReady() {
      emitPwaEvent('offline-ready')
    },
    onRegisteredSW(_swUrl, swRegistration) {
      registration = swRegistration || null
      // An installed app can stay open for days, so re-check whenever the user
      // comes back to it instead of only on a cold start.
      if (!registration) return
      window.addEventListener('focus', checkForPwaUpdate)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForPwaUpdate()
      })
    },
    onRegisterError() {
      /* Registration failure must not break the app. */
    },
  })
}
