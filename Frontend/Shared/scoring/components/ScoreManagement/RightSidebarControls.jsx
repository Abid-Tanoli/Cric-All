import React, { useState } from 'react';
import CricketGround from '../CricketGround';
import PitchMap, { LINE_ZONES, LENGTH_ZONES } from '../PitchMap';
import ShotTypePicker from '../ShotTypePicker';
import FielderSelector from './FielderSelector';
import { SHOTS } from '../../data/shotsData';
import { getScoringVisibility } from '../../utils/scoringVisibility';

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
    onSelectBowler,
    activeGroundZone,
    handleGroundClick,
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
    ballMovement = 'none',
    setBallMovement,
    useAICommentary = false,
    setUseAICommentary,
    manualCommentary = '',
    setManualCommentary,
    fieldedById,
    setFieldedById,
    fieldedByPosition,
    setFieldedByPosition,
}) => {
    const [showShotPicker, setShowShotPicker] = useState(false);
    const [showMaps, setShowMaps] = useState(true);
    const visibility = getScoringVisibility(useAICommentary);
    const currentShot = findShot(shotToId(pitchMapShot || ''));
    const showFielderSelector = visibility.showNormalBallFielder && [1, 2, 3].includes(selectedRuns) && !selectedExtra && !selectedWicket;
    const fieldingTeamXI = bowlingXI || [];
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
        <div className="w-full shrink-0 space-y-3 xl:sticky xl:top-4">
            <div className="rounded-2xl border border-cric-border bg-cric-card p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">AI commentary</h4>
                        <p className="mt-0.5 text-[10px] font-semibold text-cric-muted">
                            AI commentary: {useAICommentary ? 'ON' : 'OFF'} (applies to everyone scoring this match)
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setUseAICommentary?.(!useAICommentary)}
                        className={`relative h-11 w-16 shrink-0 rounded-full transition-all ${useAICommentary ? 'bg-green-600' : 'bg-slate-400 dark:bg-slate-700'}`}
                        aria-pressed={useAICommentary}
                        title="Toggle AI commentary"
                    >
                        <span className={`absolute top-1.5 h-8 w-8 rounded-full bg-white shadow-lg transition-all ${useAICommentary ? 'left-7' : 'left-1'}`} />
                    </button>
                </div>
                {!useAICommentary && (
                    <textarea
                        value={manualCommentary}
                        onChange={(event) => setManualCommentary?.(event.target.value)}
                        rows={2}
                        className="mt-2 w-full resize-none rounded-xl border border-cric-border bg-cric-bg p-2 text-xs font-semibold text-cric-text outline-none transition-all focus:border-cric-accent"
                        placeholder="Optional ball note"
                    />
                )}
            </div>

            <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setShowSelectionModal('striker')} className="score-touch-btn min-w-0 rounded-xl border border-cric-border bg-cric-card p-3 text-left transition-all hover:bg-black/5 dark:hover:bg-white/5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">On strike *</p>
                    <p className="truncate text-sm font-black text-cric-accent">{battingXI.find(p => String(p._id) === String(strikerId))?.name || 'Select'}</p>
                </button>
                <button onClick={() => setShowSelectionModal('nonStriker')} className="score-touch-btn min-w-0 rounded-xl border border-cric-border bg-cric-card p-3 text-left transition-all hover:bg-black/5 dark:hover:bg-white/5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Non-strike</p>
                    <p className="truncate text-sm font-black text-cric-text">{battingXI.find(p => String(p._id) === String(nonStrikerId))?.name || 'Select'}</p>
                </button>
                <button onClick={() => onSelectBowler?.()} className="score-touch-btn col-span-2 min-w-0 rounded-xl border border-cric-border bg-cric-card p-3 text-left transition-all hover:bg-black/5 dark:hover:bg-white/5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Bowler</p>
                    <p className="truncate text-sm font-black text-cric-accent">{bowlingXI.find(p => String(p._id) === String(bowlerId))?.name || 'Select bowler'}</p>
                </button>
            </div>

            {visibility.showAdvancedAnalysis && (
                <div className="rounded-2xl border border-cric-border bg-cric-card p-2 shadow-sm">
                    <button
                        type="button"
                        onClick={() => setShowMaps((current) => !current)}
                        className="score-touch-btn flex w-full items-center justify-between rounded-xl px-2 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-cric-muted"
                        aria-expanded={showMaps}
                    >
                        <span>Pitch map &amp; shot map</span>
                        <span className="text-cric-accent">{showMaps ? 'Hide' : 'Show'}</span>
                    </button>
                    {showMaps && (
                        <div className="mt-2 flex flex-col items-center gap-3 rounded-xl bg-cric-bg p-2 sm:flex-row sm:items-start">
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
                            <div className="w-full min-w-0 flex-1">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <h4 className="truncate text-[10px] font-black uppercase tracking-[0.25em] text-cric-muted">Shot direction</h4>
                                    <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-cric-muted">
                                        {activeGroundZone ? 'Selected' : 'Tap ground'}
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
                </div>
            )}

            {visibility.showAdvancedAnalysis && showMaps && (
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <select value={pitchMapLine || ''} onChange={e => setPitchMapLine(e.target.value)} aria-label="Line" className="score-touch-btn w-full rounded-xl border border-cric-border bg-cric-card p-2.5 text-xs font-bold text-cric-text outline-none">
                            <option value="">Line ▼</option>
                            {LINE_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                        </select>
                        <select value={pitchMapLength || ''} onChange={e => setPitchMapLength(e.target.value)} aria-label="Length" className="score-touch-btn w-full rounded-xl border border-cric-border bg-cric-card p-2.5 text-xs font-bold text-cric-text outline-none">
                            <option value="">Length ▼</option>
                            {LENGTH_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
                        </select>
                    </div>
                    {visibility.showShotTypePicker && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowShotPicker(true)}
                                className="score-touch-btn flex-1 rounded-xl border border-cric-border bg-cric-card px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                            >
                                {pitchMapShot ? 'Change shot' : 'Pick shot type'}
                            </button>
                            {currentShot && (
                                <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-cric-accent">{currentShot.name}</span>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div>
                <h4 className="mb-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">Runs &amp; extras</h4>
                <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2, 3, 4, 6].map(num => (
                        <button
                            key={num}
                            onClick={() => setSelectedRuns(num)}
                            className={`score-run-btn min-h-[52px] rounded-xl font-black font-raj text-xl transition-all active:scale-95 ${selectedRuns === num ? 'bg-cric-accent text-white shadow-[0_10px_20px_rgba(255,107,53,0.3)]' : 'bg-black/5 text-cric-text hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10'}`}
                        >
                            {num === 0 ? 'DOT' : num}
                        </button>
                    ))}
                    <button onClick={() => handleRevert()} disabled={reverting} className={`score-run-btn min-h-[52px] rounded-xl border transition-all ${reverting ? 'cursor-not-allowed border-slate-400/20 bg-slate-400/20 text-slate-400' : 'border-orange-500/20 bg-orange-500/10 text-orange-600 hover:bg-orange-500 hover:text-white'}`} title="Undo last ball">
                        {reverting ? (
                            <svg className="mx-auto animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="50" strokeLinecap="round" /></svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mx-auto"><path d="M9 14L4 9l5-5M4 9h12a5 5 0 015 5v3" /></svg>
                        )}
                        <span className="mt-0.5 block text-[7px] font-black uppercase tracking-wider">{reverting ? '...' : 'Undo'}</span>
                    </button>
                </div>

                <div className="mt-2 grid grid-cols-4 gap-2">
                    {['WIDE', 'NO BALL', 'BYE', 'LEG BYE'].map(type => (
                        <button
                            key={type}
                            onClick={() => setSelectedExtra(selectedExtra === type ? null : type)}
                            className={`score-run-btn rounded-xl py-2.5 text-[9px] font-black tracking-widest transition-all active:scale-95 ${selectedExtra === type ? 'bg-cric-accent text-white shadow-lg' : 'bg-black/5 text-cric-muted hover:text-cric-text dark:bg-white/5'}`}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>

            {showFielderSelector && (
                <FielderSelector
                    players={fieldingTeamXI}
                    selectedPlayer={fieldedById}
                    onPlayerChange={setFieldedById}
                    selectedPosition={fieldedByPosition}
                    onPositionChange={setFieldedByPosition}
                />
            )}

            {visibility.showBallMovement && (
                <div>
                    <h4 className="mb-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">Ball movement</h4>
                    <div className="flex flex-wrap gap-2">
                        {movementOptions.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setBallMovement?.(value)}
                                className={`score-touch-btn rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-all ${ballMovement === value ? 'bg-slate-800 text-white shadow-lg dark:bg-slate-200 dark:text-slate-900' : 'bg-black/5 text-slate-500 hover:text-cric-text dark:bg-white/5'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="sticky bottom-0 z-10 grid grid-cols-2 gap-2 rounded-xl bg-cric-card/95 pt-2 backdrop-blur">
                <button
                    onClick={() => setShowSelectionModal('wicket')}
                    className={`score-run-btn min-h-[64px] rounded-xl font-black uppercase tracking-[0.15em] transition-all active:scale-95 ${selectedWicket ? 'bg-red-600 text-white shadow-xl' : 'border-2 border-red-500/20 bg-red-600/10 font-raj text-base italic text-red-500 hover:bg-red-600/20'}`}
                >
                    {selectedWicket ? `OUT: ${selectedWicket}` : 'Wicket'}
                </button>
                <button
                    onClick={submitBall}
                    className="score-run-btn min-h-[64px] rounded-xl bg-green-600 font-black font-raj text-xl italic tracking-tight text-white shadow-[0_12px_30px_rgba(22,163,74,0.3)] transition-all hover:scale-[1.02] active:scale-95 uppercase"
                >
                    Submit ball
                </button>
            </div>
        </div>

        {visibility.showShotTypePicker && (
            <ShotTypePicker
                isOpen={showShotPicker}
                onClose={() => setShowShotPicker(false)}
                onSelect={(shot) => setPitchMapShot(shotValueToId(shot))}
                currentShot={pitchMapShot}
            />
        )}

        </>
    );
});

export default RightSidebarControls;
