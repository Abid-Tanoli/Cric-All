import React, { useEffect, useState } from 'react'
import InstallAppButton from './InstallAppButton'
import { usePwaInstall } from '../hooks/usePwaInstall'

const STORAGE_KEY = 'cricall:pwa-install-dismissed-at'
const DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

function dismissedRecently() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const dismissedAt = Number(raw)
    if (!Number.isFinite(dismissedAt)) return false
    return Date.now() - dismissedAt < DISMISS_WINDOW_MS
  } catch {
    // Private mode or a blocked storage API: show the banner instead of failing.
    return false
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    /* Storage unavailable — the banner simply shows again next visit. */
  }
}

/**
 * Dismissible bottom banner for first visits on installable browsers.
 * "Not now" hides it for ~14 days, then it may appear once more.
 */
export default function InstallAppBanner({ delayMs = 2500 }) {
  const { canInstall, needsManualGuide, installed } = usePwaInstall()
  const [visible, setVisible] = useState(false)

  const installable = canInstall || needsManualGuide

  useEffect(() => {
    if (installed || !installable || dismissedRecently()) {
      setVisible(false)
      return undefined
    }
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [installable, installed, delayMs])

  if (!visible || !installable) return null

  const dismiss = () => {
    rememberDismissal()
    setVisible(false)
  }

  return (
    <div
      role="region"
      aria-label="Install CricAll"
      className="pwa-safe-bottom fixed inset-x-0 bottom-0 z-[90] border-t border-cric-border bg-cric-card/95 px-4 pt-3 shadow-2xl backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 pb-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-widest text-cric-text">
            Install CricAll
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-cric-muted">
            Faster live scores, one tap away.
          </p>
        </div>
        <InstallAppButton variant="banner" label="Install" />
        <button
          type="button"
          onClick={dismiss}
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-xl border border-cric-border px-3 text-[10px] font-black uppercase tracking-widest text-cric-muted transition-colors hover:text-cric-text"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
