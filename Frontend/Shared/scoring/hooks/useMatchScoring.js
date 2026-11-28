import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getTabIdFromRoute, FIELD_POSITIONS, WICKET_TYPES } from '../components/ScoreManagement/constants';
import { useScoringAdapters } from '../ScoringAdapters';
import { createScoringApi } from '../createScoringApi';
import { isNextBowlerRequired } from '../utils/nextBowler';

const isIllegalDelivery = (ball) => !!(ball?.isWide || ball?.isNoBall);

const CROSSING_WICKET_TYPES = ['run out', 'runOut', 'obstructing the field', 'obstructingField'];
const isCrossingWicket = (type) => CROSSING_WICKET_TYPES.includes(type);

const isOverInProgress = (innings) => {
    const overs = innings?.oversHistory || [];
    const lastOver = overs[overs.length - 1];
    if (!lastOver || !Array.isArray(lastOver.balls) || lastOver.balls.length === 0) return false;
    return lastOver.balls.filter((ball) => !ball.isWide && !ball.isNoBall).length < 6;
};

// A version 4 UUID for one ball or one undo. crypto.randomUUID exists only on
// HTTPS and localhost; getRandomValues also works on a plain-HTTP address.
const newClientId = () => {
    const c = globalThis.crypto;
    if (typeof c?.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// Every tap gets a new id. Only a tap that repeats a failed one (same ball,
// not yet confirmed) reuses that id, so a retry after an error or a lost
// answer is recorded once (B6), while two identical balls in a row, even one
// sent while the other is still in flight, stay two balls.
const clientIdForTap = (ref, key) => {
    const prev = ref.current;
    if (prev?.failed && prev.key === key) {
        prev.failed = false;
        return prev.id;
    }
    ref.current = { key, id: newClientId(), failed: false };
    return ref.current.id;
};

// Confirmed: forget the id. Failed: keep it for a retry of the same tap.
const settleClientId = (ref, id, confirmed) => {
    if (ref.current?.id !== id) return;
    if (confirmed) ref.current = null;
    else ref.current.failed = true;
};

export default function useMatchScoring({ matchId, tabId }) {
    const adapters = useScoringAdapters();
    const api = useMemo(
        () => adapters.api || createScoringApi({ apiBaseUrl: adapters.apiBaseUrl, getToken: adapters.getToken }),
        [adapters.api, adapters.apiBaseUrl, adapters.getToken]
    );
    const axios = api;
    const API_BASE_URL = api.defaults?.baseURL || adapters.apiBaseUrl;
    const token = adapters.getToken?.();
    const [matches, setMatches] = useState([]);
    const [matchesLoaded, setMatchesLoaded] = useState(false);
    const [selectedMatch, setSelectedMatch] = useState(null);
    const [matchSquads, setMatchSquads] = useState(null);
    const [matchSquadsLoading, setMatchSquadsLoading] = useState(false);
    const [matchSquadsError, setMatchSquadsError] = useState('');
    const [loading, setLoading] = useState(false);
    const [socketConnected, setSocketConnected] = useState(true);
    const [showSettings, setShowSettings] = useState(false);

    const activeTab = getTabIdFromRoute(tabId);
    const setActiveTab = useCallback((tab) => {
        const targetMatchId = selectedMatch?._id || matchId;
        if (targetMatchId) adapters.navigate(adapters.buildScorePath(targetMatchId, tab));
    }, [adapters, selectedMatch, matchId]);

    const [reverting, setReverting] = useState(false);
    const pendingBallRef = useRef(null);
    const pendingUndoRef = useRef(null);
    const [selectedRuns, setSelectedRuns] = useState(0);
    const [selectedExtra, setSelectedExtra] = useState(null);
    const [selectedWicket, setSelectedWicket] = useState('');
    const [manualCommentary, setManualCommentary] = useState('');
    const [fieldPos, setFieldPos] = useState('');
    const [isWicketDropdownOpen, setIsWicketDropdownOpen] = useState(false);
    const [loadingCommentary, setLoadingCommentary] = useState(false);
    const [toast, setToast] = useState('');
    const showToast = adapters.showToast;

    // The match document is the single source of truth for AI commentary, so
    // every scorer sees the same mode. The old browser-local key is ignored.
    const useAICommentary = selectedMatch?.useAiCommentary === true;
    const setUseAICommentary = useCallback(async (enabled) => {
        const targetId = selectedMatch?._id || matchId;
        if (!targetId) return;
        try {
            const res = await api.patch(`/matches/${targetId}/ai-commentary`, {
                useAiCommentary: Boolean(enabled),
            });
            if (res?.data?.match) {
                setSelectedMatch(res.data.match);
            } else {
                setSelectedMatch((prev) => prev ? { ...prev, useAiCommentary: Boolean(enabled) } : prev);
            }
        } catch (error) {
            console.error("Failed to update AI commentary:", error);
            showToast?.("Could not update AI commentary for this match");
        }
    }, [api, selectedMatch?._id, matchId, showToast]);

    const reloadMatch = useCallback(async (targetMatchId = matchId) => {
        if (!targetMatchId) return;
        try {
            const res = await api.get(`/matches/${targetMatchId}`);
            setSelectedMatch(res.data);
        } catch (err) {
            console.error("Failed to reload match:", err);
        }
    }, [api, matchId]);

    // Socket-based real-time updates for wagon wheel, scores, etc.
    useEffect(() => {
        const socket = adapters.socket || adapters.getSocket?.();
        if (!socket || !matchId) {
            setSocketConnected(false);
            return;
        }
        setSocketConnected(Boolean(socket.connected));
        const mid = String(matchId);
        const payloadMatchId = (payload = {}) => payload.matchId || payload.match?._id || payload._id;
        const shouldHandle = (payload) => {
            const incomingId = payloadMatchId(payload);
            return !incomingId || String(incomingId) === mid;
        };
        const onMatchEvent = (payload) => {
            if (shouldHandle(payload)) reloadMatch(matchId);
        };
        const onConnect = () => {
            setSocketConnected(true);
            adapters.joinMatchRoom?.(mid);
            reloadMatch(mid);
        };
        const onDisconnect = () => setSocketConnected(false);

        adapters.joinMatchRoom?.(matchId);

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("score:update", onMatchEvent);
        socket.on("ball:recorded", onMatchEvent);
        socket.on("strike:changed", onMatchEvent);
        socket.on("over:completed", onMatchEvent);
        socket.on("match:updated", onMatchEvent);

        return () => {
            adapters.leaveMatchRoom?.(matchId);
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("score:update", onMatchEvent);
            socket.off("ball:recorded", onMatchEvent);
            socket.off("strike:changed", onMatchEvent);
            socket.off("over:completed", onMatchEvent);
            socket.off("match:updated", onMatchEvent);
        };
    }, [adapters, matchId, reloadMatch]);

    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });
    const [isDRSModalOpen, setIsDRSModalOpen] = useState(false);
    const [drsData, setDrsData] = useState({ result: 'upheld', type: 'lbw' });

    const [showSelectionModal, setShowSelectionModal] = useState('');
    const [showNextBowlerModal, setShowNextBowlerModal] = useState(false);
    const [activeGroundZone, setActiveGroundZone] = useState(null);

    const [pitchMapLine, setPitchMapLine] = useState('');
    const [pitchMapLength, setPitchMapLength] = useState('');
    const [pitchMapShot, setPitchMapShot] = useState('');
    const [pitchMapClickPos, setPitchMapClickPos] = useState(null);
    const [pitchMapViewMode, setPitchMapViewMode] = useState('this_over');
    const [ballMovement, setBallMovement] = useState('none');
    const [ballOutcome, setBallOutcome] = useState('played');
    const [fieldedById, setFieldedById] = useState('');
    const [fieldedByPosition, setFieldedByPosition] = useState('');

    const [setupState, setSetupState] = useState({
        team1XI: [],
        team2XI: [],
        team1TwelfthMan: '',
        team2TwelfthMan: '',
        team1SuperSub: '',
        team2SuperSub: '',
        matchFormat: 'T20',
        totalOvers: 20,
        powerplayEnabled: true,
        powerplayOvers: 6,
        tossWinner: '',
        tossDecision: 'bat',
        strikerId: '',
        nonStrikerId: '',
        bowlerId: '',
        wicketDismissal: '',
        wicketFielder: '',
        wicketNewBatter: '',
        wicketDismissedPlayer: 'striker',
        wicketDidCross: false,
        wicketRuns: 0
    });

    const [wizardStep, setWizardStep] = useState(1);
    const [isPreMatchComplete, setIsPreMatchComplete] = useState(false);

    const curInn = selectedMatch?.innings[selectedMatch?.currentInnings] || null;
    const firstInn = selectedMatch?.innings[0] || null;
    const battingTeamId = curInn?.team?._id || curInn?.team;
    const target = curInn?.target || 0;
    const isInnings2 = selectedMatch?.currentInnings === 1;

    const calculateWinProb = () => {
        if (!selectedMatch || !curInn) return { team1: 50, team2: 50 };
        if (selectedMatch.status === 'completed') return { team1: selectedMatch.result.winner === selectedMatch.teams[0]._id ? 100 : 0, team2: selectedMatch.result.winner === selectedMatch.teams[1]._id ? 100 : 0 };
        if (selectedMatch.currentInnings === 1 && curInn.target > 0) {
            const rrr = curInn.requiredRunRate || 0;
            const crr = curInn.runRate || 0;
            const prob = Math.max(10, Math.min(90, 50 + (crr - rrr) * 5));
            return { team1: 100 - prob, team2: prob };
        }
        return { team1: 50, team2: 50 };
    }
    const winProb = calculateWinProb();

    const battingTeamTeam = selectedMatch?.teams?.find(t => String(t._id) === String(battingTeamId)) || selectedMatch?.teams?.[0];
    const bowlingTeamTeam = selectedMatch?.teams?.find(t => String(t._id) !== String(battingTeamId)) || selectedMatch?.teams?.[1];

    const getPlayingXI = (teamId) => {
        if (!teamId || !selectedMatch) return [];
        const pxi = selectedMatch.playingXI?.find(p => String(p.team?._id || p.team) === String(teamId));
        if (!pxi || !pxi.players) return [];
        return pxi.players.map(p => {
            if (typeof p === 'object' && p !== null && p.name) return p;
            const pid = p._id || p;
            for (const team of (selectedMatch.teams || [])) {
                const found = team.players?.find(pl => String(pl._id || pl) === String(pid));
                if (found && typeof found === 'object') return found;
            }
            return typeof p === 'object' ? p : { _id: p, name: `Player ${p}` };
        });
    }

    const getSquad = (teamId) => {
        if (!teamId || !selectedMatch) return [];
        const squad = selectedMatch.squad15?.find(s => String(s.team?._id || s.team) === String(teamId));
        let players = [];
        if (squad && squad.players && squad.players.length > 0) {
            players = squad.players;
        } else {
            players = getPlayingXI(teamId);
        }
        if (players.length > 0) {
            return players.map(p => {
                if (typeof p === 'object' && p !== null && p.name) return p;
                const pid = p._id || p;
                for (const team of (selectedMatch.teams || [])) {
                    const found = team.players?.find(pl => String(pl._id || pl) === String(pid));
                    if (found && typeof found === 'object') return found;
                }
                return typeof p === 'object' ? p : { _id: p, name: `Player ${p}` };
            });
        }
        const team = selectedMatch.teams?.find(t => String(t._id) === String(teamId));
        return team?.players || [];
    }
    const getSquadMeta = (teamId) => {
        if (!teamId || !selectedMatch) return null;
        return selectedMatch.squad15?.find(s => String(s.team?._id || s.team) === String(teamId)) || null;
    }

    const twelfthManRule = matchSquads?.rules?.twelfthMan || null;

    const battingXI = useMemo(() => getSquad(battingTeamId), [selectedMatch, battingTeamId]);
    const bowlingXI = useMemo(() => getSquad(bowlingTeamTeam?._id), [selectedMatch, bowlingTeamTeam]);
    const battingPlayingXI = useMemo(() => getPlayingXI(battingTeamId), [selectedMatch, battingTeamId]);
    const bowlingPlayingXI = useMemo(() => getPlayingXI(bowlingTeamTeam?._id), [selectedMatch, bowlingTeamTeam]);

    const strikerId = curInn?.onStrikeBatsman?._id || curInn?.onStrikeBatsman;
    const bat1Id = curInn?.currentBatsman1?._id || curInn?.currentBatsman1;
    const bat2Id = curInn?.currentBatsman2?._id || curInn?.currentBatsman2;
    const nonStrikerId = (String(bat1Id) === String(strikerId) ? bat2Id : bat1Id);
    const bowlerId = curInn?.currentBowler?._id || curInn?.currentBowler;

    const strikerStats = useMemo(() => curInn?.batting?.find(b => String(b.player?._id || b.player) === String(strikerId)), [curInn, strikerId]);
    const nonStrikerStats = useMemo(() => curInn?.batting?.find(b => String(b.player?._id || b.player) === String(nonStrikerId)), [curInn, nonStrikerId]);
    const activeBowlerStats = useMemo(() => curInn?.bowling?.find(b => String(b.player?._id || b.player) === String(bowlerId)), [curInn, bowlerId]);

    const currentPartnership = useMemo(() => {
        if (!curInn || !curInn.partnerships || curInn.partnerships.length === 0) return { runs: 0, balls: 0 };
        const lastP = curInn.partnerships[curInn.partnerships.length - 1];
        if (lastP && lastP.wicket === undefined) return lastP;
        return { runs: 0, balls: 0 };
    }, [curInn]);

    const formattedHistory = useMemo(() => {
        if (!selectedMatch || !curInn || !curInn.oversHistory) return [];
        const balls = [];
        curInn.oversHistory.forEach(over => {
            let legalBalls = 0;
            over.balls.forEach(ball => {
                const displayBallNumber = ball.displayBallNumber || ball.legalBallNumber || legalBalls + 1;
                balls.push({
                    ...ball,
                    overNumber: over.overNumber,
                    displayBallNumber,
                    rawBallNumber: ball.ballNumber,
                    batsmanName: ball.batsmanOnStrike?.name || (battingXI.find(p => String(p._id) === String(ball.batsmanOnStrike?._id || ball.batsmanOnStrike))?.name) || "Batsman",
                    bowlerName: ball.bowler?.name || (bowlingXI.find(p => String(p._id) === String(ball.bowler?._id || ball.bowler))?.name) || "Bowler",
                    ballNumber: ball.ballNumber
                });
                if (!isIllegalDelivery(ball)) {
                    legalBalls += 1;
                }
            });
        });
        return balls;
    }, [selectedMatch, curInn, battingXI, bowlingXI]);

    useEffect(() => {
        fetchMatches();
    }, []);

    // One-time migration: any stale browser value is removed, never read and
    // never written again. The match flag always wins.
    useEffect(() => {
        if (typeof window !== 'undefined' && window.localStorage.getItem('bq_use_ai_commentary') !== null) {
            window.localStorage.removeItem('bq_use_ai_commentary');
        }
    }, []);

    useEffect(() => {
        if (matchesLoaded && matchId && (!selectedMatch || String(selectedMatch._id) !== String(matchId))) {
            handleSelectMatch(matchId);
        }
    }, [matchId, matchesLoaded]);

    const fetchMatches = async () => {
        try {
            setLoading(true);
            const result = adapters.fetchMatches
                ? await adapters.fetchMatches()
                : (await axios.get(`${API_BASE_URL}/matches`, { headers: { Authorization: `Bearer ${token}` } })).data;
            const items = Array.isArray(result) ? result : result?.matches || result?.items || [];
            setMatches(items.filter((match) => !adapters.isMatchAllowed || adapters.isMatchAllowed(match)));
            setMatchesLoaded(true);
        } catch (err) {
            console.error(err);
            setMatchesLoaded(true);
        } finally {
            setLoading(false);
        }
    };

    const loadMatchSquads = async (id) => {
        setMatchSquads(null);
        setMatchSquadsLoading(true);
        setMatchSquadsError('');
        try {
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const squadsRes = await axios.get(`${API_BASE_URL}/matches/${id}/squads`, { headers });
            setMatchSquads(squadsRes.data);
            return squadsRes.data;
        } catch (err) {
            console.error('Failed to load full squads:', err);
            setMatchSquadsError(err.response?.data?.message || err.message || 'Request failed');
            return null;
        } finally {
            setMatchSquadsLoading(false);
        }
    };

    const handleSelectMatch = async (id) => {
        try {
            if (adapters.isMatchAllowed && !matches.some((match) => adapters.isMatchAllowed(match) && String(match._id) === String(id))) {
                setSelectedMatch(null);
                return;
            }
            setLoading(true);
            setMatchSquads(null);
            setMatchSquadsError('');
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const res = await axios.get(`${API_BASE_URL}/matches/${id}`, { headers });
            setSelectedMatch(res.data);
            loadMatchSquads(id);

            const t1XI = res.data.playingXI?.find(p => (p.team?._id || p.team) === res.data.teams[0]?._id)?.players?.map(p => p._id || p) || [];
            const t2XI = res.data.playingXI?.find(p => (p.team?._id || p.team) === res.data.teams[1]?._id)?.players?.map(p => p._id || p) || [];
            const twelfthFor = (teamId) => {
                const entry = (res.data.twelfthMan || []).find(t => String(t.team?._id || t.team) === String(teamId));
                return String(entry?.player?._id || entry?.player || '');
            };
            const superSubFor = (teamId) => {
                const entry = (res.data.superSub || []).find(t => String(t.team?._id || t.team) === String(teamId));
                return String(entry?.player?._id || entry?.player || '');
            };
            const curInn = res.data.innings[res.data.currentInnings];
            const strikeId = curInn?.onStrikeBatsman?._id || curInn?.onStrikeBatsman || '';
            const bat1Id = curInn?.currentBatsman1?._id || curInn?.currentBatsman1 || '';
            const bat2Id = curInn?.currentBatsman2?._id || curInn?.currentBatsman2 || '';
            const nonStrikeId = (bat1Id === strikeId ? bat2Id : bat1Id);

            setSetupState(prev => ({
                ...prev,
                team1XI: t1XI,
                team2XI: t2XI,
                team1TwelfthMan: twelfthFor(res.data.teams[0]?._id),
                team2TwelfthMan: twelfthFor(res.data.teams[1]?._id),
                team1SuperSub: superSubFor(res.data.teams[0]?._id),
                team2SuperSub: superSubFor(res.data.teams[1]?._id),
                matchFormat: res.data.matchType || prev.matchFormat,
                totalOvers: res.data.totalOvers || prev.totalOvers,
                powerplayEnabled: res.data.powerplayConfig?.enabled ?? prev.powerplayEnabled,
                powerplayOvers: res.data.powerplayConfig?.overs ?? prev.powerplayOvers,
                tossWinner: res.data.tossWinner?._id || res.data.tossWinner || '',
                tossDecision: res.data.tossDecision || 'bat',
                strikerId: strikeId,
                nonStrikerId: nonStrikeId,
                bowlerId: curInn?.currentBowler?._id || curInn?.currentBowler || ''
            }));

            checkRoles(res.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const checkRoles = (matchData) => {
        if (!matchData) return;
        const curInn = matchData.innings[matchData.currentInnings];
        if (!curInn) return;

        const hasFormat = matchData.matchType && matchData.totalOvers > 0;

        const team1XI = matchData.playingXI?.find(p => (p.team?._id || p.team) === matchData.teams[0]?._id);
        const team2XI = matchData.playingXI?.find(p => (p.team?._id || p.team) === matchData.teams[1]?._id);
        const hasPlayingXI = team1XI && team2XI && team1XI.players.length === 11 && team2XI.players.length === 11;

        const hasToss = !!(matchData.tossWinner && matchData.tossDecision);

        const hasOpeners = curInn.onStrikeBatsman && curInn.currentBatsman1 && curInn.currentBatsman2 && curInn.currentBowler;

        if (!hasFormat || !hasPlayingXI || !hasToss || !hasOpeners) {
            setIsPreMatchComplete(false);
            if (!hasFormat) setWizardStep(1);
            else if (!hasPlayingXI) setWizardStep(2);
            else if (!hasToss) setWizardStep(3);
            else setWizardStep(4);
        } else {
            setIsPreMatchComplete(true);
            setWizardStep(5);
            setShowNextBowlerModal(isNextBowlerRequired(curInn));
            setShowSelectionModal('');
        }
    };

    const submitBall = async () => {
        if (!selectedMatch) return;
        const curInn = selectedMatch.innings[selectedMatch.currentInnings];
        if (isNextBowlerRequired(curInn)) {
            setShowNextBowlerModal(true);
            showToast("Select the next bowler to continue.", "warning");
            return;
        }
        if (!curInn.onStrikeBatsman || !curInn.currentBowler) {
            showToast("Ensure players are selected", "warning");
            return;
        }

        const strikerStats = curInn.batting.find(b => String(b.player?._id || b.player) === String(curInn.onStrikeBatsman?._id || curInn.onStrikeBatsman));
        if (strikerStats?.isOut || strikerStats?.isRetired || strikerStats?.isRetiredHurt) {
            showToast(`Striker ${strikerStats?.player?.name || ''} is already out/retired. Please select a new batsman first.`, 'warning');
            setShowSelectionModal('striker');
            return;
        }

        if (selectedWicket && !setupState.wicketNewBatter && curInn.wickets < 9 && selectedWicket !== 'retired hurt') {
            showToast("Please select the next batsman in the Wicket Details modal.", 'warning');
            setShowSelectionModal('wicket');
            return;
        }

        const batsmanOnStrike = curInn.onStrikeBatsman?._id || curInn.onStrikeBatsman;
        const b1Id = curInn.currentBatsman1?._id || curInn.currentBatsman1;
        const b2Id = curInn.currentBatsman2?._id || curInn.currentBatsman2;
        const batsmanNonStrike = (String(b1Id) === String(batsmanOnStrike) ? b2Id : b1Id);

        // A run-out (or obstructing the field) can dismiss either batter, and
        // the scorer may have completed runs / crossed before the throw.
        const crossingWicket = isCrossingWicket(selectedWicket);
        const nonStrikerSelected = setupState.wicketDismissedPlayer === 'nonStriker'
            || String(setupState.wicketDismissedPlayer) === String(batsmanNonStrike);
        const dismissedPlayerId = crossingWicket
            ? (nonStrikerSelected ? batsmanNonStrike : batsmanOnStrike)
            : undefined;
        const ballRuns = crossingWicket ? Number(setupState.wicketRuns || 0) : selectedRuns;

        const ballData = {
            inningsIndex: selectedMatch.currentInnings,
            runs: ballRuns,
            isWide: selectedExtra === 'WIDE',
            isNoBall: selectedExtra === 'NO BALL',
            isBye: selectedExtra === 'BYE',
            isLegBye: selectedExtra === 'LEG BYE',
            isWicket: !!selectedWicket,
            wicketType: selectedWicket,
            fielderId: setupState.wicketFielder || fieldedById || undefined,
            batsmanOnStrikeId: batsmanOnStrike,
            batsmanNonStrikeId: batsmanNonStrike,
            bowlerId: curInn.currentBowler?._id || curInn.currentBowler,
            ...(crossingWicket ? {
                dismissedPlayerId,
                didCross: !!setupState.wicketDidCross,
                wicketDidCross: !!setupState.wicketDidCross
            } : {}),
            ...(useAICommentary ? {
                fieldingZone: activeGroundZone?.direction || FIELD_POSITIONS.find(p => p.id === fieldPos)?.name || fieldPos,
                shotPlacement: activeGroundZone ? { x: activeGroundZone.x, y: activeGroundZone.y, angle: activeGroundZone.angle, distance: activeGroundZone.distance, position: activeGroundZone.direction } : null,
                shotType: pitchMapShot || activeGroundZone?.shotName || '',
                pitchZone: (pitchMapLength || '').replace(/_/g, '-'),
                ballMovement,
                ballOutcome,
                pitchLine: pitchMapLine || '',
                pitchLength: pitchMapLength || '',
                pitchShotType: pitchMapShot || '',
                pitchX: pitchMapClickPos ? Math.round(((pitchMapClickPos.x - 60) / 140) * 100) : null,
                pitchY: pitchMapClickPos ? Math.round(((pitchMapClickPos.y - 40) / 440) * 100) : null,
                groundZone: activeGroundZone?.shotName || activeGroundZone?.nearestPosition || '',
                fieldedByPosition: fieldedByPosition,
                fieldedById: fieldedById,
                shotTypeName: pitchMapShot || ''
            } : {}),
            commentaryText: useAICommentary ? manualCommentary : (manualCommentary || ""),
            customCommentary: !useAICommentary,
            nextBatsmanId: setupState.wicketNewBatter || undefined,
        };

        // "The same ball" is the same innings, runs, extra and wicket. Batter
        // and bowler ids are left out: a socket refresh after a lost answer can
        // already show the ball, with the strike changed.
        const clientBallId = clientIdForTap(pendingBallRef, JSON.stringify([
            selectedMatch._id, ballData.inningsIndex, ballData.runs,
            ballData.isWide, ballData.isNoBall, ballData.isBye, ballData.isLegBye,
            ballData.wicketType, ballData.dismissedPlayerId ?? null, ballData.nextBatsmanId ?? null,
        ]));

        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/score`, { ...ballData, clientBallId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            settleClientId(pendingBallRef, clientBallId, true);
            pendingUndoRef.current = null;

            setToast(res.data.duplicate ? "Ball already recorded" : res.data.isOverComplete ? "Over Completed!" : "Ball Submitted");
            setSelectedMatch(res.data.match);
            setSelectedRuns(0);
            setSelectedExtra(null);
            setSelectedWicket('');
            setFieldPos('');
            setManualCommentary('');
            setActiveGroundZone(null);
            setPitchMapLine('');
            setPitchMapLength('');
            setPitchMapShot('');
            setPitchMapClickPos(null);
            setBallMovement('none');
            setBallOutcome('played');
            setFieldedById('');
            setFieldedByPosition('');

            if (res.data.shouldEndInnings) {
                setToast("Innings should be ended!");
            }

            if (selectedWicket) {
                setSetupState(s => ({
                    ...s,
                    wicketDismissal: '',
                    wicketFielder: '',
                    wicketNewBatter: '',
                    wicketDismissedPlayer: 'striker',
                    wicketDidCross: false,
                    wicketRuns: 0
                }));
            }
            // The server already placed the incoming batter at the dismissed
            // batter's end, so trust its strike/end assignment instead of
            // forcing the new batter onto strike.
            checkRoles(res.data.match);
        } catch (err) {
            settleClientId(pendingBallRef, clientBallId, false);
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleEndInnings = () => {
        setConfirmModal({ open: true, title: 'End Innings', message: 'End this innings?', confirmLabel: 'End Innings', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doEndInnings(); } });
    }

    const doEndInnings = async () => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/end-innings`, {
                inningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Innings Ended");
            setShowNextBowlerModal(false);
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    }

    const handleStartNext = async () => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/start-next-innings`, {
                previousInningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Next Innings Started");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    }

    const handleRevert = (inningsIndex = selectedMatch?.currentInnings) => {
        if (!selectedMatch) return;
        setConfirmModal({ open: true, title: 'Undo Last Ball', message: 'Are you sure you want to undo the last ball? All associated stats will be reversed.', confirmLabel: 'Undo', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doRevert(inningsIndex); } });
    };

    const doRevert = async (inningsIndex = selectedMatch?.currentInnings) => {
        if (reverting) return;
        setReverting(true);
        // Pressing Undo again after a failed undo is the same undo, so a retry
        // cannot take back a second ball.
        const clientActionId = clientIdForTap(pendingUndoRef, JSON.stringify([selectedMatch._id, inningsIndex]));
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/revert-ball`,
                { inningsIndex, clientActionId },
                { headers: { Authorization: `Bearer ${token}` } });
            settleClientId(pendingUndoRef, clientActionId, true);
            pendingBallRef.current = null;
            setSelectedMatch(res.data.match);
            setToast(res.data.duplicate ? "Undo already done" : "Reverted successfully");
            checkRoles(res.data.match);
        } catch (e) {
            settleClientId(pendingUndoRef, clientActionId, false);
            showToast(e.response?.data?.message || e.message, 'error');
        } finally {
            setReverting(false);
        }
    };

    const handleRetire = (playerId, type) => {
        setConfirmModal({ open: true, title: 'Retire Batsman', message: `Retire ${type.replace('_', ' ')} for this batsman?`, confirmLabel: 'Retire', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doRetire(playerId, type); } });
    };

    const doRetire = async (playerId, type) => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/retire-batsman`, {
                inningsIndex: selectedMatch.currentInnings,
                playerId,
                type
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Batsman retired successfully");
            checkRoles(res.data.match);
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleGroundClick = (data) => {
        setActiveGroundZone(data);
    };

    const handleEditBall = async (ballData) => {
        try {
            const res = await axios.put(
                `${API_BASE_URL}/matches/${selectedMatch._id}/edit-ball`,
                { inningsIndex: selectedMatch.currentInnings, ...ballData },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setSelectedMatch(res.data.match);
            setToast('Ball updated successfully!');
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleResetInnings = () => {
        setConfirmModal({ open: true, title: 'Reset Innings', message: 'CRITICAL: This will reset ALL score data for the current innings (0 runs, 0 balls, clear stats). This cannot be undone. Proceed?', confirmLabel: 'Reset Innings', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doResetInnings(); } });
    };

    const doResetInnings = async () => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/reset-innings`, {
                inningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Innings Reset Successfully");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleResetMatch = () => {
        setConfirmModal({ open: true, title: 'Reset Match', message: 'FATAL: This will reset the ENTIRE match (Both innings, toss, and status). All data will be lost. Proceed?', confirmLabel: 'Reset Match', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doResetMatch(); } });
    };

    const doResetMatch = async () => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/reset-match`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSelectedMatch(res.data.match);
            setIsPreMatchComplete(false);
            setWizardStep(1);
            setToast("Match Reset Successfully");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const setRole = async (playerId, role, options = {}) => {
        try {
            const updated = { ...selectedMatch };
            const curInn = updated.innings[updated.currentInnings];

            if (role === 'striker' || role === 'nonStriker') {
                const currentStrikerId = curInn.onStrikeBatsman?._id || curInn.onStrikeBatsman;
                const currentNonStrikerId = (String(curInn.currentBatsman1?._id || curInn.currentBatsman1) === String(currentStrikerId))
                    ? (curInn.currentBatsman2?._id || curInn.currentBatsman2)
                    : (curInn.currentBatsman1?._id || curInn.currentBatsman1);

                let b1, b2;
                if (role === 'striker') {
                    b1 = playerId;
                    b2 = currentNonStrikerId;
                } else {
                    b1 = currentStrikerId;
                    b2 = playerId;
                }

                await axios.put(`${API_BASE_URL}/matches/${selectedMatch._id}/openers`, {
                    inningsIndex: selectedMatch.currentInnings,
                    batsman1Id: b1,
                    batsman2Id: b2
                }, { headers: { Authorization: `Bearer ${token}` } });
            } else if (role === 'bowler') {
                const currentBowler = curInn.currentBowler?._id || curInn.currentBowler;
                const changingBowler = String(currentBowler || '') !== String(playerId);
                if (isOverInProgress(curInn) && changingBowler && !options.completeOverReplacement) {
                    setConfirmModal({
                        open: true,
                        title: 'Change bowler mid-over?',
                        message: 'The current over is not complete. Only replace the bowler if they are injured or have been removed. The new bowler will finish this over and the replaced bowler cannot bowl again in it.',
                        confirmLabel: 'Replace injured bowler',
                        variant: 'danger',
                        onConfirm: () => {
                            setConfirmModal({ open: false });
                            setRole(playerId, 'bowler', { completeOverReplacement: true });
                        },
                    });
                    return;
                }
                await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/set-bowler`, {
                    inningsIndex: selectedMatch.currentInnings,
                    bowlerId: playerId,
                    completeOverReplacement: !!options.completeOverReplacement,
                }, { headers: { Authorization: `Bearer ${token}` } });
            }

            if (role === 'striker') {
                curInn.onStrikeBatsman = playerId;
                curInn.currentBatsman1 = playerId;
            } else if (role === 'nonStriker') {
                curInn.currentBatsman2 = playerId;
            } else if (role === 'bowler') {
                curInn.currentBowler = playerId;
            }

            setSelectedMatch({ ...updated });
            setShowSelectionModal('');
            const res = await axios.get(`${API_BASE_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
        } catch (err) {
            showToast("Failed to set role: " + (err.response?.data?.message || err.message), 'error');
        }
    };

    const handleSaveFormat = async (formatData) => {
        if (!formatData.matchFormat) {
            showToast("Please select a match format.", 'warning');
            return;
        }
        try {
            await axios.put(`${API_BASE_URL}/matches/${selectedMatch._id}/format`, formatData, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const res = await axios.get(`${API_BASE_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
            setWizardStep(2);
            setToast(`Format set to ${formatData.matchFormat}`);
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleSavePlayingXI = async () => {
        if (setupState.team1XI.length !== 11 || setupState.team2XI.length !== 11) {
            showToast("Please select exactly 11 players for both teams.", 'warning');
            return;
        }

        const teams = [
            {
                id: selectedMatch.teams[0]._id,
                xi: setupState.team1XI,
                twelfth: setupState.team1TwelfthMan,
                superSub: setupState.team1SuperSub,
            },
            {
                id: selectedMatch.teams[1]._id,
                xi: setupState.team2XI,
                twelfth: setupState.team2TwelfthMan,
                superSub: setupState.team2SuperSub,
            },
        ];

        const allXI = new Set(teams.flatMap((team) => team.xi.map((id) => String(id?._id || id))));
        const roles = teams.flatMap((team) => [
            { team: team.id, role: '12th Man', playerId: team.twelfth },
            { team: team.id, role: 'Super Sub', playerId: team.superSub },
        ]).filter((entry) => entry.playerId);
        if (roles.some((entry) => allXI.has(String(entry.playerId)))) {
            showToast("The 12th Man and Super Sub must be outside the Playing XI.", 'warning');
            return;
        }
        if (teams.some((team) => team.twelfth && team.superSub && String(team.twelfth) === String(team.superSub))) {
            showToast("A player cannot be both 12th Man and Super Sub.", 'warning');
            return;
        }
        const roleIds = roles.map((entry) => String(entry.playerId));
        if (new Set(roleIds).size !== roleIds.length) {
            showToast("A player may hold only one 12th Man or Super Sub role.", 'warning');
            return;
        }

        const storedId = (field, teamId) => {
            const entry = (selectedMatch[field] || []).find(
                (row) => String(row.team?._id || row.team) === String(teamId)
            );
            return String(entry?.player?._id || entry?.player || '');
        };

        try {
            const headers = { Authorization: `Bearer ${token}` };
            const matchId = selectedMatch._id;
            // Clear stale nominations before the XI so a player moving into it
            // is never blocked by a role saved on an earlier visit.
            for (const team of teams) {
                const savedTwelfth = storedId('twelfthMan', team.id);
                const savedSuperSub = storedId('superSub', team.id);
                if (savedTwelfth && savedTwelfth !== String(team.twelfth || '')) {
                    await axios.put(`${API_BASE_URL}/matches/${matchId}/twelfth-man`, {
                        teamId: team.id, playerId: null,
                    }, { headers });
                }
                if (savedSuperSub && savedSuperSub !== String(team.superSub || '')) {
                    await axios.put(`${API_BASE_URL}/matches/${matchId}/super-sub`, {
                        teamId: team.id, playerId: null,
                    }, { headers });
                }
            }
            for (const team of teams) {
                await axios.put(`${API_BASE_URL}/matches/${matchId}/playing-xi`, {
                    teamId: team.id, players: team.xi,
                }, { headers });
            }
            for (const team of teams) {
                if (team.twelfth && storedId('twelfthMan', team.id) !== String(team.twelfth)) {
                    await axios.put(`${API_BASE_URL}/matches/${matchId}/twelfth-man`, {
                        teamId: team.id, playerId: team.twelfth,
                    }, { headers });
                }
                if (team.superSub && storedId('superSub', team.id) !== String(team.superSub)) {
                    await axios.put(`${API_BASE_URL}/matches/${matchId}/super-sub`, {
                        teamId: team.id, playerId: team.superSub,
                    }, { headers });
                }
            }
            const [res] = await Promise.all([
                axios.get(`${API_BASE_URL}/matches/${matchId}`),
                loadMatchSquads(matchId),
            ]);
            setSelectedMatch(res.data);
            checkRoles(res.data);
            setWizardStep(3);
            setToast("Playing XI and reserve roles saved!");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleContinueToToss = () => {
        const bothSaved = [0, 1].every((index) => {
            const teamId = selectedMatch?.teams?.[index]?._id;
            const entry = (selectedMatch?.playingXI || []).find(
                (row) => String(row.team?._id || row.team) === String(teamId)
            );
            return entry?.players?.length === 11;
        });
        if (!bothSaved) {
            showToast("Save exactly 11 players for both teams first.", 'warning');
            return;
        }
        setWizardStep(3);
    };

    const handleSaveToss = async () => {
        if (!setupState.tossWinner || !setupState.tossDecision) {
            showToast("Please select Toss Winner and Decision.", 'warning');
            return;
        }
        try {
            await axios.put(`${API_BASE_URL}/matches/${selectedMatch._id}/toss`, {
                tossWinnerId: setupState.tossWinner,
                decision: setupState.tossDecision
            }, { headers: { Authorization: `Bearer ${token}` } });
            const res = await axios.get(`${API_BASE_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
            setWizardStep(4);
            setToast("Toss Saved!");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleSaveOpeners = async () => {
        if (!setupState.strikerId || !setupState.nonStrikerId || !setupState.bowlerId) {
            showToast("Please select Striker, Non-Striker, and Bowler.", 'warning');
            return;
        }
        if (setupState.strikerId === setupState.nonStrikerId) {
            showToast("Striker and Non-Striker cannot be the same player.", 'warning');
            return;
        }
        try {
            const startedFromBreak = ["innings_break", "innings-break"].includes(selectedMatch.status);
            await axios.put(`${API_BASE_URL}/matches/${selectedMatch._id}/openers`, {
                inningsIndex: selectedMatch.currentInnings,
                batsman1Id: setupState.strikerId,
                batsman2Id: setupState.nonStrikerId
            }, { headers: { Authorization: `Bearer ${token}` } });

            await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/set-bowler`, {
                inningsIndex: selectedMatch.currentInnings,
                bowlerId: setupState.bowlerId
            }, { headers: { Authorization: `Bearer ${token}` } });

            // Keep the match status in step with the scoreboard: the break screen
            // hands over to this wizard before the chase is officially running.
            if (startedFromBreak) {
                await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/start-next-innings`, {
                    previousInningsIndex: selectedMatch.currentInnings
                }, { headers: { Authorization: `Bearer ${token}` } });
            }

            setIsPreMatchComplete(true);
            const res = await axios.get(`${API_BASE_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
            setToast("Match Ready to Start!");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleTimeout = () => {
        setConfirmModal({ open: true, title: 'Strategic Timeout', message: 'Trigger Strategic Timeout?', confirmLabel: 'Trigger', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doTimeout(); } });
    };

    const doTimeout = async () => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/timeout`, {
                teamId: battingTeamId
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Strategic Timeout Started");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleDRSReview = async () => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/drs`, {
                teamId: battingTeamId,
                result: drsData.result,
                type: drsData.type,
                over: Math.floor(curInn.balls / 6),
                ball: (curInn.balls % 6) || 6
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setIsDRSModalOpen(false);
            setToast("DRS Review Recorded");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleResolveTie = async (resolution) => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/resolve-tie`, {
                resolution
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            if (resolution === 'super_over') {
                setShowSelectionModal('super_over_setup');
            } else {
                setToast("Match Tied - Declared");
            }
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleStartSuperOver = async ({ batsmenIds, bowlerId }) => {
        try {
            const res = await axios.post(`${API_BASE_URL}/matches/${selectedMatch._id}/start-super-over`, {
                batsmenIds,
                bowlerId
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setShowSelectionModal('');
            setToast("Super Over Started!");
            checkRoles(res.data.match);
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleDeleteMatch = (matchId, e) => {
        e.stopPropagation();
        setConfirmModal({ open: true, title: 'Delete Match', message: 'Delete this match permanently?', confirmLabel: 'Delete', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doDeleteMatch(matchId); } });
    };

    const doDeleteMatch = async (matchId) => {
        try {
            await axios.delete(`${API_BASE_URL}/matches/${matchId}`, { headers: { Authorization: `Bearer ${token}` } });
            setMatches(prev => prev.filter(m => m._id !== matchId));
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const pitchMapBalls = useMemo(() => formattedHistory.map(b => ({
        ballId: `${b.overNumber}.${b.ballNumber}`,
        line: b.pitchLine || b.line || '',
        length: b.pitchLength || b.length || '',
        pitchX: b.pitchX,
        pitchY: b.pitchY,
        outcome: { runs: b.runs || 0, wicket: b.isWicket || false },
        runs: b.runs,
        isWicket: b.isWicket
    })), [formattedHistory]);

    return {
        matches,
        selectedMatch,
        setSelectedMatch,
        matchSquads,
        matchSquadsLoading,
        matchSquadsError,
        loading,
        socketConnected,
        showSettings,
        setShowSettings,
        activeTab,
        setActiveTab,
        selectedRuns,
        setSelectedRuns,
        selectedExtra,
        setSelectedExtra,
        selectedWicket,
        setSelectedWicket,
        manualCommentary,
        setManualCommentary,
        fieldPos,
        setFieldPos,
        isWicketDropdownOpen,
        setIsWicketDropdownOpen,
        loadingCommentary,
        setLoadingCommentary,
        toast,
        confirmModal,
        setConfirmModal,
        isDRSModalOpen,
        setIsDRSModalOpen,
        drsData,
        setDrsData,
        showSelectionModal,
        setShowSelectionModal,
        showNextBowlerModal,
        setShowNextBowlerModal,
        useAICommentary,
        setUseAICommentary,
        activeGroundZone,
        setActiveGroundZone,
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
        ballMovement,
        setBallMovement,
        ballOutcome,
        setBallOutcome,
        fieldedById,
        setFieldedById,
        fieldedByPosition,
        setFieldedByPosition,
        setupState,
        setSetupState,
        wizardStep,
        setWizardStep,
        isPreMatchComplete,
        setIsPreMatchComplete,
        curInn,
        firstInn,
        battingTeamId,
        target,
        isInnings2,
        winProb,
        battingTeamTeam,
        bowlingTeamTeam,
        battingXI,
        bowlingXI,
        battingPlayingXI,
        bowlingPlayingXI,
        strikerId,
        nonStrikerId,
        bowlerId,
        strikerStats,
        nonStrikerStats,
        activeBowlerStats,
        currentPartnership,
        formattedHistory,
        pitchMapBalls,
        fetchMatches,
        handleSelectMatch,
        submitBall,
        handleEndInnings,
        handleStartNext,
        handleRevert,
        handleRetire,
        handleGroundClick,
        handleEditBall,
        handleResetInnings,
        handleResetMatch,
        setRole,
        handleSaveFormat,
        handleSavePlayingXI,
        handleContinueToToss,
        handleSaveToss,
        handleSaveOpeners,
        handleTimeout,
        handleDRSReview,
        handleResolveTie,
        handleStartSuperOver,
        handleDeleteMatch,
        getPlayingXI,
        getSquad,
        getSquadMeta,
        loadMatchSquads,
        twelfthManRule,
        showToast,
        reloadMatch,
        reverting
    };
}
