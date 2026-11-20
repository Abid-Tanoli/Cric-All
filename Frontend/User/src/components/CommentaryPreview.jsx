import { buildPlainOverFeed } from "@shared/scoring/utils/plainCommentary";

// Cricbuzz-style plain commentary. Every chip and sentence comes from the
// shared deterministic builder, so this panel, the full commentary tab and the
// scorer feed read the same ball data the same way. No AI call is ever made.
const TONE_CLASS = {
  wicket: "bg-red-600 text-white",
  boundary: "bg-cric-accent text-white",
  extra: "bg-cric-bg text-cric-text ring-1 ring-cric-border",
  normal: "bg-cric-bg text-cric-text ring-1 ring-cric-border",
};

export default function CommentaryPreview({
  overs = [],
  onSwitchTab,
  useAiCommentary = false,
  visibleOvers = 3,
}) {
  const feed = buildPlainOverFeed(overs);
  const stripOvers = feed.slice(0, 2);
  const listOvers = feed.slice(0, visibleOvers);

  if (feed.length === 0) {
    return (
      <div className="bg-cric-card py-2 sm:py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base sm:text-lg font-black text-cric-text">Match Centre</h3>
        </div>
        <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-cric-muted">
          Commentary will appear here after the first ball.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-cric-card py-2 sm:py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base sm:text-lg font-black text-cric-text">Match Centre</h3>
        {onSwitchTab && (
          <button
            type="button"
            onClick={() => onSwitchTab("commentary")}
            className="text-[10px] font-black uppercase tracking-widest text-cric-accent hover:underline"
          >
            View All
          </button>
        )}
      </div>

      <div className="-mx-2 mt-2 flex gap-2 overflow-x-auto px-2 pb-1 sm:mt-3">
        {stripOvers.map((over) => (
          <div
            key={over.overNumber}
            className="min-w-[9rem] shrink-0 rounded-xl bg-cric-bg p-2 ring-1 ring-cric-border"
          >
            <div className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
              Over {over.overNumber}
            </div>
            <div className="text-xs font-black text-cric-text">
              {over.runs} RUN{over.runs === 1 ? "" : "S"}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {over.balls.map((delivery, index) => (
                <span
                  key={`${over.overNumber}-${index}`}
                  title={delivery.label}
                  className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-black ${TONE_CLASS[delivery.tone] || TONE_CLASS.normal}`}
                >
                  {delivery.chip}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 divide-y divide-cric-border sm:mt-3">
        {listOvers.map((over) => (
          <div key={over.overNumber} className="pt-2 sm:pt-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-[9px] font-black uppercase tracking-widest text-cric-muted sm:text-[10px]">
              <span>
                End of over {over.overNumber}: {over.runs} run{over.runs === 1 ? "" : "s"}, score{" "}
                {over.score.runs}/{over.score.wickets}
              </span>
              <span className="normal-case tracking-normal">
                {over.bowlerName}
                {over.bowlerLine ? ` ${over.bowlerLine}` : ""}
              </span>
            </div>

            <div className="mt-1 space-y-1">
              {[...over.balls].reverse().map((delivery, index) => {
                const stored =
                  useAiCommentary && (delivery.ball.vividCommentary || delivery.ball.commentary);
                return (
                  <div
                    key={`${over.overNumber}-${index}`}
                    className="grid grid-cols-[2.25rem_1.5rem_minmax(0,1fr)] items-start gap-1.5"
                  >
                    <span className="pt-0.5 text-[9px] font-bold tabular-nums text-cric-muted sm:text-[10px]">
                      {delivery.label}
                    </span>
                    <span
                      className={`flex h-5 min-w-5 items-center justify-center rounded px-1 text-[9px] font-black ${TONE_CLASS[delivery.tone] || TONE_CLASS.normal}`}
                    >
                      {delivery.chip}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold leading-snug text-cric-text sm:text-xs">
                        {delivery.text}
                      </p>
                      {stored && (
                        <p className="mt-0.5 text-[10px] italic leading-snug text-cric-muted">
                          {stored}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
