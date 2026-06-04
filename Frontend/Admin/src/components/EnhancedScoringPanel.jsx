import React, { useState, useEffect } from "react";
import { useToast } from "./Toast";

export default function EnhancedScoringPanel({ onSubmitBall, onEndInnings, onBack, currentBatsmen, currentBowler, selectedZoneLabel }) {
    const [runs, setRuns] = useState(0);
    const [extra, setExtra] = useState(null); // 'WIDE', 'NO BALL', 'BYE', 'LEG BYE'
    const [wicket, setWicket] = useState(null);
    const [strikerId, setStrikerId] = useState("");
    const [nonStrikerId, setNonStrikerId] = useState("");
    const [bowlerId, setBowlerId] = useState("");
    const [commentary, setCommentary] = useState("");
    const { showToast } = useToast();
    const [pitchZone, setPitchZone] = useState("");
    const [ballMovement, setBallMovement] = useState("none");
    const [ballOutcome, setBallOutcome] = useState("played");

    const movementOptions = [
        ["none", "None"], ["inswing", "Inswing"], ["outswing", "Outswing"],
        ["off-cutter", "Off Cutter"], ["leg-cutter", "Leg Cutter"],
        ["seam-movement", "Seam"], ["leg-spin", "Leg Spin"], ["off-spin", "Off Spin"],
        ["googly", "Googly"], ["doosra", "Doosra"], ["flipper", "Flipper"]
    ];
    const outcomeOptions = [["played", "Played"], ["beat", "Beat"], ["left", "Left"], ["missed", "Missed"], ["edged", "Edged"]];
    const pitchZones = [
        ["full-toss", "Full Toss"], ["yorker", "Yorker"], ["full", "Full"],
        ["good-length", "Good Length"], ["short", "Short"], ["bouncer", "Bouncer"]
    ];

    // Sync IDs when props change
    useEffect(() => {
        if (currentBatsmen?.length >= 1 && !strikerId) {
            setStrikerId(currentBatsmen[0].player?._id || "");
        }
        if (currentBatsmen?.length >= 2 && !nonStrikerId) {
            setNonStrikerId(currentBatsmen[1].player?._id || "");
        }
        if (currentBowler && !bowlerId) {
            setBowlerId(currentBowler.player?._id || "");
        }
    }, [currentBatsmen, currentBowler]);

    const handleRunClick = (val) => setRuns(val);
    const handleExtraClick = (type) => setExtra(extra === type ? null : type);

    const handleSubmit = () => {
        if (!strikerId || !nonStrikerId || !bowlerId) {
            showToast("Please select striker, non-striker, and bowler.", "warning");
            return;
        }

        const ballData = {
            runs,
            isWide: extra === "WIDE",
            isNoBall: extra === "NO BALL",
            isBye: extra === "BYE",
            isLegBye: extra === "LEG BYE",
            isWicket: !!wicket,
            wicketType: wicket || "",
            batsmanOnStrikeId: strikerId,
            batsmanNonStrikeId: nonStrikerId,
            bowlerId: bowlerId,
            commentaryText: commentary,
            fieldingZone: selectedZoneLabel,
            pitchZone,
            ballMovement,
            ballOutcome,
            customCommentary: !!commentary
        };

        onSubmitBall(ballData);
        // Reset local states for next ball
        setRuns(0);
        setExtra(null);
        setWicket(null);
        setCommentary("");
        setPitchZone("");
        setBallMovement("none");
        setBallOutcome("played");
    };

    return (
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
            <div className="bg-[#031d44] p-6 text-white flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-black uppercase tracking-widest">Scoring Panel</h2>
                    <p className="text-blue-300 text-[10px] font-bold mt-1 uppercase tracking-widest opacity-80">Select runs & field position</p>
                </div>
                <div className="px-3 py-1 bg-blue-500/20 rounded-full border border-blue-500/30">
                    <span className="text-blue-300 text-[10px] font-black uppercase tracking-[0.2em]">Ball Active</span>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* On Strike Section */}
                <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">On Strike</h3>
                    <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 focus-within:ring-2 focus-within:ring-green-500/20 transition-all">
                            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                            <select 
                                value={strikerId} 
                                onChange={(e) => setStrikerId(e.target.value)}
                                className="bg-transparent border-none text-sm font-black text-slate-800 focus:ring-0 w-full cursor-pointer"
                            >
                                <option value="">Select Striker</option>
                                {currentBatsmen.map(b => (
                                    <option key={b.player?._id || b.player} value={b.player?._id || b.player}>{b.player?.name || "Unknown Batsman"}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                            <div className="w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
                            <select 
                                value={nonStrikerId} 
                                onChange={(e) => setNonStrikerId(e.target.value)}
                                className="bg-transparent border-none text-sm font-black text-slate-800 focus:ring-0 w-full cursor-pointer"
                            >
                                <option value="">Select Non-Striker</option>
                                {currentBatsmen.map(b => (
                                    <option key={b.player?._id || b.player} value={b.player?._id || b.player}>{b.player?.name || "Unknown Batsman"}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100 focus-within:ring-2 focus-within:ring-red-500/20 transition-all">
                            <div className="w-3 h-3 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                            <select 
                                value={bowlerId} 
                                onChange={(e) => setBowlerId(e.target.value)}
                                className="bg-transparent border-none text-sm font-black text-slate-800 focus:ring-0 w-full cursor-pointer"
                            >
                                <option value="">Select Bowler</option>
                                {currentBowler && (
                                    <option value={currentBowler.player?._id || currentBowler.player}>
                                        {currentBowler.player?.name || "Unknown Bowler"}
                                    </option>
                                )}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Runs Section */}
                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Runs Scored</h3>
                    <div className="grid grid-cols-3 gap-2">
                        {[0, 1, 2, 3, 4, 6].map((num) => (
                            <button
                                key={num}
                                onClick={() => handleRunClick(num)}
                                className={`py-4 rounded-xl font-black text-lg transition-all ${
                                    runs === num 
                                    ? "bg-[#031d44] text-white scale-105 shadow-lg" 
                                    : "bg-slate-50 text-slate-800 hover:bg-slate-100"
                                }`}
                            >
                                {num === 0 ? "DOT" : num}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Extras Section */}
                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Extras</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {["WIDE", "NO BALL", "BYE", "LEG BYE"].map((type) => (
                            <button
                                key={type}
                                onClick={() => handleExtraClick(type)}
                                className={`py-3 rounded-xl font-bold text-xs border-2 transition-all ${
                                    extra === type 
                                    ? "bg-orange-500 text-white border-orange-600 scale-105 shadow-md shadow-orange-100" 
                                    : "bg-white text-slate-600 border-slate-100 hover:border-orange-200 hover:text-orange-500"
                                }`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Wicket Section */}
                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Dismissal</h3>
                    <select
                        value={wicket || ""}
                        onChange={(e) => setWicket(e.target.value || null)}
                        className={`w-full p-4 rounded-xl font-black text-sm transition-all border-2 cursor-pointer ${
                            wicket 
                            ? "bg-red-600 text-white border-red-700 shadow-md shadow-red-100" 
                            : "bg-slate-50 text-slate-800 border-slate-100 hover:border-red-100"
                        }`}
                    >
                        <option value="">SELECT WICKET</option>
                        {["bowled", "caught", "lbw", "run out", "stumped", "hit wicket"].map(type => (
                            <option key={type} value={type}>{type.toUpperCase()}</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Ball Movement</h3>
                    <div className="flex flex-wrap gap-2">
                        {movementOptions.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setBallMovement(value)}
                                className={`px-3 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${ballMovement === value ? "bg-blue-600 text-white shadow-md" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Ball Outcome</h3>
                    <div className="grid grid-cols-5 gap-2">
                        {outcomeOptions.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setBallOutcome(value)}
                                className={`py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${ballOutcome === value ? "bg-[#ff6b35] text-white shadow-md" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Pitch Landing Zone</h3>
                    <div className="rounded-2xl bg-[#2c7a17] p-3">
                        <div className="mx-auto grid h-72 w-32 overflow-hidden rounded-xl bg-[#ffd333] ring-4 ring-white/20">
                            {pitchZones.map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setPitchZone(value)}
                                    className={`border-b border-white/70 text-[10px] font-black uppercase tracking-widest transition-all ${pitchZone === value ? "bg-[#f71963] text-white" : "text-slate-900 hover:bg-white/30"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Commentary */}
                <div className="space-y-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Quick Commentary</h3>
                    <textarea
                        value={commentary}
                        onChange={(e) => setCommentary(e.target.value)}
                        placeholder="AI will generate automatically if blank..."
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs font-medium focus:ring-2 focus:ring-blue-500/20 outline-none h-20 resize-none transition-all"
                    ></textarea>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
                    <button
                        onClick={onBack}
                        className="py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-2xl uppercase tracking-widest text-xs transition-all active:scale-95"
                    >
                        [ BACK ]
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="py-4 bg-[#ff6b35] hover:bg-[#e85d20] text-white font-black rounded-2xl uppercase tracking-widest text-xs shadow-lg shadow-orange-200 transition-all hover:scale-[1.02] active:scale-95"
                    >
                        [ SUBMIT BALL ]
                    </button>
                </div>
                
                <button 
                  onClick={onEndInnings}
                  className="w-full mt-2 text-[10px] font-black text-slate-300 hover:text-red-400 uppercase tracking-[0.3em] transition-colors py-2"
                >
                    -- End Innings --
                </button>
            </div>
        </div>
    );
}
