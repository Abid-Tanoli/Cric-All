import React, { useEffect, useRef, useState } from "react";
import { useScoringAdapters } from "../../ScoringAdapters";

const RUN_BADGE = {
  dot: { label: "DOT", color: "bg-slate-600" },
  run: { label: "RUN", color: "bg-slate-500" },
  four: { label: "FOUR", color: "bg-blue-600" },
  six: { label: "SIX", color: "bg-purple-600" },
  wicket: { label: "OUT", color: "bg-red-600" },
  extra: { label: "EXTRA", color: "bg-amber-500" },
};

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOverNumber = (value) => {
  if (value == null) return null;
  if (typeof value === "string" && value.includes(".")) return number(value.split(".")[0], null);
  return number(value, null);
};

const parseDisplayBallNumber = (data, ball) => {
  if (data?.displayBallNumber || ball?.displayBallNumber) return data.displayBallNumber || ball.displayBallNumber;
  if (data?.legalBallNumber || ball?.legalBallNumber) return data.legalBallNumber || ball.legalBallNumber;
  if (data?.ballNumber) return data.ballNumber;
  if (typeof data?.over === "string" && data.over.includes(".")) return number(data.over.split(".")[1], 1);
  return ball?.ballNumber || 1;
};

function getBadge(item) {
  if (item.isWicket) return RUN_BADGE.wicket;
  if (item.isWide || item.isNoBall || item.isBye || item.isLegBye) return RUN_BADGE.extra;
  if (item.runs === 6) return RUN_BADGE.six;
  if (item.runs === 4) return RUN_BADGE.four;
  if (item.runs >= 1) return { ...RUN_BADGE.run, label: String(item.runs) };
  return RUN_BADGE.dot;
}

function normalizeSocketCommentary(data, matchId) {
  if (!data) return null;
  if (data.matchId && matchId && String(data.matchId) !== String(matchId)) return null;

  const ball = data.ball || data.delivery || {};
  const commentaryPayload = data.commentary || {};
  const commentary = typeof commentaryPayload === "string"
    ? commentaryPayload
    : commentaryPayload.short || ball.commentary || data.text || "";
  const vividCommentary = commentaryPayload.vivid || ball.vividCommentary || data.vividCommentary || "";
  const overNumber = data.currentOver ?? data.overNumber ?? parseOverNumber(data.over) ?? ball.overNumber ?? 0;
  const displayBallNumber = parseDisplayBallNumber(data, ball);

  return {
    ...ball,
    id: data.ballId || ball._id || `${data.matchId || matchId}-${overNumber}.${displayBallNumber}-${commentary || vividCommentary || Date.now()}`,
    overNumber,
    ballNumber: ball.ballNumber || data.ballNumber || displayBallNumber,
    rawBallNumber: ball.rawBallNumber || ball.ballNumber || data.rawBallNumber || null,
    displayBallNumber,
    batsmanName: data.batsman || data.batsmanName || ball.batsmanName || "Batsman",
    bowlerName: data.bowler || data.bowlerName || ball.bowlerName || "Bowler",
    runs: data.runs ?? ball.runs ?? 0,
    isWicket: data.isWicket ?? ball.isWicket ?? false,
    isWide: data.isWide ?? ball.isWide ?? false,
    isNoBall: data.isNoBall ?? ball.isNoBall ?? false,
    isBye: data.isBye ?? ball.isBye ?? false,
    isLegBye: data.isLegBye ?? ball.isLegBye ?? false,
    commentary,
    vividCommentary,
    fielderName: data.fieldedByName || data.fielderName || ball.fielderName || "",
    fieldedByPosition: data.fieldedByPosition || ball.fieldedByPosition || "",
    pitchLine: data.pitchLine || ball.pitchLine || "",
    pitchLength: data.pitchLength || ball.pitchLength || "",
    ballMovement: data.ballMovement || ball.ballMovement || "",
    shotTypeName: data.shotTypeName || ball.shotTypeName || "",
    shotDirection: data.shotDirection || data.direction || ball.shotDirection || "",
    fieldingZone: data.fieldingZone || data.groundZone || ball.fieldingZone || ball.groundZone || "",
    timestamp: data.timestamp || ball.timestamp || new Date().toISOString(),
  };
}

const sameDelivery = (a, b) =>
  a.id === b.id ||
  (
    a.overNumber === b.overNumber &&
    a.rawBallNumber != null &&
    b.rawBallNumber != null &&
    a.rawBallNumber === b.rawBallNumber &&
    a.batsmanName === b.batsmanName &&
    a.bowlerName === b.bowlerName
  );

const CommentaryBox = React.memo(function CommentaryBox({ matchId, formattedHistory }) {
  const { socket: adapterSocket, getSocket, joinMatchRoom, leaveMatchRoom } = useScoringAdapters();
  const [commentaryFeed, setCommentaryFeed] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (formattedHistory && formattedHistory.length > 0) {
      const mapped = formattedHistory.slice(-50).reverse().map(b => ({
        ...b,
        id: b._id || `${b.overNumber}.${b.displayBallNumber || b.ballNumber}`,
      }));
      setCommentaryFeed(mapped);
    } else {
      setCommentaryFeed([]);
    }
  }, [formattedHistory]);

  useEffect(() => {
    const socket = adapterSocket || getSocket?.();
    if (!socket) return undefined;

    if (matchId) joinMatchRoom?.(matchId);

    const addCommentary = (item) => {
      if (!item) return;
      setCommentaryFeed(prev => {
        if (prev.some(existing => sameDelivery(existing, item))) return prev;
        return [item, ...prev].slice(0, 50);
      });
    };

    const handleCommentary = (data) => addCommentary(normalizeSocketCommentary(data, matchId));
    const handleBallWithCommentary = (data) => addCommentary(normalizeSocketCommentary(data, matchId));
    const handleAICommentary = (data) => addCommentary(normalizeSocketCommentary(data, matchId));
    const handleBallUpdate = (data) => {
      const item = normalizeSocketCommentary(data, matchId);
      if (item?.commentary || item?.vividCommentary) addCommentary(item);
    };
    const handleBallRecorded = (data) => {
      const item = normalizeSocketCommentary({ ...data, commentary: data.commentary || {} }, matchId);
      if (item?.commentary || item?.vividCommentary) addCommentary(item);
    };

    socket.on("commentary", handleCommentary);
    socket.on("match:ballWithCommentary", handleBallWithCommentary);
    socket.on("match:aiCommentary", handleAICommentary);
    socket.on("match:ballUpdate", handleBallUpdate);
    socket.on("ball:recorded", handleBallRecorded);

    return () => {
      socket.off("commentary", handleCommentary);
      socket.off("match:ballWithCommentary", handleBallWithCommentary);
      socket.off("match:aiCommentary", handleAICommentary);
      socket.off("match:ballUpdate", handleBallUpdate);
      socket.off("ball:recorded", handleBallRecorded);
      if (matchId) leaveMatchRoom?.(matchId);
    };
  }, [adapterSocket, getSocket, joinMatchRoom, leaveMatchRoom, matchId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [commentaryFeed]);

  return (
    <div className="rounded-3xl border border-cric-border bg-black/5 dark:bg-white/5 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.3em]">
          {"\uD83C\uDF99\uFE0F COMMENTARY"}
        </h4>
      </div>

      <div ref={scrollRef} className="space-y-3 max-h-[400px] overflow-y-auto no-scrollbar">
        {commentaryFeed.length === 0 ? (
          <div className="text-center py-8 text-cric-muted text-[10px] font-black uppercase tracking-widest">
            Waiting for first ball...
          </div>
        ) : (
          commentaryFeed.slice(0, 20).map((item, idx) => {
            const badge = getBadge(item);
            const overLabel = `${number(item.overNumber)}.${item.displayBallNumber || item.ballNumber || 1}`;
            const commentaryText = item.vividCommentary || item.commentary;
            return (
              <div key={item.id || idx} className="p-4 rounded-2xl bg-black/10 dark:bg-white/5 border border-cric-border/30 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-black text-cric-text uppercase tracking-tight">
                    {item.bowlerName} to {item.batsmanName}
                  </div>
                  {item.overNumber != null && (
                    <span className="text-[9px] font-black text-cric-muted whitespace-nowrap">Over {overLabel}</span>
                  )}
                </div>

                {commentaryText ? (
                  <p className="text-[11px] text-cric-text/80 leading-relaxed">
                    {commentaryText}
                    {item.isAi && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[7px] font-black bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-purple-400 uppercase tracking-wider border border-purple-500/30">
                        AI
                      </span>
                    )}
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${badge.color}`} />
                    <span className="text-[11px] text-cric-muted">
                      {badge.label} {item.runs > 0 && `- ${item.runs} run${item.runs > 1 ? 's' : ''}`}
                    </span>
                  </div>
                )}

                {(item.pitchLine || item.pitchLength || item.ballMovement || item.shotTypeName) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(item.pitchLine || item.pitchLength) && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-900/40 text-blue-300 border border-blue-500/30 uppercase tracking-wide">
                        {item.pitchLength ? item.pitchLength.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : ""}{item.pitchLength && item.pitchLine ? " • " : ""}{item.pitchLine ? item.pitchLine.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : ""}
                      </span>
                    )}
                    {item.ballMovement && item.ballMovement !== "none" && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-900/40 text-emerald-300 border border-emerald-500/30 uppercase tracking-wide">
                        {item.ballMovement.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    )}
                    {item.shotTypeName && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-900/40 text-amber-300 border border-amber-500/30 uppercase tracking-wide">
                        {item.shotTypeName}
                      </span>
                    )}
                    {(item.shotDirection || item.fieldingZone) && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-violet-900/40 text-violet-300 border border-violet-500/30 uppercase tracking-wide">
                        {(item.shotDirection || item.fieldingZone).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <span className={`inline-block px-3 py-1 rounded-full text-[9px] font-black text-white ${badge.color}`}>
                    {badge.label}
                  </span>
                  {item.fielderName && (
                    <span className="text-[9px] text-cric-muted">
                      {item.fielderName}{item.fieldedByPosition ? ` at ${item.fieldedByPosition}` : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

export default CommentaryBox;
