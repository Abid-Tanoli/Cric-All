import React from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { promptInstall } from '../pwa/installPrompt';

/**
 * Admin PWA install entry point for the sidebar.
 *
 * - Chrome/Edge: button only when beforeinstallprompt is available.
 * - iOS Safari: no prompt is fired, so show a short Share-sheet hint instead.
 * - Installed or unsupported browsers: render nothing.
 */
export default function InstallAdminButton({ className = '' }) {
  const { canInstall, needsManualGuide, installed } = usePwaInstall();

  if (installed) return null;

  if (needsManualGuide) {
    return (
      <p className={`px-4 py-2 text-[11px] leading-snug text-cric-muted ${className}`}>
        Share &gt; Add to Home Screen
      </p>
    );
  }

  if (!canInstall) return null;

  return (
    <button
      type="button"
      onClick={() => promptInstall()}
      aria-label="Install the CricAll Admin app"
      className={`mx-3 mb-2 flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-cric-accent/50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-cric-accent transition-colors hover:bg-cric-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cric-accent/60 ${className}`}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0 4-4m-4 4-4-4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2" />
      </svg>
      Install Admin app
    </button>
  );
}
