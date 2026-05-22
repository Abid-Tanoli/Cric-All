import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../services/api";
import EnhancedMatchTabs from "../components/EnhancedMatchTabs";
import ToastNotifications from "../components/ToastNotifications";
import { initSocket, joinMatchRoom, leaveMatchRoom } from "../services/socket";

const Match = () => {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);

  const loadMatch = useCallback(async () => {
    try {
      const res = await api.get(`/matches/${matchId}`);
      setMatch(res.data);
    } catch (err) {
      console.error("Failed to load match:", err);
    } finally {
      setLoading(false);
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

    const refreshMatch = (payload) => {
      if (!mounted) return;
      const payloadMatchId = payload?.matchId || payload?.match?._id || payload?._id;
      if (!payloadMatchId || payloadMatchId === matchId) loadMatch();
    };

    const handleBallUpdate = (payload) => {
      if (!mounted) return;
      if (payload?.match?._id === matchId) {
        setMatch(payload.match);
      }
      if (payload?.delivery?.isWicket) {
        addEvent({ type: 'wicket', message: 'WICKET!', player: payload.delivery?.commentary });
      }
      if (payload?.delivery?.runs === 4) {
        addEvent({ type: 'four', message: 'FOUR!', player: payload.delivery?.commentary });
      }
      if (payload?.delivery?.runs === 6) {
        addEvent({ type: 'six', message: 'SIX!', player: payload.delivery?.commentary });
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

    const joinRoom = () => joinMatchRoom(matchId);

    socket.on("connect", joinRoom);
    socket.on("match:updated", applyIncomingMatch);
    socket.on("match:update", applyIncomingMatch);
    socket.on("match:scoreUpdate", refreshMatch);
    socket.on("match:ballUpdate", refreshMatch);
    socket.on("match:ballWithCommentary", refreshMatch);
    socket.on("match:ballReverted", refreshMatch);
    socket.on("match:bowlerSet", refreshMatch);
    socket.on("match:overComplete", refreshMatch);
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
      socket.off("connect", joinRoom);
      socket.off("match:updated", applyIncomingMatch);
      socket.off("match:update", applyIncomingMatch);
      socket.off("match:scoreUpdate", refreshMatch);
      socket.off("match:ballUpdate", refreshMatch);
      socket.off("match:ballWithCommentary", refreshMatch);
      socket.off("match:ballReverted", refreshMatch);
      socket.off("match:bowlerSet", refreshMatch);
      socket.off("match:overComplete", refreshMatch);
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
      <div className="min-h-screen bg-[#031d44] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-[#031d44] flex items-center justify-center text-white font-black uppercase tracking-widest">
        Match Signal Lost
      </div>
    );
  }

  return (
    <>
      <ToastNotifications events={events} />
      <EnhancedMatchTabs matchId={matchId} match={match} />
    </>
  );
};

export default Match;
