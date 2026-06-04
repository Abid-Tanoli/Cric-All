import React from "react";

const valueOf = (value, fallback = "-") => value ?? fallback;

export default function ScorecardTable({ scorecard = [] }) {
  if (!scorecard.length) {
    return <p className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-500 ring-1 ring-slate-200">Scorecard is not available yet.</p>;
  }

  return (
    <div className="space-y-5">
      {scorecard.map((innings, index) => {
        const batting = innings.batting || innings.batsmen || [];
        const bowling = innings.bowling || innings.bowlers || [];
        const extras = innings.extras || {};
        const totals = innings.totals || innings.total || {};

        return (
          <section key={innings.inning || index} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="bg-[#031d44] px-4 py-3 text-white">
              <h3 className="text-base font-black">{innings.inning || innings.team || `Innings ${index + 1}`}</h3>
              <p className="text-xs font-bold text-blue-200">
                {valueOf(totals.R || totals.runs || innings.runs, 0)}/{valueOf(totals.W || totals.wickets || innings.wickets, 0)}
                {totals.O || innings.overs ? ` (${totals.O || innings.overs} ov)` : ""}
              </p>
            </div>

            <TableTitle title="Batting" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Batter</th>
                    <th className="px-4 py-3 text-left">How Out</th>
                    <th className="px-2 py-3 text-right">R</th>
                    <th className="px-2 py-3 text-right">B</th>
                    <th className="px-2 py-3 text-right">4s</th>
                    <th className="px-2 py-3 text-right">6s</th>
                    <th className="px-4 py-3 text-right">SR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batting.map((row, rowIndex) => (
                    <tr key={row.name || row.batsman?.name || rowIndex}>
                      <td className="px-4 py-3 font-black text-slate-900">{row.name || row.batsman?.name || "Batter"}</td>
                      <td className="px-4 py-3 text-slate-500">{row["dismissal"] || row.howOut || row.outDesc || "not out"}</td>
                      <td className="px-2 py-3 text-right font-black">{valueOf(row.r || row.runs, 0)}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row.b || row.balls, 0)}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row["4s"] || row.fours, 0)}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row["6s"] || row.sixes, 0)}</td>
                      <td className="px-4 py-3 text-right">{valueOf(row.sr || row.strikeRate, "0.00")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              Extras: {typeof extras === "object" ? Object.entries(extras).map(([key, value]) => `${key}: ${value}`).join(", ") || "0" : extras || "0"}
            </div>

            <TableTitle title="Bowling" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Bowler</th>
                    <th className="px-2 py-3 text-right">O</th>
                    <th className="px-2 py-3 text-right">M</th>
                    <th className="px-2 py-3 text-right">R</th>
                    <th className="px-2 py-3 text-right">W</th>
                    <th className="px-2 py-3 text-right">Econ</th>
                    <th className="px-2 py-3 text-right">WD</th>
                    <th className="px-4 py-3 text-right">NB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bowling.map((row, rowIndex) => (
                    <tr key={row.name || row.bowler?.name || rowIndex}>
                      <td className="px-4 py-3 font-black text-slate-900">{row.name || row.bowler?.name || "Bowler"}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row.o || row.overs, "0")}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row.m || row.maidens, 0)}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row.r || row.runs, 0)}</td>
                      <td className="px-2 py-3 text-right font-black">{valueOf(row.w || row.wickets, 0)}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row.eco || row.economy, "0.00")}</td>
                      <td className="px-2 py-3 text-right">{valueOf(row.wd || row.wides, 0)}</td>
                      <td className="px-4 py-3 text-right">{valueOf(row.nb || row.noBalls, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TableTitle({ title }) {
  return <h4 className="border-t border-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</h4>;
}
