import React from 'react';
import ImpactPlayerSetup from './ImpactPlayerSetup';
import { useScoringAdapters } from '../../ScoringAdapters';

const FORMATS = [
  { value: 'Tape Ball', label: 'Tape Ball', overs: 8, maxBowlerOvers: null, powerplayDefault: false, powerplayOvers: 2 },
  { value: 'T10', label: 'T10 (10 Overs)', overs: 10, maxBowlerOvers: 2, powerplayDefault: true, powerplayOvers: 3 },
  { value: 'T20', label: 'T20 (20 Overs)', overs: 20, maxBowlerOvers: 4, powerplayDefault: true, powerplayOvers: 6 },
  { value: 'ODI', label: 'One Day (50 Overs)', overs: 50, maxBowlerOvers: 10, powerplayDefault: true, powerplayOvers: 10 },
  { value: 'Test', label: 'Test (No Over Limit)', overs: 90, maxBowlerOvers: null, powerplayDefault: false, powerplayOvers: 0 },
  { value: 'Super Over', label: 'Super Over (Tiebreaker)', overs: 1, maxBowlerOvers: 1, powerplayDefault: false, powerplayOvers: 0 },
];

const idOf = (value) => String(value?._id || value || '');

const MatchSetupWizard = ({
    wizardStep,
    selectedMatch,
    setSelectedMatch,
    setupState,
    setSetupState,
    setWizardStep,
    handleSavePlayingXI,
    handleContinueToToss,
    handleSaveToss,
    handleSaveOpeners,
    handleSaveFormat,
    matchSquads,
    matchSquadsLoading = false,
    matchSquadsError = '',
    onRetryLoadSquads,
    twelfthManRule,
    battingXI,
    bowlingXI,
    allowFormatEdit = true,
    allowRuleEdit = true,
    allowSquadSetup = true,
}) => {
    const { api } = useScoringAdapters();
    const selectedFormat = FORMATS.find(f => f.value === setupState.matchFormat) || FORMATS[2];
    const ppEnabled = setupState.powerplayEnabled ?? selectedFormat.powerplayDefault;
    const ppOvers = setupState.powerplayOvers ?? selectedFormat.powerplayOvers;
    const [search, setSearch] = React.useState({ 0: '', 1: '' });

    // Per-match "12th Man" override (rules.twelfthManEnabled). null means inherit
    // from the tournament; here we set an explicit per-match value.
    const [ruleSaving, setRuleSaving] = React.useState(false);
    const [ruleError, setRuleError] = React.useState('');
    const matchRule = selectedMatch?.rules?.twelfthManEnabled;
    const twelfthManOn = matchRule === null || matchRule === undefined
        ? twelfthManRule?.scopedEnabled === true
        : matchRule === true;
    const toggleTwelfthMan = async () => {
        if (!selectedMatch?._id) return;
        setRuleSaving(true);
        setRuleError('');
        try {
            const res = await api.put(`/matches/${selectedMatch._id}`, {
                rules: { twelfthManEnabled: !twelfthManOn },
            });
            const updated = res.data?.match || res.data;
            if (updated) setSelectedMatch(m => ({ ...(m || {}), ...updated, rules: updated.rules }));
        } catch (error) {
            setRuleError(error.response?.data?.message || error.message || 'Could not update the 12th Man rule.');
        } finally {
            setRuleSaving(false);
        }
    };

    const teamIds = [selectedMatch?.teams?.[0]?._id, selectedMatch?.teams?.[1]?._id];
    const selectedByTeam = [setupState.team1XI || [], setupState.team2XI || []];
    const twelfthByTeam = [setupState.team1TwelfthMan || '', setupState.team2TwelfthMan || ''];
    const squadsForMatch = matchSquads?.matchId === idOf(selectedMatch?._id) ? matchSquads : null;
    const squadsReady = Boolean(
        squadsForMatch?.teams?.length &&
        teamIds.every((teamId) => {
            const row = squadsForMatch.teams.find((entry) => idOf(entry.team) === idOf(teamId));
            return Array.isArray(row?.squad) && row.squad.length >= 11;
        })
    );
    const bothXIComplete = selectedByTeam.every((xi) => xi.length === 11);
    const savedXIComplete = [0, 1].every((index) => {
        const teamId = teamIds[index];
        const entry = (selectedMatch?.playingXI || []).find((row) => idOf(row.team) === idOf(teamId));
        return (entry?.players || []).length === 11;
    });
    const selectedPlayersInSquads = squadsReady && teamIds.every((teamId, index) => {
        const row = squadsForMatch.teams.find((entry) => idOf(entry.team) === idOf(teamId));
        const available = new Set((row?.squad || []).map(idOf));
        return selectedByTeam[index].every((playerId) => available.has(idOf(playerId)));
    });
    const canSavePlayingXIs = selectedPlayersInSquads && bothXIComplete;
    const superSubEnabled = twelfthManRule?.enabled === true;

    const setTeamXI = (index, nextXI) => {
        setSetupState((state) => ({
            ...state,
            [index === 0 ? 'team1XI' : 'team2XI']: nextXI,
        }));
    };

    const setTeamTwelfthMan = (index, playerId) => {
        setSetupState((state) => ({
            ...state,
            [index === 0 ? 'team1TwelfthMan' : 'team2TwelfthMan']: playerId,
        }));
    };

    const togglePlayer = (index, playerId) => {
        const current = selectedByTeam[index];
        const isSelected = current.some((id) => idOf(id) === idOf(playerId));
        if (!isSelected && current.length >= 11) return;
        const nextXI = isSelected
            ? current.filter((id) => idOf(id) !== idOf(playerId))
            : [...current, playerId];
        setTeamXI(index, nextXI);
        // A player can only be the 12th Man while they are outside the XI.
        if (!isSelected && idOf(twelfthByTeam[index]) === idOf(playerId)) {
            setTeamTwelfthMan(index, '');
        }
    };

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
                                wizardStep === 2 ? 'Playing XI' :
                                wizardStep === 3 ? 'Toss Result' : 'Openers'
                            }
                        </p>
                    </div>
                    <button onClick={() => setSelectedMatch(null)} className="score-touch-btn text-[10px] font-black text-cric-muted hover:text-cric-text uppercase tracking-widest border border-cric-border px-4 sm:px-6 py-3 rounded-full self-start sm:self-auto">Exit Setup</button>
                </div>

                {wizardStep === 1 && allowFormatEdit && (
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

                        {allowRuleEdit && (
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-4 sm:p-8 rounded-2xl sm:rounded-3xl bg-black/5 dark:bg-white/5">
                            <div>
                                <h4 className="text-sm font-black uppercase tracking-widest">12th Man (this match)</h4>
                                <p className="text-[10px] font-bold text-cric-muted mt-1">
                                    Allow a team to swap its nominated 12th man in once. Also requires the platform master switch.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={twelfthManOn}
                                    disabled={ruleSaving}
                                    onChange={toggleTwelfthMan}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-black/10 rounded-full peer peer-checked:bg-cric-accent after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                            </label>
                        </div>
                        )}
                        {ruleError && (
                            <p role="alert" className="text-sm font-semibold text-red-600">
                                {ruleError}
                            </p>
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

                {wizardStep === 2 && allowSquadSetup && (
                    <div className="space-y-8 sm:space-y-12">
                        <div className="rounded-2xl border border-cric-border bg-cric-bg p-4 sm:p-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cric-accent">Full squad selection</p>
                            <p className="mt-2 text-xs sm:text-sm text-cric-muted font-semibold">
                                Pick exactly 11 players per team, then nominate a 12th Man from the remaining squad.
                                The list below is the complete competition squad for this match.
                            </p>
                        </div>

                        {!squadsReady && (
                            <div
                                role={matchSquadsError ? 'alert' : 'status'}
                                className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-800"
                            >
                                {matchSquadsError
                                    ? `Could not load the complete squads: ${matchSquadsError}`
                                    : matchSquadsLoading
                                        ? 'Loading the complete tournament/event squads...'
                                        : 'Complete squads of at least 11 players per team are required. Player selection is disabled until they load.'}
                                {!matchSquadsLoading && onRetryLoadSquads && (
                                    <button
                                        type="button"
                                        onClick={onRetryLoadSquads}
                                        className="ml-3 font-black underline underline-offset-2"
                                    >
                                        Retry
                                    </button>
                                )}
                            </div>
                        )}

                        {squadsReady && <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10">
                            {[0, 1].map(idx => {
                                const team = selectedMatch.teams?.[idx];
                                const teamId = team?._id;
                                const squadMeta = squadsForMatch.teams.find((row) => idOf(row.team) === idOf(teamId));
                                const squad = squadMeta?.squad || [];
                                const selected = selectedByTeam[idx];
                                const selectedIds = new Set(selected.map(idOf));
                                const query = (search[idx] || '').trim().toLowerCase();
                                const visibleSquad = query
                                    ? squad.filter((player) => String(player?.name || '').toLowerCase().includes(query))
                                    : squad;
                                const twelfthId = idOf(twelfthByTeam[idx]);
                                const remaining = squad.filter((player) => !selectedIds.has(idOf(player)));
                                const canNominateTwelfth = selected.length === 11;
                                const sourceLabel = squadMeta?.squadSource === 'tournament'
                                    ? 'tournament'
                                    : squadMeta?.squadSource === 'event'
                                        ? 'event'
                                        : 'team';

                                return (
                                    <div key={idx} className="space-y-4 min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-black uppercase text-cric-accent tracking-widest truncate">{team?.name} Squad</h4>
                                                <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                                                    {squad.length} players available ({sourceLabel} squad)
                                                </p>
                                            </div>
                                            <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                                                selected.length === 11
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-amber-100 text-amber-700'
                                            }`}>
                                                {selected.length} / 11
                                            </span>
                                        </div>

                                        <label className="block">
                                            <span className="sr-only">Search {team?.name} squad</span>
                                            <input
                                                type="search"
                                                value={search[idx] || ''}
                                                onChange={(e) => setSearch((prev) => ({ ...prev, [idx]: e.target.value }))}
                                                placeholder="Search player..."
                                                className="w-full rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-sm font-bold text-cric-text outline-none focus:border-cric-accent"
                                            />
                                        </label>

                                        <div
                                            className="max-h-[45vh] sm:max-h-[400px] overflow-y-auto overscroll-contain space-y-2 pr-1"
                                            role="group"
                                            aria-label={`${team?.name} full squad`}
                                        >
                                            {visibleSquad.length === 0 && (
                                                <p className="rounded-xl border border-dashed border-cric-border p-4 text-center text-xs font-bold text-cric-muted">
                                                    No players match this search.
                                                </p>
                                            )}
                                            {visibleSquad.map((player) => {
                                                const playerId = idOf(player);
                                                const isSelected = selectedIds.has(playerId);
                                                const isDisabled = !isSelected && selected.length >= 11;
                                                return (
                                                    <button
                                                        type="button"
                                                        key={playerId}
                                                        disabled={isDisabled}
                                                        aria-pressed={isSelected}
                                                        onClick={() => togglePlayer(idx, playerId)}
                                                        className={`w-full p-3.5 sm:p-4 rounded-xl border-2 text-left transition-all ${
                                                            isSelected
                                                                ? 'bg-cric-accent/10 border-cric-accent text-cric-text'
                                                                : isDisabled
                                                                    ? 'bg-cric-bg border-cric-border text-cric-muted/50 cursor-not-allowed'
                                                                    : 'bg-cric-bg border-cric-border text-cric-muted hover:border-cric-border/80'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="font-bold truncate">{player?.name || `Player ${playerId}`}</div>
                                                                {(player?.playingRole || player?.role) && (
                                                                    <div className="text-[10px] font-bold uppercase tracking-wider text-cric-muted mt-0.5">
                                                                        {player.playingRole || player.role}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest ${isSelected ? 'text-cric-accent' : 'text-cric-muted'}`}>
                                                                {isSelected ? 'In XI' : isDisabled ? 'XI full' : 'Select'}
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="rounded-2xl border border-cric-border bg-cric-bg p-4 space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <label htmlFor={`twelfth-man-${idx}`} className="text-[10px] font-black uppercase tracking-widest text-cric-text">
                                                    12th Man {superSubEnabled ? '· Super Sub' : ''}
                                                </label>
                                                {superSubEnabled ? (
                                                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-green-700">
                                                        Super Sub enabled
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full bg-cric-muted/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-cric-muted">
                                                        Reserve only
                                                    </span>
                                                )}
                                            </div>
                                            <select
                                                id={`twelfth-man-${idx}`}
                                                value={twelfthId}
                                                disabled={!canNominateTwelfth}
                                                onChange={(e) => setTeamTwelfthMan(idx, e.target.value)}
                                                className="w-full rounded-xl border border-cric-border bg-cric-card px-3 py-2 text-sm font-bold text-cric-text outline-none focus:border-cric-accent disabled:opacity-50"
                                            >
                                                <option value="">No 12th Man</option>
                                                {remaining.map((player) => (
                                                    <option key={idOf(player)} value={idOf(player)}>
                                                        {player?.name || `Player ${idOf(player)}`}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="text-[10px] font-bold text-cric-muted">
                                                {canNominateTwelfth
                                                    ? superSubEnabled
                                                        ? 'The 12th Man can replace one XI player once, when the rule allows it.'
                                                        : 'The 12th Man is a reserve; the Super Sub replacement rule is off for this match.'
                                                    : 'Select exactly 11 players first — the 12th Man must be outside the XI.'}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>}

                        <div className="space-y-3">
                            <button
                                onClick={handleSavePlayingXI}
                                disabled={!canSavePlayingXIs}
                                className={`score-touch-btn w-full py-4 sm:py-6 lg:py-8 rounded-2xl sm:rounded-[2rem] lg:rounded-[2.5rem] font-black font-raj text-lg sm:text-2xl italic tracking-tighter uppercase transition-all ${
                                    canSavePlayingXIs
                                        ? 'bg-cric-accent text-white shadow-[0_20px_50px_rgba(255,107,53,0.3)] hover:scale-[1.02]'
                                        : 'bg-black/10 text-cric-muted cursor-not-allowed'
                                }`}
                            >
                                Save Playing XIs & 12th Man
                            </button>
                            {!canSavePlayingXIs && (
                                <p className="text-center text-[10px] font-black uppercase tracking-widest text-amber-600">
                                    {!squadsReady
                                        ? 'Load both complete squads before saving.'
                                        : 'Select exactly 11 players for both teams to continue.'}
                                </p>
                            )}
                            {savedXIComplete && squadsReady && (
                                <button
                                    onClick={handleContinueToToss}
                                    className="score-touch-btn w-full py-3 rounded-2xl border border-cric-border text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                                >
                                    Continue with saved XI to Toss
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {wizardStep === 3 && allowSquadSetup && (
                    <div className="space-y-8 sm:space-y-12">
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
                        <div className="space-y-3">
                            <button onClick={handleSaveToss} className="score-touch-btn w-full py-4 sm:py-6 lg:py-8 rounded-2xl sm:rounded-[2rem] lg:rounded-[2.5rem] bg-cric-accent text-white font-black font-raj text-lg sm:text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all">Confirm Toss</button>
                            <button
                                onClick={() => setWizardStep?.(2)}
                                className="score-touch-btn w-full py-3 rounded-2xl border border-cric-border text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                            >
                                Back to Playing XI (edit before toss)
                            </button>
                        </div>
                        {superSubEnabled && savedXIComplete && (
                            <ImpactPlayerSetup match={selectedMatch} matchId={selectedMatch._id} />
                        )}
                    </div>
                )}

                {wizardStep === 4 && allowSquadSetup && (
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
