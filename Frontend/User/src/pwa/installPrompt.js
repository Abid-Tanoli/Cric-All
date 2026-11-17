/**
 * Shared install state.
 *
 * `beforeinstallprompt` fires ONCE per page load, so a per-component listener
 * would mean only the first mounted install button ever sees it. One module
 * level store captures the event and every `InstallAppButton` reads the same
 * snapshot through `usePwaInstall()`.
 */

const listeners = new Set()

let deferredPrompt = null
let dismissedThisSession = false
let installed = false
let initialized = false
let snapshot = { canInstall: false, needsManualGuide: false, installed: false }

function computeSnapshot() {
  const alreadyInstalled = installed || isRunningStandalone()
  return {
    canInstall: Boolean(deferredPrompt) && !alreadyInstalled && !dismissedThisSession,
    // iOS Safari never fires beforeinstallprompt: show the Share-sheet guide.
    needsManualGuide: !alreadyInstalled && !deferredPrompt && isIosDevice(),
    installed: alreadyInstalled,
  }
}

function isRunningStandalone() {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true
  } catch {
    /* matchMedia is unavailable in some webviews. */
  }
  return window.navigator?.standalone === true
}

function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iphone|ipad|ipod/i.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac; multi-touch is what gives it away.
  return /macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1
}

function refresh() {
  const next = computeSnapshot()
  const changed =
    next.canInstall !== snapshot.canInstall ||
    next.needsManualGuide !== snapshot.needsManualGuide ||
    next.installed !== snapshot.installed
  snapshot = next
  if (changed) listeners.forEach((listener) => listener())
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  installed = isRunningStandalone()

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-infobar out of the way; the app shows its own
    // "Install app" entries in the navbar, menu, footer and banner.
    event.preventDefault()
    deferredPrompt = event
    refresh()
  })

  window.addEventListener('appinstalled', () => {
    installed = true
    deferredPrompt = null
    refresh()
  })

  try {
    const standaloneQuery = window.matchMedia?.('(display-mode: standalone)')
    standaloneQuery?.addEventListener?.('change', refresh)
  } catch {
    /* Older Safari only supports addListener; the appinstalled event covers it. */
  }

  // Publish the first snapshot: iOS (no beforeinstallprompt) and installed
  // launches must render correctly without waiting for any event.
  refresh()
}

export function subscribeInstall(listener) {
  ensureInitialized()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getInstallSnapshot() {
  ensureInitialized()
  return snapshot
}

/**
 * Shows the browser install prompt. Resolves with the user's choice, or
 * `{ outcome: 'unavailable' }` when the browser did not offer one.
 */
export async function promptInstall() {
  ensureInitialized()
  if (!deferredPrompt) return { outcome: 'unavailable' }
  const prompt = deferredPrompt
  // BeforeInstallPromptEvent can only be used once.
  deferredPrompt = null
  try {
    prompt.prompt()
    const choice = await prompt.userChoice
    if (choice?.outcome !== 'accepted') dismissedThisSession = true
    refresh()
    return choice || { outcome: 'dismissed' }
  } catch {
    dismissedThisSession = true
    refresh()
    return { outcome: 'unavailable' }
  }
}

/** Test helper: forget captured state so a fresh page load can be simulated. */
export function resetInstallPromptState() {
  deferredPrompt = null
  dismissedThisSession = false
  installed = false
  initialized = false
  snapshot = { canInstall: false, needsManualGuide: false, installed: false }
  listeners.clear()
}
