import { number, idOf, sameId, teamName, longTeamName, playerName, getTeamById, getPlayingXI, formatOvers, formatBowlerOvers, strikeRate, getCrr, economyRate, dismissalParts } from "../utils/matchHelpers";
import InfoBlock from "./InfoBlock";

export default function ScorecardTab({ match, innings, selectedInnings, setSelectedInnings, battingTeam, players }) {
  const extras = innings?.extras || {};
  const totalExtras = number(extras.total) || number(extras.wides) + number(extras.noBalls) + number(extras.byes) + number(extras.legByes) + number(extras.penalties);
  const battingIds = new Set((innings?.batting || []).map((row) => idOf(row.player)));
  const dnb = getPlayingXI(match, innings?.team).filter((player) => !battingIds.has(idOf(player)));
  // P4: the player of the match is set after the game, by a scorer or an
  // admin. It is shown on every innings of the scorecard, not just the second.
  const mom = match?.manOfMatch;
  const momName = mom ? playerName(mom, players) : "";

  return (
    <section className="space-y-3 sm:space-y-4">
      {momName && (
        <div
          data-testid="player-of-the-match"
          className="flex items-center gap-3 rounded-xl bg-amber-50 px-3 sm:px-4 py-2.5 sm:py-3 ring-1 ring-amber-200"
        >
          <span aria-hidden="true" className="text-lg sm:text-xl">🏅</span>
          <div className="min-w-0">
            <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Player of the Match</p>
            <p className="text-sm sm:text-base font-black text-cric-text truncate">{momName}</p>
          </div>
        </div>
      )}
      <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
        {(match.innings || []).map((inn, index) => {
          const team = getTeamById(match, inn.team);
          return (
            <button
              type="button"
              key={inn._id || index}
              onClick={() => setSelectedInnings(index)}
              className={`shrink-0 rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-black transition-all ${
                selectedInnings === index ? "bg-cric-accent text-white" : "bg-cric-card text-cric-muted ring-1 ring-cric-border"
              }`}
            >
              {teamName(team)}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl bg-cric-card shadow-sm ring-1 ring-cric-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cric-border bg-cric-bg px-3 sm:px-4 py-2 sm:py-3">
          <h2 className="text-sm sm:text-base font-black text-cric-text">{longTeamName(battingTeam)}</h2>
          <div className="text-sm sm:text-base font-black tabular-nums text-cric-text">{number(innings?.runs)}/{number(innings?.wickets)} <span className="text-xs font-bold text-cric-muted">({formatOvers(innings?.balls)} ov)</span></div>
        </div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[400px] sm:min-w-[600px] text-left text-xs sm:text-sm">
            <thead className="bg-cric-bg text-[10px] sm:text-[11px] uppercase tracking-widest text-cric-muted">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3">Batter</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3">How Out</th>
                <th className="hidden sm:table-cell px-2 sm:px-4 py-2 sm:py-3">Bowler</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">R</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">B</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">4s</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">6s</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-right">SR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cric-border">
              {(innings?.batting || []).map((row) => {
                const dismissal = dismissalParts(row, players);
                return (
                  <tr key={idOf(row.player)} className={!row.isOut ? "border-l-4 border-l-emerald-500" : ""}>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 font-black text-cric-text">{playerName(row.player, players)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-cric-muted text-[10px] sm:text-xs leading-tight break-words max-w-[120px] sm:max-w-none">{dismissal.how}</td>
                    <td className="hidden sm:table-cell px-2 sm:px-4 py-2 sm:py-3 text-cric-muted">{dismissal.bowler}</td>
                    <td className="px-1 sm:px-3 py-2 sm:py-3 text-right font-black tabular-nums text-cric-text">{number(row.runs)}</td>
                    <td className="px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.balls)}</td>
                    <td className="px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.fours)}</td>
                    <td className="px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.sixes)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{row.strikeRate ? number(row.strikeRate).toFixed(2) : strikeRate(row.runs, row.balls)}</td>
                  </tr>
                );
              })}
              <tr className="bg-cric-bg font-bold">
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-cric-text">Extras</td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-cric-muted text-[10px] sm:text-xs" colSpan={2}>
                  w {number(extras.wides)}, nb {number(extras.noBalls)}, b {number(extras.byes)}, lb {number(extras.legByes)}
                </td>
                <td className="px-1 sm:px-3 py-2 sm:py-3 text-right font-black tabular-nums text-cric-text">{totalExtras}</td>
                <td colSpan={4} />
              </tr>
              <tr className="bg-cric-accent/10 font-black">
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-cric-text">Total</td>
                <td className="px-2 sm:px-4 py-2 sm:py-3 text-cric-muted text-[10px] sm:text-xs" colSpan={2}>{formatOvers(innings?.balls)} Ov (RR: {getCrr(innings)})</td>
                <td className="px-1 sm:px-3 py-2 sm:py-3 text-right font-black tabular-nums text-cric-text">{number(innings?.runs)}/{number(innings?.wickets)}</td>
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl bg-cric-card p-3 sm:p-4 shadow-sm ring-1 ring-cric-border">
        <h3 className="text-[10px] sm:text-xs font-black uppercase tracking-[0.18em] text-cric-muted mb-2 sm:mb-3">Fall of Wickets</h3>
        {(innings?.fallOfWickets || []).length ? (
          <div className="grid gap-1.5 sm:gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {innings.fallOfWickets.map((w, i) => (
              <div key={i} className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm bg-cric-bg rounded-lg px-2 sm:px-3 py-1.5 sm:py-2">
                <span className="font-black text-cric-text shrink-0 min-w-[2.5rem] sm:min-w-[3rem]">{number(w.wicket || w.wickets || i + 1)}-{number(w.runs)}</span>
                <span className="text-cric-muted flex-1 truncate">{playerName(w.player, players)}</span>
                <span className="text-[10px] sm:text-xs font-bold text-cric-muted shrink-0">{w.overs || "0.0"} ov</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs sm:text-sm text-cric-muted">No wickets yet</p>
        )}
      </div>

      <InfoBlock title="Did Not Bat">
        {dnb.length ? dnb.map((player) => playerName(player, players)).join(", ") : "All listed batters have appeared"}
      </InfoBlock>

      <div className="overflow-hidden rounded-xl bg-cric-card shadow-sm ring-1 ring-cric-border">
        <div className="border-b border-cric-border bg-cric-bg px-3 sm:px-4 py-2 sm:py-3 font-black text-sm sm:text-base text-cric-text">Bowling</div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[400px] sm:min-w-[580px] text-left text-xs sm:text-sm">
            <thead className="bg-cric-bg text-[10px] sm:text-[11px] uppercase tracking-widest text-cric-muted">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3">Bowler</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">O</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">M</th>
                <th className="hidden sm:table-cell px-1 sm:px-3 py-2 sm:py-3 text-right">DOT</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">R</th>
                <th className="px-1 sm:px-3 py-2 sm:py-3 text-right">W</th>
                <th className="hidden sm:table-cell px-1 sm:px-3 py-2 sm:py-3 text-right">Econ</th>
                <th className="hidden md:table-cell px-1 sm:px-3 py-2 sm:py-3 text-right">WD</th>
                <th className="hidden md:table-cell px-2 sm:px-4 py-2 sm:py-3 text-right">NB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cric-border">
              {(innings?.bowling || []).map((row) => (
                <tr key={idOf(row.player)}>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 font-black text-cric-text">{playerName(row.player, players)}</td>
                  <td className="px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{formatBowlerOvers(row)}</td>
                  <td className="px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.maidens)}</td>
                  <td className="hidden sm:table-cell px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.dotBalls ?? row.dots)}</td>
                  <td className="px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.runs)}</td>
                  <td className="px-1 sm:px-3 py-2 sm:py-3 text-right font-black tabular-nums text-cric-text">{number(row.wickets)}</td>
                  <td className="hidden sm:table-cell px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{row.economy || economyRate(row.runs, row.balls)}</td>
                  <td className="hidden md:table-cell px-1 sm:px-3 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.wides)}</td>
                  <td className="hidden md:table-cell px-2 sm:px-4 py-2 sm:py-3 text-right tabular-nums text-cric-muted">{number(row.noBalls)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
