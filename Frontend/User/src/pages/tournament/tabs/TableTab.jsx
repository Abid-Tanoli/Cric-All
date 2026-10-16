import React from "react";
import { Link } from "react-router-dom";

function FormPill({ value }) {
  const tone =
    value === "W" ? "bg-green-500" : value === "L" ? "bg-red-500" : value === "T" ? "bg-amber-500" : "bg-slate-400";
  return <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${tone}`}>{value}</span>;
}

export default function TableTab({ standings = [], tournament }) {
  if (!standings.length) {
    return (
      <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
        <p className="text-cric-muted font-bold text-lg mb-2">Points Table Not Available</p>
        <p className="text-sm text-cric-muted/60">Standings will appear after matches are played.</p>
      </div>
    );
  }

  return (
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
  );
}
