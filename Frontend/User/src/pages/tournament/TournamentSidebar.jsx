import React from "react";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// Tournament hub right sidebar
// ---------------------------------------------------------------------------
//
// Shown on Home / Fixtures / Table / Stats / Teams. Reads from the two already
// loaded payloads — the existing points table (via GET /tournaments/:id/standings)
// and the shared stats service (via GET /tournaments/:id/stats) — so it never
// computes a second, possibly divergent, set of numbers.
//
// Fixed, documented order and sizes:
//   1. Mini points table — top 8 (or the knockout bracket when there are no
//      points rows, because a pure knockout has no league table)
//   2. Top Wicket Takers  — top 3
//   3. Top Run Scorers    — top 3

export const MINI_TABLE_SIZE = 8;
export const LEADER_SIZE = 3;
export const SIDEBAR_BRACKET_STAGES = 3;

function TeamRow({ row, index }) {
  const team = row.team || {};
  return (
    <Link
      to={`/teams/${team._id}`}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-cric-bg transition-colors"
    >
      <span className="w-4 text-[10px] font-bold text-cric-muted">{index + 1}</span>
      <span className="w-5 h-5 rounded bg-white border border-cric-border flex items-center justify-center overflow-hidden shrink-0">
        {team.logo ? (
          <img src={team.logo} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="text-[8px] font-bold text-cric-muted">{team.shortName || team.name?.charAt(0) || "T"}</span>
        )}
      </span>
      <span className="flex-1 truncate text-xs font-bold text-cric-text">{team.name || team.shortName || "Team"}</span>
      <span className="text-[10px] text-cric-muted font-bold">{row.matchesPlayed || 0}M</span>
      <span className="w-6 text-right text-xs font-black text-cric-accent">{row.points || 0}</span>
    </Link>
  );
}

function LeaderRow({ player, index, metric, value }) {
  const name = player?.name || "Unknown";
  const id = player?.playerId || player?._id;
  return (
    <Link
      to={id ? `/players/${id}` : "#"}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-cric-bg transition-colors"
    >
      <span className="w-4 text-[10px] font-bold text-cric-muted">{index + 1}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-xs font-bold text-cric-text">{name}</span>
        <span className="block truncate text-[10px] text-cric-muted">{player?.team || ""}</span>
      </span>
      <span className="text-xs font-black text-cric-text">
        {value} <span className="text-[9px] font-bold text-cric-muted uppercase">{metric}</span>
      </span>
    </Link>
  );
}

function BracketMatchRow({ match }) {
  if (match?.placeholder) {
    return (
      <div className="px-2 py-1.5 rounded-lg bg-cric-bg/50">
        <span className="block truncate text-[11px] font-bold text-cric-muted">{match.label || "TBD"}</span>
        <span className="block text-[9px] text-cric-muted/70">Awaiting previous round</span>
      </div>
    );
  }

  const teams = match?.teams || [];
  return (
    <Link
      to={match?.matchId ? `/match/${match.matchId}` : "#"}
      className="block px-2 py-1.5 rounded-lg hover:bg-cric-bg transition-colors"
    >
      <span className="block truncate text-[11px] font-bold text-cric-text">
        {teams.map((team) => `${team.isWinner ? "✓ " : ""}${team.shortName || team.name}`).join(" vs ") || "TBD"}
      </span>
      <span className="block truncate text-[9px] text-cric-muted">
        {match?.result?.description ||
          teams.map((team) => (team.score ? team.score.text : "-")).join(" - ")}
      </span>
    </Link>
  );
}

function BracketPreview({ bracket }) {
  const stages = (bracket?.stages || [])
    .filter((stage) => (stage.matches || []).length > 0)
    .slice(-SIDEBAR_BRACKET_STAGES);

  return (
    <div className="p-2 space-y-2">
      {stages.map((stage) => (
        <div key={stage.stage}>
          <p className="px-2 pb-1 text-[9px] font-black uppercase tracking-widest text-cric-muted">{stage.label}</p>
          <div className="space-y-0.5">
            {(stage.matches || []).map((match, index) => (
              <BracketMatchRow key={match.matchId || `${stage.stage}-${index}`} match={match} />
            ))}
          </div>
        </div>
      ))}
      {bracket?.champion?._id && (
        <Link
          to={`/teams/${bracket.champion._id}`}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 transition-colors"
        >
          <span className="text-[9px] font-black uppercase tracking-widest text-green-800">Champion</span>
          <span className="flex-1 truncate text-xs font-bold text-cric-text">
            {bracket.champion.name || bracket.champion.shortName}
          </span>
        </Link>
      )}
    </div>
  );
}

export default function TournamentSidebar({ standings = [], bracket = null, stats = null }) {
  const miniTable = [...standings].slice(0, MINI_TABLE_SIZE);
  const hasBracket = Boolean(bracket?.isKnockout);
  const showBracket = hasBracket && miniTable.length === 0;
  const wicketTakers = (stats?.topWicketTakers || []).slice(0, LEADER_SIZE);
  const runScorers = (stats?.topRunScorers || []).slice(0, LEADER_SIZE);

  return (
    <aside className="space-y-4" data-testid="tournament-sidebar">
      <section className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden" data-testid="sidebar-table">
        <h3 className="px-4 py-3 border-b border-cric-border text-xs font-black uppercase tracking-widest text-cric-muted">
          {showBracket ? "Knockout" : "Points Table"}
        </h3>
        {showBracket ? (
          <BracketPreview bracket={bracket} />
        ) : miniTable.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-cric-muted">No standings yet</p>
        ) : (
          <div className="p-2 space-y-0.5">
            {miniTable.map((row, index) => (
              <TeamRow key={row.team?._id || index} row={row} index={index} />
            ))}
          </div>
        )}
      </section>

      <section className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden" data-testid="sidebar-wickets">
        <h3 className="px-4 py-3 border-b border-cric-border text-xs font-black uppercase tracking-widest text-cric-muted">
          Top Wicket Takers
        </h3>
        {wicketTakers.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-cric-muted">No bowling stats yet</p>
        ) : (
          <div className="p-2 space-y-0.5">
            {wicketTakers.map((player, index) => (
              <LeaderRow key={player.playerId || index} player={player} index={index} metric="wkts" value={player.wickets || 0} />
            ))}
          </div>
        )}
      </section>

      <section className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden" data-testid="sidebar-runs">
        <h3 className="px-4 py-3 border-b border-cric-border text-xs font-black uppercase tracking-widest text-cric-muted">
          Top Run Scorers
        </h3>
        {runScorers.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-cric-muted">No batting stats yet</p>
        ) : (
          <div className="p-2 space-y-0.5">
            {runScorers.map((player, index) => (
              <LeaderRow key={player.playerId || index} player={player} index={index} metric="runs" value={player.runs || 0} />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
