import React, { useMemo, useState } from 'react';
import ScorecardTab from './ScorecardTab';
import CommentaryTab from './CommentaryTab';

const SECTIONS = [
    { id: 'summary', label: 'Summary' },
    { id: 'scorecard', label: 'Scorecard' },
    { id: 'commentary', label: 'Commentary' },
    { id: 'overs', label: 'Overs' },
];

const notationFor = (ball) => {
    if (ball?.isWicket) return 'W';
    if (ball?.isWide) return `${Number(ball.runs) || 0}wd`;
    if (ball?.isNoBall) return `${Number(ball.runs) || 0}nb`;
    if (ball?.isBye) return `${Number(ball.runs) || 0}b`;
    if (ball?.isLegBye) return `${Number(ball.runs) || 0}lb`;
    const runs = Number(ball?.runs) || 0;
    return runs === 0 ? '•' : String(runs);
};

const StatRow = ({ label, value }) => (
    <div className="flex items-center justify-between gap-3 border-b border-cric-border/60 py-2 last:border-0">
        <span className="text-xs font-bold uppercase tracking-wider text-cric-muted">{label}</span>
        <span className="text-sm font-black text-cric-text">{value}</span>
    </div>
);

export default function InningsBreakScreen({
    match,
    data,
    finishedBattingXI = [],
    finishedBowlingXI = [],
    useAICommentary = false,
    onStartNext,
    onUndo,
    reverting = false,
}) {
    const [section, setSection] = useState('summary');
    const { finished = {}, finishedTeam, chasingTeam, score, extras, chase } = data || {};

    const formattedHistory = useMemo(() => {
        const overs = finished?.oversHistory || [];
        return overs.flatMap((over) => (over.balls || []).map((ball) => ({
            ...ball,
            overNumber: over.overNumber,
            displayBallNumber: ball.displayBallNumber || ball.ballNumber,
            batsmanName: ball.batsmanName || ball.batsmanOnStrike?.name || 'Batsman',
            bowlerName: ball.bowlerName || ball.bowler?.name || over.bowler?.name || 'Bowler',
        })));
    }, [finished]);

    return (
        <div className="min-h-[60vh] max-w-full overflow-x-hidden bg-cric-bg text-cric-text">
            <div className="sticky top-0 z-40 border-b border-cric-border bg-cric-card px-3 py-3 shadow-sm">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cric-accent">Innings break</p>
                        <h1 className="truncate text-lg font-black uppercase leading-tight sm:text-2xl">
                            {finishedTeam?.name || 'First innings'} innings complete
                        </h1>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-amber-600">
                        Review
                    </span>
                </div>
            </div>

            <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-5">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
                    <section className="rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">
                            {finishedTeam?.name || 'Batting team'} · 1st innings
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
                            <p className="text-5xl font-black leading-none tracking-tight sm:text-6xl">
                                {score?.runs || 0}<span className="text-cric-accent">/</span>{score?.wickets || 0}
                            </p>
                            <p className="text-base font-bold text-cric-muted">({score?.overs || '0.0'} ov)</p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                            <span className="rounded-full bg-cric-bg px-3 py-1">Extras {extras?.total || 0}</span>
                            <span className="rounded-full bg-cric-bg px-3 py-1">w {extras?.wides || 0}</span>
                            <span className="rounded-full bg-cric-bg px-3 py-1">nb {extras?.noBalls || 0}</span>
                            <span className="rounded-full bg-cric-bg px-3 py-1">b {extras?.byes || 0}</span>
                            <span className="rounded-full bg-cric-bg px-3 py-1">lb {extras?.legByes || 0}</span>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-cric-accent/30 bg-cric-card p-4 shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-accent">Target</p>
                        <p className="mt-1 text-xl font-black leading-tight sm:text-2xl">
                            {chasingTeam?.name || 'Chasing team'} need {chase?.runsNeeded || 0} runs from {chase?.ballsRemaining || 0} balls
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                            <div className="rounded-xl bg-cric-bg p-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Target</p>
                                <p className="text-lg font-black">{chase?.target || 0}</p>
                            </div>
                            <div className="rounded-xl bg-cric-bg p-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Req. rate</p>
                                <p className="text-lg font-black">{(chase?.requiredRunRate || 0).toFixed(2)}</p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onStartNext}
                            className="score-touch-btn mt-3 w-full rounded-xl bg-cric-accent px-4 py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg transition-all hover:scale-[1.01]"
                        >
                            Start Next Innings
                        </button>
                        <button
                            type="button"
                            onClick={onUndo}
                            disabled={reverting}
                            className="score-touch-btn mt-2 w-full rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-4 text-sm font-black uppercase tracking-widest text-red-500 transition-all hover:bg-red-500 hover:text-white disabled:cursor-wait disabled:opacity-60"
                        >
                            {reverting ? 'Undoing…' : 'Undo last ball'}
                        </button>
                        <p className="mt-2 text-center text-[10px] font-bold text-cric-muted">
                            Undo the final ball if the innings ended on a mistake.
                        </p>
                    </section>
                </div>

                <div className="flex gap-1.5 overflow-x-auto border-b border-cric-border pb-2 no-scrollbar">
                    {SECTIONS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setSection(item.id)}
                            aria-pressed={section === item.id}
                            className={`score-touch-btn shrink-0 rounded-full px-4 py-2.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                                section === item.id
                                    ? 'bg-cric-accent text-white'
                                    : 'border border-cric-border bg-cric-card text-cric-muted hover:text-cric-text'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                {section === 'summary' && (
                    <div className="grid gap-3 md:grid-cols-2">
                        <section className="rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
                            <h2 className="text-xs font-black uppercase tracking-[0.25em] text-cric-accent">Top batters</h2>
                            <div className="mt-2">
                                {(data?.topBatters || []).length === 0 && (
                                    <p className="py-2 text-xs font-semibold text-cric-muted">No batting data.</p>
                                )}
                                {(data?.topBatters || []).map((row) => (
                                    <div key={row.id || row.name} className="flex items-center justify-between gap-3 border-b border-cric-border/60 py-2 last:border-0">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-black">{row.name}</p>
                                            <p className="text-[10px] font-bold text-cric-muted">
                                                {row.balls} balls · {row.fours}×4 · {row.sixes}×6
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-base font-black">{row.runs}</p>
                                            <p className="text-[10px] font-bold text-cric-muted">SR {row.strikeRate.toFixed(2)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
                            <h2 className="text-xs font-black uppercase tracking-[0.25em] text-blue-500">Top bowlers</h2>
                            <div className="mt-2">
                                {(data?.topBowlers || []).length === 0 && (
                                    <p className="py-2 text-xs font-semibold text-cric-muted">No bowling data.</p>
                                )}
                                {(data?.topBowlers || []).map((row) => (
                                    <div key={row.id || row.name} className="flex items-center justify-between gap-3 border-b border-cric-border/60 py-2 last:border-0">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-black">{row.name}</p>
                                            <p className="text-[10px] font-bold text-cric-muted">
                                                {row.overs}-{row.maidens}-{row.runs}-{row.wickets} · Econ {row.economy.toFixed(2)}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-base font-black">{row.wickets}w</p>
                                            <p className="text-[10px] font-bold text-cric-muted">{row.overs} ov</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
                            <h2 className="text-xs font-black uppercase tracking-[0.25em] text-cric-accent">Fall of wickets</h2>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {(data?.fallOfWickets || []).length === 0 && (
                                    <p className="py-2 text-xs font-semibold text-cric-muted">No wickets.</p>
                                )}
                                {(data?.fallOfWickets || []).map((wicket) => (
                                    <span key={wicket.key} className="rounded-full bg-cric-bg px-3 py-1.5 text-[11px] font-bold">
                                        {wicket.wickets}-{wicket.runs} ({wicket.name}{wicket.overs ? `, ${wicket.overs}` : ''})
                                    </span>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm">
                            <h2 className="text-xs font-black uppercase tracking-[0.25em] text-cric-muted">Overs summary</h2>
                            <div className="mt-2">
                                {(data?.oversSummary || []).length === 0 && (
                                    <p className="py-2 text-xs font-semibold text-cric-muted">No overs bowled.</p>
                                )}
                                {(data?.oversSummary || []).map((row) => (
                                    <StatRow
                                        key={row.id || row.name}
                                        label={row.name}
                                        value={`${row.overs}-${row.maidens}-${row.runs}-${row.wickets}`}
                                    />
                                ))}
                            </div>
                        </section>
                    </div>
                )}

                {section === 'scorecard' && (
                    <div className="rounded-2xl border border-cric-border bg-cric-card p-2 sm:p-3">
                        <ScorecardTab
                            curInn={finished}
                            battingTeamName={finishedTeam?.name || 'Batting Team'}
                            bowlingTeamName={chasingTeam?.name || 'Bowling Team'}
                            battingPlayingXI={finishedBattingXI}
                            bowlingPlayingXI={finishedBowlingXI}
                            battingXI={finishedBattingXI}
                            bowlingXI={finishedBowlingXI}
                            selectedMatch={match}
                        />
                    </div>
                )}

                {section === 'commentary' && (
                    <div className="rounded-2xl border border-cric-border bg-cric-card p-3 sm:p-4">
                        <CommentaryTab
                            formattedHistory={formattedHistory}
                            oversHistory={finished?.oversHistory || []}
                            setActiveTab={() => setSection('summary')}
                            useAICommentary={useAICommentary}
                        />
                    </div>
                )}

                {section === 'overs' && (
                    <div className="space-y-2">
                        {(finished?.oversHistory || []).length === 0 && (
                            <p className="rounded-2xl border border-cric-border bg-cric-card p-6 text-center text-sm font-semibold text-cric-muted">
                                No overs recorded.
                            </p>
                        )}
                        {(finished?.oversHistory || []).slice().reverse().map((over, index) => {
                            const runs = (over.balls || []).reduce(
                                (sum, ball) => sum + (Number(ball.runs) || 0) + (ball.isWide ? 1 : 0) + (ball.isNoBall ? 1 : 0),
                                0
                            );
                            const wickets = (over.balls || []).filter((ball) => ball.isWicket).length;
                            const bowler = over.bowler?.name
                                || data?.oversSummary?.find((row) => String(row.id) === String(over.bowler?._id || over.bowler))?.name
                                || 'Bowler';
                            return (
                                <div key={over._id || over.overNumber || index} className="rounded-2xl border border-cric-border bg-cric-card p-3 shadow-sm">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-cric-accent">Over {(Number(over.overNumber) || 0) + 1}</p>
                                            <p className="truncate text-[10px] font-bold text-cric-muted">{bowler}</p>
                                        </div>
                                        <p className="shrink-0 text-xs font-black">
                                            {runs} run{runs === 1 ? '' : 's'}
                                            {wickets > 0 && <span className="ml-2 text-red-500">{wickets}w</span>}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(over.balls || []).map((ball, ballIndex) => (
                                            <span
                                                key={ball._id || ballIndex}
                                                className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-black ${
                                                    ball.isWicket ? 'bg-red-600 text-white'
                                                        : Number(ball.runs) === 6 && !ball.isWide && !ball.isNoBall ? 'bg-purple-600 text-white'
                                                            : Number(ball.runs) === 4 && !ball.isWide && !ball.isNoBall ? 'bg-blue-600 text-white'
                                                                : ball.isWide || ball.isNoBall ? 'bg-amber-500 text-white'
                                                                    : 'bg-cric-bg text-cric-text'
                                                }`}
                                            >
                                                {notationFor(ball)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
