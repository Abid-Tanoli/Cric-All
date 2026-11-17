import React, { useEffect, useRef, useState } from 'react'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { promptInstall } from '../pwa/installPrompt'

const BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-lg font-black uppercase tracking-widest transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cric-accent/60'

const VARIANTS = {
  nav: 'px-4 py-2 text-[10px] border border-cric-accent/50 text-cric-accent hover:bg-cric-accent hover:text-white dark:border-cric-accent/60',
  menu: 'mb-3 w-full rounded-xl border border-cric-accent/50 px-4 py-3 text-xs text-cric-accent hover:bg-cric-accent hover:text-white',
  banner: 'shrink-0 rounded-xl bg-cric-accent px-4 py-3 text-[11px] text-white hover:bg-orange-600',
  footer:
    'min-h-[44px] px-0 py-1 text-xs font-bold normal-case tracking-normal text-cric-text hover:text-cric-accent',
}

function InstallIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0 4-4m-4 4-4-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg className="h-5 w-5 shrink-0 text-cric-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 6.5 3.5-3.5 3.5 3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
    </svg>
  )
}

/** iOS has no install prompt, so the steps are spelled out instead. */
function IosInstallGuide({ onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cricall-install-title"
        className="w-full max-w-sm rounded-2xl border border-cric-border bg-cric-card p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="cricall-install-title"
          className="text-sm font-black uppercase tracking-widest text-cric-text"
        >
          Install CricAll
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-cric-muted">
          Add CricAll to your home screen for full-screen live scores.
        </p>
        <ol className="mt-4 space-y-3 text-xs text-cric-text">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cric-accent/15 text-[10px] font-black text-cric-accent">
              1
            </span>
            <span className="flex items-center gap-2">
              Tap the Share icon <ShareIcon /> in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cric-accent/15 text-[10px] font-black text-cric-accent">
              2
            </span>
            <span>Scroll down and tap &quot;Add to Home Screen&quot;.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cric-accent/15 text-[10px] font-black text-cric-accent">
              3
            </span>
            <span>Tap &quot;Add&quot; — CricAll opens like an app.</span>
          </li>
        </ol>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-5 min-h-[44px] w-full rounded-xl bg-cric-accent px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-orange-600"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

/**
 * "Install app" entry point.
 *
 * - Android Chrome / desktop Chrome + Edge: uses the captured
 *   beforeinstallprompt event.
 * - iOS Safari: opens the Share-sheet steps.
 * - Already installed, or a browser that cannot install (Firefox desktop):
 *   renders nothing, never a dead button.
 */
export default function InstallAppButton({ variant = 'nav', className = '', label = 'Install app' }) {
  const { canInstall, needsManualGuide, installed } = usePwaInstall()
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    if (installed) setGuideOpen(false)
  }, [installed])

  if (installed) return null
  if (!canInstall && !needsManualGuide) return null

  const handleClick = () => {
    if (canInstall) {
      promptInstall()
      return
    }
    setGuideOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`${BASE_CLASS} ${VARIANTS[variant] || VARIANTS.nav} ${className}`}
        aria-label="Install the CricAll app"
      >
        <InstallIcon />
        {label}
      </button>
      {guideOpen && <IosInstallGuide onClose={() => setGuideOpen(false)} />}
    </>
  )
}
