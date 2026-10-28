import React from "react";
import { Link } from "react-router-dom";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";

function SquadCard({ squad }) {
  const team = squad.team || {};
  const players = squad.players || [];
  const isC = (id) => String(squad.captain?._id || squad.captain || "") === String(id);
  const isVC = (id) => String(squad.viceCaptain?._id || squad.viceCaptain || "") === String(id);
  const isWK = (id) => (squad.wicketKeepers || []).some((w) => String(w?._id || w) === String(id));

  return (
    <div className="bg-cric-card rounded-xl shadow-sm overflow-hidden border border-cric-border">
      <div className="bg-gradient-to-r from-cric-text to-slate-800 text-white p-4">
        <div className="flex items-center gap-3">
          {team.logo && <img src={team.logo} alt="" className="w-10 h-10 rounded-lg object-cover" />}
          <div>
            <h3 className="text-lg font-black uppercase">{team.name || squad.name || "Team"}</h3>
            <p className="text-[10px] text-blue-200 font-bold">{players.length} Players</p>
          </div>
        </div>
      </div>
      <div className="p-4">
        {players.length === 0 ? (
          <p className="text-sm text-cric-muted">Squad not announced yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {players.map((player) => {
              const id = player._id || player.id;
              return (
                <Link
                  key={id}
                  to={`/players/${id}`}
                  className="px-3 py-1.5 bg-cric-bg hover:bg-cric-card hover:text-cric-accent rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                >
                  {player.name}
                  <BattingPositionBadge value={player.battingPosition} />
                  {isC(id) && <span className="text-cric-accent">(C)</span>}
                  {isVC(id) && <span className="text-green-600">(VC)</span>}
                  {isWK(id) && <span className="text-orange-600">(WK)</span>}
                  {player.isPlayingXI && <span className="text-emerald-600">(XI)</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamTile({ team }) {
  return (
    <Link
      to={`/teams/${team._id}`}
      className="bg-cric-card rounded-xl shadow-sm border border-cric-border p-4 flex items-center gap-3 hover:shadow-md transition-all"
    >
      <span className="w-10 h-10 rounded-lg bg-white border border-cric-border flex items-center justify-center overflow-hidden">
        {team.logo ? (
          <img src={team.logo} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="text-xs font-bold text-cric-muted">{team.shortName || team.name?.charAt(0) || "T"}</span>
        )}
      </span>
      <span className="font-bold text-cric-text">{team.name || team.shortName}</span>
    </Link>
  );
}

export default function TeamsTab({ teams = [], squads = [], stats = {} }) {
  const squadTeamIds = new Set(squads.map((s) => String(s.team?._id || s.team)));
  const teamsWithoutSquad = teams.filter((team) => !squadTeamIds.has(String(team?._id)));
  const teamStats = stats?.teamStats || [];

  return (
    <div className="space-y-8">
      {teamStats.length > 0 && (
        <div>
          <h2 className="text-xl font-black text-cric-text uppercase tracking-tight flex items-center gap-2 mb-4">
            <span className="w-2 h-6 bg-blue-600 rounded-full" />
            Team Stats
          </h2>
          <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-cric-bg text-cric-muted uppercase text-[11px] font-bold">
                  <tr>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-2 py-3 text-center">M</th>
                    <th className="px-2 py-3 text-center">W</th>
                    <th className="px-2 py-3 text-center">L</th>
                    <th className="px-2 py-3 text-center">Runs</th>
                    <th className="px-2 py-3 text-center">Wkts</th>
                    <th className="px-2 py-3 text-center">4s</th>
                    <th className="px-2 py-3 text-center">6s</th>
                    <th className="px-2 py-3 text-center">HS</th>
                    <th className="px-2 py-3 text-center">LS</th>
                    <th className="px-3 py-3 text-center">RR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamStats.map((row) => (
                    <tr key={row.teamId} className="hover:bg-cric-bg transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/teams/${row.teamId}`} className="flex items-center gap-2 font-bold text-cric-text hover:text-cric-accent">
                          <span className="w-7 h-7 rounded bg-white border border-cric-border flex items-center justify-center overflow-hidden">
                            {row.logo ? (
                              <img src={row.logo} alt="" className="w-5 h-5 object-contain" />
                            ) : (
                              <span className="text-[9px] font-bold text-cric-muted">{(row.name || "T").charAt(0)}</span>
                            )}
                          </span>
                          {row.name || "Team"}
                        </Link>
                      </td>
                      <td className="px-2 py-3 text-center">{row.played || 0}</td>
                      <td className="px-2 py-3 text-center text-green-600 font-bold">{row.won || 0}</td>
                      <td className="px-2 py-3 text-center text-red-600 font-bold">{row.lost || 0}</td>
                      <td className="px-2 py-3 text-center font-black text-blue-800">{row.runs ?? 0}</td>
                      <td className="px-2 py-3 text-center font-bold">{row.wickets ?? 0}</td>
                      <td className="px-2 py-3 text-center">{row.fours || 0}</td>
                      <td className="px-2 py-3 text-center">{row.sixes || 0}</td>
                      <td className="px-2 py-3 text-center">{row.highestTotalText ?? "-"}</td>
                      <td className="px-2 py-3 text-center">{row.lowestTotalText ?? "-"}</td>
                      <td className="px-3 py-3 text-center">{row.runRate ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-black text-cric-text uppercase tracking-tight flex items-center gap-2 mb-4">
          <span className="w-2 h-6 bg-purple-600 rounded-full" />
          Team Squads
        </h2>
        {squads.length === 0 ? (
          <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
            <p className="text-cric-muted font-bold">Squads not announced yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {squads.map((squad) => (
              <SquadCard key={squad.team?._id || squad._id || squad.name} squad={squad} />
            ))}
          </div>
        )}
      </div>

      {teamsWithoutSquad.length > 0 && (
        <div>
          <h2 className="text-lg font-black text-cric-text uppercase tracking-tight mb-4">Teams</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teamsWithoutSquad.map((team) => (
              <TeamTile key={team._id} team={team} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
