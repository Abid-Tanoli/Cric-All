import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../services/api";
import EnhancedMatchTabs from "../components/EnhancedMatchTabs";
import ToastNotifications from "../components/ToastNotifications";
import ThemeToggle from "../components/ThemeToggle";
import ShareButton from "../components/ShareButton";
import PDFReport from "../components/PDFReport";
import { initSocket, joinMatchRoom, leaveMatchRoom } from "../services/socket";

const Match = () => {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);

  const loadMatch = useCallback(async (retries = 2) => {
    let shouldRetry = false;
    try {
      const res = await api.get(`/matches/${matchId}`);
      setMatch(res.data);
    } catch (err) {
      console.error("Failed to load match:", err.response?.status || err.code, err.message);
      shouldRetry = retries > 0 && (err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK');
      if (shouldRetry) {
        setTimeout(() => loadMatch(retries - 1), 1000);
      }
    } finally {
      if (!shouldRetry) setLoading(false);
    }
  }, [matchId]);

  const addEvent = (event) => {
    setEvents(prev => [...prev, event]);
  };

  useEffect(() => {
    let mounted = true;
    const socket = initSocket();

    loadMatch();

    const applyIncomingMatch = (payload) => {
      if (!mounted) return;
      const updatedMatch = payload?.match || payload;
      const updatedId = updatedMatch?.matchId || updatedMatch?._id || payload?.matchId;

      if (updatedMatch?._id && updatedMatch._id === matchId) {
        setMatch(updatedMatch);
        return;
      }

      if (updatedId === matchId) {
        loadMatch();
      }
    };

    const applyScoreUpdate = (payload = {}) => {
      if (!mounted || payload.matchId !== matchId) return;
      setMatch(prev => {
        if (!prev?.innings?.[payload.inningsIndex ?? prev.currentInnings ?? 0]) return prev;
        const inningsIndex = payload.inningsIndex ?? prev.currentInnings ?? 0;
        const innings = prev.innings.map((inn, index) => (
          index === inningsIndex
            ? {
                ...inn,
                runs: payload.runs ?? inn.runs,
                wickets: payload.wickets ?? inn.wickets,
                overs: payload.overs ?? inn.overs,
                balls: payload.balls ?? inn.balls,
                runRate: payload.runRate ?? inn.runRate,
                requiredRunRate: payload.requiredRunRate ?? inn.requiredRunRate,
                onStrikeBatsman: payload.strikerId ?? inn.onStrikeBatsman,
                currentBatsman1: payload.strikerId ?? inn.currentBatsman1,
                currentBatsman2: payload.nonStrikerId ?? inn.currentBatsman2,
              }
            : inn
        ));

        return { ...prev, innings };
      });
    };

    const applyStrikeUpdate = (payload = {}) => {
      if (!mounted || payload.matchId !== matchId) return;
      setMatch(prev => {
        const inningsIndex = payload.inningsIndex ?? prev?.currentInnings ?? 0;
        if (!prev?.innings?.[inningsIndex]) return prev;
        const innings = prev.innings.map((inn, index) => (
          index === inningsIndex
            ? {
                ...inn,
                onStrikeBatsman: payload.strikerId ?? inn.onStrikeBatsman,
                currentBatsman1: payload.strikerId ?? inn.currentBatsman1,
                currentBatsman2: payload.nonStrikerId ?? inn.currentBatsman2,
              }
            : inn
        ));
        return { ...prev, innings };
      });
    };

    const applyRecordedBall = (payload = {}) => {
      if (!mounted || payload.matchId !== matchId || !payload.ball) return;
      setMatch(prev => {
        const inningsIndex = payload.inningsIndex ?? prev?.currentInnings ?? 0;
        const current = prev?.innings?.[inningsIndex];
        if (!current) return prev;

        const overNumber = payload.currentOver ?? payload.overNumber ?? payload.ball.overNumber;
        if (overNumber == null) return prev;

        const ball = {
          ...payload.ball,
          displayBallNumber: payload.displayBallNumber ?? payload.ball.displayBallNumber,
        };

        const oversHistory = [...(current.oversHistory || [])];
        const existingOverIndex = oversHistory.findIndex((over) => Number(over.overNumber) === Number(overNumber));
        const over =
          existingOverIndex >= 0
            ? { ...oversHistory[existingOverIndex], balls: [...(oversHistory[existingOverIndex].balls || [])] }
            : { overNumber, bowler: ball.bowler, balls: [], runsScored: 0, wickets: 0 };

        const existingBallIndex = over.balls.findIndex((item) => {
          if (item._id && ball._id) return String(item._id) === String(ball._id);
          return Number(item.ballNumber) === Number(ball.ballNumber);
        });

        if (existingBallIndex >= 0) {
          over.balls[existingBallIndex] = { ...over.balls[existingBallIndex], ...ball };
        } else {
          over.balls.push(ball);
        }

        over.runsScored = over.balls.reduce(
          (sum, item) => sum + Number(item.runs || 0) + Number(item.extraRuns || 0) + Number(item.penaltyRuns || 0),
          0
        );
        over.wickets = over.balls.filter((item) => item.isWicket).length;

        if (existingOverIndex >= 0) oversHistory[existingOverIndex] = over;
        else oversHistory.push(over);

        const innings = prev.innings.map((inn, index) => (
          index === inningsIndex ? { ...inn, oversHistory } : inn
        ));
        return { ...prev, innings };
      });
    };

    const refreshMatch = (payload) => {
      if (!mounted) return;
      const payloadMatchId = payload?.matchId || payload?.match?._id || payload?._id;
      if (!payloadMatchId || payloadMatchId === matchId) loadMatch();
    };

    const handleBallUpdate = (payload) => {
      if (!mounted) return;
      const payloadMatchId = payload?.matchId || payload?.match?._id;
      if (payloadMatchId && payloadMatchId !== matchId) return;
      if (payload?.match?._id === matchId) {
        setMatch(payload.match);
      }
      const delivery = payload?.delivery || payload?.ball || payload;
      if (payload?.ball && payload?.matchId === matchId) {
        applyRecordedBall(payload);
      }
      if (delivery?.isWicket) {
        addEvent({ type: 'wicket', message: 'WICKET!', player: delivery?.commentary });
      }
      if (delivery?.runs === 4) {
        addEvent({ type: 'four', message: 'FOUR!', player: delivery?.commentary });
      }
      if (delivery?.runs === 6) {
        addEvent({ type: 'six', message: 'SIX!', player: delivery?.commentary });
      }
    };

    const handleWicketAlert = (payload) => {
      if (!mounted) return;
      addEvent({ type: 'wicket', message: `WICKET - ${payload.wicketType}`, player: payload.batsman });
    };

    const handleMilestone = (payload) => {
      if (!mounted) return;
      addEvent({ type: payload.type, message: `${payload.type}!`, player: payload.player });
    };

    const handleInningsComplete = (payload) => {
      if (!mounted) return;
      addEvent({ type: 'innings', message: 'Innings Complete', player: `${payload.total} runs` });
    };

    const handleMatchResult = (payload) => {
      if (!mounted) return;
      addEvent({ type: 'result', message: 'Match Result', player: payload.description });
    };

    const handleOverCompleted = (payload) => {
      applyStrikeUpdate(payload);
    };

    const joinRoom = () => joinMatchRoom(matchId);

    // ─── NEW SPECIFIC EVENTS ──────────────────────────────────
    socket.on("ball:recorded", handleBallUpdate);
    socket.on("score:update", applyScoreUpdate);
    socket.on("strike:changed", applyStrikeUpdate);
    socket.on("over:completed", handleOverCompleted);
    const handleInningsEnd = (payload) => {
      handleInningsComplete(payload);
      loadMatch();
    };
    const handleMatchEnd = (payload) => {
      handleMatchResult(payload || {});
      loadMatch();
    };
    socket.on("innings:end", handleInningsEnd);
    socket.on("match:end", handleMatchEnd);

    // ─── LEGACY EVENTS (backward compat) ──────────────────────
    socket.on("connect", joinRoom);
    socket.on("match:updated", applyIncomingMatch);
    socket.on("match:update", applyIncomingMatch);
    socket.on("match:scoreUpdate", applyScoreUpdate);
    socket.on("match:ballUpdate", handleBallUpdate);
    socket.on("match:ballWithCommentary", handleBallUpdate);
    socket.on("match:ballReverted", refreshMatch);
    socket.on("match:bowlerSet", refreshMatch);
    socket.on("match:overComplete", handleBallUpdate);
    socket.on("match:aiCommentary", refreshMatch);
    socket.on("scoreUpdate", refreshMatch);
    socket.on("ballRecorded", refreshMatch);
    socket.on("inningsComplete", refreshMatch);
    socket.on("matchComplete", refreshMatch);
    socket.on("BALL_UPDATE", handleBallUpdate);
    socket.on("WICKET_ALERT", handleWicketAlert);
    socket.on("MILESTONE_ALERT", handleMilestone);
    socket.on("INNINGS_COMPLETE", handleInningsComplete);
    socket.on("MATCH_RESULT", handleMatchResult);

    joinMatchRoom(matchId);

    return () => {
      mounted = false;
      leaveMatchRoom(matchId);
      socket.off("ball:recorded", handleBallUpdate);
      socket.off("score:update", applyScoreUpdate);
      socket.off("strike:changed", applyStrikeUpdate);
      socket.off("over:completed", handleOverCompleted);
      socket.off("innings:end", handleInningsEnd);
      socket.off("match:end", handleMatchEnd);
      socket.off("connect", joinRoom);
      socket.off("match:updated", applyIncomingMatch);
      socket.off("match:update", applyIncomingMatch);
      socket.off("match:scoreUpdate", applyScoreUpdate);
      socket.off("match:ballUpdate", handleBallUpdate);
      socket.off("match:ballWithCommentary", handleBallUpdate);
      socket.off("match:ballReverted", refreshMatch);
      socket.off("match:bowlerSet", refreshMatch);
      socket.off("match:overComplete", handleBallUpdate);
      socket.off("match:aiCommentary", refreshMatch);
      socket.off("scoreUpdate", refreshMatch);
      socket.off("ballRecorded", refreshMatch);
      socket.off("inningsComplete", refreshMatch);
      socket.off("matchComplete", refreshMatch);
      socket.off("BALL_UPDATE", handleBallUpdate);
      socket.off("WICKET_ALERT", handleWicketAlert);
      socket.off("MILESTONE_ALERT", handleMilestone);
      socket.off("INNINGS_COMPLETE", handleInningsComplete);
      socket.off("MATCH_RESULT", handleMatchResult);
    };
  }, [loadMatch, matchId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cric-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-cric-accent border-t-transparent"></div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-cric-bg flex items-center justify-center text-cric-text font-black uppercase tracking-widest">
        Match Signal Lost
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cric-bg overflow-x-hidden">
      <div className="border-b border-cric-border bg-cric-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
          <Link to="/live" className="touch-target flex items-center gap-1.5 text-xs font-bold text-cric-muted hover:text-cric-accent shrink-0">
            <span aria-hidden="true">←</span> Live
          </Link>
          <Link to="/" className="text-sm font-black font-raj text-cric-text truncate">CricAll</Link>
          <div className="flex items-center gap-2">
            <PDFReport match={match} label="PDF" />
            <ShareButton
              title={`${match.teams?.[0]?.name || "Match"} vs ${match.teams?.[1]?.name || ""}`.trim()}
              text="Follow the live score on CricAll"
            />
            <ThemeToggle />
          </div>
        </div>
      </div>
      <ToastNotifications events={events} />
      <EnhancedMatchTabs matchId={matchId} match={match} />
    </div>
  );
};

export default Match;
