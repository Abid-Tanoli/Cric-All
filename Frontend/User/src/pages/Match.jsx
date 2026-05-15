import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../services/api";
import EnhancedMatchTabs from "../components/EnhancedMatchTabs";
import { initSocket, joinMatchRoom, leaveMatchRoom } from "../services/socket";

const Match = () => {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);

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

    const joinRoom = () => joinMatchRoom(matchId);

    socket.on("connect", joinRoom);
    socket.on("match:updated", applyIncomingMatch);
    socket.on("match:update", applyIncomingMatch);
    socket.on("match:scoreUpdate", refreshMatch);
    socket.on("match:ballUpdate", refreshMatch);
    socket.on("match:ballWithCommentary", refreshMatch);
    socket.on("match:ballReverted", refreshMatch);
    socket.on("match:bowlerSet", refreshMatch);
    socket.on("scoreUpdate", refreshMatch);
    socket.on("ballRecorded", refreshMatch);
    socket.on("inningsComplete", refreshMatch);
    socket.on("matchComplete", refreshMatch);

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
      socket.off("scoreUpdate", refreshMatch);
      socket.off("ballRecorded", refreshMatch);
      socket.off("inningsComplete", refreshMatch);
      socket.off("matchComplete", refreshMatch);
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

  return <EnhancedMatchTabs matchId={matchId} match={match} />;
};

export default Match;
