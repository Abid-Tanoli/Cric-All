import CommentaryChip from "./CommentaryChip";

// The end-of-over band shared by the Match Centre preview and the commentary
// tab: over runs, team score, the over's chips, both batters at the crease and
// both bowlers (this over's and the other end's). Every figure comes straight
// from the shared builder, so neither panel can drift.
export default function OverSummaryCard({ entry }) {
  if (!entry) return null;

  return (
    <section className="my-2 rounded-xl border border-cric-border bg-cric-bg p-3 shadow-sm sm:my-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-cric-accent sm:text-[11px]">
            {entry.title}
          </h4>
          <span className="text-xs font-black text-cric-text sm:text-sm">{entry.runsText}</span>
        </div>
        <span className="rounded-md bg-cric-card px-2 py-0.5 text-[11px] font-black tabular-nums text-cric-text ring-1 ring-cric-border sm:text-xs">
          {entry.scoreText}
        </span>
      </header>

      {entry.chaseText && (
        <p className="mt-1 text-[10px] font-bold text-orange-600 dark:text-orange-400 sm:text-[11px]">
          {entry.chaseText}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {entry.balls.map((delivery, index) => (
          <CommentaryChip
            key={`${entry.overNumber}-${index}`}
            chip={delivery.chip}
            tone={delivery.tone}
          />
        ))}
      </div>

      {(entry.batters.length > 0 || entry.bowlers.length > 0) && (
        <div className="mt-3 grid gap-3 border-t border-cric-border pt-2.5 sm:grid-cols-2">
          {entry.batters.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
                At the crease
              </p>
              <ul className="mt-1 space-y-1">
                {entry.batters.map((batter) => (
                  <li
                    key={batter.id}
                    className="flex items-baseline justify-between gap-2 text-xs sm:text-[13px]"
                  >
                    <span className="min-w-0 truncate font-semibold text-cric-text">
                      {batter.name || "Batter"}
                      {batter.onStrike && <span className="ml-0.5 text-cric-accent">*</span>}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums text-cric-muted">
                      {batter.runs} ({batter.balls})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entry.bowlers.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
                Bowling
              </p>
              <ul className="mt-1 space-y-1">
                {entry.bowlers.map((bowler) => (
                  <li
                    key={bowler.id || bowler.name}
                    className="flex items-baseline justify-between gap-2 text-xs sm:text-[13px]"
                  >
                    <span
                      className={`min-w-0 truncate ${
                        bowler.isCurrent
                          ? "font-bold text-cric-text"
                          : "font-semibold text-cric-muted"
                      }`}
                    >
                      {bowler.name || "Bowler"}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums text-cric-muted">
                      {bowler.line}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
