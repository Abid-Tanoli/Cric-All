import React, { useEffect, useState } from 'react'
import { onPwaEvent } from '../pwa/pwaEvents'
import { applyPwaUpdate } from '../pwa/registerPwa'

/**
 * Non-blocking "New version available" toast.
 *
 * A waiting service worker stays waiting until the user reloads, so after a
 * deploy nobody keeps looking at the previous UI.
 */
export default function PwaUpdateToast() {
  const [visible, setVisible] = useState(false)

  useEffect(() => onPwaEvent('need-refresh', () => setVisible(true)), [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] z-[110] flex justify-center px-4"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-cric-border bg-cric-card px-4 py-3 shadow-2xl">
        <p className="min-w-0 flex-1 text-[11px] font-bold text-cric-text">
          New version available.
        </p>
        <button
          type="button"
          onClick={() => applyPwaUpdate()}
          className="min-h-[44px] shrink-0 rounded-lg bg-cric-accent px-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-orange-600"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss update notice"
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg text-cric-muted transition-colors hover:text-cric-text"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
