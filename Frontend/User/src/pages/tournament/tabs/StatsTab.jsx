import React from "react";
import { Link } from "react-router-dom";
import BoundaryMeter from "../../../components/BoundaryMeter";
import PlayerOfTournament from "./PlayerOfTournament";

function PlayerCell({ row }) {
  const id = row.playerId || row._id;
  const teams = Array.isArray(row.teamsPlayedFor) ? row.teamsPlayedFor : [];
  const others = teams.slice(1).map((team) => team.name).filter(Boolean);
  return (
    <td className="px-4 py-3">
      {id ? (
        <Link to={`/players/${id}`} className="font-bold text-cric-text hover:text-cric-accent">
          {row.name}
        </Link>
      ) : (
        <span className="font-bold text-cric-text">{row.name}</span>
      )}
      <div className="text-[10px] text-cric-muted">
        {row.team}
        {teams.length > 1 && (
          <span className="ml-1 font-black uppercase text-cric-accent" title={`Most recent match team; also played for ${others.join(", ")}`}>
            (latest)
          </span>
        )}
      </div>
      {others.length > 0 && (
        <div className="text-[9px] text-cric-muted/80">Also: {others.join(", ")}</div>
      )}
    </td>
  );
}

function Section({ title, icon, color, columns, rows, render, empty }) {
  return (
    <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
      <div className={`p-6 border-b border-cric-border bg-gradient-to-r ${color} text-white`}>
        <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <span className="text-2xl">{icon}</span> {title}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-cric-bg text-cric-muted uppercase text-[11px] font-bold">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Player</th>
              {columns.map((c) => (
                <th key={c} className="px-4 py-3 text-center">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rows || []).map((row, idx) => (
              <tr key={`${row.playerId || row._id || idx}-${idx}`} className="hover:bg-cric-bg transition-colors">
                <td className="px-4 py-3 font-bold text-cric-muted">{idx + 1}</td>
                <PlayerCell row={row} />
                {render(row)}
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-cric-muted">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StatsTab({ stats = {} }) {
  const boundaryMeter = stats.boundaryMeter || { sixes: 0, fours: 0, mostSixes: [], mostFours: [] };
  const empty = stats.empty === true && !stats.topRunScorers?.length && !stats.topWicketTakers?.length;
  const hasDiscipline =
    (stats.topWicketTakers || []).some((row) => (row.wides || 0) > 0 || (row.noBalls || 0) > 0) ||
    (stats.totalWides || 0) > 0 ||
    (stats.totalNoBalls || 0) > 0;

  return (
    <div className="space-y-8">
      <PlayerOfTournament data={stats.playerOfTournament} />

      {!empty && <BoundaryMeter stats={boundaryMeter} />}

      {empty && (
        <div className="bg-cric-card rounded-2xl shadow-sm p-8 text-center border border-cric-border">
          <p className="text-cric-muted font-bold">Stats will be available after matches are played.</p>
        </div>
      )}

      <Section
        title="Most Runs"
        icon="🏏"
        color="from-blue-600 to-blue-700"
        columns={["Mat", "Inn", "NO", "Runs", "HS", "Avg", "SR", "50s", "100s", "4s", "6s"]}
        rows={stats.topRunScorers}
        empty="No batting stats available yet"
        render={(s) => (
          <>
            <td className="px-4 py-3 text-center" title="Matches played">{s.matches || 0}</td>
            <td className="px-4 py-3 text-center">{s.innings || 0}</td>
            <td className="px-4 py-3 text-center">{s.notOuts || 0}</td>
            <td className="px-4 py-3 text-center font-black text-blue-800 bg-cric-card/50">{s.runs || 0}</td>
            <td className="px-4 py-3 text-center font-bold">{s.highestText ?? s.highest}</td>
            <td className="px-4 py-3 text-center">{s.average ?? "-"}</td>
            <td className="px-4 py-3 text-center">{s.strikeRate ?? "-"}</td>
            <td className="px-4 py-3 text-center">{s.fifties || 0}</td>
            <td className="px-4 py-3 text-center">{s.hundreds || 0}</td>
            <td className="px-4 py-3 text-center">{s.fours || 0}</td>
            <td className="px-4 py-3 text-center">{s.sixes || 0}</td>
          </>
        )}
      />

      <Section
        title="Most Wickets"
        icon="⚾"
        color="from-green-600 to-green-700"
        columns={["Mat", "Ov", "Wkts", "BBI", "Avg", "Econ", "4W", "5W", ...(hasDiscipline ? ["Wd", "NB"] : [])]}
        rows={stats.topWicketTakers}
        empty="No bowling stats available yet"
        render={(s) => (
          <>
            <td className="px-4 py-3 text-center" title="Matches played">{s.matches || 0}</td>
            <td className="px-4 py-3 text-center">{s.oversText ?? "-"}</td>
            <td className="px-4 py-3 text-center font-black text-green-800 bg-green-50/50">{s.wickets || 0}</td>
            <td className="px-4 py-3 text-center font-bold">{s.bestFigures || "-"}</td>
            <td className="px-4 py-3 text-center">{s.average ?? "-"}</td>
            <td className="px-4 py-3 text-center">{s.economy ?? "-"}</td>
            <td className="px-4 py-3 text-center">{s.fourWickets || 0}</td>
            <td className="px-4 py-3 text-center">{s.fiveWickets || 0}</td>
            {hasDiscipline && <td className="px-4 py-3 text-center">{s.wides || 0}</td>}
            {hasDiscipline && <td className="px-4 py-3 text-center">{s.noBalls || 0}</td>}
          </>
        )}
      />

      <Section
        title="Fielding & Keeping"
        icon="🧤"
        color="from-orange-600 to-amber-700"
        columns={["Mat", "Catches", "Stumpings", "Run Outs", "Total"]}
        rows={stats.topFielders}
        empty="No fielding stats available yet"
        render={(s) => (
          <>
            <td className="px-4 py-3 text-center">{s.matches || 0}</td>
            <td className="px-4 py-3 text-center font-black text-orange-800">{s.catches || 0}</td>
            <td className="px-4 py-3 text-center">{s.stumpings || 0}</td>
            <td className="px-4 py-3 text-center">{s.runOuts || 0}</td>
            <td className="px-4 py-3 text-center font-black">{s.total || 0}</td>
          </>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Highest Scores"
          icon="🚀"
          color="from-purple-600 to-purple-700"
          columns={["Mat", "Runs", "Balls", "4s", "6s"]}
          rows={(stats.highestScores || []).slice(0, 10)}
          empty="No innings recorded yet"
          render={(s) => (
            <>
              <td className="px-4 py-3 text-center" title="Matches played">{s.matches || 0}</td>
              <td className="px-4 py-3 text-center font-black">{s.runs}{s.notOut ? "*" : ""}</td>
              <td className="px-4 py-3 text-center">{s.balls || 0}</td>
              <td className="px-4 py-3 text-center">{s.fours || 0}</td>
              <td className="px-4 py-3 text-center">{s.sixes || 0}</td>
            </>
          )}
        />
        <Section
          title="Best Bowling"
          icon="🎯"
          color="from-teal-600 to-teal-700"
          columns={["Mat", "Figures", "Runs", "Overs"]}
          rows={(stats.bestBowling || []).slice(0, 10)}
          empty="No spells recorded yet"
          render={(s) => (
            <>
              <td className="px-4 py-3 text-center" title="Matches played">{s.matches || 0}</td>
              <td className="px-4 py-3 text-center font-black">{s.figures}</td>
              <td className="px-4 py-3 text-center">{s.runs || 0}</td>
              <td className="px-4 py-3 text-center">{Math.floor((s.balls || 0) / 6)}.{s.balls % 6}</td>
            </>
          )}
        />
        <Section
          title="Best Strike Rate"
          icon="⚡"
          color="from-indigo-600 to-indigo-700"
          columns={["Mat", "SR", "Runs", "Balls"]}
          rows={stats.bestStrikeRates}
          empty="No qualified batting yet"
          render={(s) => (
            <>
              <td className="px-4 py-3 text-center" title="Matches played">{s.matches || 0}</td>
              <td className="px-4 py-3 text-center font-black">{s.strikeRate}</td>
              <td className="px-4 py-3 text-center">{s.runs || 0}</td>
              <td className="px-4 py-3 text-center">{s.balls || 0}</td>
            </>
          )}
        />
        <Section
          title="Best Economy"
          icon="🧊"
          color="from-cyan-600 to-cyan-700"
          columns={["Mat", "Econ", "Overs", "Wkts"]}
          rows={stats.bestEconomy}
          empty="No qualified bowling yet"
          render={(s) => (
            <>
              <td className="px-4 py-3 text-center" title="Matches played">{s.matches || 0}</td>
              <td className="px-4 py-3 text-center font-black">{s.economy}</td>
              <td className="px-4 py-3 text-center">{s.oversText ?? "-"}</td>
              <td className="px-4 py-3 text-center">{s.wickets || 0}</td>
            </>
          )}
        />
      </div>

      {(stats.teamStats || []).length > 0 && (
        <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
          <div className="p-6 border-b border-cric-border bg-gradient-to-r from-slate-700 to-slate-900 text-white">
            <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <span className="text-2xl">🏆</span> Team Stats
            </h3>
            <p className="text-xs text-white/60 mt-1">Completed matches only</p>
          </div>
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
                {stats.teamStats.map((row) => (
                  <tr key={row.teamId} className="hover:bg-cric-bg transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/teams/${row.teamId}`} className="font-bold text-cric-text hover:text-cric-accent">
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
      )}
    </div>
  );
}
