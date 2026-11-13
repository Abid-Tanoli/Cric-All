import React from 'react';
import RecentBallsStrip, { number } from '../../../../Shared/components/RecentBallsStrip.jsx';

const deliveryOverText = (ball) => {
    if (!ball) return "0.0";
    return `${number(ball.overNumber)}.${ball.displayBallNumber || ball.ballNumber || 1}`;
};

const LiveScoringPanel = React.memo(({
    battingXI,
    bowlingXI,
    strikerId,
    nonStrikerId,
    bowlerId,
    strikerStats,
    nonStrikerStats,
    activeBowlerStats,
    winProb,
    selectedMatch,
    formattedHistory = [],
    formatOvers,
    onRetire,
}) => {
    const isStrikerOut = strikerStats?.isOut || strikerStats?.isRetiredHurt || strikerStats?.isRetired;
    const isNonStrikerOut = nonStrikerStats?.isOut || nonStrikerStats?.isRetiredHurt || nonStrikerStats?.isRetired;
    const lastBall = formattedHistory[formattedHistory.length - 1];

    return (
        <div className="space-y-4 sm:space-y-8 animate-fadeIn">
            {selectedMatch?.result?.resultType === 'super_over' && (
                <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-3xl">
                    <div className="w-10 h-10 bg-amber-500 rounded-2xl flex items-center justify-center text-white text-xl">SO</div>
                    <div>
                        <h3 className="text-sm font-black text-amber-600 uppercase tracking-tighter">
                            Super Over {Math.floor((selectedMatch.innings.length - 2) / 2) + 1}
                        </h3>
                        <p className="text-[10px] font-bold text-amber-600/70 uppercase tracking-widest">
                            {selectedMatch.innings.length % 2 === 0 ? '1st Innings' : '2nd Innings'} - Target: {selectedMatch.innings[selectedMatch.currentInnings]?.target || 'N/A'}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-black/5 dark:bg-black/20 rounded-2xl sm:rounded-[2.5rem] p-4 sm:p-8 border border-cric-border">
                    <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-6">Current Batters</h3>
                    <div className="space-y-6">
                        <div className={`flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center transition-opacity duration-500 ${isStrikerOut ? 'opacity-30 grayscale' : ''}`}>
                            <div className="flex-1 min-w-0">
                                <div className={`text-base sm:text-xl font-black text-cric-text flex items-center gap-2 break-words ${isStrikerOut ? 'line-through' : ''}`}>
                                    {battingXI.find(p => String(p._id) === String(strikerId))?.name || 'Waiting...'}
                                    {!isStrikerOut && <span className="text-cric-accent">*</span>}
                                </div>
                                <div className="flex items-center gap-4 mt-1">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Striker</div>
                                    {!isStrikerOut && strikerId && (
                                        <button
                                            onClick={() => onRetire?.(strikerId, 'retired_hurt')}
                                            className="text-[9px] font-black text-amber-500 hover:text-amber-600 transition-colors uppercase tracking-widest border border-amber-500/20 px-2 py-0.5 rounded-full"
                                        >
                                            Retired Hurt
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="text-left sm:text-right shrink-0">
                                <div className="text-2xl font-black text-cric-text">{Math.max(0, strikerStats?.runs || 0)} ({Math.max(0, strikerStats?.balls || 0)})</div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">4s: {strikerStats?.fours || 0} | 6s: {strikerStats?.sixes || 0}</div>
                            </div>
                        </div>
                        <div className="h-px bg-cric-border" />
                        <div className={`flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center transition-opacity duration-500 ${isNonStrikerOut ? 'opacity-30 grayscale' : 'opacity-60'}`}>
                            <div className="flex-1 min-w-0">
                                <div className={`text-base sm:text-xl font-black text-cric-text break-words ${isNonStrikerOut ? 'line-through' : ''}`}>
                                    {battingXI.find(p => String(p._id) === String(nonStrikerId))?.name || 'Waiting...'}
                                </div>
                                <div className="flex items-center gap-4 mt-1">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Non-Striker</div>
                                    {!isNonStrikerOut && nonStrikerId && (
                                        <button
                                            onClick={() => onRetire?.(nonStrikerId, 'retired_hurt')}
                                            className="text-[9px] font-black text-amber-500 hover:text-amber-600 transition-colors uppercase tracking-widest border border-amber-500/20 px-2 py-0.5 rounded-full"
                                        >
                                            Retired Hurt
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="text-left sm:text-right shrink-0">
                                <div className="text-2xl font-black text-cric-text">{Math.max(0, nonStrikerStats?.runs || 0)} ({Math.max(0, nonStrikerStats?.balls || 0)})</div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">4s: {nonStrikerStats?.fours || 0} | 6s: {nonStrikerStats?.sixes || 0}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-black/5 dark:bg-black/20 rounded-2xl sm:rounded-[2.5rem] p-4 sm:p-8 border border-cric-border">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Active Bowler</h3>
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                        <div className="min-w-0">
                            <div className="text-base sm:text-xl font-black text-blue-500 dark:text-blue-400 break-words">
                                {bowlingXI.find(p => String(p._id) === String(bowlerId))?.name || 'Waiting...'}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">Currently Bowling</div>
                        </div>
                        <div className="text-left sm:text-right shrink-0">
                            <div className="text-2xl font-black text-cric-text">
                                {activeBowlerStats?.wickets || 0}/{activeBowlerStats?.runs || 0}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">
                                OVERS: {formatOvers(activeBowlerStats?.balls || 0)}
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 pt-8 border-t border-cric-border">
                        <div className="flex justify-between text-[10px] font-black uppercase mb-2 text-cric-text">
                            <span>{selectedMatch?.teams?.[0]?.name || 'Team A'} {Math.round(winProb.team1)}%</span>
                            <span>{selectedMatch?.teams?.[1]?.name || 'Team B'} {Math.round(winProb.team2)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-black/10 dark:bg-white/5 rounded-full overflow-hidden flex">
                            <div className="h-full bg-cric-accent" style={{ width: `${winProb.team1}%` }} />
                            <div className="h-full bg-blue-500" style={{ width: `${winProb.team2}%` }} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-black/5 dark:bg-black/20 rounded-2xl sm:rounded-[2.5rem] p-4 sm:p-8 border border-cric-border overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Recent Balls</h3>
                </div>
                <RecentBallsStrip history={formattedHistory} />
            </div>

            <div className="bg-black/5 rounded-2xl sm:rounded-[2.5rem] p-4 sm:p-8 border border-black/5">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Last Ball Analysis</h3>
                {lastBall ? (
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start">
                            <div className="text-xl font-black text-cric-accent whitespace-nowrap">{deliveryOverText(lastBall)}</div>
                            <div className="space-y-2">
                                <div className="text-lg font-bold text-slate-900 leading-tight mb-3">
                                    {(() => {
                                        const runs = lastBall.runs || 0;
                                        const getRunLabel = () => {
                                            if (lastBall.isWicket) return "OUT!";
                                            if (lastBall.isWide) return "wide";
                                            if (lastBall.isNoBall) return "no ball";
                                            if (lastBall.isLegBye) return "leg bye";
                                            if (lastBall.isBye) return "bye";
                                            if (runs === 0) return "no run";
                                            if (runs === 1) return "1 run";
                                            if (runs === 2) return "2 runs";
                                            if (runs === 3) return "3 runs";
                                            if (runs === 4) return "FOUR";
                                            if (runs === 6) return "SIX";
                                            return `${runs} runs`;
                                        };
                                        return `${lastBall.bowlerName || 'Bowler'} to ${lastBall.batsmanName || 'Batsman'}, ${getRunLabel()}`;
                                    })()}
                                </div>
                                {(lastBall.vividCommentary || lastBall.commentary) && (
                                    <div className="bg-black/2 p-4 rounded-2xl border border-black/5 space-y-2">
                                        <p className="text-slate-600 text-sm italic font-medium leading-relaxed">
                                            {lastBall.vividCommentary || lastBall.commentary}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-slate-500 italic text-sm">Waiting for the first ball to be bowled...</div>
                )}
            </div>
        </div>
    );
});

export default LiveScoringPanel;
