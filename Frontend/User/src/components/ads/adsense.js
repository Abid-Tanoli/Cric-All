/**
 * Minimal Google AdSense loader.
 *
 * Nothing is loaded unless VITE_ADS_ENABLED === 'true' and a valid client id is
 * configured. The script is injected lazily (after window load, during idle
 * time) so it never blocks first paint, and it is injected only once per page.
 */
const SCRIPT_ID = 'cricall-adsense-loader'
const SCRIPT_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'

let loadPromise = null
let loadFailed = false
// Hard guard on top of the React guard: one push per DOM slot, even if the
// component is re-rendered or React StrictMode runs effects twice.
const pushedSlots = new Set()

export function getClientId() {
  return (import.meta.env.VITE_ADSENSE_CLIENT || '').trim()
}

export function isAdsEnabled() {
  return (
    import.meta.env.VITE_ADS_ENABLED === 'true' &&
    /^ca-pub-\d+$/.test(getClientId())
  )
}

export function isAdTestMode() {
  return import.meta.env.VITE_ADSENSE_TEST === 'true'
}

/**
 * @returns {Promise<boolean>} true when the Google loader is available, false
 * when it was blocked (ad blocker/offline). Never rejects and never logs.
 */
export function loadAdsense() {
  if (loadFailed) return Promise.resolve(false)
  if (window.adsbygoogle && document.getElementById(SCRIPT_ID)) {
    return Promise.resolve(true)
  }
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve) => {
    const schedule = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => injectScript(resolve), { timeout: 2000 })
      } else {
        window.setTimeout(() => injectScript(resolve), 0)
      }
    }
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })
  })
  return loadPromise
}

function injectScript(resolve) {
  if (document.getElementById(SCRIPT_ID)) {
    resolve(Boolean(window.adsbygoogle))
    return
  }
  const script = document.createElement('script')
  script.id = SCRIPT_ID
  script.async = true
  script.crossOrigin = 'anonymous'
  script.src = `${SCRIPT_SRC}?client=${encodeURIComponent(getClientId())}`
  script.onload = () => resolve(true)
  script.onerror = () => {
    // Ad blocker or network failure: recover quietly, no console error.
    loadFailed = true
    loadPromise = null
    resolve(false)
  }
  document.head.appendChild(script)
}

/**
 * Push the AdSense fill request once for a given slot instance.
 * @returns {boolean} false when this slot was already pushed.
 */
export function pushSlot(key) {
  if (pushedSlots.has(key)) return false
  pushedSlots.add(key)
  try {
    ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    return true
  } catch {
    // A broken/stale adsbygoogle array must never crash the page.
    return false
  }
}

/** Test helper: forget loader/push state between cases. */
export function resetAdsenseForTests() {
  pushedSlots.clear()
  loadPromise = null
  loadFailed = false
  document.getElementById(SCRIPT_ID)?.remove()
  delete window.adsbygoogle
}
