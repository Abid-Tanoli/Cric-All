import { registerSW } from 'virtual:pwa-register'
import { emitPwaEvent } from './pwaEvents'
import { setPwaUpdateHandler } from './update'

/**
 * `registerType: 'prompt'` in vite.config.js means a new worker WAITS. The app
 * shows a "New version available — Update" toast and only then calls
 * updateSW(true), which activates the worker and reloads once.
 */
let registration = null
let lastUpdateCheck = 0
const UPDATE_CHECK_INTERVAL_MS = 60 * 1000

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

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      emitPwaEvent('need-refresh')
    },
    onOfflineReady() {
      emitPwaEvent('offline-ready')
    },
    onRegisteredSW(_swUrl, swRegistration) {
      registration = swRegistration || null
      if (!registration) return
      // Re-check on focus/visibility: an installed admin app can stay open for
      // days, and stale workers must be replaced cleanly on the next deploy.
      window.addEventListener('focus', checkForPwaUpdate)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForPwaUpdate()
      })
    },
    onRegisterError() {
      /* Registration failure must not break the admin app. */
    },
  })

  setPwaUpdateHandler(() => updateSW(true))
}
