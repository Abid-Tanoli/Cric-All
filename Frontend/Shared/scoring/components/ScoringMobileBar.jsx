import React, { useState, useEffect } from "react";

export default React.memo(function ScoringMobileBar({
  activePanel,
  onPanelChange,
  onMidSession,
  onToggleMenu,
}) {

  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark' ||
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const panels = [
    { id: "management", label: "Score" },
    { id: "main", label: "Live" },
    { id: "sidebar", label: "Menu" },
  ];

  return (
    <div className="xl:hidden sticky top-0 z-50 mb-3 border-b border-cric-border bg-cric-card shadow-md">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleMenu}
          className="score-touch-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cric-border bg-cric-bg text-cric-text text-2xl font-black leading-none"
          aria-label="Open menu"
          title="Menu"
        >
          =
        </button>
        <button
          type="button"
          onClick={() => {
            onPanelChange(activePanel === "management" ? "main" : "management");
            onMidSession?.();
          }}
          className="score-touch-btn flex-1 rounded-xl bg-cric-accent px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-white shadow-md"
        >
          {activePanel === "management" ? "Live Feed" : "Score Now"}
        </button>
        <button
          type="button"
          onClick={() => setIsDark(!isDark)}
          className="score-touch-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cric-border bg-cric-bg text-cric-muted hover:text-cric-accent"
          title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {isDark ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>
      <div className="px-3 pb-2 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cric-muted">
          {panels.find(p => p.id === activePanel)?.label || 'Scoring'} Panel
        </p>
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-cric-border p-1.5">
        {panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            onClick={() => onPanelChange(panel.id)}
            className={`score-touch-btn rounded-lg py-2.5 text-[10px] font-black uppercase tracking-wider transition-all ${
              activePanel === panel.id
                ? "bg-cric-accent text-white shadow-sm"
                : "text-cric-muted hover:bg-cric-bg hover:text-cric-text"
            }`}
          >
            {panel.label}
          </button>
        ))}
      </div>
    </div>
  );
});
