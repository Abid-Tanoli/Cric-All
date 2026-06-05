import React from 'react';
import CricketGround from '../CricketGround';
import PitchMap, { LINE_ZONES, LENGTH_ZONES, SHOT_TYPES } from '../PitchMap';

const shotToId = (shot) => shot.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const RightSidebarControls = ({
    curInn,
    handleResetInnings,
    handleResetMatch,
    handleEndInnings,
    handleStartNext,
    setShowSelectionModal,
    battingXI,
    bowlingXI,
    strikerId,
    nonStrikerId,
    bowlerId,
    selectedRuns,
    setSelectedRuns,
    handleRevert,
    selectedExtra,
    setSelectedExtra,
    selectedWicket,
    submitBall,
    activeGroundZone,
    handleGroundClick,
    // PitchMap props
    pitchMapBalls,
    pitchMapCurrentOver,
    pitchMapLine,
    setPitchMapLine,
    pitchMapLength,
    setPitchMapLength,
    pitchMapShot,
    setPitchMapShot,
    pitchMapClickPos,
    setPitchMapClickPos,
    pitchMapViewMode,
    setPitchMapViewMode,
    ballMovement = 'none',
    setBallMovement,
    ballOutcome = 'played',
    setBallOutcome
}) => {
    const movementOptions = [
        ['none', 'None'],
        ['inswing', 'Inswing'],
        ['outswing', 'Outswing'],
        ['off-cutter', 'Off Cutter'],
        ['leg-cutter', 'Leg Cutter'],
        ['seam-movement', 'Seam'],
        ['leg-spin', 'Leg Spin'],
        ['off-spin', 'Off Spin'],
        ['googly', 'Googly'],
        ['doosra', 'Doosra'],
        ['flipper', 'Flipper'],
    ];
    const outcomeOptions = [
        ['played', 'Played'],
        ['beat', 'Beat'],
        ['left', 'Left'],
        ['missed', 'Missed'],
        ['edged', 'Edged'],
    ];

    return (
        <div className="lg:w-[480px] shrink-0 sticky top-0 mt-0 pt-2 pb-12 px-8 h-screen flex flex-col bg-cric-card rounded-[3.5rem] border border-cric-border shadow-2xl overflow-y-auto no-scrollbar">
            <div className="mb-8 mt-4 flex justify-between items-start">
                <div>
                    <h2 className="text-3xl font-black font-raj tracking-tighter italic text-cric-text uppercase">Management Panel</h2>
                    <div className="text-[10px] font-black text-cric-accent uppercase tracking-[0.3em] mt-1">Live Scoring Control</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-2">
                        <button onClick={handleResetInnings} className="text-[9px] font-black text-cric-accent border border-cric-accent/30 px-3 py-1 rounded-full hover:bg-cric-accent hover:text-white transition-all uppercase tracking-widest whitespace-nowrap">Reset Innings</button>
                        <button onClick={handleEndInnings} className="text-[9px] font-black text-red-500 border border-red-500/30 px-3 py-1 rounded-full hover:bg-red-500 hover:text-white transition-all uppercase tracking-widest whitespace-nowrap">End Innings</button>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleResetMatch} className="text-[9px] font-black text-white bg-red-600 px-3 py-1 rounded-full hover:bg-red-700 transition-all uppercase tracking-widest whitespace-nowrap shadow-lg shadow-red-500/30">Reset Match</button>
                        {curInn?.target > 0 && <button onClick={handleStartNext} className="text-[9px] font-black text-green-500 border border-green-500/30 px-3 py-1 rounded-full hover:bg-green-500 hover:text-white transition-all uppercase tracking-widest whitespace-nowrap">Next Innings</button>}
                    </div>
                </div>
            </div>

            <div className="space-y-12">
                {/* Role Selectors Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">On Strike (*)</h4>
                        <button onClick={() => setShowSelectionModal('striker')} className="w-full p-6 bg-black/5 dark:bg-white/2 rounded-3xl border border-cric-border text-left font-black font-raj text-lg italic hover:bg-black/10 dark:hover:bg-white/5 transition-all text-cric-accent">
                            {battingXI.find(p => String(p._id) === String(strikerId))?.name || 'SELECT STRIKER'}
                        </button>
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">Non-Strike</h4>
                        <button onClick={() => setShowSelectionModal('nonStriker')} className="w-full p-6 bg-black/5 dark:bg-white/2 rounded-3xl border border-cric-border text-left font-black font-raj text-lg italic hover:bg-black/10 dark:hover:bg-white/5 transition-all opacity-60 text-cric-text">
                            {battingXI.find(p => String(p._id) === String(nonStrikerId))?.name || 'SELECT NON-STRIKER'}
                        </button>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">Active Bowler</h4>
                        <button onClick={() => setShowSelectionModal('bowler')} className="w-full p-6 bg-black/5 dark:bg-white/2 rounded-3xl border border-cric-border text-left font-black font-raj text-lg italic hover:bg-black/10 dark:hover:bg-white/5 transition-all text-blue-500">
                            {bowlingXI.find(p => String(p._id) === String(bowlerId))?.name || 'SELECT BOWLER'}
                        </button>
                    </div>
                </div>

                {/* 2. Maps Section: Pitch Map + Shot Direction side by side */}
                <div className="flex flex-col md:flex-row gap-4 md:gap-2 items-center md:items-start">
                    <PitchMap
                        balls={pitchMapBalls || []}
                        currentOver={pitchMapCurrentOver || 0}
                        bowlerName={bowlingXI.find(p => String(p._id) === String(bowlerId))?.name || ''}
                        batsmanName={battingXI.find(p => String(p._id) === String(strikerId))?.name || ''}
                        viewMode={pitchMapViewMode || 'this_over'}
                        selectedLine={pitchMapLine}
                        onLineChange={setPitchMapLine}
                        selectedLength={pitchMapLength}
                        onLengthChange={setPitchMapLength}
                        selectedShot={pitchMapShot}
                        onShotChange={setPitchMapShot}
                        clickPosition={pitchMapClickPos}
                        onClickPositionChange={setPitchMapClickPos}
                    />
                    <div className="flex-1 min-w-0 w-full space-y-4">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] truncate pr-2">Shot Direction</h4>
                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest shrink-0">
                                {activeGroundZone ? '✓ Selected' : 'Click ground'}
                            </span>
                        </div>
                        <CricketGround
                            onShotSelect={handleGroundClick}
                            selectedRuns={selectedRuns}
                            activeZone={activeGroundZone}
                        />
                    </div>
                </div>

                {/* 3. Line, Length, Shot Type */}
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Line</label>
                            <select value={pitchMapLine || ''} onChange={e => setPitchMapLine(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all">
                                <option value="">Select Line ▼</option>
                                {LINE_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Length</label>
                            <select value={pitchMapLength || ''} onChange={e => setPitchMapLength(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all">
                                <option value="">Select Length ▼</option>
                                {LENGTH_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Shot Type</label>
                        <select value={pitchMapShot || ''} onChange={e => setPitchMapShot(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all">
                            <option value="">Select Shot ▼</option>
                            {SHOT_TYPES.map(shot => <option key={shot} value={shotToId(shot)}>{shot}</option>)}
                        </select>
                    </div>
                </div>

                {/* 4. Ball Run Selector */}
                <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Runs & Extras</h4>
                    <div className="grid grid-cols-4 gap-4">
                        {[0, 1, 2, 3, 4, 6].map(num => (
                            <button
                                key={num}
                                onClick={() => setSelectedRuns(num)}
                                className={`h-16 rounded-2xl font-black font-raj text-2xl transition-all ${selectedRuns === num ? 'bg-cric-accent text-white shadow-[0_10px_20px_rgba(255,107,53,0.3)] scale-105 z-10' : 'bg-black/5 dark:bg-white/5 text-cric-text hover:bg-black/10 dark:hover:bg-white/10'}`}
                            >
                                {num === 0 ? 'DOT' : num}
                            </button>
                        ))}
                        <button onClick={handleRevert} className="h-16 rounded-2xl bg-black/5 dark:bg-white/2 text-slate-500 hover:text-cric-text transition-all">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mx-auto"><path d="M9 14L4 9l5-5M4 9h12a5 5 0 015 5v3" /></svg>
                        </button>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        {['WIDE', 'NO BALL', 'BYE', 'LEG BYE'].map(type => (
                            <button
                                key={type}
                                onClick={() => setSelectedExtra(selectedExtra === type ? null : type)}
                                className={`py-4 rounded-2xl text-[10px] font-black tracking-widest transition-all ${selectedExtra === type ? 'bg-blue-600 text-white shadow-lg' : 'bg-black/5 dark:bg-white/2 text-slate-500 hover:text-cric-text border border-transparent hover:border-cric-border/50'}`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 5. Ball Movement */}
                <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Ball Movement</h4>
                    <div className="flex flex-wrap gap-2">
                        {movementOptions.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setBallMovement?.(value)}
                                className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${ballMovement === value ? 'bg-slate-800 text-white shadow-lg dark:bg-slate-200 dark:text-slate-900' : 'bg-black/5 dark:bg-white/5 text-slate-500 hover:text-cric-text hover:bg-black/10'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 6. Ball Outcome */}
                <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Ball Outcome</h4>
                    <div className="flex flex-wrap gap-2">
                        {outcomeOptions.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setBallOutcome?.(value)}
                                className={`px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${ballOutcome === value ? 'bg-slate-800 text-white shadow-lg dark:bg-slate-200 dark:text-slate-900' : 'bg-black/5 dark:bg-white/5 text-slate-500 hover:text-cric-text hover:bg-black/10'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 7. Wicket and Submit */}
                <div className="grid grid-cols-2 gap-4 pt-6">
                    <button
                        onClick={() => setShowSelectionModal('wicket')}
                        className={`py-8 rounded-[2rem] font-black uppercase tracking-[0.2em] text-[11px] relative overflow-hidden transition-all h-32 ${selectedWicket ? 'bg-red-600 text-white shadow-xl' : 'bg-red-600/10 text-red-500 border-2 border-red-500/20 hover:bg-red-600/20 font-raj text-2xl italic'}`}
                    >
                        <div className="relative z-10">
                            {selectedWicket ? `OUT: ${selectedWicket}` : 'FALLEN WICKET'}
                        </div>
                    </button>
                    <button
                        onClick={submitBall}
                        className="py-8 rounded-[2rem] bg-green-600 text-white font-black font-raj text-3xl italic tracking-tighter shadow-[0_20px_50px_rgba(22,163,74,0.3)] hover:scale-105 active:scale-95 transition-all uppercase h-32"
                    >
                        Submit Ball
                    </button>
                </div>
            </div>

            <div className="mt-auto pt-12 text-center opacity-30 text-[9px] font-black tracking-[0.5em] uppercase">
                BQ-PLAY Elite Scoring Engine 2026
            </div>
        </div>
    );
};

export default RightSidebarControls;
