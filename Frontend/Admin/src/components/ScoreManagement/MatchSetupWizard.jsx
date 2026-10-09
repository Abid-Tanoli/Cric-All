import React from 'react';
import ImpactPlayerSetup from './ImpactPlayerSetup';

const FORMATS = [
  { value: 'Tape Ball', label: 'Tape Ball', overs: 8, maxBowlerOvers: null, powerplayDefault: false, powerplayOvers: 2 },
  { value: 'T10', label: 'T10 (10 Overs)', overs: 10, maxBowlerOvers: 2, powerplayDefault: true, powerplayOvers: 3 },
  { value: 'T20', label: 'T20 (20 Overs)', overs: 20, maxBowlerOvers: 4, powerplayDefault: true, powerplayOvers: 6 },
  { value: 'ODI', label: 'One Day (50 Overs)', overs: 50, maxBowlerOvers: 10, powerplayDefault: true, powerplayOvers: 10 },
  { value: 'Test', label: 'Test (No Over Limit)', overs: 90, maxBowlerOvers: null, powerplayDefault: false, powerplayOvers: 0 },
  { value: 'Super Over', label: 'Super Over (Tiebreaker)', overs: 1, maxBowlerOvers: 1, powerplayDefault: false, powerplayOvers: 0 },
];

const MatchSetupWizard = ({
    wizardStep,
    selectedMatch,
    setSelectedMatch,
    setupState,
    setSetupState,
    handleSavePlayingXI,
    handleSaveToss,
    handleSaveOpeners,
    handleSaveFormat,
    battingXI,
    bowlingXI
}) => {
    const selectedFormat = FORMATS.find(f => f.value === setupState.matchFormat) || FORMATS[2];
    const ppEnabled = setupState.powerplayEnabled ?? selectedFormat.powerplayDefault;
    const ppOvers = setupState.powerplayOvers ?? selectedFormat.powerplayOvers;

    return (
        <div className="min-h-screen bg-cric-bg text-cric-text transition-colors duration-300 flex flex-col items-center justify-center p-3 sm:p-6 lg:p-8 overflow-x-hidden">
            <div className="w-full max-w-4xl bg-cric-card rounded-2xl sm:rounded-[2rem] lg:rounded-[4rem] border border-cric-border shadow-2xl p-4 sm:p-8 lg:p-16 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-cric-accent"></div>

                <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center mb-8 lg:mb-16">
                    <div className="space-y-2">
                        <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black font-raj italic uppercase tracking-tighter leading-none">Match Setup Wizard</h2>
                        <p className="text-cric-muted font-medium tracking-wide uppercase text-xs">
                            Step {wizardStep} of 4: {
                                wizardStep === 1 ? 'Match Format' :
                                wizardStep === 2 ? 'Team Rosters' :
                                wizardStep === 3 ? 'Toss Result' : 'Openers'
                            }
                        </p>
                    </div>
                    <button onClick={() => setSelectedMatch(null)} className="score-touch-btn text-[10px] font-black text-cric-muted hover:text-cric-text uppercase tracking-widest border border-cric-border px-4 sm:px-6 py-3 rounded-full self-start sm:self-auto">Exit Setup</button>
                </div>

                {wizardStep === 1 && (
                    <div className="space-y-12">
                        <div className="space-y-6">
                            <h4 className="text-sm font-black uppercase text-cric-accent tracking-widest pl-2">Match Format</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {FORMATS.map(f => (
                                    <button
                                        key={f.value}
                                        onClick={() => {
                                            setSetupState(s => ({
                                                ...s,
                                                matchFormat: f.value,
                                                totalOvers: f.overs,
                                                powerplayEnabled: f.powerplayDefault,
                                                powerplayOvers: f.powerplayOvers,
                                            }));
                                        }}
                                        className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border-2 text-left transition-all ${
                                            setupState.matchFormat === f.value
                                                ? 'bg-cric-accent/10 border-cric-accent'
                                                : 'bg-cric-bg border-cric-border text-cric-muted hover:border-cric-border/80'
                                        }`}
                                    >
                                        <div className="font-black text-lg">{f.label}</div>
                                        <div className="text-[10px] font-bold text-cric-muted mt-1 uppercase tracking-wider">
                                            {f.overs} overs/innings
                                            {f.maxBowlerOvers ? ` - Max ${f.maxBowlerOvers} overs/bowler` : ' - No bowler limit'}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {!['Test', 'Super Over'].includes(selectedFormat.value) && (
                            <div className="space-y-6 p-4 sm:p-8 rounded-2xl sm:rounded-3xl bg-black/5 dark:bg-white/5">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h4 className="text-sm font-black uppercase tracking-widest">Powerplay Overs</h4>
                                        <p className="text-[10px] font-bold text-cric-muted mt-1">
                                            Fielding restrictions during first block of overs
                                        </p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={ppEnabled}
                                            onChange={(e) => setSetupState(s => ({ ...s, powerplayEnabled: e.target.checked }))}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-black/10 rounded-full peer peer-checked:bg-cric-accent after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                                    </label>
                                </div>
                                {ppEnabled && (
                                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                                        <span className="text-xs font-bold uppercase tracking-wider text-cric-muted">Powerplay overs:</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={Math.min(selectedFormat.overs, 10)}
                                            value={ppOvers}
                                            onChange={(e) => setSetupState(s => ({ ...s, powerplayOvers: Math.max(1, Math.min(selectedFormat.overs, Number(e.target.value)))}))}
                                            className="w-24 p-3 bg-cric-bg border border-cric-border rounded-2xl text-center font-black text-lg outline-none focus:border-cric-accent"
                                        />
                                        <span className="text-xs font-bold text-cric-muted">
                                            of {selectedFormat.overs} overs
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={() => handleSaveFormat({
                                matchFormat: setupState.matchFormat,
                                totalOvers: setupState.totalOvers,
                                powerplayEnabled: ppEnabled,
                                powerplayOvers: ppEnabled ? ppOvers : 0,
                            })}
                            disabled={!setupState.matchFormat}
                            className={`score-touch-btn w-full py-4 sm:py-6 lg:py-8 rounded-2xl sm:rounded-[2rem] lg:rounded-[2.5rem] font-black font-raj text-lg sm:text-2xl italic tracking-tighter uppercase shadow-lg transition-all ${
                                setupState.matchFormat
                                    ? 'bg-cric-accent text-white shadow-[0_20px_50px_rgba(255,107,53,0.3)] hover:scale-[1.02]'
                                    : 'bg-black/10 text-cric-muted cursor-not-allowed'
                            }`}
                        >
                            Confirm Format & Continue
                        </button>
                    </div>
                )}

                {wizardStep === 2 && (
                    <div className="space-y-12">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-12">
                            {[0, 1].map(idx => (
                                <div key={idx} className="space-y-6">
                                    <h4 className="text-sm font-black uppercase text-cric-accent tracking-widest pl-2">{selectedMatch.teams[idx]?.name} Squad</h4>
                                    <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto no-scrollbar pr-2">
                                        {(selectedMatch.teams[idx]?.players || []).map(p => {
                                            const pId = p._id || p;
                                            const isSelected = idx === 0 ? setupState.team1XI.includes(pId) : setupState.team2XI.includes(pId);
                                            return (
                                                <button
                                                    key={pId}
                                                    onClick={() => {
                                                        const teamKey = idx === 0 ? 'team1XI' : 'team2XI';
                                                        const current = setupState[teamKey];
                                                        setSetupState(s => ({
                                                            ...s,
                                                            [teamKey]: isSelected ? current.filter(id => id !== pId) : [...current, pId]
                                                        }));
                                                    }}
                                                    className={`p-4 rounded-2xl border-2 text-left transition-all ${isSelected ? 'bg-cric-accent/10 border-cric-accent text-cric-text' : 'bg-cric-bg border-cric-border text-cric-muted hover:border-cric-border/80'}`}
                                                >
                                                    <div className="font-bold">{p.name || `Player ${pId}`}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="text-[10px] font-black text-cric-muted uppercase tracking-widest text-center">
                                        {idx === 0 ? setupState.team1XI.length : setupState.team2XI.length} / 11 Selected
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={handleSavePlayingXI} className="score-touch-btn w-full py-4 sm:py-6 lg:py-8 rounded-2xl sm:rounded-[2rem] lg:rounded-[2.5rem] bg-cric-accent text-white font-black font-raj text-lg sm:text-2xl italic tracking-tighter uppercase shadow-[0_20px_50px_rgba(255,107,53,0.3)] hover:scale-[1.02] transition-all">Save Playing XIs</button>

                        <ImpactPlayerSetup match={selectedMatch} matchId={selectedMatch._id} />
                    </div>
                )}

                {wizardStep === 3 && (
                    <div className="space-y-12">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-cric-muted uppercase tracking-[0.3em] pl-4">Toss Winner</label>
                                <div className="grid grid-cols-1 gap-4">
                                    {selectedMatch.teams.map(t => (
                                        <button key={t._id} onClick={() => setSetupState(s => ({ ...s, tossWinner: t._id }))} className={`score-touch-btn p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl border-2 font-black text-base sm:text-xl italic font-raj transition-all ${setupState.tossWinner === t._id ? 'bg-blue-600/10 border-blue-500 text-blue-500' : 'bg-cric-bg border-cric-border text-cric-muted'}`}>
                                            {t.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-cric-muted uppercase tracking-[0.3em] pl-4">Decision</label>
                                <div className="grid grid-cols-1 gap-4">
                                    {['bat', 'bowl'].map(d => (
                                        <button key={d} onClick={() => setSetupState(s => ({ ...s, tossDecision: d }))} className={`score-touch-btn p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl border-2 font-black text-base sm:text-xl italic font-raj uppercase transition-all ${setupState.tossDecision === d ? 'bg-cric-accent/10 border-cric-accent text-cric-accent' : 'bg-cric-bg border-cric-border text-cric-muted'}`}>
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <button onClick={handleSaveToss} className="score-touch-btn w-full py-4 sm:py-6 lg:py-8 rounded-2xl sm:rounded-[2rem] lg:rounded-[2.5rem] bg-cric-accent text-white font-black font-raj text-lg sm:text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all">Confirm Toss</button>
                    </div>
                )}

                {wizardStep === 4 && (
                    <div className="space-y-12">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-12">
                            <div className="space-y-6">
                                <h4 className="text-[10px] font-black uppercase text-cric-accent tracking-widest pl-2">Select Batters</h4>
                                <select value={setupState.strikerId} onChange={(e) => setSetupState(s => ({ ...s, strikerId: e.target.value }))} className="w-full p-4 sm:p-6 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl text-cric-text font-bold outline-none focus:border-cric-accent">
                                    <option value="">Select Striker...</option>
                                    {battingXI.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                                </select>
                                <select value={setupState.nonStrikerId} onChange={(e) => setSetupState(s => ({ ...s, nonStrikerId: e.target.value }))} className="w-full p-4 sm:p-6 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl text-cric-text font-bold outline-none focus:border-cric-accent">
                                    <option value="">Select Non-Striker...</option>
                                    {battingXI.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-6">
                                <h4 className="text-[10px] font-black uppercase text-blue-500 tracking-widest pl-2">Select Bowler</h4>
                                <select value={setupState.bowlerId} onChange={(e) => setSetupState(s => ({ ...s, bowlerId: e.target.value }))} className="w-full p-4 sm:p-6 bg-cric-bg border border-cric-border rounded-2xl sm:rounded-3xl text-cric-text font-bold outline-none focus:border-blue-500">
                                    <option value="">Select Opening Bowler...</option>
                                    {bowlingXI.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <button onClick={handleSaveOpeners} className="score-touch-btn w-full py-4 sm:py-6 lg:py-8 rounded-2xl sm:rounded-[2rem] lg:rounded-[2.5rem] bg-cric-accent text-white font-black font-raj text-lg sm:text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all">Start Live Scoring</button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MatchSetupWizard;
