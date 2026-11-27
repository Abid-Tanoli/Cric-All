import { useMemo } from "react";
import { number, idOf, sameId, playerName, formatOvers, formatBowlerOvers, strikeRate, economyRate, getCrr, ballRuns, teamOfInnings } from "../utils/matchHelpers";

export default function SummaryTab({ match, allPlayers }) {
  const computeMVP = () => {
    const scores = {};
    const resolveName = (player) => {
      if (typeof player === "object" && (player.name || player.fullName)) return player.name || player.fullName;
      const found = allPlayers.find(p => sameId(p, player));
      return found?.name || found?.fullName || "Unknown";
    };
    (match?.innings || []).forEach(inn => {
      (inn.batting || []).forEach(b => {
        if (!b.player) return;
        const key = idOf(b.player);
        if (!scores[key]) scores[key] = { name: resolveName(b.player), player: b.player, runs: 0, ballsFaced: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, catches: 0 };
        scores[key].runs += number(b.runs);
        scores[key].ballsFaced += number(b.balls ?? b.ballsFaced);
      });
      (inn.bowling || []).forEach(b => {
        if (!b.player) return;
        const key = idOf(b.player);
        if (!scores[key]) scores[key] = { name: resolveName(b.player), player: b.player, runs: 0, ballsFaced: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, catches: 0 };
        scores[key].wickets += number(b.wickets);
        scores[key].runsConceded += number(b.runs);
        scores[key].ballsBowled += number(b.balls);
      });
    });
    return Object.values(scores)
      .map(s => ({
        ...s,
        strikeRate: s.ballsFaced ? ((s.runs / s.ballsFaced) * 100).toFixed(2) : "0.00",
        economy: s.ballsBowled ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(2) : "0.00",
        impactScore: number(s.runs) + number(s.wickets) * 25 + number(s.catches) * 10,
      }))
      .sort((a, b) => number(b.impactScore) - number(a.impactScore))
      .slice(0, 5);
  };

  const mvpList = useMemo(() => computeMVP(), [match, allPlayers]);

  const mom = match?.manOfMatch || match?.mom;
  const momName = mom ? (typeof mom === "object" ? (mom.name || mom.fullName) : playerName(mom, allPlayers)) : null;

  const firstInnings = match?.innings?.[0];
  const secondInnings = match?.innings?.[1];

  return (
    <div className="space-y-5">
      {(match.status === "completed" || match.result?.winner) && (
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-xl p-5 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider opacity-80">Result</p>
              <p className="text-lg font-black mt-0.5">{match.result?.description || match.result?.winnerName || "Match Complete"}</p>
              {momName && (
                <div className="flex items-center gap-2 mt-2 bg-white/15 rounded-lg px-3 py-1.5 inline-flex">
                  <span className="text-lg">Trophy</span>
                  <span className="text-sm font-bold">Player of the Match: <span className="underline decoration-yellow-300 decoration-2">{momName}</span></span>
                </div>
              )}
            </div>
            <div className="hidden sm:flex items-center gap-3">
              {(match.teams || []).map((t, i) => (
                <div key={t._id || i} className="text-center">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-1 overflow-hidden">
                    {t.logo ? <img src={t.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-lg font-black">{t.shortName?.charAt(0)}</span>}
                  </div>
                  <p className="text-[10px] font-bold uppercase opacity-80">{t.shortName}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {mvpList.length > 0 && (
        <div className="bg-cric-card rounded-xl border border-cric-border overflow-hidden">
          <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <h3 className="text-[11px] sm:text-xs font-black text-amber-800 dark:text-amber-300 uppercase tracking-wider">MVP Impact List</h3>
          </div>
          <div className="divide-y divide-cric-border">
            {mvpList.map((p, idx) => (
              <div key={idOf(p.player)} className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 hover:bg-cric-accent/5">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[9px] sm:text-[10px] font-black shrink-0 ${idx === 0 ? "bg-amber-400 text-amber-900" : "bg-cric-bg text-cric-muted"}`}>
                    {idx === 0 ? "1" : idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-cric-text truncate">{p.name}</p>
                    <p className="text-[9px] sm:text-[10px] text-cric-muted">
                      {p.runs > 0 && <span>{p.runs} runs{p.wickets > 0 ? ", " : ""}</span>}
                      {p.wickets > 0 && <span>{p.wickets} wickets</span>}
                      {p.runs === 0 && p.wickets === 0 && <span>0 runs, 0 wickets</span>}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs sm:text-sm font-black text-cric-text">{p.impactScore}</p>
                  <p className="text-[8px] sm:text-[9px] text-cric-muted uppercase">MVP Score</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {match.tossWinner && (
        <div className="bg-cric-card rounded-xl border border-cric-border p-3 sm:p-4">
          <h3 className="text-[9px] sm:text-[10px] font-black text-cric-muted uppercase tracking-widest mb-1.5 sm:mb-2">Toss Update</h3>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xl sm:text-2xl shrink-0">Toss</span>
            <div>
              <p className="text-xs sm:text-sm font-bold text-cric-text">
                {typeof match.tossWinner === "object" ? match.tossWinner.name || match.tossWinner.shortName : playerName(match.tossWinner, allPlayers)} won the toss
              </p>
              <p className="text-[11px] sm:text-xs text-cric-muted capitalize font-semibold">Elected to {match.tossDecision || "bat"} first</p>
            </div>
          </div>
          {match.preMatchComments && (
            <div className="mt-2 sm:mt-3 bg-cric-bg rounded-lg p-2 sm:p-3 border border-cric-border">
              <p className="text-[11px] sm:text-xs font-semibold text-cric-text italic">"{match.preMatchComments}"</p>
              <p className="text-[9px] sm:text-[10px] text-cric-muted font-bold mt-1">- Pre-match Comments</p>
            </div>
          )}
        </div>
      )}

      {(firstInnings || secondInnings) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {[firstInnings, secondInnings].filter(Boolean).map((inn, idx) => {
            const t = teamOfInnings(match, inn, idx);
            const topBatter = [...(inn.batting || [])].sort((a, b) => number(b.runs) - number(a.runs))[0];
            const topBowler = [...(inn.bowling || [])].sort((a, b) => number(b.wickets) - number(a.wickets))[0];
            return (
              <div key={idx} className="bg-cric-card rounded-xl border border-cric-border overflow-hidden">
                <div className={`px-3 sm:px-4 py-2 sm:py-2.5 ${idx === 0 ? "bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800" : "bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                      <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-cric-card flex items-center justify-center overflow-hidden border border-cric-border shrink-0">
                        {t?.logo ? <img src={t.logo} alt="" className="w-full h-full object-cover" /> : <span className="text-[8px] sm:text-[9px] font-black text-cric-muted">{t?.shortName?.charAt(0)}</span>}
                      </div>
                      <span className="text-[11px] sm:text-xs font-black text-cric-text uppercase truncate">{t?.shortName || t?.name || `Team ${idx + 1}`}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base sm:text-lg font-black tabular-nums text-cric-text">{inn.runs}/{inn.wickets ?? "-"}</p>
                      <p className="text-[9px] sm:text-[10px] font-bold text-cric-muted">Overs: {formatOvers(inn.balls)} - RR: {getCrr(inn)}</p>
                    </div>
                  </div>
                </div>
                <div className="p-2 sm:p-3 space-y-1.5 sm:space-y-2">
                  {topBatter && (
                    <div className="flex items-center justify-between text-[11px] sm:text-xs gap-2">
                      <span className="font-semibold text-cric-muted shrink-0">Top Batter:</span>
                      <span className="font-bold text-cric-text text-right min-w-0 truncate">
                        {playerName(topBatter.player, allPlayers)} {topBatter.runs}({topBatter.balls ?? topBatter.ballsFaced}) - SR {strikeRate(topBatter.runs, topBatter.balls ?? topBatter.ballsFaced)}
                      </span>
                    </div>
                  )}
                  {topBowler && (
                    <div className="flex items-center justify-between text-[11px] sm:text-xs gap-2">
                      <span className="font-semibold text-cric-muted shrink-0">Top Bowler:</span>
                      <span className="font-bold text-cric-text text-right min-w-0 truncate">
                        {playerName(topBowler.player, allPlayers)} {topBowler.wickets}/{topBowler.runs} ({formatBowlerOvers(topBowler)}) - Econ {economyRate(topBowler.runs, topBowler.balls)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {match && (() => {
        const allBowling = (match.innings || []).flatMap(inn =>
          (inn.bowling || []).map(b => ({ ...b, team: inn.team }))
        ).filter(b => number(b.wickets) > 0 || number(b.maidens) > 0);
        const topBowlers = [...allBowling].sort((a, b) => number(b.wickets) - number(a.wickets) || number(a.runs) - number(b.runs)).slice(0, 4);
        if (topBowlers.length === 0) return null;
        return (
          <div className="bg-cric-card rounded-xl border border-cric-border overflow-hidden">
            <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-cric-bg border-b border-cric-border">
              <h3 className="text-[9px] sm:text-[10px] font-black text-cric-muted uppercase tracking-widest">Best Performances - Bowlers</h3>
            </div>
            <div className="divide-y divide-cric-border">
              {topBowlers.map((b, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 hover:bg-cric-accent/5">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[9px] sm:text-[10px] font-black shrink-0 ${idx === 0 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-cric-bg text-cric-muted'}`}>
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-cric-text truncate">{playerName(b.player, allPlayers)}</p>
                      <p className="text-[9px] sm:text-[10px] text-cric-muted">{b.team?.shortName || b.team?.name}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs sm:text-sm font-black text-cric-text">
                      {number(b.wickets)}/{number(b.runs)}
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-cric-muted">
                      {formatBowlerOvers(b)} - Econ {economyRate(b.runs, b.balls)}
                      {number(b.maidens) > 0 && ` - ${b.maidens}M`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {(match.result?.postMatchComments || match.result?.captainComments) && (
        <div className="bg-cric-card rounded-xl border border-cric-border p-3 sm:p-4">
          <h3 className="text-[9px] sm:text-[10px] font-black text-cric-muted uppercase tracking-widest mb-2 sm:mb-3">Post-Match Reactions</h3>
          <div className="space-y-2 sm:space-y-3">
            {match.result?.captainComments && (
              <div className="bg-cric-bg rounded-lg p-2 sm:p-3 border border-cric-border">
                <p className="text-[11px] sm:text-xs font-semibold text-cric-text italic">"{match.result.captainComments}"</p>
                <p className="text-[9px] sm:text-[10px] text-cric-muted font-bold mt-1">- Captain's Comments</p>
              </div>
            )}
            {match.result?.postMatchComments && (
              <div className="bg-cric-bg rounded-lg p-2 sm:p-3 border border-cric-border">
                <p className="text-[11px] sm:text-xs font-semibold text-cric-text italic">"{match.result.postMatchComments}"</p>
                <p className="text-[9px] sm:text-[10px] text-cric-muted font-bold mt-1">- Post-match Comments</p>
              </div>
            )}
          </div>
        </div>
      )}

      {match && (() => {
        const allBalls = (match.innings || []).flatMap((inn, innIdx) => {
          const team = match.teams?.find(t => sameId(t._id, inn.team));
          return (inn.oversHistory || []).flatMap(over =>
            (over.balls || []).map((ball, bIdx) => {
              const runs = ballRuns(ball);
              const overStr = `${over.overNumber}.${ball.ballNumber || bIdx + 1}`;
              return { ...ball, runs, overStr, team: team?.shortName || team?.name || `Innings ${innIdx + 1}`, innings: innIdx };
            })
          );
        });
        const topMoments = [
          ...allBalls.filter(b => b.runs === 6).slice(0, 3),
          ...allBalls.filter(b => b.isWicket).slice(0, 3),
          ...allBalls.filter(b => b.runs === 4).slice(0, 3),
        ].sort((a, b) => {
          const pri = (b) => b.runs === 6 ? 2 : b.isWicket ? 2 : 1;
          return pri(b) - pri(a) || 0;
        }).slice(0, 6);
        if (topMoments.length === 0) return null;
        return (
          <div className="bg-cric-card rounded-xl border border-cric-border overflow-hidden">
            <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
              <h3 className="text-[11px] sm:text-xs font-black text-amber-800 dark:text-amber-300 uppercase tracking-wider">Key Moments</h3>
            </div>
            <div className="divide-y divide-cric-border">
              {topMoments.map((ball, i) => {
                const batterName = typeof ball.player === "object" ? ball.player.name || ball.player.fullName : playerName(ball.player, allPlayers);
                const bowlerName = typeof ball.bowler === "object" ? ball.bowler.name || ball.bowler.fullName : (ball.bowler ? playerName(ball.bowler, allPlayers) : null);
                return (
                  <div key={i} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 hover:bg-cric-accent/5">
                    <span className={`text-base sm:text-lg shrink-0 ${ball.runs === 6 ? 'text-purple-600' : ball.runs === 4 ? 'text-blue-600' : 'text-red-600'}`}>
                      {ball.runs === 6 ? '6' : ball.runs === 4 ? '4' : 'W'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-cric-text truncate">
                        {ball.runs === 6 && <span className="text-purple-600">SIX! </span>}
                        {ball.runs === 4 && <span className="text-blue-600">FOUR! </span>}
                        {batterName}
                      </p>
                      <p className="text-[9px] sm:text-[10px] text-cric-muted">
                        {bowlerName && <span>Bowled by {bowlerName} - </span>}
                        <span>Over {ball.overStr} - {ball.team}</span>
                        {ball.isWicket && <span className="text-red-500 font-bold"> - WICKET</span>}
                      </p>
                    </div>
                    {ball.runs > 0 && (
                      <div className={`shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-black text-[11px] sm:text-sm ${
                        ball.runs === 6 ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : ball.runs === 4 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-cric-bg text-cric-muted'
                      }`}>
                        {ball.runs}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="bg-cric-card rounded-xl border border-cric-border overflow-hidden">
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-cric-bg border-b border-cric-border">
          <h3 className="text-[9px] sm:text-[10px] font-black text-cric-muted uppercase tracking-widest">Match Details</h3>
        </div>
        <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-[11px] sm:text-xs">
          {match.venue && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Venue</span>
              <span className="font-semibold text-cric-text">{match.venue}{match.address ? `, ${match.address}` : ""}</span>
            </div>
          )}
          {match.startAt && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Date</span>
              <span className="font-semibold text-cric-text">{new Date(match.startAt).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          )}
          {match.tossWinner && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Toss</span>
              <span className="font-semibold text-cric-text">{typeof match.tossWinner === "object" ? match.tossWinner.name : playerName(match.tossWinner, allPlayers)} won, elected to {match.tossDecision || "bat"}</span>
            </div>
          )}
          {match.matchType && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Format</span>
              <span className="font-semibold text-cric-text capitalize">{match.matchType.replace(/_/g, " ")}</span>
            </div>
          )}
          {match.tournament?.name && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Series</span>
              <span className="font-semibold text-cric-text">{match.tournament.name}</span>
            </div>
          )}
          {match.season && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Season</span>
              <span className="font-semibold text-cric-text">{match.season}</span>
            </div>
          )}
          {(match.umpires?.length > 0) && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Umpires</span>
              <span className="font-semibold text-cric-text">{match.umpires.map(u => typeof u === "object" ? u.name : u).join(", ")}</span>
            </div>
          )}
          {match.matchReferee && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Match Referee</span>
              <span className="font-semibold text-cric-text">{typeof match.matchReferee === "object" ? match.matchReferee.name : match.matchReferee}</span>
            </div>
          )}
          {match.weather && (
            <div>
              <span className="font-bold text-cric-muted block text-[9px] sm:text-[10px] uppercase">Weather</span>
              <span className="font-semibold text-cric-text">{typeof match.weather === "object" ? `${match.weather.condition || match.weather.description || ""} ${match.weather.temp ? `- ${match.weather.temp}C` : ""}`.trim() : match.weather}</span>
            </div>
          )}
        </div>
      </div>

      {(!firstInnings && !secondInnings && !match.tossWinner && match.status !== "completed") && (
        <div className="bg-cric-card rounded-xl border border-cric-border p-6 sm:p-8 text-center">
          <p className="text-2xl sm:text-3xl mb-1.5 sm:mb-2">Info</p>
          <p className="text-xs sm:text-sm font-bold text-cric-muted">Match details will appear here once the match begins</p>
        </div>
      )}
    </div>
  );
}
