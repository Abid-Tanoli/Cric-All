import React from "react";
import { Link } from "react-router-dom";

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

export default function TeamsTab({ teams = [], squads = [] }) {
  const squadTeamIds = new Set(squads.map((s) => String(s.team?._id || s.team)));
  const teamsWithoutSquad = teams.filter((team) => !squadTeamIds.has(String(team?._id)));

  return (
    <div className="space-y-8">
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
