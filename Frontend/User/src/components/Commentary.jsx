import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { initSocket } from "../services/socket";

const overRunsAndWickets = (over) => {
  const balls = over?.balls || [];
  const runs = balls.reduce((sum, ball) => sum + (ball.runs || 0) + (ball.isWide || ball.isNoBall ? 1 : 0), 0);
  const wickets = balls.filter(ball => ball.isWicket).length;
  return { runs, wickets };
};

const ballClass = (ball) => {
  if (ball?.isWicket) return "bg-red-600 text-white";
  if (ball?.isWide || ball?.isNoBall) return "bg-orange-500 text-white";
  if (ball?.runs === 6) return "bg-purple-600 text-white";
  if (ball?.runs === 4) return "bg-blue-600 text-white";
  if ((ball?.runs || 0) > 0) return "bg-slate-700 text-white";
  return "bg-slate-300 text-slate-700";
};

const ballLabel = (ball) => {
  if (ball?.isWicket) return "W";
  if (ball?.isWide) return "Wd";
  if (ball?.isNoBall) return "Nb";
  if (ball?.runs === 0) return "\u2022";
  return String(ball.runs || 0);
};

const getRunText = (ball) => {
  if (ball?.runText) return ball.runText;
  if (ball?.isWicket) return "OUT!";
  if (ball?.isWide) return "wide";
  if (ball?.isNoBall) return "no ball";
  if (ball?.runs === 0) return "no run";
  if (ball?.runs === 1) return "1 run";
  if (ball?.runs === 4) return "FOUR";
  if (ball?.runs === 6) return "SIX";
  return `${ball.runs} runs`;
};

const labelize = (value) =>
  String(value || "")
    .replace(/_/g, "-")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const ballMetaItems = (ball) => [
  ball?.pitchZone || ball?.pitchLength ? `Length: ${labelize(ball.pitchZone || ball.pitchLength)}` : "",
  ball?.pitchLine ? `Line: ${labelize(ball.pitchLine)}` : "",
  ball?.ballMovement && ball.ballMovement !== "none" ? `Movement: ${labelize(ball.ballMovement)}` : "",
  ball?.ballOutcome && ball.ballOutcome !== "played" ? `Outcome: ${labelize(ball.ballOutcome)}` : "",
  ball?.fieldingZone || ball?.nearestPosition || ball?.regionName || ball?.zone
    ? `Area: ${labelize(ball.fieldingZone || ball.nearestPosition || ball.regionName || ball.zone)}`
    : "",
  ball?.shotType || ball?.pitchShotType ? `Shot: ${labelize(ball.shotType || ball.pitchShotType)}` : "",
].filter(Boolean);

export default function Commentary({ matchId, className = "" }) {
  const navigate = useNavigate();
  const [commentary, setCommentary] = useState([]);
  const [match, setMatch] = useState(null);
  const [showViewFull, setShowViewFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);

  const buildCommentaryFromMatch = (res) => {
    const allBalls = [];
    res.data.innings?.forEach(innings => {
      innings?.oversHistory?.forEach(over => {
        const overNum = over.overNumber;
        (over.balls || []).forEach(ball => {
          allBalls.push({
            overNumber: overNum,
            ballNumber: ball.ballNumber,
            over: `${overNum}.${ball.ballNumber}`,
            text: ball.vividCommentary || ball.commentary || "",
            runs: ball.runs,
            runText: ball.runText,
            bowlerName: ball.bowlerName || ball.bowler?.name || "Bowler",
            batsmanName: ball.batsmanName || ball.batsmanOnStrike?.name || "Batsman",
            isWicket: ball.isWicket,
            isWide: ball.isWide,
            isNoBall: ball.isNoBall,
            isLegBye: ball.isLegBye,
            isBye: ball.isBye,
            pitchZone: ball.pitchZone,
            pitchLength: ball.pitchLength,
            pitchLine: ball.pitchLine,
            ballMovement: ball.ballMovement,
            ballOutcome: ball.ballOutcome,
            fieldingZone: ball.fieldingZone,
            nearestPosition: ball.nearestPosition,
            regionName: ball.regionName,
            zone: ball.zone,
            shotType: ball.shotType,
            pitchShotType: ball.pitchShotType,
            timestamp: ball.timestamp || ball.createdAt || new Date().toISOString(),
            _over: over,
          });
        });
      });
    });
    allBalls.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return allBalls;
  };

  useEffect(() => {
    let mounted = true;
    const socket = initSocket();
    socket.emit("join-match", matchId);

    api.get(`/matches/${matchId}`).then(res => {
      if (!mounted) return;
      setMatch(res.data);
      const allCommentary = buildCommentaryFromMatch(res);
      setCommentary(allCommentary);
      const totalOvers = res.data.totalOvers || 20;
      const currentInnings = res.data.innings?.[res.data.currentInnings];
      if (currentInnings) {
        const oversBowled = currentInnings.overs + (currentInnings.balls || 0) / 6;
        if (oversBowled >= totalOvers - 4) {
          setShowViewFull(true);
        }
      }
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setLoading(false);
    });

    const handleBallUpdate = (data) => {
      if (data.matchId === matchId && (data.ball?.commentary || data.ball?.vividCommentary || data.ball?.runs !== undefined)) {
        const ball = data.ball || data.delivery || {};
        const newItem = {
          overNumber: data.currentOver ?? data.overNumber ?? 0,
          ballNumber: ball.ballNumber || data.ballNumber || 1,
          over: `${data.currentOver ?? data.overNumber ?? 0}.${ball.ballNumber || data.ballNumber || 1}`,
          text: ball.vividCommentary || ball.commentary || "",
          runs: ball.runs,
          runText: ball.runText,
          bowlerName: ball.bowlerName || data.bowlerName || "Bowler",
          batsmanName: ball.batsmanName || data.batsmanName || ball.batsmanOnStrike?.name || "Batsman",
          isWicket: ball.isWicket,
          isWide: ball.isWide,
          isNoBall: ball.isNoBall,
          isLegBye: ball.isLegBye,
          isBye: ball.isBye,
          pitchZone: ball.pitchZone,
          pitchLength: ball.pitchLength,
          pitchLine: ball.pitchLine,
          ballMovement: ball.ballMovement,
          ballOutcome: ball.ballOutcome,
          fieldingZone: ball.fieldingZone,
          nearestPosition: ball.nearestPosition,
          regionName: ball.regionName,
          zone: ball.zone,
          shotType: ball.shotType,
          pitchShotType: ball.pitchShotType,
          timestamp: ball.timestamp || new Date().toISOString(),
        };
        setCommentary(prev => {
          const exists = prev.some(c => c.over === newItem.over && c.batsmanName === newItem.batsmanName);
          if (exists) return prev;
          return [newItem, ...prev];
        });
      }
    };

    socket.on("match:ballUpdate", handleBallUpdate);
    socket.on("match:ball-update", handleBallUpdate);
    socket.on("BALL_UPDATE", (data) => handleBallUpdate({ matchId: data.matchId || matchId, ball: data.delivery || data, currentOver: data.currentOver, ballNumber: data.ballNumber }));
    socket.on("match:ballWithCommentary", (data) => {
      if (data.match?._id === matchId) {
        setMatch(prev => data.match || prev);
        const updated = buildCommentaryFromMatch({ data: data.match });
        if (updated.length) setCommentary(updated);
      }
    });

    return () => {
      mounted = false;
      socket.off("match:ballUpdate", handleBallUpdate);
      socket.off("match:ball-update", handleBallUpdate);
      socket.off("BALL_UPDATE");
      socket.off("match:ballWithCommentary");
    };
  }, [matchId]);

  useEffect(() => {
    if (containerRef.current && commentary.length > 0) {
      containerRef.current.scrollTop = 0;
    }
  }, [commentary.length]);

  const groupByOver = (items) => {
    const map = new Map();
    items.forEach(item => {
      const key = item.overNumber ?? 0;
      if (!map.has(key)) {
        map.set(key, { overNumber: key, balls: [], bowlerName: item.bowlerName });
      }
      const group = map.get(key);
      if (!group.balls.some(b => b.over === item.over && b.batsmanName === item.batsmanName)) {
        group.balls.push(item);
      }
      if (item.bowlerName && !group.bowlerName) group.bowlerName = item.bowlerName;
    });
    return Array.from(map.values()).sort((a, b) => b.overNumber - a.overNumber);
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
        <div className="bg-[#031d44] px-6 py-4">
          <div className="h-5 w-48 bg-white/20 rounded animate-pulse" />
          <div className="h-3 w-32 bg-white/10 rounded mt-2 animate-pulse" />
        </div>
        <div className="p-6 space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="w-12 space-y-2">
                <div className="h-4 w-10 bg-slate-200 rounded" />
                <div className="h-8 w-8 bg-slate-200 rounded-full mx-auto" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const safeCommentary = Array.isArray(commentary) ? commentary : [];
  const groupedOvers = groupByOver(safeCommentary);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
      <div className="bg-[#031d44] px-6 py-4 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-tight">
                Commentary
              </h2>
              {match && (
                <p className="text-xs text-blue-200 mt-0.5">
                  {match.teams?.[0]?.name} vs {match.teams?.[1]?.name}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            {match?.innings?.[match.currentInnings] && (
              <>
                <p className="text-white font-bold text-sm">
                  {match.innings[match.currentInnings].runs}/{match.innings[match.currentInnings].wickets}
                </p>
                <p className="text-blue-200 text-xs">
                  {match.innings[match.currentInnings].overs}.{match.innings[match.currentInnings].balls % 6} ov
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="max-h-[700px] overflow-y-auto">
        {safeCommentary.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-30 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No commentary yet</p>
            <p className="text-sm text-slate-400 mt-2">Match hasn't started or no balls bowled</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {groupedOvers.map((group, gi) => (
              <div key={group.overNumber} className="py-3">
                {gi === 0 && (
                  <div className="px-4 mb-3">
                    <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      Latest
                    </span>
                  </div>
                )}
                <div className="px-4 mb-3">
                  <div className="bg-gradient-to-r from-blue-50 to-slate-50 rounded-xl border border-blue-100 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[#ff6b35] font-black text-lg">Over {group.overNumber}</span>
                        <span className="text-slate-400 text-sm">|</span>
                        <span className="text-sm font-bold text-slate-600">{group.bowlerName || "Bowler"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-slate-700">
                          {overRunsAndWickets({ balls: group.balls }).runs} run{overRunsAndWickets({ balls: group.balls }).runs !== 1 ? "s" : ""}
                        </span>
                        {overRunsAndWickets({ balls: group.balls }).wickets > 0 && (
                          <>
                            <span className="text-slate-300">|</span>
                            <span className="text-red-600 font-bold">{overRunsAndWickets({ balls: group.balls }).wickets} wkt</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {group.balls.slice().reverse().map((ball, bi) => (
                        <span key={bi} className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shadow-sm ${ballClass(ball)}`}>
                          {ballLabel(ball)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-1 px-4">
                  {group.balls.map((c, i) => {
                    const lines = c.text.split('\n').filter(Boolean);
                    const metaItems = ballMetaItems(c);
                    return (
                      <div key={`${c.over}-${i}`} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group">
                        <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-12">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shadow-sm ${ballClass(c)}`}>
                            {ballLabel(c)}
                          </span>
                          <span className="text-[9px] font-mono font-bold text-slate-400">
                            {c.overNumber}.{c.ballNumber || (() => {
                              const idx = group.balls.indexOf(c);
                              return idx + 1;
                            })()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-[#031d44] leading-snug">
                            {c.bowlerName} to {c.batsmanName}, {getRunText(c)}
                          </p>
                          {lines.map((line, li) => (
                            <p key={li} className="text-sm text-slate-600 leading-relaxed mt-0.5">
                              {line}
                            </p>
                          ))}
                          {c.timestamp && (
                            <p className="text-[10px] text-slate-400 font-medium mt-1">
                              {new Date(c.timestamp).toLocaleTimeString()}
                            </p>
                          )}
                          {metaItems.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {metaItems.map((item) => (
                                <span key={item} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                                  {item}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {match && (
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${match.status === 'live' ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`} />
              <span className="font-bold text-slate-600 uppercase">{match.status}</span>
            </div>
            {match.tossWinner && (
              <p className="text-slate-500">
                Toss: {match.tossWinner.name} elected to {match.tossDecision}
              </p>
            )}
          </div>

          {showViewFull && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <button
                onClick={() => navigate(`/match/${matchId}#commentary`)}
                className="w-full bg-[#031d44] hover:bg-blue-700 text-white py-3 rounded-lg font-bold uppercase tracking-widest text-xs transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                View Full Commentary
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
