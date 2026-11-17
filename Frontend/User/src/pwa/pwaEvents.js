/**
 * Small event bridge between the service-worker registration (which imports the
 * `virtual:pwa-register` module) and the React components that react to it.
 * Components stay free of virtual-module imports so they remain testable in jsdom.
 */
const EVENT_NAME = 'cricall:pwa'

export function emitPwaEvent(type, detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { type, ...detail } }))
}

export function onPwaEvent(type, handler) {
  if (typeof window === 'undefined') return () => {}
  const listener = (event) => {
    if (event.detail?.type === type) handler(event.detail)
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
