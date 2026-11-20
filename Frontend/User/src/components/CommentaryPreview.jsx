import { buildPlainOverFeed } from "@shared/scoring/utils/plainCommentary";
import CommentaryBall from "./CommentaryBall";
import CommentaryChip from "./CommentaryChip";
import CommentaryEventRow from "./CommentaryEventRow";
import OverSummaryCard from "./OverSummaryCard";

// Cricbuzz-style plain commentary. Every chip, sentence, end-of-over card and
// event row comes from the shared deterministic builder, so this panel and the
// full commentary tab read the same ball data the same way. No AI call is made.
const eventKey = (over, event, index) =>
  event.kind === "ball"
    ? `${over.overNumber}-${event.delivery.label}`
    : `${over.overNumber}-${event.kind}-${index}`;

export default function CommentaryPreview({
  overs = [],
  players = [],
  onSwitchTab,
  useAiCommentary = false,
  visibleOvers = 3,
  target = 0,
  totalOvers = 0,
}) {
  const feed = buildPlainOverFeed(overs, { players, target, totalOvers });
  const stripOvers = feed.slice(0, 2);
  const listOvers = feed.slice(0, visibleOvers);

  if (feed.length === 0) {
    return (
      <div className="bg-cric-card py-2 sm:py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-cric-text sm:text-lg">Match Centre</h3>
        </div>
        <p className="mt-2 text-xs text-cric-muted sm:mt-3 sm:text-sm">
          Commentary will appear here after the first ball.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-cric-card py-2 sm:py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-black text-cric-text sm:text-lg">Match Centre</h3>
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

      <div className="-mx-2 mt-2 flex gap-2.5 overflow-x-auto px-2 pb-1.5 sm:mt-3">
        {stripOvers.map((over) => (
          <div
            key={over.overNumber}
            className="min-w-[9.5rem] shrink-0 rounded-xl bg-cric-bg p-2.5 ring-1 ring-cric-border"
          >
            <div className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
              Over {over.overNumber}
            </div>
            <div className="mt-0.5 text-xs font-black text-cric-text">
              {over.runs} RUN{over.runs === 1 ? "" : "S"}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {over.balls.map((delivery, index) => (
                <CommentaryChip
                  key={`${over.overNumber}-${index}`}
                  chip={delivery.chip}
                  tone={delivery.tone}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-4 sm:mt-4">
        {listOvers.map((over) => (
          <div key={over.overNumber}>
            <OverSummaryCard entry={over} />

            <div className="mt-1">
              {[...over.events].reverse().map((event, index) => {
                const key = eventKey(over, event, index);
                return event.kind === "ball" ? (
                  <CommentaryBall
                    key={key}
                    delivery={event.delivery}
                    useAiCommentary={useAiCommentary}
                  />
                ) : (
                  <CommentaryEventRow key={key} event={event} />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
