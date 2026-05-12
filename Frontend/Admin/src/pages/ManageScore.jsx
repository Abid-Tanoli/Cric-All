import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { useParams, useNavigate, NavLink } from 'react-router-dom';
import BallByBallFeed from '../components/BallByBallFeed';
import CricketGround from '../components/CricketGround';
import MatchSetupWizard from '../components/ScoreManagement/MatchSetupWizard';
import RightSidebarControls from '../components/ScoreManagement/RightSidebarControls';
import LiveScoringPanel from '../components/ScoreManagement/LiveScoringPanel';
import Scorecard from '../components/Scorecard';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';

const TAB_ROUTE_BY_ID = {
    live: '',
    scorecard: 'scorecard',
    commentary: 'commentary',
    stats: 'live-stats',
    overs: 'overs',
    xi: 'playing-xi',
    table: 'table',
    photos: 'photos',
    videos: 'videos',
    blogs: 'blogs'
};

const TAB_ID_BY_ROUTE = Object.entries(TAB_ROUTE_BY_ID).reduce((acc, [id, route]) => {
    if (route) acc[route] = id;
    return acc;
}, {});

const getScoreTabPath = (matchId, tabId) => {
    const route = TAB_ROUTE_BY_ID[tabId] || '';
    return `/admin/score/${matchId}${route ? `/${route}` : ''}`;
};

const getTabIdFromRoute = (tabId) => {
    if (!tabId) return 'live';
    if (TAB_ROUTE_BY_ID[tabId] !== undefined) return tabId;
    return TAB_ID_BY_ROUTE[tabId] || 'live';
};

const FIELD_POSITIONS = [
    // Close Infield (radius 50-80px from center)
    { id: 'wicket_keeper', name: 'Wicket Keeper', x: 200, y: 235 },
    { id: 'slip_1', name: '1st Slip', x: 170, y: 240 },
    { id: 'slip_2', name: '2nd Slip', x: 155, y: 245 },
    { id: 'gully', name: 'Gully', x: 140, y: 230 },
    { id: 'leg_slip', name: 'Leg Slip', x: 228, y: 240 },
    { id: 'leg_gully', name: 'Leg Gully', x: 242, y: 228 },
    { id: 'silly_point', name: 'Silly Point', x: 148, y: 205 },
    { id: 'silly_mid_on', name: 'Silly Mid On', x: 222, y: 195 },
    { id: 'silly_mid_off', name: 'Silly Mid Off', x: 178, y: 195 },
    { id: 'short_leg', name: 'Short Leg', x: 235, y: 210 },
    { id: 'bat_pad', name: 'Bat Pad (Leg)', x: 215, y: 200 },
    // Inner Ring / 30-Yard Circle (radius 80-120px)
    { id: 'point', name: 'Point', x: 110, y: 200 },
    { id: 'backward_point', name: 'Backward Point', x: 115, y: 225 },
    { id: 'cover_point', name: 'Cover Point', x: 120, y: 185 },
    { id: 'cover', name: 'Cover', x: 128, y: 165 },
    { id: 'extra_cover', name: 'Extra Cover', x: 145, y: 148 },
    { id: 'mid_off', name: 'Mid Off', x: 170, y: 138 },
    { id: 'mid_on', name: 'Mid On', x: 230, y: 138 },
    { id: 'mid_wicket', name: 'Mid Wicket', x: 268, y: 155 },
    { id: 'square_leg', name: 'Square Leg', x: 288, y: 200 },
    { id: 'backward_square_leg', name: 'Backward Square Leg', x: 282, y: 222 },
    { id: 'short_fine_leg', name: 'Short Fine Leg', x: 252, y: 252 },
    { id: 'forward_short_leg', name: 'Forward Short Leg', x: 245, y: 185 },
    // Outfield (radius 130-185px from center)
    { id: 'third_man', name: 'Third Man', x: 122, y: 338 },
    { id: 'fine_leg', name: 'Fine Leg', x: 272, y: 345 },
    { id: 'deep_fine_leg', name: 'Deep Fine Leg', x: 258, y: 368 },
    { id: 'deep_backward_sq', name: 'Deep Backward Sq Leg', x: 348, y: 272 },
    { id: 'deep_square_leg', name: 'Deep Square Leg', x: 365, y: 205 },
    { id: 'deep_mid_wicket', name: 'Deep Mid Wicket', x: 355, y: 138 },
    { id: 'cow_corner', name: 'Cow Corner', x: 328, y: 92 },
    { id: 'long_on', name: 'Long On', x: 260, y: 52 },
    { id: 'straight_hit', name: 'Straight Hit', x: 200, y: 35 },
    { id: 'long_off', name: 'Long Off', x: 138, y: 52 },
    { id: 'deep_extra_cover', name: 'Deep Extra Cover', x: 70, y: 92 },
    { id: 'sweeper_cover', name: 'Sweeper Cover', x: 48, y: 138 },
    { id: 'deep_cover', name: 'Deep Cover', x: 42, y: 175 },
    { id: 'deep_point', name: 'Deep Point', x: 38, y: 205 },
    { id: 'deep_backward_point', name: 'Deep Backward Point', x: 48, y: 245 },
    { id: 'long_stop', name: 'Long Stop', x: 200, y: 375 },
    // Wide Zones
    { id: 'wide_off', name: 'Wide (Off Side)', x: 15, y: 200 },
    { id: 'wide_leg', name: 'Wide (Leg Side)', x: 385, y: 200 },
];
const WICKET_TYPES = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket'];

export default function ManageScore() {
    const { token } = useSelector((state) => state.auth);
    const { matchId, tabId } = useParams();
    const navigate = useNavigate();
    const activeTab = getTabIdFromRoute(tabId);
    const setActiveTab = (tab) => {
        const targetMatchId = selectedMatch?._id || matchId;
        if (targetMatchId) navigate(getScoreTabPath(targetMatchId, tab));
    };

    const [matches, setMatches] = useState([]);
    const [selectedMatch, setSelectedMatch] = useState(null);
    const [loading, setLoading] = useState(false);

    const [selectedRuns, setSelectedRuns] = useState(0);
    const [selectedExtra, setSelectedExtra] = useState(null);
    const [selectedWicket, setSelectedWicket] = useState('');
    const [manualCommentary, setManualCommentary] = useState('');
    const [fieldPos, setFieldPos] = useState('');
    const [isWicketDropdownOpen, setIsWicketDropdownOpen] = useState(false);
    const [loadingCommentary, setLoadingCommentary] = useState(false);
    const [toast, setToast] = useState('');
    const [isDRSModalOpen, setIsDRSModalOpen] = useState(false);
    const [drsData, setDrsData] = useState({ result: 'upheld', type: 'lbw' });

    const [showSelectionModal, setShowSelectionModal] = useState('');
    const [useAICommentary, setUseAICommentary] = useState(true);
    const [activeGroundZone, setActiveGroundZone] = useState(null); // { x, y, zone, direction, shotName, autoRuns }

    // PitchMap state
    const [pitchMapLine, setPitchMapLine] = useState('');
    const [pitchMapLength, setPitchMapLength] = useState('');
    const [pitchMapShot, setPitchMapShot] = useState('');
    const [pitchMapClickPos, setPitchMapClickPos] = useState(null);
    const [pitchMapViewMode, setPitchMapViewMode] = useState('this_over');

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

    const formatOvers = (balls) => {
        if (!balls) return "0.0";
        const overs = Math.floor(balls / 6);
        const rem = balls % 6;
        return `${overs}.${rem}`;
    };

    const tabs = [
        { id: 'live', label: 'LIVE', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
        { id: 'scorecard', label: 'SCORECARD', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
        { id: 'commentary', label: 'COMMENTARY', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
        { id: 'stats', label: 'LIVE STATS', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
        { id: 'overs', label: 'OVERS', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
        { id: 'xi', label: 'PLAYING XI', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
        { id: 'table', label: 'TABLE', icon: 'M9 19V5h6v14H9z' },
        { id: 'photos', label: 'PHOTOS', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
        { id: 'videos', label: 'VIDEOS', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
        { id: 'blogs', label: 'BLOGS', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' }
    ];

    const curInn = selectedMatch?.innings[selectedMatch?.currentInnings] || null;
    const battingTeamId = curInn?.team?._id || curInn?.team;

    // Win Probability Logic
    const calculateWinProb = () => {
        if (!selectedMatch || !curInn) return { team1: 50, team2: 50 };
        if (selectedMatch.status === 'completed') return { team1: selectedMatch.result.winner === selectedMatch.teams[0]._id ? 100 : 0, team2: selectedMatch.result.winner === selectedMatch.teams[1]._id ? 100 : 0 };

        // Simple heuristic for demo: (Required RR vs Current RR)
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

        // Ensure we return player objects with names
        return pxi.players.map(p => {
            if (typeof p === 'object' && p !== null && p.name) return p;
            // Lookup in teams.players if p is an ID or incomplete object
            const pid = p._id || p;
            for (const team of (selectedMatch.teams || [])) {
                const found = team.players?.find(pl => String(pl._id || pl) === String(pid));
                if (found && typeof found === 'object') return found;
            }
            return typeof p === 'object' ? p : { _id: p, name: `Player ${p}` };
        });
    }

    // Get squad (squad15) for a team, falling back to playingXI
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
            // Ensure objects
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

        // Final fallback: use all players assigned to the team
        const team = selectedMatch.teams?.find(t => String(t._id) === String(teamId));
        return team?.players || [];
    }
    const getSquadMeta = (teamId) => {
        if (!teamId || !selectedMatch) return null;
        return selectedMatch.squad15?.find(s => String(s.team?._id || s.team) === String(teamId)) || null;
    }
    // Use squad for batting/bowling player lists (larger pool than just XI)
    const battingXI = useMemo(() => getSquad(battingTeamId), [selectedMatch, battingTeamId]);
    const bowlingXI = useMemo(() => getSquad(bowlingTeamTeam?._id), [selectedMatch, bowlingTeamTeam]);
    const battingPlayingXI = useMemo(() => getPlayingXI(battingTeamId), [selectedMatch, battingTeamId]);
    const bowlingPlayingXI = useMemo(() => getPlayingXI(bowlingTeamTeam?._id), [selectedMatch, bowlingTeamTeam]);

    // Derived current match state
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
        // If it's an active partnership (no wicket associated yet)
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

        // 1. Check Playing XI
        const team1XI = matchData.playingXI?.find(p => (p.team?._id || p.team) === matchData.teams[0]?._id);
        const team2XI = matchData.playingXI?.find(p => (p.team?._id || p.team) === matchData.teams[1]?._id);
        const hasPlayingXI = team1XI && team2XI && team1XI.players.length === 11 && team2XI.players.length === 11;

        // 2. Check Toss
        const hasToss = !!(matchData.tossWinner && matchData.tossDecision);

        // 3. Check openers
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
            alert("Ensure players are selected");
            return;
        }

        // Validation: Ensure the striker isn't someone who is already out
        const strikerStats = curInn.batting.find(b => String(b.player?._id || b.player) === String(curInn.onStrikeBatsman?._id || curInn.onStrikeBatsman));
        if (strikerStats?.isOut || strikerStats?.isRetired || strikerStats?.isRetiredHurt) {
            alert(`Striker ${strikerStats?.player?.name || ''} is already out/retired. Please select a new batsman first.`);
            setShowSelectionModal('striker');
            return;
        }

        // Validation: If a wicket is selected, ensure a next batsman is chosen (unless it's the last wicket)
        if (selectedWicket && !setupState.wicketNewBatter && curInn.wickets < 9 && selectedWicket !== 'retired hurt') {
            alert("Please select the next batsman in the Wicket Details modal.");
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

            if (res.data.shouldEndInnings) {
                setToast("Innings should be ended!");
            }

            // If there's a new batter selected from the wicket modal, assign them
            if (selectedWicket && setupState.wicketNewBatter) {
                try {
                    const newRole = selectedWicket === 'run out' ? 'nonStriker' : 'striker'; // Simplification, ideally user chooses who is out
                    // Wait for state to settle, then set role
                    await setRole(setupState.wicketNewBatter, 'striker');
                } catch (e) { console.error(e); }
                setSetupState(s => ({ ...s, wicketDismissal: '', wicketFielder: '', wicketNewBatter: '' }));
            } else {
                checkRoles(res.data.match);
            }
        } catch (err) {
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleEndInnings = async () => {
        if (!window.confirm("End this innings?")) return;
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/end-innings`, {
                inningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Innings Ended");
        } catch (err) {
            alert(err.response?.data?.message || err.message);
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
            alert(err.response?.data?.message || err.message);
        }
    }

    const handleRevert = async () => {
        if (!window.confirm("Are you sure you want to undo the last ball? All associated stats will be reversed.")) return;
        if (!selectedMatch) return;
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/revert-ball`,
                { inningsIndex: selectedMatch.currentInnings },
                { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Reverted successfully");
        } catch (e) {
            alert(e.response?.data?.message || e.message);
        }
    };

    const handleRetire = async (playerId, type) => {
        if (!window.confirm(`Retire ${type.replace('_', ' ')} for this batsman?`)) return;
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
            alert(err.response?.data?.message || err.message);
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
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleResetInnings = async () => {
        if (!window.confirm("CRITICAL: This will reset ALL score data for the current innings (0 runs, 0 balls, clear stats). This cannot be undone. Proceed?")) return;
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/reset-innings`, {
                inningsIndex: selectedMatch.currentInnings
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Innings Reset Successfully");
        } catch (err) {
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleResetMatch = async () => {
        if (!window.confirm("FATAL: This will reset the ENTIRE match (Both innings, toss, and status). All data will be lost. Proceed?")) return;
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/reset-match`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSelectedMatch(res.data.match);
            setIsPreMatchComplete(false); // Go back to setup wizard
            setWizardStep(1);
            setToast("Match Reset Successfully");
        } catch (err) {
            alert(err.response?.data?.message || err.message);
        }
    };


    const setRole = async (playerId, role) => {
        try {
            const updated = { ...selectedMatch };
            const curInn = updated.innings[updated.currentInnings];

            // To persist, we should hit the API
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

            // Local update for immediate UI feedback
            if (role === 'striker') {
                curInn.onStrikeBatsman = playerId;
                curInn.currentBatsman1 = playerId;
                // currentBatsman2 stays what it was (the non-striker)
            } else if (role === 'nonStriker') {
                curInn.currentBatsman2 = playerId;
                // onStrike stays currentBatsman1
            } else if (role === 'bowler') {
                curInn.currentBowler = playerId;
            }

            setSelectedMatch({ ...updated });
            setShowSelectionModal('');
            // Re-fetch to ensure sync with backend
            const res = await axios.get(`${API_URL}/matches/${selectedMatch._id}`);
            setSelectedMatch(res.data);
            checkRoles(res.data);
        } catch (err) {
            alert("Failed to set role: " + (err.response?.data?.message || err.message));
        }
    };

    const handleSavePlayingXI = async () => {
        if (setupState.team1XI.length !== 11 || setupState.team2XI.length !== 11) {
            alert("Please select exactly 11 players for both teams.");
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
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleSaveToss = async () => {
        if (!setupState.tossWinner || !setupState.tossDecision) {
            alert("Please select Toss Winner and Decision.");
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
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleSaveOpeners = async () => {
        if (!setupState.strikerId || !setupState.nonStrikerId || !setupState.bowlerId) {
            alert("Please select Striker, Non-Striker, and Bowler.");
            return;
        }
        if (setupState.strikerId === setupState.nonStrikerId) {
            alert("Striker and Non-Striker cannot be the same player.");
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
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleTimeout = async () => {
        if (!window.confirm("Trigger Strategic Timeout?")) return;
        try {
            const res = await axios.post(`${API_URL}/matches/${selectedMatch._id}/timeout`, {
                teamId: battingTeamId
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedMatch(res.data.match);
            setToast("Strategic Timeout Started");
        } catch (err) {
            alert(err.response?.data?.message || err.message);
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
            alert(err.response?.data?.message || err.message);
        }
    };

    const handleDeleteMatch = async (matchId, e) => {
        e.stopPropagation();
        if (!window.confirm("Delete this match permanently?")) return;
        try {
            await axios.delete(`${API_URL}/matches/${matchId}`, { headers: { Authorization: `Bearer ${token}` } });
            setMatches(prev => prev.filter(m => m._id !== matchId));
        } catch (err) {
            alert(err.response?.data?.message || err.message);
        }
    };

    if (loading && !selectedMatch) return <div className="p-10 text-center text-xl font-bold bg-[#f1f5f9] min-h-screen">Loading matches...</div>;

    if (!selectedMatch) {
        return (
            <div className="p-8 max-w-[1200px] mx-auto min-h-screen bg-cric-bg transition-colors duration-300">
                <h1 className="text-3xl font-black text-cric-text mb-8 uppercase tracking-tight">Select Match to Score</h1>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {matches.map(m => (
                        <div key={m._id} onClick={() => navigate(`/admin/score/${m._id}`)} className="bg-cric-card p-8 rounded-3xl shadow-sm border border-cric-border hover:border-cric-accent cursor-pointer transition-all relative group overflow-hidden">
                            <div className="absolute top-0 left-0 w-2 h-full bg-cric-blue"></div>
                            <button
                                onClick={(e) => handleDeleteMatch(m._id, e)}
                                className="absolute top-4 right-4 w-10 h-10 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                                title="Delete match"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                            <div className="text-[10px] font-black text-cric-muted uppercase tracking-widest mb-2">{m.format} • {m.venue}</div>
                            <h2 className="text-xl font-black text-cric-text leading-tight mb-4 uppercase">{m.teams[0]?.name} <br /><span className="text-cric-blue">VS</span><br /> {m.teams[1]?.name}</h2>
                            <div className="flex items-center justify-between mt-4">
                                <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${m.status === 'live' ? 'bg-red-500/20 text-red-500' : 'bg-cric-muted/20 text-cric-muted'}`}>{m.status}</span>
                                <div className="text-cric-blue group-hover:translate-x-1 transition-transform">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!isPreMatchComplete) {
        return (
            <MatchSetupWizard
                wizardStep={wizardStep}
                selectedMatch={selectedMatch}
                setSelectedMatch={setSelectedMatch}
                setupState={setupState}
                setSetupState={setSetupState}
                handleSavePlayingXI={handleSavePlayingXI}
                handleSaveToss={handleSaveToss}
                handleSaveOpeners={handleSaveOpeners}
                battingXI={battingXI}
                bowlingXI={bowlingXI}
            />
        );
    }

    return (
        <div className="flex flex-col lg:flex-row min-h-screen bg-cric-bg text-cric-text p-4 lg:p-8 gap-8 transition-colors duration-300">
            {/* MAIN CONTENT (Left) */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header / Match Info */}
                <div className="bg-cric-card rounded-[2.5rem] p-8 border border-cric-border shadow-xl mb-6">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                            <span className="text-[10px] font-black tracking-[0.3em] uppercase text-slate-400">Live Match Tracking</span>
                        </div>
                        <div className="text-[10px] font-black tracking-[0.3em] uppercase text-[#ff6b35]">Match ID: {selectedMatch._id.slice(-6)}</div>
                    </div>

                    <div className="flex justify-between items-end">
                        <div className="space-y-2">
                            <h1 className="text-5xl font-black font-raj italic tracking-tighter uppercase leading-none">
                                {battingTeamTeam?.name} <span className="text-[#ff6b35]">VS</span> {bowlingTeamTeam?.name}
                            </h1>
                            <div className="text-slate-400 font-medium">{selectedMatch.venue} • {selectedMatch.format}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-6xl font-black font-raj italic text-black leading-none">
                                {curInn?.runs}/{curInn?.wickets}
                            </div>
                            <div className="text-xl font-bold text-slate-500 mt-2">OVERS {formatOvers(curInn?.balls)}</div>
                        </div>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex bg-cric-card rounded-full p-1 border border-cric-border mb-6 overflow-x-auto no-scrollbar">
                    {tabs.map(tab => (
                        <NavLink
                            key={tab.id}
                            to={getScoreTabPath(selectedMatch._id, tab.id)}
                            end={tab.id === 'live'}
                            className={() => `flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-full transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-cric-accent text-white shadow-lg shadow-cric-accent/20' : 'text-cric-muted hover:text-cric-text hover:bg-black/5 dark:hover:bg-white/5'}`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon} />
                            </svg>
                            <span className="text-[10px] font-black tracking-widest uppercase">{tab.label}</span>
                        </NavLink>
                    ))}
                </div>

                {/* Tab Content Area */}
                <div className="flex-1 bg-cric-card rounded-[3.5rem] border border-cric-border shadow-2xl p-8 overflow-y-auto no-scrollbar min-h-[600px]">
                    {activeTab === 'live' && (
                        <div className="space-y-12 animate-fadeIn">
                            <LiveScoringPanel
                                battingXI={battingXI}
                                bowlingXI={bowlingXI}
                                strikerId={strikerId}
                                nonStrikerId={nonStrikerId}
                                bowlerId={bowlerId}
                                strikerStats={strikerStats}
                                nonStrikerStats={nonStrikerStats}
                                activeBowlerStats={activeBowlerStats}
                                winProb={winProb}
                                selectedMatch={selectedMatch}
                                formattedHistory={formattedHistory}
                                formatOvers={formatOvers}
                                onRetire={handleRetire}
                            />

                            {/* Live Commentary Feed Integrated into Live Page */}
                            <div className="pt-8 border-t border-cric-border">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Recent Live Commentary</h3>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                        <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Live Feed</span>
                                    </div>
                                </div>
                                <BallByBallFeed
                                    history={formattedHistory}
                                    overs={curInn?.oversHistory || []}
                                    onEdit={handleEditBall}
                                    onSwitchTab={setActiveTab}
                                    compact={true}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'scorecard' && (
                        <Scorecard
                            curInn={curInn}
                            battingTeamName={battingTeamTeam?.name || 'Batting Team'}
                            bowlingTeamName={bowlingTeamTeam?.name || 'Bowling Team'}
                            battingXI={battingPlayingXI}
                            bowlingXI={bowlingPlayingXI}
                            allPlayers={[...battingXI, ...bowlingXI]}
                            formatOvers={formatOvers}
                            selectedMatch={selectedMatch}
                            tossInfo={selectedMatch?.tossWinner && selectedMatch?.tossDecision
                                ? `${selectedMatch.teams.find(t => String(t._id) === String(selectedMatch.tossWinner?._id || selectedMatch.tossWinner))?.name || 'Team'} chose to ${selectedMatch.tossDecision}.`
                                : null}
                        />
                    )}

                    {activeTab === 'commentary' && (
                        <div className="space-y-6 animate-fadeIn">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Ball by Ball Commentary</h3>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                    <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Live</span>
                                </div>
                            </div>
                            <BallByBallFeed
                                history={formattedHistory}
                                overs={curInn?.oversHistory || []}
                                onEdit={handleEditBall}
                                onSwitchTab={setActiveTab}
                                compact={false}
                            />
                        </div>
                    )}

                    {activeTab === 'stats' && (
                        <div className="space-y-12 animate-fadeIn">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-black/20 rounded-[2.5rem] p-8 border border-white/5">
                                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6 text-center">Run Rate Comparison</h4>
                                    <div className="h-64 flex items-end justify-between gap-2 px-4">
                                        {[20, 35, 45, 30, 55, 70, 65, 80, 95, 100].map((h, i) => (
                                            <div key={i} className="flex-1 bg-[#ff6b35]/20 rounded-t-lg relative group transition-all hover:bg-[#ff6b35]/40" style={{ height: `${h}%` }}>
                                                <div className="absolute inset-x-0 bottom-0 bg-[#ff6b35] rounded-t-lg transition-all h-2 group-hover:h-full opacity-50"></div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-between mt-4 text-[9px] font-bold text-slate-600 px-2 uppercase">
                                        <span>Start</span>
                                        <span>Mid</span>
                                        <span>Death</span>
                                    </div>
                                </div>

                                <div className="bg-black/20 rounded-[2.5rem] p-8 border border-white/5">
                                    <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6 text-center">Partnership Growth</h4>
                                    <div className="h-64 flex items-end justify-between gap-1">
                                        {Array.from({ length: 15 }).map((_, i) => (
                                            <div key={i} className="flex-1 bg-blue-500/20 rounded-t-lg" style={{ height: `${Math.random() * 80 + 20}%` }}></div>
                                        ))}
                                    </div>
                                    <div className="text-center mt-4 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Last 15 Overs</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                {[
                                    { label: 'Dots %', val: '34.2%', color: 'text-slate-400' },
                                    { label: 'Boundaries', val: '12', color: 'text-[#ff6b35]' },
                                    { label: 'Singles', val: '45', color: 'text-blue-400' },
                                    { label: 'Projected', val: '342', color: 'text-green-500' }
                                ].map((s, i) => (
                                    <div key={i} className="bg-black/20 rounded-3xl p-6 border border-white/5 text-center">
                                        <div className={`text-2xl font-black ${s.color}`}>{s.val}</div>
                                        <div className="text-[9px] font-black text-slate-600 uppercase tracking-widest mt-2">{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'overs' && (
                        <div className="space-y-6 animate-fadeIn">
                            <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Over-by-Over Summary</h3>
                            {(curInn?.oversHistory || []).slice().reverse().map((over, idx) => {
                                const overRuns = over.balls.reduce((s, b) => s + (b.runs || 0) + (b.isWide ? 1 : 0) + (b.isNoBall ? 1 : 0), 0);
                                const overWkts = over.balls.filter(b => b.isWicket).length;
                                return (
                                    <div key={idx} className="bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl p-5 border border-cric-border/50">
                                        <div className="flex justify-between items-center mb-3">
                                            <div className="flex items-center gap-3">
                                                <span className="text-cric-accent font-black text-base">Over {over.overNumber + 1}</span>
                                                <span className="text-[10px] font-bold text-slate-500">
                                                    {over.bowler?.name || bowlingXI.find(p => String(p._id) === String(over.bowler?._id || over.bowler))?.name || 'Bowler'}
                                                </span>
                                            </div>
                                            <div className="text-sm font-black text-cric-text">
                                                {overRuns} run{overRuns !== 1 ? 's' : ''}
                                                {overWkts > 0 && <span className="text-red-500 ml-2">{overWkts} wkt{overWkts !== 1 ? 's' : ''}</span>}
                                                {over.maidenOver && <span className="text-green-500 ml-2">M</span>}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 flex-wrap">
                                            {over.balls.map((b, bi) => {
                                                const isW = b.isWicket;
                                                const is4 = b.runs === 4 && !b.isWide && !b.isNoBall && !b.isWicket;
                                                const is6 = b.runs === 6 && !b.isWide && !b.isNoBall && !b.isWicket;
                                                const notation = isW ? 'W' : b.isWide ? `${b.runs}wd` : b.isNoBall ? `${b.runs}nb` : b.isBye ? `${b.runs}b` : b.isLegBye ? `${b.runs}lb` : b.runs === 0 ? '•' : String(b.runs);
                                                return (
                                                    <div key={bi} className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-black shrink-0 shadow-sm ${
                                                        isW ? 'bg-red-600 text-white' :
                                                        is6 ? 'bg-purple-600 text-white' :
                                                        is4 ? 'bg-blue-600 text-white' :
                                                        (b.isWide || b.isNoBall) ? 'bg-amber-500 text-white' :
                                                        'bg-black/10 dark:bg-white/10 text-cric-text'
                                                    }`}>{notation}</div>
                                                );
                                            })}
                                        </div>
                                        {over.summary && (
                                            <p className="text-[11px] text-slate-400 italic mt-3 border-t border-cric-border/30 pt-2">{over.summary}</p>
                                        )}
                                    </div>
                                );
                            })}
                            {(!curInn?.oversHistory || curInn.oversHistory.length === 0) && (
                                <div className="text-center py-12 text-slate-500 italic text-sm">No overs bowled yet.</div>
                            )}
                        </div>
                    )}

                    {activeTab === 'table' && (
                        <div className="space-y-8 animate-fadeIn">
                            <h3 className="text-xl font-black font-raj italic uppercase text-cric-accent tracking-tight">Match Summary Table</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-cric-border">
                                            <th className="py-3 pl-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Team</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Score</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Overs</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">RR</th>
                                            <th className="py-3 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest pr-4">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedMatch?.innings || []).map((inn, idx) => {
                                            const teamName = selectedMatch.teams.find(t => String(t._id) === String(inn.team?._id || inn.team))?.name || 'Team';
                                            const ov = formatOvers(inn.balls);
                                            const rr = inn.runRate?.toFixed(2) || (inn.balls > 0 ? (inn.runs / (inn.balls / 6)).toFixed(2) : '0.00');
                                            return (
                                                <tr key={idx} className={`border-b border-cric-border/50 ${idx === selectedMatch.currentInnings ? 'bg-cric-accent/5' : ''}`}>
                                                    <td className="py-4 pl-4 font-bold text-sm text-cric-text">
                                                        {teamName}
                                                        {idx === selectedMatch.currentInnings && <span className="ml-2 text-[9px] bg-cric-accent/20 text-cric-accent px-2 py-0.5 rounded-full font-black uppercase">Batting</span>}
                                                    </td>
                                                    <td className="py-4 text-right font-black text-sm text-cric-text">{inn.runs}/{inn.wickets}</td>
                                                    <td className="py-4 text-right text-sm text-slate-500">{ov}</td>
                                                    <td className="py-4 text-right text-sm text-slate-500">{rr}</td>
                                                    <td className="py-4 text-right text-sm pr-4">
                                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
                                                            inn.status === 'live' ? 'bg-red-500/20 text-red-500' :
                                                            inn.status === 'completed' ? 'bg-green-500/20 text-green-500' :
                                                            'bg-slate-500/20 text-slate-500'
                                                        }`}>{inn.status || 'upcoming'}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {selectedMatch?.result?.description && (
                                <div className="bg-cric-accent/5 rounded-2xl p-5 border border-cric-accent/20 text-center">
                                    <span className="text-sm font-black text-cric-text">{selectedMatch.result.description}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'xi' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 animate-fadeIn">
                            {[battingTeamTeam, bowlingTeamTeam].map((team, idx) => (
                                <div key={idx} className="space-y-6">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className={`w-2 h-8 ${idx === 0 ? 'bg-[#ff6b35]' : 'bg-blue-500'} rounded-full`}></div>
                                        <h3 className="text-2xl font-black font-raj italic uppercase tracking-tighter">{team?.name} XI</h3>
                                    </div>
                                    <div className="space-y-3">
                                        {getPlayingXI(team?._id).map((p, pIdx) => (
                                            <div key={pIdx} className="bg-black/[0.03] dark:bg-white/[0.03] p-4 rounded-2xl border border-cric-border/50 flex justify-between items-center group hover:border-cric-accent/30 transition-all">
                                                <span className="font-bold text-cric-text group-hover:text-cric-accent transition-all">{p.name}</span>
                                                <span className="text-[10px] font-black text-cric-accent uppercase tracking-widest">{p.playingRole || 'Player'}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {['photos', 'videos', 'blogs'].includes(activeTab) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-fadeIn">
                            {[1, 2, 3, 4, 5, 6].map(i => (
                                <div key={i} className="group cursor-pointer">
                                    <div className="aspect-video bg-black/40 rounded-[2rem] border border-white/5 overflow-hidden relative mb-4">
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-all"></div>
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100">
                                            <div className="w-12 h-12 rounded-full bg-[#ff6b35] flex items-center justify-center">
                                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                            </div>
                                        </div>
                                        {/* Dynamic placeholder text */}
                                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-700 uppercase tracking-widest group-hover:hidden">Media Preview {i}</div>
                                    </div>
                                    <h4 className="font-bold text-slate-300 group-hover:text-white transition-all px-2 uppercase text-sm tracking-tight">Match Highlight: {activeTab.slice(0, -1).toUpperCase()} #{i}</h4>
                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] px-2 mt-2">2 Hours Ago • {activeTab.toUpperCase()}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* PERMANENT MANAGEMENT PANEL (Right Sidebar) */}
            <RightSidebarControls
                curInn={curInn}
                handleResetInnings={handleResetInnings}
                handleResetMatch={handleResetMatch}
                handleEndInnings={handleEndInnings}
                handleStartNext={handleStartNext}
                setShowSelectionModal={setShowSelectionModal}
                battingXI={battingXI}
                bowlingXI={bowlingXI}
                strikerId={strikerId}
                nonStrikerId={nonStrikerId}
                bowlerId={bowlerId}
                selectedRuns={selectedRuns}
                setSelectedRuns={setSelectedRuns}
                handleRevert={handleRevert}
                selectedExtra={selectedExtra}
                setSelectedExtra={setSelectedExtra}
                selectedWicket={selectedWicket}
                submitBall={submitBall}
                activeGroundZone={activeGroundZone}
                handleGroundClick={handleGroundClick}
                pitchMapBalls={formattedHistory.map(b => ({
                    ballId: `${b.overNumber}.${b.ballNumber}`,
                    line: b.pitchLine || b.line || '',
                    length: b.pitchLength || b.length || '',
                    pitchX: b.pitchX,
                    pitchY: b.pitchY,
                    outcome: { runs: b.runs || 0, wicket: b.isWicket || false },
                    runs: b.runs,
                    isWicket: b.isWicket
                }))}
                pitchMapCurrentOver={curInn?.overs || 0}
                pitchMapLine={pitchMapLine}
                setPitchMapLine={setPitchMapLine}
                pitchMapLength={pitchMapLength}
                setPitchMapLength={setPitchMapLength}
                pitchMapShot={pitchMapShot}
                setPitchMapShot={setPitchMapShot}
                pitchMapClickPos={pitchMapClickPos}
                setPitchMapClickPos={setPitchMapClickPos}
                pitchMapViewMode={pitchMapViewMode}
                setPitchMapViewMode={setPitchMapViewMode}
            />

            {/* Selection Modals */}
            {showSelectionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/90 backdrop-blur-sm">
                    <div className="bg-cric-card w-full max-w-4xl rounded-[3.5rem] border border-cric-border shadow-2xl overflow-hidden animate-zoomIn">
                        <div className="p-12">
                            <div className="flex justify-between items-center mb-12">
                                <h3 className="text-4xl font-black font-raj italic uppercase tracking-tighter text-cric-text">
                                    {showSelectionModal === 'wicket' ? 'DISMISSAL DETAILS' :
                                        showSelectionModal === 'striker' ? 'SELECT NEW STRIKER' :
                                            showSelectionModal === 'nonStriker' ? 'SELECT NEW NON-STRIKER' :
                                                showSelectionModal === 'bowler' ? 'CHANGE BOWLER' : 'SELECTION'}
                                </h3>
                                <button onClick={() => setShowSelectionModal('')} className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center hover:bg-red-500 transition-all text-cric-text hover:text-white">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                </button>
                            </div>

                            {showSelectionModal === 'wicket' && (
                                <div className="space-y-8">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        {WICKET_TYPES.map(type => (
                                            <button key={type} onClick={() => setSelectedWicket(type)} className={`p-6 rounded-3xl border-2 font-black uppercase text-xs tracking-widest transition-all ${selectedWicket === type ? 'bg-red-600 border-red-400 text-white shadow-lg' : 'bg-black/5 dark:bg-white/2 border-cric-border text-slate-500 hover:border-cric-border/80'}`}>
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-2">Next Batsman</label>
                                            <select value={setupState.wicketNewBatter} onChange={(e) => setSetupState(s => ({ ...s, wicketNewBatter: e.target.value }))} className="w-full p-6 bg-cric-bg border border-cric-border rounded-3xl text-cric-text font-black outline-none focus:border-red-500">
                                                <option value="">Select Next In...</option>
                                                {battingXI.filter(p => {
                                                    const pId = p._id || p;
                                                    const stats = curInn?.batting?.find(b => String(b.player?._id || b.player) === String(pId));
                                                    const isCurrent = [String(strikerId), String(nonStrikerId)].includes(String(pId));
                                                    const isOut = stats?.isOut || stats?.isRetired;
                                                    // Allow if they haven't batted OR if they are retired hurt (and not currently on field)
                                                    return !isCurrent && (!stats || stats.isRetiredHurt) && !isOut;
                                                }).map(p => (
                                                    <option key={p._id} value={p._id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-2">Fielder Involved</label>
                                            <select value={setupState.wicketFielder} onChange={(e) => setSetupState(s => ({ ...s, wicketFielder: e.target.value }))} className="w-full p-6 bg-cric-bg border border-cric-border rounded-3xl text-cric-text font-black outline-none focus:border-red-500">
                                                <option value="">Select Fielder...</option>
                                                {bowlingXI.map(p => (
                                                    <option key={p._id} value={p._id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            if (!setupState.wicketNewBatter && curInn.wickets < 9 && selectedWicket !== 'retired hurt') {
                                                alert("Please select the next batsman before confirming.");
                                                return;
                                            }
                                            setShowSelectionModal('');
                                        }} 
                                        className="w-full py-8 rounded-[2rem] bg-red-600 text-white font-black font-raj text-2xl italic tracking-tighter uppercase shadow-xl hover:scale-105 transition-all mt-8"
                                    >
                                        Confirm Wicket Details
                                    </button>
                                </div>
                            )}

                            {(showSelectionModal === 'striker' || showSelectionModal === 'nonStriker') && (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {battingXI.filter(p => {
                                        const pId = p._id || p;
                                        const stats = curInn?.batting?.find(b => String(b.player?._id || b.player) === String(pId));
                                        const isOut = stats?.isOut || stats?.isRetired;
                                        // Include players who haven't batted yet OR are retired hurt
                                        return (!stats || stats.isRetiredHurt) && !isOut;
                                    }).map(p => (
                                        <button key={p._id} onClick={() => setRole(p._id, showSelectionModal)} className="p-8 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-cric-accent hover:bg-cric-accent/5 transition-all text-left">
                                            <div className="text-xl font-black text-cric-text">{p.name}</div>
                                            <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2 select-none">
                                                {curInn?.batting?.find(b => String(b.player?._id || b.player) === String(p._id))?.isRetiredHurt ? 'Return Retired Hurt' : 'Select Batter'}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {showSelectionModal === 'bowler' && (
                                <div className="space-y-8">
                                    {(() => {
                                        const mainBowlers = bowlingXI.filter(p => 
                                            ['Bowler', 'All-Rounder', 'Bowling-All-Rounder'].includes(p.playingRole)
                                        );
                                        const partTimers = bowlingXI.filter(p => 
                                            !['Bowler', 'All-Rounder', 'Bowling-All-Rounder'].includes(p.playingRole)
                                        );

                                        return (
                                            <>
                                                {mainBowlers.length > 0 && (
                                                    <div>
                                                        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4 pl-2">Main Bowlers</h4>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                                            {mainBowlers.map(p => (
                                                                <button key={p._id} onClick={() => setRole(p._id, 'bowler')} className="p-6 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left">
                                                                    <div className="text-lg font-black text-cric-text">{p.name}</div>
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2 select-none">
                                                                        {p.bowlingStyle && p.bowlingStyle !== 'Not Applicable' ? p.bowlingStyle : 'BOWLER'}
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {partTimers.length > 0 && (
                                                    <div className="pt-4 border-t border-cric-border/30">
                                                        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4 pl-2">Part-timer Bowlers</h4>
                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                                            {partTimers.map(p => (
                                                                <button key={p._id} onClick={() => setRole(p._id, 'bowler')} className="p-6 rounded-[2rem] bg-black/5 dark:bg-white/5 border border-cric-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left">
                                                                    <div className="text-lg font-black text-cric-text">{p.name}</div>
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-2 select-none">
                                                                        {p.bowlingStyle && p.bowlingStyle !== 'Not Applicable' ? p.bowlingStyle : 'PART-TIMER'}
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
