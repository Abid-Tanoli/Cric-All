import React from "react";
import { ballChipText, ballChipTone } from "@shared/scoring/utils/plainCommentary";

export const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const ballRuns = (ball) => number(ball?.runs);

const deliverySequence = (ball, index) => {
  const candidates = [
    ball?.rawBallNumber,
    ball?.ballNumber,
    ball?.sequence,
    ball?.deliveryNumber,
  ];
  const numeric = candidates.map(Number).find(Number.isFinite);
  if (numeric != null) return numeric;
  const time = ball?.timestamp || ball?.createdAt;
  const stamp = time ? new Date(time).getTime() : NaN;
  return Number.isFinite(stamp) ? stamp : index;
};

export const orderedBallsForDisplay = (balls = []) =>
  balls
    .map((ball, index) => ({ ball, index, sequence: deliverySequence(ball, index) }))
    .sort((a, b) => {
      if (a.sequence !== b.sequence) return b.sequence - a.sequence;
      return b.index - a.index;
    })
    .map((entry) => entry.ball);

export const ballLabel = (ball) => ballChipText(ball);

export const ballClass = (ball) => {
  if (ball?.wicketCancelled) return "bg-orange-500 text-white ring-2 ring-red-500";
  const tone = ballChipTone(ball);
  if (tone === "wicket") return "bg-red-600 text-white";
  if (tone === "extra") {
    return "bg-orange-100 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800";
  }
  if (tone === "boundary") {
    return ballRuns(ball) === 6 ? "bg-purple-600 text-white" : "bg-cric-accent text-white";
  }
  if (ballRuns(ball) === 0) return "bg-cric-border text-cric-text";
  return "bg-cric-text text-cric-card";
};

export const overRunsAndWickets = (over) => {
  const balls = over?.balls || [];
  const fallbackRuns = balls.reduce(
    (sum, ball) => sum + ballRuns(ball) + number(ball?.extraRuns) + number(ball?.penaltyRuns),
    0
  );
  return {
    runs: number(over?.runsScored, fallbackRuns),
    wickets: number(over?.wickets, balls.filter((ball) => ball?.isWicket).length),
  };
};

export const groupHistoryByOver = (history = []) => {
  const overMap = new Map();
  history.forEach((ball) => {
    const overNumber = ball?.overNumber;
    if (overNumber == null) return;
    if (!overMap.has(overNumber)) {
      overMap.set(overNumber, { overNumber, balls: [] });
    }
    overMap.get(overNumber).balls.push(ball);
  });
  return Array.from(overMap.values());
};

export const latestOversForDisplay = ({ overs = [], history = [] } = {}) => {
  const source = overs.length ? overs : groupHistoryByOver(history);
  return [...source]
    .sort((a, b) => number(b?.overNumber) - number(a?.overNumber))
    .map((over) => ({
      ...over,
      balls: orderedBallsForDisplay(over?.balls || []),
    }));
};

export default function RecentBallsStrip({
  overs = [],
  history = [],
  showLegend = true,
  className = "",
  overClassName = "",
  emptyText = "No balls recorded yet.",
}) {
  const visibleOvers = latestOversForDisplay({ overs, history });

  if (visibleOvers.length === 0) {
    return <p className="text-xs text-cric-muted">{emptyText}</p>;
  }

  return (
    <div className={className || "space-y-3"}>
      {showLegend && (
        <div className="flex gap-2 text-[8px] font-black uppercase text-cric-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-cric-accent" /> Boundary
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-600" /> Wicket
          </span>
        </div>
      )}
      <div className="-mx-2 overflow-x-auto px-2 pb-2">
        <div className="flex min-w-fit gap-3">
          {visibleOvers.map((over) => {
            const summary = overRunsAndWickets(over);
            return (
              <div
                key={over._id || over.overNumber}
                className={`flex shrink-0 items-center gap-3 rounded-xl bg-cric-bg p-3 ring-1 ring-cric-border ${overClassName}`}
              >
                <div className="shrink-0 whitespace-nowrap text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Over {number(over.overNumber) + 1}: {summary.runs} run{summary.runs === 1 ? "" : "s"}
                  {summary.wickets > 0 ? `, ${summary.wickets} wkt` : ""}
                </div>
                <div className="flex flex-nowrap gap-1.5">
                  {(over.balls || []).map((ball, index) => (
                    <span
                      key={ball._id || `${over.overNumber}-${index}`}
                      title={`${number(over.overNumber)}.${ball.displayBallNumber || ball.ballNumber || index + 1}`}
                      className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-black ${ballClass(ball)}`}
                    >
                      {ballLabel(ball)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
