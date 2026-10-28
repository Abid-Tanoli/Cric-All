import { number, idOf, sameId, teamName, longTeamName, playerName, getPlayingXI, getTossLine, statusLabel, formatOvers, currentInningsOf } from "../utils/matchHelpers";
import SquadSection from "./SquadSection";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";

export default function PlayingXITab({ match, players }) {
  const currentTeamId = match?.innings?.[match?.currentInnings || 0]?.team;
  const rolesByTeam = new Map((match?.teamRoles || []).map((entry) => [idOf(entry.team), entry]));

  const inningsForTeam = (teamId) => (match?.innings || []).find((innings) => sameId(innings.team, teamId));

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="rounded-xl bg-cric-accent p-4 sm:p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div>
            <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.22em] text-white/70">Playing XI</p>
            <h2 className="mt-1 text-xl sm:text-2xl font-black">Team Sheets</h2>
            <p className="mt-1 text-xs sm:text-sm text-white/70">{getTossLine(match)}</p>
          </div>
          <div className="rounded-lg bg-white/10 px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-black uppercase tracking-widest">
            {statusLabel(match?.status)}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        {(match?.teams || []).map((team) => {
          const teamId = idOf(team);
          const explicitXi = getPlayingXI(match, team);
          const xi = explicitXi.length ? explicitXi : (team.players || []).slice(0, 11);
          const xiIds = new Set(xi.map(idOf));
          const twelfth = (match?.twelfthMan || []).filter((entry) => sameId(entry.team, team)).map((entry) => entry.player).filter(Boolean);
          const squadPlayers = (match?.squad15 || []).find((entry) => sameId(entry.team, team))?.players || [];
          const benchMap = new Map();
          [...squadPlayers, ...twelfth].forEach((player) => {
            if (!xiIds.has(idOf(player))) benchMap.set(idOf(player), player);
          });
          const bench = Array.from(benchMap.values());
          const benchIds = new Set(bench.map(idOf));
          const seriesSquad = (team.players || []).filter((player) => !xiIds.has(idOf(player)) && !benchIds.has(idOf(player)));
          const roles = rolesByTeam.get(teamId) || {};
          const innings = inningsForTeam(teamId);
          const battingIds = new Set((innings?.batting || []).map((row) => idOf(row.player)));

          return (
            <div key={teamId || team?.name} className={`overflow-hidden rounded-xl bg-cric-card shadow-sm ring-1 ${sameId(currentTeamId, teamId) ? "ring-cric-accent" : "ring-cric-border"}`}>
              <div className={`px-3 sm:px-4 py-2 sm:py-3 ${sameId(currentTeamId, teamId) ? "bg-cric-accent/5" : "bg-cric-bg"} border-b border-cric-border`}>
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cric-card ring-1 ring-cric-border">
                      {team.logo ? <img src={team.logo} alt={longTeamName(team)} className="h-full w-full object-cover" /> : <span className="font-black text-cric-text text-sm sm:text-base">{teamName(team).charAt(0)}</span>}
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm sm:text-base font-black text-cric-text">{longTeamName(team)}</h3>
                      <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                        {xi.length || 0} players {sameId(currentTeamId, teamId) ? "- batting now" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-cric-muted shrink-0">
                    {innings ? `${number(innings.runs)}/${number(innings.wickets)} (${formatOvers(innings.balls)})` : "Not started"}
                  </div>
                </div>
              </div>

              <div className="divide-y divide-cric-border">
                {(xi.length ? xi : Array.from({ length: 11 })).map((player, index) => {
                  const playerId = idOf(player);
                  const isCaptain = sameId(roles.captain, playerId);
                  const isViceCaptain = sameId(roles.viceCaptain, playerId);
                  const isKeeper = (roles.wicketKeepers || []).some((keeper) => sameId(keeper, playerId));
                  const hasBatted = battingIds.has(playerId);

                  return (
                    <div key={playerId || index} className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 hover:bg-cric-accent/5">
                      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <span className="flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full bg-cric-bg text-[10px] sm:text-[11px] font-black text-cric-muted">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs sm:text-sm font-black text-cric-text">{player ? playerName(player, players) : `Player ${index + 1}`}</p>
                          <div className="mt-0.5 sm:mt-1 flex flex-wrap gap-0.5 sm:gap-1">
                            {isCaptain && <span className="rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-black uppercase text-blue-700 dark:text-blue-300">C</span>}
                            {isViceCaptain && <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300">VC</span>}
                            {isKeeper && <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-black uppercase text-amber-700 dark:text-amber-300">WK</span>}
                            {hasBatted && <span className="rounded-full bg-cric-bg px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-black uppercase text-cric-muted">Batted</span>}
                          </div>
                        </div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-[9px] sm:text-[10px] font-bold uppercase text-cric-muted">
                          <span>{player?.playingRole || player?.role || ""}</span>
                          <BattingPositionBadge value={player?.battingPosition} />
                        </span>
                    </div>
                  );
                })}
              </div>
              {bench.length > 0 && (
                <SquadSection title="Bench / Substitutes" players={bench} allPlayers={players} muted />
              )}
              {seriesSquad.length > 0 && (
                <SquadSection title="Series Squad (Not Playing)" players={seriesSquad} allPlayers={players} muted />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
