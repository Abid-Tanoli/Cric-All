import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { initSocket } from "../services/socket";

export default function Commentary({ matchId }) {
  const navigate = useNavigate();
  const [commentary, setCommentary] = useState([]);
  const [match, setMatch] = useState(null);
  const [showViewFull, setShowViewFull] = useState(false);

  useEffect(() => {
    const socket = initSocket();
    socket.emit("join-match", matchId);

    // Fetch match data to get existing commentary
    api.get(`/matches/${matchId}`).then(res => {
      setMatch(res.data);
      // Extract commentary from overs history
      const allCommentary = [];
      res.data.innings?.forEach(innings => {
        innings?.oversHistory?.forEach(over => {
          over.balls?.forEach(ball => {
            if (ball.commentary) {
              allCommentary.push({
                over: `${over.overNumber}.${ball.ballNumber}`,
                text: ball.commentary,
                runs: ball.runs,
                runText: ball.runText,
                bowlerName: ball.bowlerName || ball.bowler?.name || "Bowler",
                batsmanName: ball.batsmanName || ball.batsmanOnStrike?.name || "Batsman",
                isWicket: ball.isWicket,
                isWide: ball.isWide,
                isNoBall: ball.isNoBall,
                timestamp: ball.timestamp
              });
            }
          });
        });
      });
      // Sort by timestamp (newest first)
      allCommentary.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setCommentary(allCommentary);

      // Show "View Full Commentary" button if more than (totalOvers - 4) overs are bowled
      const totalOvers = res.data.totalOvers || 20;
      const currentInnings = res.data.innings?.[res.data.currentInnings];
      if (currentInnings) {
        const oversBowled = currentInnings.overs + (currentInnings.balls % 6) / 6;
        if (oversBowled >= totalOvers - 4) {
          setShowViewFull(true);
        }
      }
    }).catch(console.error);

    const handleBallUpdate = (data) => {
      if (data.matchId === matchId && data.ball?.commentary) {
        const newCommentary = {
          over: `${data.currentOver}.${data.ballNumber}`,
          text: data.ball.commentary,
          runs: data.ball.runs,
          runText: data.ball.runText,
          bowlerName: data.ball.bowlerName || "Bowler",
          batsmanName: data.ball.batsmanName || "Batsman",
          isWicket: data.ball.isWicket,
          isWide: data.ball.isWide,
          isNoBall: data.ball.isNoBall,
          timestamp: data.ball.timestamp
        };
        setCommentary(prev => [newCommentary, ...prev]);

        // Check if we should show "View Full Commentary" button
        if (match) {
          const totalOvers = match.totalOvers || 20;
          const currentInnings = match.innings?.[match.currentInnings];
          if (currentInnings) {
            const oversBowled = currentInnings.overs + (currentInnings.balls % 6) / 6;
            if (oversBowled >= totalOvers - 4) {
              setShowViewFull(true);
            }
          }
        }
      }
    };

    socket.on("match:ballUpdate", handleBallUpdate);
    socket.on("match:ball-update", handleBallUpdate);

    return () => {
      socket.off("match:ballUpdate", handleBallUpdate);
      socket.off("match:ball-update", handleBallUpdate);
    };
  }, [matchId]);

  const getBallStyle = (commentaryItem) => {
    if (commentaryItem.isWicket) {
      return "bg-red-600 text-white";
    }
    if (commentaryItem.isNoBall || commentaryItem.isWide) {
      return "bg-orange-500 text-white";
    }
    if (commentaryItem.runs === 4) {
      return "bg-green-600 text-white";
    }
    if (commentaryItem.runs === 6) {
      return "bg-purple-600 text-white";
    }
    if (commentaryItem.runs === 1 || commentaryItem.runs === 2 || commentaryItem.runs === 3) {
      return "bg-blue-500 text-white";
    }
    if (commentaryItem.runs === 0) {
      return "bg-slate-300 text-slate-700";
    }
    return "bg-slate-200 text-slate-600";
  };

  const getRunsDisplay = (commentaryItem) => {
    if (commentaryItem.isWicket) return "W";
    if (commentaryItem.isWide) return "Wd";
    if (commentaryItem.isNoBall) return "Nb";
    return commentaryItem.runs;
  };

  const getRunText = (commentaryItem) => {
    if (commentaryItem.runText) return commentaryItem.runText;
    if (commentaryItem.isWicket) return "OUT!";
    if (commentaryItem.isWide) return "wide";
    if (commentaryItem.isNoBall) return "no ball";
    if (commentaryItem.runs === 0) return "no run";
    if (commentaryItem.runs === 1) return "1 run";
    if (commentaryItem.runs === 4) return "FOUR";
    if (commentaryItem.runs === 6) return "SIX";
    return `${commentaryItem.runs} runs`;
  };

  const safeCommentary = Array.isArray(commentary) ? commentary : [];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header - ESPN Cricinfo Style */}
      <div className="bg-[#031d44] px-6 py-4 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
              <div className="w-1 h-6 bg-red-600 rounded-full" />
              Ball-by-Ball Commentary
            </h2>
            {match && (
              <p className="text-xs text-blue-200 mt-1">
                {match.teams?.[0]?.name} vs {match.teams?.[1]?.name}
              </p>
            )}
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

      {/* Commentary List */}
      <div className="divide-y divide-slate-100 max-h-[700px] overflow-y-auto">
        {safeCommentary.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-16 h-16 mx-auto mb-4 opacity-30 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No commentary yet</p>
            <p className="text-sm text-slate-400 mt-2">Match hasn't started or no balls bowled</p>
          </div>
        ) : (
          safeCommentary.map((c, i) => (
            <div key={i} className="p-4 hover:bg-slate-50 transition-colors group">
              <div className="flex items-start gap-4">
                {/* Over Number & Ball Indicator */}
                <div className="flex-shrink-0">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xs font-black text-[#031d44] bg-slate-100 px-2 py-1 rounded font-mono">
                      {c.over}
                    </span>
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${getBallStyle(c)}`}>
                      {getRunsDisplay(c)}
                    </span>
                  </div>
                </div>

                {/* Commentary Text */}
                <div className="flex-1">
                  <div className="bg-white rounded-lg p-3 border border-slate-200 group-hover:border-blue-300 transition-colors">
                    {/* First line - Cricinfo format */}
                    <p className="text-sm font-bold text-[#031d44] leading-snug font-mono">
                      {c.over} {c.bowlerName || "Bowler"} to {c.batsmanName || "Batsman"}, {getRunText(c)}.
                    </p>
                    {/* Second line - Commentary description */}
                    {c.text.split('\n')[1] && (
                      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                        {c.text.split('\n')[1]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer - Current Match Status */}
      {match && (
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${match.status === 'live' ? 'bg-red-500 animate-pulse' : 'bg-slate-400'}`}></span>
              <span className="font-bold text-slate-600 uppercase">{match.status}</span>
            </div>
            {match.tossWinner && (
              <p className="text-slate-500">
                Toss: {match.tossWinner.name} elected to {match.tossDecision}
              </p>
            )}
          </div>

          {/* View Full Commentary Button - Shows after last 4 overs */}
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
