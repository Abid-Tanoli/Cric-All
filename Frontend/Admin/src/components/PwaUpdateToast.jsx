import React, { useEffect, useState } from 'react';
import { onPwaEvent } from '../pwa/pwaEvents';
import { applyPwaUpdate } from '../pwa/update';

/** Non-blocking toast for a waiting Admin service worker. */
export default function PwaUpdateToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => onPwaEvent('need-refresh', () => setVisible(true)), []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] z-[110] flex justify-center px-4"
    >
      <div className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-cric-border bg-cric-card px-4 py-3 shadow-2xl">
        <p className="min-w-0 flex-1 text-xs font-bold text-cric-text">
          New version available
        </p>
        <button
          type="button"
          onClick={() => applyPwaUpdate()}
          className="min-h-[44px] shrink-0 rounded-lg bg-cric-accent px-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-orange-600"
        >
          Update
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
  );
}
