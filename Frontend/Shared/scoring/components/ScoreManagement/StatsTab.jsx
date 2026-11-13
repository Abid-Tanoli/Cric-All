import React from 'react';

const formatOvers = (balls = 0) => `${Math.floor(balls / 6)}.${balls % 6}`;
const sum = (arr, fn) => arr.reduce((s, i) => s + (fn(i) || 0), 0);

export default React.memo(function StatsTab({ innings, strikerStats, nonStrikerStats, activeBowlerStats, totalOvers }) {
    if (!innings) {
        return (
            <div className="flex items-center justify-center min-h-[300px] bg-black/10 dark:bg-white/5 rounded-[2.5rem] border border-white/5">
                <div className="text-center p-8">
                    <div className="text-4xl mb-4 opacity-30">📊</div>
                    <p className="text-sm font-bold text-slate-500">No innings data yet</p>
                    <p className="text-[10px] text-slate-600 mt-2">Statistics will appear once the match starts.</p>
                </div>
            </div>
        );
    }

    const allBalls = (innings.oversHistory || []).flatMap(o => o.balls || []);
    const legalBalls = allBalls.filter(b => !b.isWide && !b.isNoBall);
    const dotBalls = legalBalls.filter(b => !b.runs && !b.isWicket);
    const fours = legalBalls.filter(b => b.runs === 4);
    const sixes = legalBalls.filter(b => b.runs === 6);
    const dots = legalBalls.filter(b => b.runs === 0 && !b.isWicket).length;
    const dotBallPct = legalBalls.length > 0 ? ((dots / legalBalls.length) * 100).toFixed(1) : '0.0';
    const boundaries = fours.length + sixes.length;
    const boundaryPct = legalBalls.length > 0 ? ((boundaries / legalBalls.length) * 100).toFixed(1) : '0.0';
    const runsInBoundaries = (fours.length * 4) + (sixes.length * 6);
    const runsInSingles = legalBalls.filter(b => b.runs === 1).length;
    const runsInTwos = legalBalls.filter(b => b.runs === 2).length * 2;
    const runsInThrees = legalBalls.filter(b => b.runs === 3).length * 3;
    const runsFromRunning = runsInSingles + runsInTwos + runsInThrees;

    const topBatsman = [...(innings.batting || [])]
        .sort((a, b) => (b.runs || 0) - (a.runs || 0))
        .slice(0, 3);

    const topBowlers = [...(innings.bowling || [])]
        .sort((a, b) => (b.wickets || 0) - (a.wickets || 0))
        .slice(0, 3);

    const projectedScore = innings.runRate > 0 && totalOvers
        ? Math.round(innings.runRate * totalOvers)
        : null;

    const runRate = innings.runRate || 0;
    const reqRunRate = innings.requiredRunRate || 0;
    const remainingOvers = totalOvers ? Math.max(0, totalOvers - (innings.balls / 6)) : 0;

    return (
        <div className="space-y-6 animate-fadeIn">
            <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Live Match Statistics</h3>

            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Current RR</p>
                    <p className="text-3xl font-black text-cric-text">{runRate.toFixed(2)}</p>
                </div>
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Required RR</p>
                    <p className={`text-3xl font-black ${innings.target && reqRunRate > 0 ? 'text-cric-accent' : 'text-cric-muted'}`}>
                        {innings.target && reqRunRate > 0 ? reqRunRate.toFixed(2) : '—'}
                    </p>
                </div>
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Projected</p>
                    <p className="text-3xl font-black text-cric-text">
                        {projectedScore ? `${projectedScore}` : '—'}
                    </p>
                </div>
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Remaining Overs</p>
                    <p className="text-3xl font-black text-cric-text">
                        {innings.target && totalOvers ? formatOvers(remainingOvers * 6) : formatOvers(innings.balls)}
                    </p>
                </div>
            </div>

            {/* Batting & Bowling Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Batting Breakdown */}
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-6 border border-cric-border/50">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">Batting Breakdown</h4>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-semibold text-cric-muted">Dot Balls</span>
                            <span className="text-lg font-black text-cric-text">{dots} ({dotBallPct}%)</span>
                        </div>
                        <div className="w-full h-2 bg-black/10 dark:bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-slate-500 rounded-full" style={{ width: `${dotBallPct}%` }} />
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-semibold text-cric-muted">Boundaries</span>
                            <span className="text-lg font-black text-cric-text">{boundaries} ({boundaryPct}%)</span>
                        </div>
                        <div className="w-full h-2 bg-black/10 dark:bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-cric-accent rounded-full" style={{ width: `${boundaryPct}%` }} />
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-semibold text-cric-muted">Runs from Boundaries</span>
                            <span className="text-lg font-black text-cric-text">{runsInBoundaries}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-semibold text-cric-muted">Runs from Running</span>
                            <span className="text-lg font-black text-cric-text">{runsFromRunning}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-semibold text-cric-muted">Extras</span>
                            <span className="text-lg font-black text-cric-text">{innings.extras?.total || 0}</span>
                        </div>
                    </div>
                </div>

                {/* Current Batters */}
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-6 border border-cric-border/50">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">Current Batters</h4>
                    <div className="space-y-4">
                        {strikerStats && (
                            <div className="bg-cric-accent/5 rounded-xl p-4 border border-cric-accent/20">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-black text-cric-text">{strikerStats.player?.name || 'Striker'} <span className="text-cric-accent">*</span></span>
                                    <span className="text-xl font-black text-cric-text">{strikerStats.runs || 0}</span>
                                </div>
                                <div className="text-xs text-cric-muted">
                                    {strikerStats.balls || 0} balls • {strikerStats.fours || 0} fours • {strikerStats.sixes || 0} sixes • SR: {((strikerStats.runs || 0) / Math.max(strikerStats.balls || 0, 1) * 100).toFixed(1)}
                                </div>
                            </div>
                        )}
                        {nonStrikerStats && (
                            <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-xl p-4 border border-cric-border/40">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-black text-cric-text">{nonStrikerStats.player?.name || 'Non-Striker'}</span>
                                    <span className="text-xl font-black text-cric-text">{nonStrikerStats.runs || 0}</span>
                                </div>
                                <div className="text-xs text-cric-muted">
                                    {nonStrikerStats.balls || 0} balls • {nonStrikerStats.fours || 0} fours • {nonStrikerStats.sixes || 0} sixes • SR: {((nonStrikerStats.runs || 0) / Math.max(nonStrikerStats.balls || 0, 1) * 100).toFixed(1)}
                                </div>
                            </div>
                        )}
                        {!strikerStats && !nonStrikerStats && (
                            <p className="text-sm text-cric-muted italic">No batting data yet</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Top Batters & Bowlers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-6 border border-cric-border/50">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">Top Batters</h4>
                    {topBatsman.length > 0 ? (
                        <div className="space-y-3">
                            {topBatsman.map((b, i) => (
                                <div key={i} className="flex items-center justify-between py-2 border-b border-cric-border/30 last:border-0">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-[10px] font-black text-cric-muted w-5">{i + 1}.</span>
                                        <span className="text-sm font-bold text-cric-text truncate">{b.player?.name || 'Player'}</span>
                                    </div>
                                    <span className="text-sm font-black text-cric-text shrink-0">{b.runs || 0} ({b.balls || 0})</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-cric-muted italic">No batting data yet</p>
                    )}
                </div>
                <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-6 border border-cric-border/50">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">Top Bowlers</h4>
                    {topBowlers.length > 0 ? (
                        <div className="space-y-3">
                            {topBowlers.map((b, i) => (
                                <div key={i} className="flex items-center justify-between py-2 border-b border-cric-border/30 last:border-0">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-[10px] font-black text-cric-muted w-5">{i + 1}.</span>
                                        <span className="text-sm font-bold text-cric-text truncate">{b.player?.name || 'Player'}</span>
                                    </div>
                                    <span className="text-sm font-black text-cric-text shrink-0">{b.wickets || 0}/{b.runs || 0} ({formatOvers(b.balls || 0)})</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-cric-muted italic">No bowling data yet</p>
                    )}
                </div>
            </div>

            {/* Extras Breakdown */}
            <div className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-6 border border-cric-border/50">
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">Extras Breakdown</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                        { label: 'Wides', value: innings.extras?.wides || 0 },
                        { label: 'No Balls', value: innings.extras?.noBalls || 0 },
                        { label: 'Byes', value: innings.extras?.byes || 0 },
                        { label: 'Leg Byes', value: innings.extras?.legByes || 0 },
                        { label: 'Penalties', value: innings.extras?.penalties || 0 },
                    ].map(ext => (
                        <div key={ext.label} className="bg-black/[0.02] dark:bg-white/[0.02] rounded-xl p-4 text-center border border-cric-border/30">
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">{ext.label}</p>
                            <p className="text-2xl font-black text-cric-text">{ext.value}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});