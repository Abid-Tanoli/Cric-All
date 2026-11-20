import { useMemo, useState } from "react";
import { number, playerName, ballRuns, overRunsAndWickets } from "../utils/matchHelpers";
import { buildPlainOverFeed } from "@shared/scoring/utils/plainCommentary";
import { orderedBallsForDisplay } from "./RecentBallsStrip";
import BallBadge from "./BallBadge";
import CommentaryBall from "./CommentaryBall";

export default function CommentaryTab({ overs, players, visibleOvers, onLoadMore, useAiCommentary = false }) {
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
  const overSummaries = useMemo(() => {
    const map = new Map();
    buildPlainOverFeed(overs).forEach((entry) => map.set(entry.overNumber, entry));
    return map;
  }, [overs]);

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

      {visible.length ? visible.map((over) => (
        <div key={over._id || over.overNumber} className="overflow-hidden rounded-xl bg-cric-card shadow-sm ring-1 ring-cric-border">
          <div className="p-3 sm:p-4">
            <div className="bg-cric-bg rounded-xl p-3 sm:p-4 mb-2 sm:mb-3 border border-cric-border">
              <div className="flex justify-between items-start flex-wrap gap-1.5 sm:gap-2">
                <div>
                  <span className="text-cric-accent font-black text-sm sm:text-base">Over {number(over.overNumber) + 1}</span>
                  <span className="text-cric-muted text-[11px] sm:text-xs ml-2 sm:ml-3">
                    {overRunsAndWickets(over).runs} run{overRunsAndWickets(over).runs !== 1 ? "s" : ""}
                    {overRunsAndWickets(over).wickets > 0 && <span className="text-red-500"> | {overRunsAndWickets(over).wickets} wkt{overRunsAndWickets(over).wickets !== 1 ? "s" : ""}</span>}
                  </span>
                </div>
                <div className="text-right text-[9px] sm:text-[10px] text-cric-muted font-bold uppercase tracking-widest">
                  {playerName(over.bowler, players)}
                </div>
              </div>
              {overSummaries.get(number(over.overNumber) + 1)?.complete && (
                <p className="text-cric-muted text-[11px] sm:text-xs mt-1.5 sm:mt-2 leading-relaxed border-t border-cric-border pt-1.5 sm:pt-2">
                  End of over {number(over.overNumber) + 1}: {overRunsAndWickets(over).runs} run
                  {overRunsAndWickets(over).runs === 1 ? "" : "s"}, score{" "}
                  {overSummaries.get(number(over.overNumber) + 1).score.runs}/
                  {overSummaries.get(number(over.overNumber) + 1).score.wickets}
                  {overSummaries.get(number(over.overNumber) + 1).bowlerLine
                    ? ` · ${playerName(over.bowler, players)} ${overSummaries.get(number(over.overNumber) + 1).bowlerLine}`
                    : ""}
                </p>
              )}
              <div className="flex gap-1 sm:gap-1.5 mt-1.5 sm:mt-2 flex-wrap">
                {orderedBallsForDisplay(over.balls || []).map((b, i) => (
                  <BallBadge key={i} ball={b} small />
                ))}
              </div>
            </div>

            <div className="space-y-0.5 sm:space-y-1">
              {orderedBallsForDisplay(over.balls || []).map((ball, index) => (
                <CommentaryBall
                  key={ball._id || index}
                  over={over}
                  ball={ball}
                  players={players}
                  compact={compact}
                  useAiCommentary={useAiCommentary}
                />
              ))}
            </div>
          </div>
        </div>
      )) : (
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
