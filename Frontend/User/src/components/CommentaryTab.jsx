import { useMemo, useState } from "react";
import { ballRuns } from "../utils/matchHelpers";
import { buildPlainOverFeed, overNumberOf } from "@shared/scoring/utils/plainCommentary";
import CommentaryBall from "./CommentaryBall";
import CommentaryEventRow from "./CommentaryEventRow";
import OverSummaryCard from "./OverSummaryCard";

const eventKey = (over, event, index) =>
  event.kind === "ball"
    ? `${over.overNumber}-${event.delivery.label}`
    : `${over.overNumber}-${event.kind}-${index}`;

export default function CommentaryTab({
  overs,
  players = [],
  visibleOvers,
  onLoadMore,
  useAiCommentary = false,
  target = 0,
  totalOvers = 0,
}) {
  const [filter, setFilter] = useState('all');
  const [compact, setCompact] = useState(false);

  const filteredOvers = useMemo(() => {
    if (filter === 'all') return overs.slice(0, visibleOvers);
    return overs.filter(over => {
      return (over.balls || []).some(ball => {
        if (filter === 'fours' && ballRuns(ball) === 4) return true;
        if (filter === 'sixes' && ballRuns(ball) === 6) return true;
        if (filter === 'wickets' && ball?.isWicket) return true;
        return false;
      });
    }).slice(0, visibleOvers);
  }, [overs, filter, visibleOvers]);

  const visible = filteredOvers;
  const feedByOver = useMemo(() => {
    const map = new Map();
    buildPlainOverFeed(overs, { players, target, totalOvers }).forEach((entry) =>
      map.set(entry.overNumber, entry)
    );
    return map;
  }, [overs, players, target, totalOvers]);

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="bg-cric-card rounded-xl shadow-sm border border-cric-border p-1.5 sm:p-2 flex items-center justify-between flex-wrap gap-1.5 sm:gap-2">
        <div className="flex gap-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'fours', label: 'Fours', color: 'bg-cric-accent' },
            { key: 'sixes', label: 'Sixes', color: 'bg-purple-600' },
            { key: 'wickets', label: 'Wickets', color: 'bg-red-600' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all ${
                filter === f.key
                  ? `${f.color || 'bg-cric-accent'} text-white`
                  : 'text-cric-muted hover:text-cric-text bg-cric-bg'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCompact(c => !c)}
          className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all ${
            compact ? 'bg-cric-accent text-white' : 'text-cric-muted hover:text-cric-text bg-cric-bg'
          }`}
        >
          {compact ? 'Full' : 'Compact'}
        </button>
      </div>

      {visible.length ? visible.map((over) => {
        const entry = feedByOver.get(overNumberOf(over));
        if (!entry) return null;
        return (
          <div
            key={over._id || over.overNumber}
            className="overflow-hidden rounded-xl bg-cric-card p-2 shadow-sm ring-1 ring-cric-border sm:p-3"
          >
            <OverSummaryCard entry={entry} />

            <div className="mt-1 sm:mt-2">
              {[...entry.events].reverse().map((event, index) => {
                const key = eventKey(entry, event, index);
                return event.kind === "ball" ? (
                  <CommentaryBall
                    key={key}
                    delivery={event.delivery}
                    useAiCommentary={useAiCommentary}
                    compact={compact}
                  />
                ) : (
                  <CommentaryEventRow key={key} event={event} />
                );
              })}
            </div>
          </div>
        );
      }) : (
        <div className="rounded-xl bg-cric-card p-6 sm:p-8 text-center shadow-sm ring-1 ring-cric-border">
          <p className="text-2xl sm:text-3xl mb-2 sm:mb-3">Commentary</p>
          <p className="text-xs sm:text-sm font-black text-cric-muted">
            {filter === 'all' ? 'No commentary yet.' : `No ${filter} in this match.`}
          </p>
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')} className="mt-2 text-xs font-bold text-cric-accent hover:underline">
              Show all commentary
            </button>
          )}
        </div>
      )}

      {filter === 'all' && overs.length > visibleOvers && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full rounded-xl bg-cric-accent px-4 py-3 font-black text-white text-xs sm:text-sm hover:opacity-90 transition-all shadow-md"
        >
          Load More Commentary
        </button>
      )}
    </section>
  );
}
