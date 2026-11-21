/**
 * Shared install state for the Admin app.
 *
 * `beforeinstallprompt` fires once per page load, so one module-level store
 * captures it and every subscriber reads the same snapshot.
 */
const listeners = new Set()

let deferredPrompt = null
let dismissedThisSession = false
let installed = false
let initialized = false
let snapshot = { canInstall: false, needsManualGuide: false, installed: false }

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
  // iPadOS 13+ reports itself as a Mac; multi-touch gives it away.
  return /macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1
}

function computeSnapshot() {
  const alreadyInstalled = installed || isRunningStandalone()
  return {
    canInstall: Boolean(deferredPrompt) && !alreadyInstalled && !dismissedThisSession,
    // iOS Safari never fires beforeinstallprompt: show the Share-sheet hint.
    needsManualGuide: !alreadyInstalled && !deferredPrompt && isIosDevice(),
    installed: alreadyInstalled,
  }
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
    window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', refresh)
  } catch {
    /* Older Safari only supports addListener; appinstalled covers it. */
  }

  // Publish the first snapshot so iOS and installed launches render correctly
  // without waiting for an event.
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

/** Shows the browser install prompt. BeforeInstallPromptEvent can be used once. */
export async function promptInstall() {
  ensureInitialized()
  if (!deferredPrompt) return { outcome: 'unavailable' }
  const prompt = deferredPrompt
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
