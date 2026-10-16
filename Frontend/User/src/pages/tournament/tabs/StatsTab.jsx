import React from "react";
import { Link } from "react-router-dom";
import BoundaryMeter from "../../../components/BoundaryMeter";

function PlayerCell({ row }) {
  const id = row.playerId || row._id;
  return (
    <td className="px-4 py-3">
      {id ? (
        <Link to={`/players/${id}`} className="font-bold text-cric-text hover:text-cric-accent">
          {row.name}
        </Link>
      ) : (
        <span className="font-bold text-cric-text">{row.name}</span>
      )}
      <div className="text-[10px] text-cric-muted">{row.team}</div>
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

  return (
    <div className="space-y-8">
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
        columns={["Mat", "Ov", "Wkts", "BBI", "Avg", "Econ", "4W", "5W"]}
        rows={stats.topWicketTakers}
        empty="No bowling stats available yet"
        render={(s) => (
          <>
            <td className="px-4 py-3 text-center">{s.innings || 0}</td>
            <td className="px-4 py-3 text-center">{s.oversText ?? "-"}</td>
            <td className="px-4 py-3 text-center font-black text-green-800 bg-green-50/50">{s.wickets || 0}</td>
            <td className="px-4 py-3 text-center font-bold">{s.bestFigures || "-"}</td>
            <td className="px-4 py-3 text-center">{s.average ?? "-"}</td>
            <td className="px-4 py-3 text-center">{s.economy ?? "-"}</td>
            <td className="px-4 py-3 text-center">{s.fourWickets || 0}</td>
            <td className="px-4 py-3 text-center">{s.fiveWickets || 0}</td>
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
          columns={["Runs", "Balls", "4s", "6s"]}
          rows={(stats.highestScores || []).slice(0, 10)}
          empty="No innings recorded yet"
          render={(s) => (
            <>
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
          columns={["Figures", "Runs", "Overs"]}
          rows={(stats.bestBowling || []).slice(0, 10)}
          empty="No spells recorded yet"
          render={(s) => (
            <>
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
          columns={["SR", "Runs", "Balls"]}
          rows={stats.bestStrikeRates}
          empty="No qualified batting yet"
          render={(s) => (
            <>
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
          columns={["Econ", "Overs", "Wkts"]}
          rows={stats.bestEconomy}
          empty="No qualified bowling yet"
          render={(s) => (
            <>
              <td className="px-4 py-3 text-center font-black">{s.economy}</td>
              <td className="px-4 py-3 text-center">{s.oversText ?? "-"}</td>
              <td className="px-4 py-3 text-center">{s.wickets || 0}</td>
            </>
          )}
        />
      </div>
    </div>
  );
}
