import React from 'react';
import { formatOvers } from './constants';

const ballLabel = (ball) => {
  if (!ball) return '';
  if (ball.isWicket) return 'W';
  if (ball.isWide) return `${ball.runs || 0}wd`;
  if (ball.isNoBall) return `${ball.runs || 0}nb`;
  if (ball.isBye) return `${ball.runs || 0}b`;
  if (ball.isLegBye) return `${ball.runs || 0}lb`;
  return ball.runs === 0 ? '•' : String(ball.runs || 0);
};

const ballTone = (ball) => {
  if (ball?.isWicket) return 'bg-red-600 text-white';
  if (ball?.runs === 6 && !ball?.isWide && !ball?.isNoBall) return 'bg-purple-600 text-white';
  if (ball?.runs === 4 && !ball?.isWide && !ball?.isNoBall) return 'bg-blue-600 text-white';
  if (ball?.isWide || ball?.isNoBall || ball?.isBye || ball?.isLegBye) return 'bg-amber-500 text-white';
  return 'bg-black/10 text-cric-text dark:bg-white/10';
};

const nameOf = (players, id) => (players || []).find((player) => String(player._id || player) === String(id))?.name || '—';

export default function ScoringScoreHeader({
  curInn,
  battingXI = [],
  bowlingXI = [],
  strikerId,
  nonStrikerId,
  bowlerId,
  strikerStats,
  nonStrikerStats,
  activeBowlerStats,
  isInnings2 = false,
  target = 0,
  totalOvers = 0,
  nextBowlerRequired = false,
  onOpenBowler,
}) {
  const overs = curInn?.oversHistory || [];
  const thisOver = overs[overs.length - 1];
  const chips = thisOver?.balls || [];
  const striker = nameOf(battingXI, strikerId);
  const nonStriker = nameOf(battingXI, nonStrikerId);
  const bowler = nameOf(bowlingXI, bowlerId);
  const bowlerOvers = formatOvers(activeBowlerStats?.balls ?? Math.round((activeBowlerStats?.overs || 0) * 6));

  return (
    <div className="rounded-2xl border border-cric-border bg-cric-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-cric-muted">Live score</p>
          <p className="mt-0.5 truncate text-sm font-black text-cric-text">
            {curInn?.team?.name || 'Batting side'}
          </p>
          {isInnings2 && target > 0 && (
            <p className="mt-0.5 text-[10px] font-bold text-cric-accent">
              Need {Math.max(0, target - (curInn?.runs || 0))} from {Math.max(0, (Number(totalOvers) || 0) * 6 - (curInn?.balls || 0))} balls
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-black italic leading-none tabular-nums text-cric-text">
            {curInn?.runs || 0}/{curInn?.wickets || 0}
          </div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
            {formatOvers(curInn?.balls)} ov
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="min-w-0 rounded-lg bg-cric-bg px-2 py-1.5">
          <p className="font-black text-cric-text">
            <span className="text-cric-accent">•</span> {striker}
          </p>
          <p className="font-bold tabular-nums text-cric-muted">
            {strikerStats?.runs || 0} ({strikerStats?.balls || 0})
          </p>
        </div>
        <div className="min-w-0 rounded-lg bg-cric-bg px-2 py-1.5">
          <p className="truncate font-black text-cric-text">{nonStriker}</p>
          <p className="font-bold tabular-nums text-cric-muted">
            {nonStrikerStats?.runs || 0} ({nonStrikerStats?.balls || 0})
          </p>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 rounded-lg bg-cric-bg px-2 py-1.5">
          <p className="truncate font-black text-cric-text">{bowler}</p>
          <p className="shrink-0 font-bold tabular-nums text-cric-muted">
            {bowlerOvers}-{activeBowlerStats?.maidens || 0}-{activeBowlerStats?.runs || 0}-{activeBowlerStats?.wickets || 0}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-cric-muted">
          This over
        </span>
        {chips.length === 0 && <span className="text-[10px] font-semibold text-cric-muted">—</span>}
        {chips.map((ball, index) => (
          <span
            key={ball._id || `${index}-${ball.ballNumber}`}
            className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 text-[10px] font-black ${ballTone(ball)}`}
          >
            {ballLabel(ball)}
          </span>
        ))}
      </div>

      {nextBowlerRequired && (
        <button
          type="button"
          onClick={onOpenBowler}
          className="score-touch-btn mt-3 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
        >
          Over complete — select next bowler
        </button>
      )}
    </div>
  );
}
