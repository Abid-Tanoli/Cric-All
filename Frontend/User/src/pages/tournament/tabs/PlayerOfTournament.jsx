import React, { useState } from "react";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// Player of the Tournament
// ---------------------------------------------------------------------------
// Renders the impact ranking computed by Backend/src/services/tournamentImpact.js.
// Every weight and the "How it's calculated" copy come from the API payload, so
// changing a constant on the server updates this card without a frontend edit.

const Breakdown = ({ row }) => {
  const items = [
    ["Batting", row.breakdown?.batting],
    ["Bowling", row.breakdown?.bowling],
    ["Fielding", row.breakdown?.fielding],
    ["Winning", row.breakdown?.winBonus],
    ["Player of the Match", row.breakdown?.manOfMatchBonus],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-cric-bg px-3 py-2">
          <div className="text-[9px] uppercase tracking-wide text-cric-muted font-bold">{label}</div>
          <div className={`text-sm font-black ${(value || 0) < 0 ? "text-red-600" : "text-cric-text"}`}>
            {value == null ? "—" : Number(value).toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
};

export default function PlayerOfTournament({ data }) {
  const [openId, setOpenId] = useState(null);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const leader = data?.leader || rows[0] || null;
  const explanation = Array.isArray(data?.explanation) ? data.explanation : [];

  return (
    <div className="bg-cric-card rounded-2xl shadow-sm overflow-hidden border border-cric-border">
      <div className="p-6 border-b border-cric-border bg-gradient-to-r from-amber-500 to-orange-600 text-white">
        <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <span className="text-2xl">🌟</span> Player of the Tournament
        </h3>
        <p className="text-xs text-white/80 mt-1">
          Impact ranking, not just runs or wickets · provisional until the Final is completed
        </p>
      </div>

      {!leader && (
        <div className="px-4 py-8 text-center text-cric-muted">
          The Player of the Tournament ranking appears once matches are completed.
        </div>
      )}

      {leader && (
        <div className="p-6 border-b border-cric-border bg-cric-bg/60">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {leader.imageUrl ? (
              <img
                src={leader.imageUrl}
                alt={leader.name}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-400 shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-amber-500/15 border-2 border-amber-400 flex items-center justify-center text-2xl font-black text-amber-700 shrink-0">
                {(leader.name || "?").charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Leader</div>
              {leader.playerId ? (
                <Link to={`/players/${leader.playerId}`} className="text-xl font-black text-cric-text hover:text-cric-accent">
                  {leader.name}
                </Link>
              ) : (
                <span className="text-xl font-black text-cric-text">{leader.name}</span>
              )}
              <div className="text-xs text-cric-muted">
                {leader.team}
                {leader.matches ? ` · ${leader.matches} matches` : ""}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-[10px] font-black uppercase tracking-widest text-cric-muted">Impact</div>
              <div className="text-3xl font-black text-amber-700">{leader.impact}</div>
            </div>
          </div>
          <div className="mt-4">
            <Breakdown row={leader} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-cric-bg text-cric-muted uppercase text-[11px] font-bold">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-4 py-3">Player</th>
                <th className="px-3 py-3 text-center" title="Matches played">M</th>
                <th className="px-3 py-3 text-center">Runs</th>
                <th className="px-3 py-3 text-center">Wkts</th>
                <th className="px-3 py-3 text-center">Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 10).map((row) => {
                const key = row.playerId || row.name;
                const open = openId === key;
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`hover:bg-cric-bg transition-colors cursor-pointer ${open ? "bg-cric-bg" : ""}`}
                      onClick={() => setOpenId(open ? null : key)}
                      aria-expanded={open}
                    >
                      <td className="px-3 py-3 font-bold text-cric-muted">{row.rank}</td>
                      <td className="px-4 py-3">
                        {row.playerId ? (
                          <Link
                            to={`/players/${row.playerId}`}
                            className="font-bold text-cric-text hover:text-cric-accent"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="font-bold text-cric-text">{row.name}</span>
                        )}
                        <div className="text-[10px] text-cric-muted">{row.team}</div>
                      </td>
                      <td className="px-3 py-3 text-center" title="Matches played">{row.matches || 0}</td>
                      <td className="px-3 py-3 text-center">{row.runs || 0}</td>
                      <td className="px-3 py-3 text-center">{row.wickets || 0}</td>
                      <td className="px-3 py-3 text-center font-black text-amber-700">{row.impact}</td>
                    </tr>
                    {open && (
                      <tr className="bg-cric-bg/70">
                        <td colSpan={6} className="px-4 py-3">
                          <Breakdown row={row} />
                          <div className="mt-2 text-[10px] text-cric-muted">
                            {row.innings ? `${row.innings} innings · ${row.runs} runs` : "No innings"}
                            {row.ballsBowled ? ` · ${row.oversText} overs · ${row.wickets} wickets` : ""}
                            {row.manOfMatchAwards ? ` · ${row.manOfMatchAwards}x Player of the Match` : ""}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {explanation.length > 0 && (
        <details className="border-t border-cric-border px-4 py-3">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-cric-muted">
            How it&apos;s calculated
          </summary>
          <ul className="mt-3 space-y-1 text-xs text-cric-muted list-disc pl-5">
            {explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-cric-muted/80">
            Tap any row in the top 10 to see its breakdown. Fielding is only counted where the scorecard records it.
          </p>
        </details>
      )}
    </div>
  );
}
