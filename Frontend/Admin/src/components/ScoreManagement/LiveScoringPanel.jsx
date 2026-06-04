import React, { useRef } from 'react';

const LiveScoringPanel = ({
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
    formattedHistory,
    formatOvers,
    onRetire,
}) => {
    const scrollRef = useRef(null);

    const scrollToOver = (direction) => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;
        const markers = Array.from(container.querySelectorAll('[data-type="over"]'));
        if (markers.length === 0) return;

        const currentScroll = container.scrollLeft;
        let target = null;

        if (direction === 'next') { // Older history (Right)
            target = markers.find(m => m.offsetLeft > currentScroll + 50);
        } else { // Newer history (Left)
            target = [...markers].reverse().find(m => m.offsetLeft < currentScroll - 50);
        }

        if (target) {
            container.scrollTo({
                left: target.offsetLeft - 12,
                behavior: 'smooth'
            });
        } else if (direction === 'prev') {
            container.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
        }
    };

    const isStrikerOut = strikerStats?.isOut || strikerStats?.isRetiredHurt || strikerStats?.isRetired;
    const isNonStrikerOut = nonStrikerStats?.isOut || nonStrikerStats?.isRetiredHurt || nonStrikerStats?.isRetired;

    return (
        <div className="space-y-8 animate-fadeIn">
            {selectedMatch?.result?.resultType === 'super_over' && (
                <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 p-4 rounded-3xl">
                    <div className="w-10 h-10 bg-amber-500 rounded-2xl flex items-center justify-center text-white text-xl">⚡</div>
                    <div>
                        <h3 className="text-sm font-black text-amber-600 uppercase tracking-tighter">
                            Super Over {Math.floor((selectedMatch.innings.length - 2) / 2) + 1}
                        </h3>
                        <p className="text-[10px] font-bold text-amber-600/70 uppercase tracking-widest">
                            {selectedMatch.innings.length % 2 === 0 ? '1st Innings' : '2nd Innings'} • Target: {selectedMatch.innings[selectedMatch.currentInnings]?.target || 'N/A'}
                        </p>
                    </div>
                </div>
            )}
            {/* Score Overlays, Batsmen, Bowlers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Batsmen Card */}
                <div className="bg-black/5 dark:bg-black/20 rounded-[2.5rem] p-8 border border-cric-border">
                    <h3 className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-6">Current Batters</h3>
                    <div className="space-y-6">
                        <div className={`flex justify-between items-center transition-opacity duration-500 ${isStrikerOut ? 'opacity-30 grayscale' : ''}`}>
                            <div className="flex-1">
                                <div className={`text-xl font-black text-cric-text flex items-center gap-2 ${isStrikerOut ? 'line-through' : ''}`}>
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
                            <div className="text-right">
                                <div className="text-2xl font-black text-cric-text">{Math.max(0, strikerStats?.runs || 0)} ({Math.max(0, strikerStats?.balls || 0)})</div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">4s: {strikerStats?.fours || 0} | 6s: {strikerStats?.sixes || 0}</div>
                            </div>
                        </div>
                        <div className="h-px bg-cric-border" />
                        <div className={`flex justify-between items-center transition-opacity duration-500 ${isNonStrikerOut ? 'opacity-30 grayscale' : 'opacity-60'}`}>
                            <div className="flex-1">
                                <div className={`text-xl font-black text-cric-text ${isNonStrikerOut ? 'line-through' : ''}`}>
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
                            <div className="text-right">
                                <div className="text-2xl font-black text-cric-text">{Math.max(0, nonStrikerStats?.runs || 0)} ({Math.max(0, nonStrikerStats?.balls || 0)})</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bowler Card */}
                <div className="bg-black/5 dark:bg-black/20 rounded-[2.5rem] p-8 border border-cric-border">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Active Bowler</h3>
                    <div className="flex justify-between items-center">
                        <div>
                            <div className="text-xl font-black text-blue-500 dark:text-blue-400">
                                {bowlingXI.find(p => String(p._id) === String(bowlerId))?.name || 'Waiting...'}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">Currently Bowling</div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-black text-cric-text">
                                {activeBowlerStats?.wickets || 0}/{activeBowlerStats?.runs || 0}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase mt-1">
                                OVERS: {formatOvers(activeBowlerStats?.balls || 0)}
                            </div>
                        </div>
                    </div>

                    {/* Win Probability Heuristic Visual */}
                    <div className="mt-8 pt-8 border-t border-cric-border">
                        <div className="flex justify-between text-[10px] font-black uppercase mb-2 text-cric-text">
                            <span>{selectedMatch.teams[0].name} {Math.round(winProb.team1)}%</span>
                            <span>{selectedMatch.teams[1].name} {Math.round(winProb.team2)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-black/10 dark:bg-white/5 rounded-full overflow-hidden flex">
                            <div className="h-full bg-cric-accent" style={{ width: `${winProb.team1}%` }} />
                            <div className="h-full bg-blue-500" style={{ width: `${winProb.team2}%` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Balls */}
            <div className="bg-black/5 dark:bg-black/20 rounded-[2.5rem] p-8 border border-cric-border overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Recent Balls</h3>
                    <div className="flex gap-2">
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                            <span className="text-[8px] font-black text-slate-500 uppercase">Boundary</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-red-600"></div>
                            <span className="text-[8px] font-black text-slate-500 uppercase">Wicket</span>
                        </div>
                    </div>
                </div>
                
                <div className="relative group -mx-8 px-8">
                    {/* Navigation Arrows */}
                    <button 
                        onClick={() => scrollToOver('prev')}
                        className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-cric-accent text-white rounded-full border border-white/20 opacity-0 group-hover:opacity-100 transition-all shadow-xl backdrop-blur-md"
                        title="Newer Overs"
                    >
                        <span className="text-xl font-bold">‹</span>
                    </button>

                    <button 
                        onClick={() => scrollToOver('next')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-cric-accent text-white rounded-full border border-white/20 opacity-0 group-hover:opacity-100 transition-all shadow-xl backdrop-blur-md"
                        title="Previous Overs"
                    >
                        <span className="text-xl font-bold">›</span>
                    </button>

                    <div 
                        ref={scrollRef}
                        className="flex items-center gap-3 overflow-x-auto pb-4 no-scrollbar scroll-smooth"
                    >
                    {(() => {
                        const getOrdinal = (n) => {
                            const s = ["th", "st", "nd", "rd"];
                            const v = n % 100;
                            return (s[(v - 20) % 10] || s[v] || s[0]);
                        };

                        // Calculate runs per over
                        const overRuns = formattedHistory.reduce((acc, ball) => {
                            const ov = ball.overNumber;
                            if (acc[ov] === undefined) acc[ov] = 0;
                            acc[ov] += (ball.runs || 0) + (ball.isWide || ball.isNoBall ? 1 : 0);
                            return acc;
                        }, {});

                        // Show more history to allow scrolling
                        const history = [...formattedHistory].slice(-60);
                        const elements = [];
                        let currentOver = -1;

                        history.forEach((ball, i) => {
                            if (ball.overNumber !== currentOver) {
                                if (currentOver !== -1) {
                                    elements.push({ 
                                        type: 'over', 
                                        label: `${currentOver + 1}${getOrdinal(currentOver + 1)}`,
                                        runs: overRuns[currentOver] || 0
                                    });
                                }
                                currentOver = ball.overNumber;
                            }
                            elements.push({ type: 'ball', ...ball });
                        });
                        
                        if (currentOver !== -1) {
                            elements.push({ 
                                type: 'over', 
                                label: `${currentOver + 1}${getOrdinal(currentOver + 1)}`,
                                runs: overRuns[currentOver] || 0
                            });
                        }

                        return elements.reverse().map((el, idx) => (
                            el.type === 'over' ? (
                                <div 
                                    key={`ov-${idx}`} 
                                    data-type="over"
                                    className="flex items-center justify-center min-w-[90px] h-9 bg-cric-accent/10 rounded-full border border-cric-accent/30 shrink-0 mx-2 px-4 shadow-sm backdrop-blur-sm"
                                >
                                    <span className="text-[10px] font-black text-cric-accent uppercase tracking-tighter">{el.label}</span>
                                    <span className="mx-1.5 text-[10px] text-cric-accent/40 font-bold">•</span>
                                    <span className="text-[12px] font-black text-white/90 tabular-nums">
                                        {el.runs}
                                    </span>
                                </div>
                            ) : (
                                <div key={`ball-${idx}`} className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-sm border-2 shrink-0 transition-all hover:scale-110 cursor-default ${el.isWicket ? 'bg-red-600 border-red-400 text-white shadow-lg shadow-red-600/20 animate-pulse' : el.runs === 4 ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-600/20' : el.runs === 6 ? 'bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-600/20' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                                    {el.isWicket ? 'W' : (el.runs === 0 && !el.isWide && !el.isNoBall) ? '•' : String(el.runs || 0)}
                                </div>
                            )
                        ));
                    })()}
                </div>
            </div>
            </div>

            {/* Last Ball Analysis */}
            <div className="bg-black/5 rounded-[2.5rem] p-8 border border-black/5">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Last Ball Analysis</h3>
                {formattedHistory.length > 0 ? (
                    <div className="space-y-4">
                        <div className="flex gap-4 items-start">
                            <div className="text-xl font-black text-cric-accent whitespace-nowrap">{formatOvers(formattedHistory[formattedHistory.length - 1].ballNumber)}</div>
                            <div className="space-y-2">
                                <div className="text-lg font-bold text-slate-900 leading-tight mb-3">
                                    {(() => {
                                        const lastBall = formattedHistory[formattedHistory.length - 1];
                                        const runs = lastBall.runs || 0;
                                        const getRunLabel = () => {
                                            if (lastBall.isWicket) return "OUT!";
                                            if (lastBall.isWide) return "wide";
                                            if (lastBall.isNoBall) return "no ball";
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
                                {(formattedHistory[formattedHistory.length - 1].vividCommentary || formattedHistory[formattedHistory.length - 1].commentary) && (
                                    <div className="bg-black/2 p-4 rounded-2xl border border-black/5 space-y-2">
                                        <p className="text-slate-600 text-sm italic font-medium leading-relaxed">
                                            {formattedHistory[formattedHistory.length - 1].vividCommentary || formattedHistory[formattedHistory.length - 1].commentary}
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
};

export default LiveScoringPanel;
