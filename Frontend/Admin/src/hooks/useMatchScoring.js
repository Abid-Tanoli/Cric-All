import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { getTabIdFromRoute, getScoreTabPath, FIELD_POSITIONS, WICKET_TYPES, formatOvers } from '../components/ScoreManagement/constants';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export default function useMatchScoring() {
    const { token } = useSelector((state) => state.auth);
    const { matchId, tabId } = useParams();
    const navigate = useNavigate();
    const [matches, setMatches] = useState([]);
    const [selectedMatch, setSelectedMatch] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const activeTab = getTabIdFromRoute(tabId);
    const setActiveTab = useCallback((tab) => {
        const targetMatchId = selectedMatch?._id || matchId;
        if (targetMatchId) navigate(getScoreTabPath(targetMatchId, tab));
    }, [navigate, selectedMatch, matchId]);

    const [selectedRuns, setSelectedRuns] = useState(0);
    const [selectedExtra, setSelectedExtra] = useState(null);
    const [selectedWicket, setSelectedWicket] = useState('');
    const [manualCommentary, setManualCommentary] = useState('');
    const [fieldPos, setFieldPos] = useState('');
    const [isWicketDropdownOpen, setIsWicketDropdownOpen] = useState(false);
    const [loadingCommentary, setLoadingCommentary] = useState(false);
    const [toast, setToast] = useState('');
    const { showToast } = useToast();
    const reloadMatch = useCallback(async () => {
        try {
            const res = await axios.get(`${API_URL}/matches/${selectedMatch?._id || matchId}`);
            setSelectedMatch(res.data);
        } catch (err) {
            console.error("Failed to reload match:", err);
        }
    }, [selectedMatch, matchId]);
    const [confirmModal, setConfirmModal] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });
    const [isDRSModalOpen, setIsDRSModalOpen] = useState(false);
    const [drsData, setDrsData] = useState({ result: 'upheld', type: 'lbw' });

    const [showSelectionModal, setShowSelectionModal] = useState('');
    const [useAICommentary, setUseAICommentary] = useState(true);
    const [activeGroundZone, setActiveGroundZone] = useState(null);

    const [pitchMapLine, setPitchMapLine] = useState('');
    const [pitchMapLength, setPitchMapLength] = useState('');
    const [pitchMapShot, setPitchMapShot] = useState('');
    const [pitchMapClickPos, setPitchMapClickPos] = useState(null);
    const [pitchMapViewMode, setPitchMapViewMode] = useState('this_over');
    const [ballMovement, setBallMovement] = useState('none');
    const [ballOutcome, setBallOutcome] = useState('played');

    const [setupState, setSetupState] = useState({
        team1XI: [],
        team2XI: [],
        tossWinner: '',
        tossDecision: 'bat',
        strikerId: '',
        nonStrikerId: '',
        bowlerId: '',
        wicketDismissal: '',
        wicketFielder: '',
        wicketNewBatter: ''
    });

    const [wizardStep, setWizardStep] = useState(1);
    const [isPreMatchComplete, setIsPreMatchComplete] = useState(true);

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
            over.balls.forEach(ball => {
                balls.push({
                    ...ball,
                    overNumber: over.overNumber,
                    batsmanName: ball.batsmanOnStrike?.name || (battingXI.find(p => String(p._id) === String(ball.batsmanOnStrike?._id || ball.batsmanOnStrike))?.name) || "Batsman",
                    bowlerName: ball.bowler?.name || (bowlingXI.find(p => String(p._id) === String(ball.bowler?._id || ball.bowler))?.name) || "Bowler",
                    ballNumber: ball.ballNumber
                });
            });
        });
        return balls;
    }, [selectedMatch, curInn, battingXI, bowlingXI]);

    useEffect(() => {
        fetchMatches();
    }, []);

    useEffect(() => {
        if (matchId && (!selectedMatch || selectedMatch._id !== matchId)) {
            handleSelectMatch(matchId);
        }
    }, [matchId]);

    const fetchMatches = async () => {
        try {
            setLoading(true);
            const res = await axios.get(`${API_URL}/matches`, { headers: { Authorization: `Bearer ${token}` } });
            setMatches(res.data?.matches || res.data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectMatch = async (matchId) => {
        try {
            setLoading(true);
            const res = await axios.get(`${API_URL}/matches/${matchId}`);
            setSelectedMatch(res.data);

            const t1XI = res.data.playingXI?.find(p => (p.team?._id || p.team) === res.data.teams[0]?._id)?.players?.map(p => p._id || p) || [];
            const t2XI = res.data.playingXI?.find(p => (p.team?._id || p.team) === res.data.teams[1]?._id)?.players?.map(p => p._id || p) || [];
            const curInn = res.data.innings[res.data.currentInnings];
            const strikeId = curInn?.onStrikeBatsman?._id || curInn?.onStrikeBatsman || '';
            const bat1Id = curInn?.currentBatsman1?._id || curInn?.currentBatsman1 || '';
            const bat2Id = curInn?.currentBatsman2?._id || curInn?.currentBatsman2 || '';
            const nonStrikeId = (bat1Id === strikeId ? bat2Id : bat1Id);

            setSetupState(prev => ({
                ...prev,
                team1XI: t1XI,
                team2XI: t2XI,
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

        const team1XI = matchData.playingXI?.find(p => (p.team?._id || p.team) === matchData.teams[0]?._id);
        const team2XI = matchData.playingXI?.find(p => (p.team?._id || p.team) === matchData.teams[1]?._id);
        const hasPlayingXI = team1XI && team2XI && team1XI.players.length === 11 && team2XI.players.length === 11;

        const hasToss = !!(matchData.tossWinner && matchData.tossDecision);

        const hasOpeners = curInn.onStrikeBatsman && curInn.currentBatsman1 && curInn.currentBatsman2 && curInn.currentBowler;

        if (!hasPlayingXI || !hasToss || !hasOpeners) {
            setIsPreMatchComplete(false);
            if (!hasPlayingXI) setWizardStep(1);
            else if (!hasToss) setWizardStep(2);
            else setWizardStep(3);
        } else {
            setIsPreMatchComplete(true);
            setWizardStep(4);
            const ballsTossed = curInn.balls % 6;
            const overNum = curInn.overs;
            const overHist = curInn.oversHistory.find(o => o.overNumber === overNum);
            if (overHist?.balls?.length > 0 && ballsTossed === 0) {
                setShowSelectionModal('bowler');
            } else {
                setShowSelectionModal('');
            }
        }
    };

    const submitBall = async () => {
        if (!selectedMatch) return;
        const curInn = selectedMatch.innings[selectedMatch.currentInnings];
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

        let aiLine1 = manualCommentary || "Played securely.";

        const ballData = {
            inningsIndex: selectedMatch.currentInnings,
            runs: selectedRuns,
            isWide: selectedExtra === 'WIDE',
            isNoBall: selectedExtra === 'NO BALL',
            isBye: selectedExtra === 'BYE',
            isLegBye: selectedExtra === 'LEG BYE',
            isWicket: !!selectedWicket,
            wicketType: selectedWicket,
            fielderId: setupState.wicketFielder || undefined,
            batsmanOnStrikeId: batsmanOnStrike,
            batsmanNonStrikeId: batsmanNonStrike,
            bowlerId: curInn.currentBowler?._id || curInn.currentBowler,
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
            commentaryText: manualCommentary,
            customCommentary: !useAICommentary && !!manualCommentary,
            nextBatsmanId: setupState.wicketNewBatter || undefined
        };

        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/score`, ballData, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setToast(res.data.isOverComplete ? "Over Completed!" : "Ball Submitted");
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

            if (res.data.shouldEndInnings) {
                setToast("Innings should be ended!");
            }

            if (selectedWicket && setupState.wicketNewBatter) {
                try {
                    const newRole = selectedWicket === 'run out' ? 'nonStriker' : 'striker';
                    await setRole(setupState.wicketNewBatter, 'striker');
                } catch (e) { console.error(e); }
                setSetupState(s => ({ ...s, wicketDismissal: '', wicketFielder: '', wicketNewBatter: '' }));
            } else {
                checkRoles(res.data.match);
            }
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleEndInnings = () => {
        setConfirmModal({ open: true, title: 'End Innings', message: 'End this innings?', confirmLabel: 'End Innings', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doEndInnings(); } });
    }

    const doEndInnings = async () => {
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/end-innings`, {
                inningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Innings Ended");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    }

    const handleStartNext = async () => {
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/start-next-innings`, {
                previousInningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Next Innings Started");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    }

    const handleRevert = () => {
        if (!selectedMatch) return;
        setConfirmModal({ open: true, title: 'Undo Last Ball', message: 'Are you sure you want to undo the last ball? All associated stats will be reversed.', confirmLabel: 'Undo', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doRevert(); } });
    };

    const doRevert = async () => {
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/revert-ball`,
                { inningsIndex: selectedMatch.currentInnings },
                { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Reverted successfully");
        } catch (e) {
            showToast(e.response?.data?.message || e.message, 'error');
        }
    };

    const handleRetire = (playerId, type) => {
        setConfirmModal({ open: true, title: 'Retire Batsman', message: `Retire ${type.replace('_', ' ')} for this batsman?`, confirmLabel: 'Retire', variant: 'danger', onConfirm: async () => { setConfirmModal({ open: false }); doRetire(playerId, type); } });
    };

    const doRetire = async (playerId, type) => {
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/retire-batsman`, {
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
                `${API_URL}/matches/${selectedMatch._id}/edit-ball`,
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
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/reset-innings`, {
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
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/reset-match`, {}, {
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

    const setRole = async (playerId, role) => {
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

                await axios.put(`${API_URL}/matches/${selectedMatch._id}/openers`, {
                    inningsIndex: selectedMatch.currentInnings,
                    batsman1Id: b1,
                    batsman2Id: b2
                }, { headers: { Authorization: `Bearer ${token}` } });
            } else if (role === 'bowler') {
                await axios.post(`${API_URL}/matches/${selectedMatch._id}/set-bowler`, {
                    inningsIndex: selectedMatch.currentInnings,
                    bowlerId: playerId
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
            const res = await axios.get(`${API_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
        } catch (err) {
            showToast("Failed to set role: " + (err.response?.data?.message || err.message), 'error');
        }
    };

    const handleSavePlayingXI = async () => {
        if (setupState.team1XI.length !== 11 || setupState.team2XI.length !== 11) {
            showToast("Please select exactly 11 players for both teams.", 'warning');
            return;
        }
        try {
            await axios.put(`${API_URL}/matches/${selectedMatch._id}/playing-xi`, { teamId: selectedMatch.teams[0]._id, players: setupState.team1XI }, { headers: { Authorization: `Bearer ${token}` } });
            await axios.put(`${API_URL}/matches/${selectedMatch._id}/playing-xi`, { teamId: selectedMatch.teams[1]._id, players: setupState.team2XI }, { headers: { Authorization: `Bearer ${token}` } });
            const res = await axios.get(`${API_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
            setWizardStep(2);
            setToast("Playing XI Saved!");
        } catch (err) {
            showToast(err.response?.data?.message || err.message, 'error');
        }
    };

    const handleSaveToss = async () => {
        if (!setupState.tossWinner || !setupState.tossDecision) {
            showToast("Please select Toss Winner and Decision.", 'warning');
            return;
        }
        try {
            await axios.put(`${API_URL}/matches/${selectedMatch._id}/toss`, {
                tossWinnerId: setupState.tossWinner,
                decision: setupState.tossDecision
            }, { headers: { Authorization: `Bearer ${token}` } });
            const res = await axios.get(`${API_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
            setWizardStep(3);
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
            await axios.put(`${API_URL}/matches/${selectedMatch._id}/openers`, {
                inningsIndex: selectedMatch.currentInnings,
                batsman1Id: setupState.strikerId,
                batsman2Id: setupState.nonStrikerId
            }, { headers: { Authorization: `Bearer ${token}` } });

            await axios.post(`${API_URL}/matches/${selectedMatch._id}/set-bowler`, {
                inningsIndex: selectedMatch.currentInnings,
                bowlerId: setupState.bowlerId
            }, { headers: { Authorization: `Bearer ${token}` } });

            setIsPreMatchComplete(true);
            const res = await axios.get(`${API_URL}/matches/${selectedMatch._id}`);
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
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/timeout`, {
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
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/drs`, {
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
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/resolve-tie`, {
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
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/start-super-over`, {
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
            await axios.delete(`${API_URL}/matches/${matchId}`, { headers: { Authorization: `Bearer ${token}` } });
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
        loading,
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
        handleSavePlayingXI,
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
        showToast,
        reloadMatch
    };
}
