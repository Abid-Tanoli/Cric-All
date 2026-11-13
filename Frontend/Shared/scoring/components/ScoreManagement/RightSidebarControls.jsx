import React, { useState } from 'react';
import CricketGround from '../CricketGround';
import PitchMap, { LINE_ZONES, LENGTH_ZONES } from '../PitchMap';
import ShotTypePicker from '../ShotTypePicker';
import ShotDiagram from '../ShotDiagram';
import FielderSelector from './FielderSelector';
import { SHOTS } from '../../data/shotsData';

const shotToId = (shot) => shot.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const SHOT_ID_MAP = {
  driven: 'straight_drive',
  pull_shot: 'pull',
  hook_shot: 'hook',
  scoop_shot: 'scoop',
  ramp_shot: 'ramp',
  left_padded_away: 'left_padded',
  no_shot_offered: 'no_shot',
};
const findShot = (id) => SHOTS.find(s => s.id === (SHOT_ID_MAP[id] || id)) || null;
const shotValueToId = (shot) => {
  if (!shot) return "";
  if (typeof shot === "object") return shot.id || "";
  if (SHOTS.some(item => item.id === shot)) return shot;
  const normalized = shotToId(shot);
  return SHOT_ID_MAP[normalized] || normalized;
};

const RightSidebarControls = React.memo(({
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
    reverting,
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
    useAICommentary = true,
    setUseAICommentary,
    manualCommentary = '',
    setManualCommentary,
    // Fielder props
    fieldedById,
    setFieldedById,
    fieldedByPosition,
    setFieldedByPosition,
}) => {
    const [showShotPicker, setShowShotPicker] = useState(false);
    const currentShot = findShot(shotToId(pitchMapShot || ''));
    const showFielderSelector = [1, 2, 3].includes(selectedRuns) && !selectedExtra && !selectedWicket;
    const fieldingTeamXI = bowlingXI || [];
    const CAT_COLORS = {
      front_foot: '#3b82f6',
      back_foot: '#8b5cf6',
      leg_side: '#22c55e',
      unorthodox: '#f59e0b',
      power: '#ef4444',
      defensive: '#6b7280'
    };
    const CAT_LABELS = {
      front_foot: 'Front-Foot',
      back_foot: 'Back-Foot',
      leg_side: 'Leg-Side',
      unorthodox: 'Unorthodox',
      power: 'Power',
      defensive: 'Defensive'
    };
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
    return (
        <>
        <div className="w-full shrink-0 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] flex flex-col bg-cric-card rounded-2xl sm:rounded-[2rem] xl:rounded-[3rem] border border-cric-border shadow-2xl overflow-y-auto px-3 py-4 sm:px-6 xl:px-7">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start">
                <div>
                    <h2 className="text-2xl xl:text-3xl font-black font-raj tracking-tighter italic text-cric-text uppercase">Management Panel</h2>
                    <div className="text-[10px] font-black text-cric-accent uppercase tracking-[0.3em] mt-1">Live Scoring Control</div>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-2">
                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleResetInnings} className="text-[9px] font-black text-cric-accent border border-cric-accent/30 px-3 py-1 rounded-full hover:bg-cric-accent hover:text-white transition-all uppercase tracking-widest whitespace-nowrap">Reset Innings</button>
                        <button onClick={handleEndInnings} className="text-[9px] font-black text-red-500 border border-red-500/30 px-3 py-1 rounded-full hover:bg-red-500 hover:text-white transition-all uppercase tracking-widest whitespace-nowrap">End Innings</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleResetMatch} className="text-[9px] font-black text-white bg-red-600 px-3 py-1 rounded-full hover:bg-red-700 transition-all uppercase tracking-widest whitespace-nowrap shadow-lg shadow-red-500/30">Reset Match</button>
                        {curInn?.target > 0 && <button onClick={handleStartNext} className="text-[9px] font-black text-green-500 border border-green-500/30 px-3 py-1 rounded-full hover:bg-green-500 hover:text-white transition-all uppercase tracking-widest whitespace-nowrap">Next Innings</button>}
                    </div>
                </div>
            </div>

            <div className="space-y-6 sm:space-y-10 xl:space-y-12">
                <div className="rounded-2xl sm:rounded-3xl border border-cric-border bg-black/5 p-4 sm:p-5 dark:bg-white/5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em]">AI Commentary</h4>
                            <p className="mt-1 text-xs font-semibold text-cric-muted">
                                {useAICommentary ? 'On by default. AI lines will be generated for scored balls.' : 'Off. Manual or simple recorded commentary will be used.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setUseAICommentary?.(!useAICommentary)}
                            className={`relative h-10 w-20 shrink-0 rounded-full transition-all ${useAICommentary ? 'bg-green-600' : 'bg-slate-400 dark:bg-slate-700'}`}
                            aria-pressed={useAICommentary}
                            title="Toggle AI commentary"
                        >
                            <span className={`absolute top-1 h-8 w-8 rounded-full bg-white shadow-lg transition-all ${useAICommentary ? 'left-11' : 'left-1'}`} />
                            <span className={`absolute inset-y-0 ${useAICommentary ? 'left-3' : 'right-3'} flex items-center text-[9px] font-black uppercase tracking-widest text-white`}>
                                {useAICommentary ? 'On' : 'Off'}
                            </span>
                        </button>
                    </div>
                    {!useAICommentary && (
                        <div className="mt-4 space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-1">Manual Commentary</label>
                            <textarea
                                value={manualCommentary}
                                onChange={(event) => setManualCommentary?.(event.target.value)}
                                rows={3}
                                className="w-full resize-none rounded-2xl border border-cric-border bg-cric-bg p-3 text-sm font-semibold text-cric-text outline-none transition-all focus:border-cric-accent"
                                placeholder="Optional ball note for this delivery"
                            />
                        </div>
                    )}
                </div>

                {/* Role Selectors Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">On Strike (*)</h4>
                        <button onClick={() => setShowSelectionModal('striker')} className="score-touch-btn w-full p-4 sm:p-6 bg-black/5 dark:bg-white/2 rounded-2xl sm:rounded-3xl border border-cric-border text-left font-black font-raj text-base sm:text-lg italic hover:bg-black/10 dark:hover:bg-white/5 transition-all text-cric-accent break-words">
                            {battingXI.find(p => String(p._id) === String(strikerId))?.name || 'SELECT STRIKER'}
                        </button>
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">Non-Strike</h4>
                        <button onClick={() => setShowSelectionModal('nonStriker')} className="score-touch-btn w-full p-4 sm:p-6 bg-black/5 dark:bg-white/2 rounded-2xl sm:rounded-3xl border border-cric-border text-left font-black font-raj text-base sm:text-lg italic hover:bg-black/10 dark:hover:bg-white/5 transition-all opacity-60 text-cric-text break-words">
                            {battingXI.find(p => String(p._id) === String(nonStrikerId))?.name || 'SELECT NON-STRIKER'}
                        </button>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <h4 className="text-[9px] font-black uppercase text-slate-500 tracking-widest pl-2">Active Bowler</h4>
                        <button onClick={() => setShowSelectionModal('bowler')} className="score-touch-btn w-full p-4 sm:p-6 bg-black/5 dark:bg-white/2 rounded-2xl sm:rounded-3xl border border-cric-border text-left font-black font-raj text-base sm:text-lg italic hover:bg-black/10 dark:hover:bg-white/5 transition-all text-cric-accent break-words">
                            {bowlingXI.find(p => String(p._id) === String(bowlerId))?.name || 'SELECT BOWLER'}
                        </button>
                    </div>
                </div>

                {/* 2. Maps Section: Pitch Map + Shot Direction side by side */}
                {useAICommentary && (
                <div className="flex flex-col md:flex-row gap-4 md:gap-2 items-center md:items-start min-w-0">
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
                )}

                {/* 3. Line, Length, Shot Type */}
                {useAICommentary && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Line</label>
                            <select value={pitchMapLine || ''} onChange={e => setPitchMapLine(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-3 sm:p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all">
                                <option value="">Select Line ▼</option>
                                {LINE_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Length</label>
                            <select value={pitchMapLength || ''} onChange={e => setPitchMapLength(e.target.value)} className="w-full bg-black/5 dark:bg-white/5 border border-cric-border rounded-2xl p-3 sm:p-4 text-cric-text font-bold outline-none appearance-none cursor-pointer hover:bg-black/10 transition-all">
                                <option value="">Select Length ▼</option>
                                {LENGTH_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2 flex-1">Shot Type</label>
                            <button
                                onClick={() => setShowShotPicker(true)}
                                className="text-[8px] font-black px-3 py-1.5 rounded-full bg-cric-accent/10 text-cric-accent hover:bg-cric-accent hover:text-white transition-all uppercase tracking-widest border border-cric-accent/20"
                            >
                                {pitchMapShot ? 'Change Shot' : 'Pick Shot'}
                            </button>
                        </div>
                        {currentShot && (
                            <div className="mt-3 flex items-start gap-3 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl p-3 border border-cric-border/40">
                                <ShotDiagram shot={currentShot} size={64} />
                                <div className="min-w-0">
                                    <h4 className="text-xs font-black text-cric-text uppercase leading-tight">{currentShot.name}</h4>
                                    <p className="text-[9px] text-slate-500 mt-1 leading-relaxed">{currentShot.desc}</p>
                                    <span className="inline-block mt-1.5 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest"
                                        style={{
                                            background: CAT_COLORS[currentShot.category] + '20',
                                            color: CAT_COLORS[currentShot.category]
                                        }}>
                                        {CAT_LABELS[currentShot.category]}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                )}

                {/* 4. Ball Run Selector */}
                <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Runs & Extras</h4>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
                        {[0, 1, 2, 3, 4, 6].map(num => (
                            <button
                                key={num}
                                onClick={() => setSelectedRuns(num)}
                                className={`score-run-btn min-h-[52px] sm:min-h-[64px] rounded-2xl font-black font-raj text-xl sm:text-2xl transition-all active:scale-95 ${selectedRuns === num ? 'bg-cric-accent text-white shadow-[0_10px_20px_rgba(255,107,53,0.3)] scale-105 z-10' : 'bg-black/5 dark:bg-white/5 text-cric-text hover:bg-black/10 dark:hover:bg-white/10'}`}
                            >
                                {num === 0 ? 'DOT' : num}
                            </button>
                        ))}
                        <button onClick={handleRevert} disabled={reverting} className={`score-run-btn min-h-[52px] sm:min-h-[64px] rounded-2xl transition-all border group col-span-3 sm:col-span-1 ${reverting ? 'bg-slate-400/20 text-slate-400 cursor-not-allowed border-slate-400/20' : 'bg-orange-500/10 text-orange-600 hover:bg-orange-500 hover:text-white border-orange-500/20 hover:border-orange-500'}`} title="Undo last ball">
                            {reverting ? (
                                <svg className="animate-spin mx-auto" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="50" strokeLinecap="round" /></svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mx-auto"><path d="M9 14L4 9l5-5M4 9h12a5 5 0 015 5v3" /></svg>
                            )}
                            <span className="block text-[7px] font-black uppercase tracking-wider mt-0.5">{reverting ? '...' : 'Undo'}</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                        {['WIDE', 'NO BALL', 'BYE', 'LEG BYE'].map(type => (
                            <button
                                key={type}
                                onClick={() => setSelectedExtra(selectedExtra === type ? null : type)}
                                className={`score-run-btn min-h-[48px] py-3 rounded-2xl text-[10px] sm:text-xs font-black tracking-widest transition-all active:scale-95 ${selectedExtra === type ? 'bg-cric-accent text-white shadow-lg' : 'bg-black/5 dark:bg-white/2 text-cric-muted hover:text-cric-text border border-transparent hover:border-cric-border/50'}`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                {/* FIELDER SELECTOR - Only for 1/2/3 runs */}
                {showFielderSelector && (
                    <FielderSelector
                        players={fieldingTeamXI}
                        selectedPlayer={fieldedById}
                        onPlayerChange={setFieldedById}
                        selectedPosition={fieldedByPosition}
                        onPositionChange={setFieldedByPosition}
                    />
                )}

                {/* 5. Ball Movement */}
                {useAICommentary && (
                <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em] pl-2">Ball Movement</h4>
                    <div className="flex flex-wrap gap-2">
                        {movementOptions.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setBallMovement?.(value)}
                                className={`score-touch-btn px-3 sm:px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${ballMovement === value ? 'bg-slate-800 text-white shadow-lg dark:bg-slate-200 dark:text-slate-900' : 'bg-black/5 dark:bg-white/5 text-slate-500 hover:text-cric-text hover:bg-black/10'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                )}

                {/* 6. Wicket and Submit */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-4 sm:pt-6">
                    <button
                        onClick={() => setShowSelectionModal('wicket')}
                        className={`score-run-btn min-h-[72px] sm:min-h-[8rem] rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-[0.2em] text-sm sm:text-base relative overflow-hidden transition-all active:scale-95 ${selectedWicket ? 'bg-red-600 text-white shadow-xl' : 'bg-red-600/10 text-red-500 border-2 border-red-500/20 hover:bg-red-600/20 font-raj text-xl sm:text-2xl italic'}`}
                    >
                        <div className="relative z-10">
                            {selectedWicket ? `OUT: ${selectedWicket}` : 'FALLEN WICKET'}
                        </div>
                    </button>
                    <button
                        onClick={submitBall}
                        className="score-run-btn min-h-[72px] sm:min-h-[8rem] rounded-2xl sm:rounded-[2rem] bg-green-600 text-white font-black font-raj text-2xl sm:text-3xl italic tracking-tighter shadow-[0_20px_50px_rgba(22,163,74,0.3)] hover:scale-[1.02] active:scale-95 transition-all uppercase"
                    >
                        Submit Ball
                    </button>
                </div>

            </div>

            <div className="mt-auto pt-12 text-center opacity-30 text-[9px] font-black tracking-[0.5em] uppercase">
                CricAll Elite Scoring Engine 2026
            </div>
        </div>

        <ShotTypePicker
            isOpen={showShotPicker}
            onClose={() => setShowShotPicker(false)}
            onSelect={(shot) => setPitchMapShot(shotValueToId(shot))}
            currentShot={pitchMapShot}
        />

        </>
    );
});

export default RightSidebarControls;
