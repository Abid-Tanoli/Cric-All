/**
 * Holds the "activate waiting worker" callback without importing the virtual
 * pwa-register module, so the update toast can be unit tested in jsdom.
 */
let updateHandler = null

export function setPwaUpdateHandler(handler) {
  updateHandler = typeof handler === 'function' ? handler : null
}

export function applyPwaUpdate() {
  if (typeof updateHandler === 'function') return updateHandler()
  if (typeof window !== 'undefined') window.location.reload()
  return undefined
}
