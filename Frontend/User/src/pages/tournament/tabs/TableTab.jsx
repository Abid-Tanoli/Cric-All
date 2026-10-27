import React from "react";
import { Link } from "react-router-dom";

function FormPill({ value }) {
  const tone =
    value === "W" ? "bg-green-500" : value === "L" ? "bg-red-500" : value === "T" ? "bg-amber-500" : "bg-slate-400";
  return <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${tone}`}>{value}</span>;
}

function StatusLabel({ status }) {
  const label = String(status || "upcoming").replace(/_/g, " ");
  const tone =
    status === "completed"
      ? "bg-green-100 text-green-800"
      : status === "live" || status === "innings_break" || status === "toss_done"
        ? "bg-red-100 text-red-700"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

function BracketTeam({ team }) {
  if (!team) return null;
  const name = team.shortName || team.name || "TBD";
  return (
    <div className={`flex items-center gap-2 px-3 py-2 ${team.isWinner ? "bg-green-50" : ""}`}>
      <span className="w-6 h-6 rounded bg-white border border-cric-border flex items-center justify-center overflow-hidden shrink-0">
        {team.logo ? (
          <img src={team.logo} alt="" className="w-5 h-5 object-contain" />
        ) : (
          <span className="text-[9px] font-bold text-cric-muted">{name.charAt(0)}</span>
        )}
      </span>
      <span className={`flex-1 truncate text-sm ${team.isWinner ? "font-black text-cric-text" : "font-semibold text-cric-text/80"}`}>
        {name}
        {team.isWinner && <span className="ml-1 text-[10px] font-black text-green-700">W</span>}
      </span>
      <span className="text-xs font-bold text-cric-muted tabular-nums">
        {team.score ? `${team.score.runs}/${team.score.wickets}` : "-"}
      </span>
    </div>
  );
}

function BracketMatch({ match }) {
  if (match.placeholder) {
    return (
      <div className="border border-dashed border-cric-border rounded-xl p-4 text-center bg-cric-bg/40">
        <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">{match.label || "TBD"}</p>
        <p className="text-[10px] text-cric-muted/60 mt-1">Awaiting previous round</p>
      </div>
    );
  }

  const teams = match.teams || [];
  return (
    <Link
      to={`/match/${match.matchId}`}
      className="block border border-cric-border rounded-xl overflow-hidden bg-cric-card hover:shadow-md hover:border-cric-accent/40 transition-all"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-cric-border bg-cric-bg/60">
        <span className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
          {match.stageLabel || "Match"}
        </span>
        <StatusLabel status={match.status} />
      </div>
      <div className="divide-y divide-cric-border">
        {teams.length ? (
          teams.map((team, index) => <BracketTeam key={team._id || index} team={team} />)
        ) : (
          <>
            <div className="px-3 py-2 text-sm font-semibold text-cric-muted">TBD</div>
            <div className="px-3 py-2 text-sm font-semibold text-cric-muted">TBD</div>
          </>
        )}
      </div>
      {(match.result?.description || match.startAt) && (
        <div className="px-3 py-2 border-t border-cric-border bg-cric-bg/30">
          <p className="text-[11px] font-bold text-cric-text/80 line-clamp-2">
            {match.result?.description || new Date(match.startAt).toLocaleString()}
          </p>
        </div>
      )}
    </Link>
  );
}

function Bracket({ bracket, tournament }) {
  const stages = (bracket?.stages || []).filter((stage) => (stage.matches || []).length > 0);
  if (!stages.length) {
    return (
      <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
        <p className="text-cric-muted font-bold text-lg mb-2">Bracket Not Available</p>
        <p className="text-sm text-cric-muted/60">The knockout draw will appear when fixtures are created.</p>
      </div>
    );
  }

  return (
    <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
      <div className="p-6 border-b border-cric-border bg-gradient-to-r from-cric-text to-slate-800 text-white">
        <h3 className="text-xl font-black uppercase tracking-tight">Knockout Bracket</h3>
        <p className="text-xs text-white/60 mt-1">{tournament?.name}</p>
      </div>
      <div className="p-4 sm:p-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stages.map((stage) => (
          <section key={stage.stage} className="min-w-0">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-cric-muted mb-3">{stage.label}</h4>
            <div className="space-y-3">
              {(stage.matches || []).map((match, index) => (
                <BracketMatch key={match.matchId || `placeholder-${stage.stage}-${index}`} match={match} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {bracket?.champion?._id && (
        <div className="px-4 sm:px-6 py-4 border-t border-cric-border bg-green-50 flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-green-800">Champion</span>
          <Link to={`/teams/${bracket.champion._id}`} className="font-black text-cric-text hover:text-cric-accent">
            {bracket.champion.name || bracket.champion.shortName}
          </Link>
        </div>
      )}
    </div>
  );
}

export default function TableTab({ standings = [], bracket = null, tournament }) {
  const hasBracket = Boolean(bracket?.isKnockout);
  const hasPoints = standings.length > 0;

  if (!hasBracket && !hasPoints) {
    return (
      <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
        <p className="text-cric-muted font-bold text-lg mb-2">Points Table Not Available</p>
        <p className="text-sm text-cric-muted/60">Standings will appear after matches are played.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasBracket && <Bracket bracket={bracket} tournament={tournament} />}

      {hasPoints && (
        <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
          <div className="p-6 border-b border-cric-border bg-gradient-to-r from-cric-text to-slate-800 text-white">
            <h3 className="text-xl font-black uppercase tracking-tight">Points Table</h3>
            <p className="text-xs text-white/60 mt-1">{tournament?.name}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-cric-bg text-cric-muted uppercase text-[11px] font-bold">
                <tr>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">Team</th>
                  <th className="px-2 py-3 text-center">M</th>
                  <th className="px-2 py-3 text-center">W</th>
                  <th className="px-2 py-3 text-center">L</th>
                  <th className="px-2 py-3 text-center">T/NR</th>
                  <th className="px-4 py-3 text-center">NRR</th>
                  <th className="px-4 py-3 text-center bg-cric-card text-blue-800">PTS</th>
                  <th className="px-4 py-3">Form</th>
                  <th className="px-4 py-3">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {standings.map((entry, idx) => (
                  <tr key={entry.team?._id || idx} className={idx < 4 ? "bg-green-50/30" : "hover:bg-cric-bg"}>
                    <td className="px-4 py-4 font-bold text-cric-muted">{idx + 1}</td>
                    <td className="px-4 py-4">
                      <Link to={`/teams/${entry.team?._id}`} className="flex items-center gap-3 hover:text-cric-accent">
                        <span className="w-8 h-8 rounded bg-white border border-cric-border flex items-center justify-center overflow-hidden">
                          {entry.team?.logo ? (
                            <img src={entry.team.logo} alt="" className="w-6 h-6 object-contain" />
                          ) : (
                            <span className="text-[10px] font-bold">{entry.team?.shortName || "T"}</span>
                          )}
                        </span>
                        <span className="font-bold text-cric-text">{entry.team?.name || entry.team?.shortName}</span>
                      </Link>
                    </td>
                    <td className="px-2 py-4 text-center font-medium">{entry.matchesPlayed || 0}</td>
                    <td className="px-2 py-4 text-center text-green-600 font-bold">{entry.won || 0}</td>
                    <td className="px-2 py-4 text-center text-red-600 font-bold">{entry.lost || 0}</td>
                    <td className="px-2 py-4 text-center text-cric-muted font-medium">
                      {(entry.tied || 0) + (entry.noResult || 0)}
                    </td>
                    <td className="px-4 py-4 text-center font-bold text-cric-accent">
                      {Number(entry.netRunRate || 0).toFixed(3)}
                    </td>
                    <td className="px-4 py-4 text-center font-black bg-cric-card text-blue-900 text-lg">{entry.points || 0}</td>
                    <td className="px-4 py-4">
                      <div className="flex gap-1">
                        {(entry.form || []).map((f, i) => (
                          <FormPill key={i} value={f} />
                        ))}
                        {(!entry.form || entry.form.length === 0) && <span className="text-xs text-slate-300">-</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-cric-muted">
                      {entry.next ? (
                        <Link to={`/match/${entry.next.matchId}`} className="font-bold text-cric-text hover:text-cric-accent">
                          vs {entry.next.opponent}
                          <span className="block text-[10px] font-normal">
                            {entry.next.startAt ? new Date(entry.next.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
