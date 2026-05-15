import React from 'react';
import CricketGround from '../CricketGround';
import PitchMap from '../PitchMap';

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
    setPitchMapViewMode
}) => {
    return (
        <div className="lg:w-[500px] shrink-0 sticky top-32 h-[calc(100vh-160px)] flex flex-col bg-cric-card rounded-[3.5rem] border border-cric-border shadow-2xl p-12 overflow-y-auto no-scrollbar">
            <div className="mb-12 flex justify-between items-start">
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

                {/* Scoring Buttons Section */}
                <div className="space-y-8">
                    <div className="grid grid-cols-4 gap-4">
                        {[0, 1, 2, 3, 4, 6].map(num => (
                            <button
                                key={num}
                                onClick={() => setSelectedRuns(num)}
                                className={`h-20 rounded-3xl font-black font-raj text-2xl transition-all ${selectedRuns === num ? 'bg-cric-accent text-white shadow-[0_15px_30px_rgba(255,107,53,0.3)] scale-110 z-10' : 'bg-black/5 dark:bg-white/5 text-cric-text hover:bg-black/10 dark:hover:bg-white/10'}`}
                            >
                                {num === 0 ? 'DOT' : num}
                            </button>
                        ))}
                        <button onClick={handleRevert} className="h-20 rounded-3xl bg-black/5 dark:bg-white/2 text-slate-500 hover:text-cric-text transition-all">
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

                {/* Pitch Map - Ball Tracking */}
                <div className="space-y-4">
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
                </div>

                {/* Shot Direction - Interactive Ground */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em]">Shot Direction</h4>
                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">
                            {activeGroundZone ? '✓ Position Selected' : 'Click the ground'}
                        </span>
                    </div>
                    <CricketGround
                        onShotSelect={handleGroundClick}
                        selectedRuns={selectedRuns}
                        activeZone={activeGroundZone}
                    />
                </div>
            </div>

            <div className="mt-auto pt-12 text-center opacity-30 text-[9px] font-black tracking-[0.5em] uppercase">
                Cricinfo Elite Scoring Engine 2026
            </div>
        </div>
    );
};

export default RightSidebarControls;
