import React, { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../Toast';

// Task 6 — Super Sub (Impact Player), IPL-style rule.
// A team's nominated 12th man may replace one player of the playing XI once.
// The platform must enable the rule first (SystemSettings.enableSuperSub,
// default off) or the endpoint will refuse with SUPER_SUB_DISABLED.
const idOf = (value) => String(value?._id || value || '');

const ImpactPlayerSetup = ({ match, matchId }) => {
    const [matchData, setMatchData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [nominee, setNominee] = useState({}); // teamId -> playerId (12th man)
    const [toReplace, setToReplace] = useState({}); // teamId -> playerId (XI out)
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const { showToast } = useToast();

    const loadMatch = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/matches/${matchId}`);
            setMatchData(res.data);
        } catch (err) {
            setError('Failed to load match data.');
        } finally {
            setLoading(false);
        }
    }, [matchId]);

    useEffect(() => {
        loadMatch();
    }, [loadMatch]);

    const teamIndex = (teamId) => (match.teams || []).findIndex((t) => idOf(t) === idOf(teamId));

    const nominate = async (teamId) => {
        const playerId = nominee[idOf(teamId)];
        if (!playerId) return;
        setBusy(true);
        setError('');
        try {
            await api.put(`/matches/${matchId}/twelfth-man`, { teamId, playerId });
            showToast('12th man nominated', 'success');
            await loadMatch();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not nominate 12th man.');
        } finally {
            setBusy(false);
        }
    };

    const applySuperSub = async (teamId) => {
        const playerId = nominee[idOf(teamId)];
        const replacesPlayerId = toReplace[idOf(teamId)];
        if (!playerId || !replacesPlayerId) {
            showToast('Choose both the 12th man and the player to replace.', 'warning');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await api.put(`/matches/${matchId}/impact-player`, { teamId, playerId, replacesPlayerId });
            showToast('Super Sub applied — impact player is now in the XI', 'success');
            await loadMatch();
        } catch (err) {
            const code = err.response?.data?.code;
            const fallback =
                code === 'SUPER_SUB_DISABLED'
                    ? 'The Super Sub rule is disabled. Enable enableSuperSub in platform settings first.'
                    : 'Failed to apply the Super Sub.';
            setError(err.response?.data?.message || fallback);
        } finally {
            setBusy(false);
        }
    };

    const renderTeamPanel = (team) => {
        const teamId = idOf(team);
        if (teamIndex(teamId) === -1) return null;

        const xi = matchData?.playingXI?.find((x) => idOf(x.team) === teamId)?.players || [];
        const xiIds = xi.map(idOf);
        const squad = team.players || [];
        const twelfthEntry = matchData?.twelfthMan?.find((t) => idOf(t.team) === teamId);
        const impactEntry = matchData?.impactPlayers?.find((i) => idOf(i.team) === teamId);

        const existingTwelfthId = idOf(twelfthEntry?.player);
        const candidates = squad.filter((p) => !xiIds.includes(idOf(p)));

        return (
            <div key={teamId} className="rounded-2xl border border-cric-border bg-cric-bg p-4">
                <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-black uppercase tracking-widest text-cric-accent">{team.name}</h4>
                    <span
                        className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
                            impactEntry
                                ? 'bg-green-100 text-green-700'
                                : 'bg-cric-muted/15 text-cric-muted'
                        }`}
                    >
                        {impactEntry ? 'Super Sub used' : 'Super Sub available'}
                    </span>
                </div>

                {impactEntry ? (
                    <p className="mt-3 text-xs font-bold text-cric-text">
                        Impact player {impactEntry.player?.name || 'n/a'} replaced{' '}
                        {impactEntry.replaces?.name || 'n/a'}.
                    </p>
                ) : (
                    <div className="mt-3 space-y-2">
                        {xiIds.length === 0 ? (
                            <p className="text-xs text-cric-muted font-semibold">
                                Save the Playing XI first — the Super Sub swaps a 12th man in for one XI player.
                            </p>
                        ) : (
                            <>
                                <label className="block">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
                                        12th Man
                                    </span>
                                    <select
                                        aria-label={`${team.name} 12th man`}
                                        value={
                                            existingTwelfthId ||
                                            nominee[teamId] ||
                                            (candidates[0] && idOf(candidates[0])) ||
                                            ''
                                        }
                                        onChange={(e) =>
                                            setNominee((prev) => ({ ...prev, [teamId]: e.target.value }))
                                        }
                                        className="mt-1 w-full rounded-xl border border-cric-border bg-cric-card px-3 py-2 text-sm font-bold text-cric-text outline-none focus:border-cric-accent"
                                    >
                                        {candidates.length === 0 && <option value="">No substitute available</option>}
                                        {candidates.map((p) => (
                                            <option key={idOf(p)} value={idOf(p)}>
                                                {p.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                {!existingTwelfthId && (
                                    <button
                                        onClick={() => nominate(teamId)}
                                        disabled={busy}
                                        className="w-full rounded-xl border border-cric-border px-3 py-2 text-[9px] font-black uppercase tracking-widest text-cric-text hover:bg-cric-card disabled:opacity-50"
                                    >
                                        Nominate 12th Man
                                    </button>
                                )}

                                {existingTwelfthId && (
                                    <label className="block">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-cric-muted">
                                            Replace from Playing XI
                                        </span>
                                        <select
                                            aria-label={`${team.name} player to replace`}
                                            value={toReplace[teamId] || ''}
                                            onChange={(e) =>
                                                setToReplace((prev) => ({ ...prev, [teamId]: e.target.value }))
                                            }
                                            className="mt-1 w-full rounded-xl border border-cric-border bg-cric-card px-3 py-2 text-sm font-bold text-cric-text outline-none focus:border-cric-accent"
                                        >
                                            <option value="">Select player...</option>
                                            {xi.map((p) => (
                                                <option key={idOf(p)} value={idOf(p)}>
                                                    {p.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}

                                {existingTwelfthId && (
                                    <button
                                        onClick={() => applySuperSub(teamId)}
                                        disabled={busy}
                                        className="w-full rounded-xl bg-cric-accent px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:opacity-90 disabled:opacity-50"
                                    >
                                        Apply Super Sub
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="mt-6 space-y-3 rounded-2xl border border-cric-border bg-cric-card p-5">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-cric-text">
                        Super Sub (Impact Player)
                    </h3>
                    <p className="mt-1 text-[10px] font-bold text-cric-muted">
                        A team's 12th man may replace one of the playing XI once.
                    </p>
                </div>
                <button
                    onClick={loadMatch}
                    disabled={loading || busy}
                    className="rounded-xl border border-cric-border px-3 py-2 text-[9px] font-black uppercase tracking-widest text-cric-muted hover:bg-cric-bg disabled:opacity-50"
                >
                    Refresh
                </button>
            </div>

            {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-600">
                    {error}
                </p>
            )}

            {loading ? (
                <p className="py-4 text-center text-xs font-black uppercase tracking-widest text-cric-muted">
                    Loading Super Sub state...
                </p>
            ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(match.teams || []).filter((_, i) => i < 2).map(renderTeamPanel)}
                </div>
            )}
        </div>
    );
};

export default ImpactPlayerSetup;