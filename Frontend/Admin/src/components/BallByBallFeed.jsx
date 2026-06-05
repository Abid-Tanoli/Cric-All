import React, { useRef, useEffect, useState } from "react";

// Ball notation badge
function BallBadge({ ball, small = false }) {
    const isWicket = ball.isWicket;
    const isLegBye = ball.isLegBye;
    const isBye = ball.isBye;
    const notation = isWicket ? "W"
        : isLegBye ? "LB"
            : isBye ? "B"
                : (ball.runs === 0 && !ball.isWide && !ball.isNoBall) ? "•" : String(ball.runs || 0);

    const isFour = ball.runs === 4 && !ball.isWide && !ball.isNoBall && !ball.isWicket && !isLegBye && !isBye;
    const isSix = ball.runs === 6 && !ball.isWide && !ball.isNoBall && !ball.isWicket && !isLegBye && !isBye;
    const isWide = ball.isWide;
    const isNoBall = ball.isNoBall;

    const base = small ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs";
    const color = isWicket
        ? "bg-red-600 text-white shadow-red-500/40"
        : isSix ? "bg-purple-600 text-white shadow-purple-500/40"
            : isFour ? "bg-blue-600 text-white shadow-blue-500/40"
                : (isWide || isNoBall || isLegBye || isBye) ? "bg-amber-500 text-white shadow-amber-500/40"
                    : "bg-white/10 text-slate-300 shadow-white/5";

    return (
        <div className={`${base} ${color} rounded-lg flex items-center justify-center font-black shrink-0 shadow`}>
            {notation}
        </div>
    );
}

// Format over.ball string (e.g. ball 9 → "1.3")
function fmtOver(totalBalls) {
    const over = Math.floor((totalBalls - 1) / 6);
    const ball = ((totalBalls - 1) % 6) + 1;
    return `${over}.${ball}`;
}

// Header for one ball
function BallHeader({ ball, overNum, ballNum, onEdit }) {
    const notation = ball.notation || (ball.isWicket ? "W" : ball.runs === 0 ? "•" : String(ball.runs));
    const typeLabel = ball.isWicket
        ? ball.wicketType?.toUpperCase() || "WICKET"
        : ball.isWide ? `${ball.runs + 1} WIDE`
            : ball.isNoBall ? `NB+${ball.runs}`
                : ball.isBye ? "BYE"
                    : ball.isLegBye ? "LEG BYE"
                        : ball.runs === 4 ? "FOUR"
                            : ball.runs === 6 ? "SIX"
                                : ball.runs === 0 ? "DOT"
                                    : `${ball.runs} RUN${ball.runs !== 1 ? "S" : ""}`;

    return (
        <div className="flex items-center gap-3 group">
            <BallBadge ball={ball} />
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-slate-900 font-bold text-sm leading-tight">
                        {overNum}.{ballNum} {ball.bowlerName || 'Bowler'} to {ball.batsmanName || 'Batsman'}, {(() => {
                            const runs = ball.runs || 0;
                            if (ball.isWicket) return "OUT!";
                            if (ball.isWide) return "wide";
                            if (ball.isNoBall) return "no ball";
                            if (ball.isLegBye) return "leg bye";
                            if (ball.isBye) return "bye";
                            if (runs === 0) return "no run";
                            if (runs === 1) return "1 run";
                            if (runs === 2) return "2 runs";
                            if (runs === 3) return "3 runs";
                            if (runs === 4) return "FOUR";
                            if (runs === 6) return "SIX";
                            return `${runs} runs`;
                        })()}
                    </span>
                </div>
            </div>
            {onEdit && (
                <button
                    onClick={() => onEdit(ball)}
                    className="opacity-0 group-hover:opacity-100 text-[9px] font-black text-slate-500 hover:text-[#ff6b35] border border-white/5 hover:border-[#ff6b35]/50 px-3 py-1 rounded-full uppercase tracking-widest transition-all shrink-0"
                >
                    Edit
                </button>
            )}
        </div>
    );
}

// Commentary line below header
function CommentaryLine({ text, loading }) {
    if (loading) {
        return (
            <div className="ml-12 flex gap-1 items-center mt-1">
                {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
                <span className="text-slate-600 text-[10px] italic ml-1">AI commentary...</span>
            </div>
        );
    }
    if (!text) return null;
    return (
        <p className="ml-12 text-[11px] text-slate-400 italic leading-relaxed mt-0.5">
            {text}
        </p>
    );
}

// Over block - BQ-PLAY style
function OverBlock({ over, balls, onEdit, showReadMore, onReadMore, allPlayers }) {
    const overRuns = over.runsScored ?? balls.reduce((s, b) => s + (b.runs || 0) + (b.isWide ? 1 : 0) + (b.isNoBall ? 1 : 0), 0);
    const overWickets = over.wickets ?? balls.filter(b => b.isWicket).length;
    const bowlerName = over.bowlerName || balls[0]?.bowlerName || "Bowler";

    // Sort balls newest first (highest ballNumber first)
    const sortedBalls = [...balls].reverse();

    return (
        <div className="border-l-2 border-white/5 pl-4">
            {/* Over Header Summary */}
            <div className="bg-black/30 rounded-2xl p-4 mb-3 border border-white/5">
                <div className="flex justify-between items-start flex-wrap gap-2">
                    <div>
                        <span className="text-[#ff6b35] font-black text-base">Over {over.overNumber + 1}</span>
                        <span className="text-slate-400 text-[11px] ml-3">
                            {overRuns} run{overRuns !== 1 ? "s" : ""}
                            {overWickets > 0 && <span className="text-red-400"> | {overWickets} wkt{overWickets !== 1 ? "s" : ""}</span>}
                        </span>
                    </div>
                    <div className="text-right text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        {bowlerName}
                    </div>
                </div>
                {over.summary && (
                    <p className="text-slate-400 text-[11px] italic mt-2 leading-relaxed border-t border-white/5 pt-2">
                        {over.summary}
                    </p>
                )}
                {/* Mini wagon-wheel for this over */}
                <div className="flex gap-1.5 mt-2 flex-wrap">
                    {[...balls].map((b, i) => (
                        <BallBadge key={i} ball={b} small />
                    ))}
                </div>
            </div>

            {/* Ball-by-ball (newest to oldest) */}
            <div className="space-y-3">
                {sortedBalls.map((ball, idx) => (
                    <div key={idx} className={`p-3 rounded-xl transition-all ${ball.isWicket ? "bg-red-950/20 border border-red-500/10" : "hover:bg-white/2"}`}>
                        <BallHeader
                            ball={ball}
                            overNum={over.overNumber}
                            ballNum={ball.ballNumber}
                            onEdit={onEdit}
                        />
                        {(ball.vividCommentary || ball.commentary) && (
                            <div className="ml-12 mt-2">
                                <p className="text-[12px] text-slate-600 italic leading-relaxed">
                                    {ball.vividCommentary || ball.commentary}
                                </p>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {showReadMore && (
                <button
                    onClick={onReadMore}
                    className="mt-3 text-[10px] font-black text-[#ff6b35] uppercase tracking-widest hover:underline"
                >
                    Read full commentary →
                </button>
            )}
        </div>
    );
}

// Edit Ball Modal
function EditBallModal({ ball, overNum, ballNum, onSave, onClose }) {
    const [commentary, setCommentary] = useState(ball.commentary ?? "");
    const [vividCommentary, setVividCommentary] = useState(ball.vividCommentary ?? "");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        await onSave({
            overNumber: overNum,
            ballNumber: ballNum,
            runs,
            isWide: extra === "WIDE",
            isNoBall: extra === "NO BALL",
            isBye: extra === "BYE",
            isLegBye: extra === "LEG BYE",
            isWicket: !!wicket,
            wicketType: wicket,
            commentary,
            vividCommentary
        });
        setSaving(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-[#141b24] rounded-[2.5rem] border border-white/10 p-8 w-full max-w-lg shadow-2xl my-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-2xl font-black font-raj italic uppercase text-white">
                        Edit Ball {overNum}.{ballNum}
                    </h3>
                    <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-red-500 transition-all">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Runs & Extras */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2 block">Runs</label>
                            <select value={runs} onChange={e => setRuns(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-bold outline-none">
                                {[0, 1, 2, 3, 4, 5, 6].map(r => <option key={r} value={r} className="bg-[#141b24]">{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2 block">Extra</label>
                            <select value={extra} onChange={e => setExtra(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-bold outline-none uppercase">
                                {["", "WIDE", "NO BALL", "BYE", "LEG BYE"].map(e => <option key={e} value={e} className="bg-[#141b24]">{e || "None"}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Wicket */}
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2 block">Wicket</label>
                        <select value={wicket} onChange={e => setWicket(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-bold outline-none uppercase">
                            {["", "bowled", "caught", "lbw", "run out", "stumped", "hit wicket"].map(w => <option key={w} value={w} className="bg-[#141b24]">{w || "No Wicket"}</option>)}
                        </select>
                    </div>

                    {/* Commentary Fields */}
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2 block">Broadcast Line (Main)</label>
                        <textarea
                            value={commentary}
                            onChange={e => setCommentary(e.target.value)}
                            rows={2}
                            placeholder="Bowler to Batsman, Result..."
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white text-sm outline-none focus:border-[#ff6b35] transition-all resize-none"
                        />
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2 block">Technical Analysis (Next line)</label>
                        <textarea
                            value={vividCommentary}
                            onChange={e => setVividCommentary(e.target.value)}
                            rows={3}
                            placeholder="Detailed technical description here..."
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white text-sm outline-none focus:border-[#ff6b35] transition-all resize-none"
                        />
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full py-5 rounded-2xl bg-[#ff6b35] text-white font-black font-raj text-xl italic uppercase shadow-xl hover:scale-105 transition-all disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Update Ball & Commentary"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function BallByBallFeed({ history = [], overs = [], onEdit, onSwitchTab, compact = false }) {
    const scrollRef = useRef(null);
    const [editingBall, setEditingBall] = useState(null);

    useEffect(() => {
        if (scrollRef.current && !compact) {
            scrollRef.current.scrollTop = 0;
        }
    }, [history]);

    if (!history || history.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500 italic text-sm">
                Waiting for the first ball...
            </div>
        );
    }

    // Group history into overs
    const groupedOvers = {};
    history.forEach(ball => {
        const overNum = ball.overNumber ?? Math.floor((ball.ballNumber - 1) / 6);
        if (!groupedOvers[overNum]) groupedOvers[overNum] = { overNumber: overNum, balls: [] };
        groupedOvers[overNum].balls.push(ball);
    });

    // Match over summaries from overs prop
    overs.forEach(ov => {
        if (groupedOvers[ov.overNumber]) {
            groupedOvers[ov.overNumber].summary = ov.summary;
            groupedOvers[ov.overNumber].runsScored = ov.runsScored;
            groupedOvers[ov.overNumber].wickets = ov.wickets;
            groupedOvers[ov.overNumber].bowlerName = ov.bowlerName;
        }
    });

    // Sort overs newest first
    let sortedOvers = Object.values(groupedOvers).sort((a, b) => b.overNumber - a.overNumber);

    // If compact (like on the live page), only show the last 4 overs as requested
    if (compact) {
        sortedOvers = sortedOvers.slice(0, 4);
    }

    const handleEdit = (ball) => {
        setEditingBall(ball);
    };

    return (
        <div ref={scrollRef} className="space-y-8">
            {sortedOvers.map((over, idx) => (
                <OverBlock
                    key={over.overNumber}
                    over={over}
                    balls={over.balls}
                    onEdit={onEdit ? handleEdit : null}
                    showReadMore={!compact && idx === 2}
                    onReadMore={() => onSwitchTab && onSwitchTab("commentary")}
                />
            ))}

            {editingBall && onEdit && (
                <EditBallModal
                    ball={editingBall}
                    overNum={editingBall.overNumber ?? Math.floor((editingBall.ballNumber - 1) / 6)}
                    ballNum={editingBall.ballNumber}
                    onSave={async (data) => {
                        await onEdit({ ...editingBall, ...data });
                    }}
                    onClose={() => setEditingBall(null)}
                />
            )}
        </div>
    );
}
