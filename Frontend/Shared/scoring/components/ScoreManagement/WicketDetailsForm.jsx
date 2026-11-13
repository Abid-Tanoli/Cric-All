import React from 'react';
import { WICKET_TYPES, CROSSING_WICKET_TYPES } from './constants';

const inputClass = 'w-full p-3 sm:p-6 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl text-cric-text font-black outline-none focus:border-red-500';
const labelClass = 'text-[10px] font-black uppercase text-slate-500 tracking-widest pl-2';

export default function WicketDetailsForm({
    selectedWicket,
    setSelectedWicket,
    setupState,
    setSetupState,
    battingXI = [],
    bowlingXI = [],
    curInn,
    strikerId,
    nonStrikerId,
    onConfirm,
    showToast,
}) {
    const isCrossingWicket = CROSSING_WICKET_TYPES.includes(selectedWicket);
    const strikerName = battingXI.find(p => String(p._id || p) === String(strikerId))?.name || 'Striker';
    const nonStrikerName = battingXI.find(p => String(p._id || p) === String(nonStrikerId))?.name || 'Non-Striker';

    const availableBatters = battingXI.filter(p => {
        const pId = p._id || p;
        const stats = curInn?.batting?.find(b => String(b.player?._id || b.player) === String(pId));
        const isCurrent = [String(strikerId), String(nonStrikerId)].includes(String(pId));
        const isOut = stats?.isOut || stats?.isRetired;
        return !isCurrent && (!stats || stats.isRetiredHurt) && !isOut;
    });

    const confirm = () => {
        if (!setupState.wicketNewBatter && curInn?.wickets < 9 && selectedWicket !== 'retired hurt') {
            showToast?.('Please select the next batsman before confirming.', 'warning');
            return;
        }
        onConfirm?.();
    };

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4">
                {WICKET_TYPES.map(type => (
                    <button key={type} onClick={() => setSelectedWicket(type)} className={`score-touch-btn p-3 sm:p-6 rounded-2xl sm:rounded-3xl border-2 font-black uppercase text-[9px] sm:text-xs tracking-widest transition-all ${selectedWicket === type ? 'bg-red-600 border-red-400 text-white shadow-lg' : 'bg-black/5 dark:bg-white/2 border-cric-border text-slate-500 hover:border-cric-border/80'}`}>
                        {type}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
                <div className="space-y-2">
                    <label htmlFor="wicket-next-batter" className={labelClass}>Next Batsman</label>
                    <select id="wicket-next-batter" value={setupState.wicketNewBatter} onChange={(e) => setSetupState(s => ({ ...s, wicketNewBatter: e.target.value }))} className={inputClass}>
                        <option value="">Select Next In...</option>
                        {availableBatters.map(p => (
                            <option key={p._id || p} value={p._id || p}>{p.name}</option>
                        ))}
                    </select>
                </div>
                <div className="space-y-2">
                    <label htmlFor="wicket-fielder" className={labelClass}>Fielder Involved</label>
                    <select id="wicket-fielder" value={setupState.wicketFielder} onChange={(e) => setSetupState(s => ({ ...s, wicketFielder: e.target.value }))} className={inputClass}>
                        <option value="">Select Fielder...</option>
                        {bowlingXI.map(p => (
                            <option key={p._id || p} value={p._id || p}>{p.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {isCrossingWicket && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
                    <div className="space-y-2">
                        <label htmlFor="wicket-dismissed-player" className={labelClass}>Who Is Out</label>
                        <select
                            id="wicket-dismissed-player"
                            value={setupState.wicketDismissedPlayer}
                            onChange={(e) => setSetupState(s => ({ ...s, wicketDismissedPlayer: e.target.value }))}
                            className={inputClass}
                        >
                            <option value="striker">{strikerName} (Striker)</option>
                            <option value="nonStriker">{nonStrikerName} (Non-Striker)</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="wicket-runs-completed" className={labelClass}>Runs Completed Before Run Out</label>
                        <select
                            id="wicket-runs-completed"
                            value={setupState.wicketRuns}
                            onChange={(e) => setSetupState(s => ({ ...s, wicketRuns: Number(e.target.value) }))}
                            className={inputClass}
                        >
                            {[0, 1, 2, 3, 4, 5, 6].map(runs => (
                                <option key={runs} value={runs}>{runs}</option>
                            ))}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="wicket-did-cross" className="flex items-center gap-3 p-3 sm:p-5 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl cursor-pointer">
                            <input
                                id="wicket-did-cross"
                                type="checkbox"
                                checked={!!setupState.wicketDidCross}
                                onChange={(e) => setSetupState(s => ({ ...s, wicketDidCross: e.target.checked }))}
                                className="h-5 w-5 accent-red-600"
                            />
                            <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Batters Crossed</span>
                        </label>
                    </div>
                </div>
            )}

            <button
                onClick={confirm}
                className="score-touch-btn w-full py-4 sm:py-8 rounded-2xl sm:rounded-[2rem] bg-red-600 text-white font-black font-raj text-base sm:text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all mt-4 sm:mt-8"
            >
                Confirm Wicket Details
            </button>
        </div>
    );
}
