import React, { useEffect, useState } from "react";
import { api } from "../services/api";

// Task 5: this is no longer a standalone page that guesses "the first
// tournament". It only renders the standings for the tournament (or event) it
// is given, so a points table always belongs to the competition being viewed.

const formLetter = (value) => {
  const ch = String(value || "").toUpperCase();
  if (ch === "W") return "W";
  if (ch === "L") return "L";
  if (ch === "T" || ch === "D") return "T";
  return "NR";
};

const formClass = (letter) => {
  if (letter === "W") return "bg-green-500";
  if (letter === "L") return "bg-red-500";
  if (letter === "T") return "bg-slate-400";
  return "bg-amber-500";
};

const normalizeForm = (seriesForm) => {
  if (Array.isArray(seriesForm)) return seriesForm;
  if (typeof seriesForm === "string") return seriesForm.split("").filter(Boolean);
  return [];
};

export default function PointsTable({ tournamentId, eventId, title = "Standings" }) {
  const [table, setTable] = useState([]);
  const [loading, setLoading] = useState(Boolean(tournamentId || eventId));

  useEffect(() => {
    let cancelled = false;

    if (!tournamentId && !eventId) {
      setTable([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const load = async () => {
      try {
        let rows;
        if (tournamentId) {
          const res = await api.get(`/tournaments/${tournamentId}/points-table`);
          rows = res.data;
        } else {
          const res = await api.get(`/events/${eventId}`);
          rows = res.data?.pointsTable || [];
        }
        if (!cancelled) setTable(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setTable([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [tournamentId, eventId]);

  const sorted = [...table].sort(
    (a, b) => (b.points || 0) - (a.points || 0) || (b.netRunRate || 0) - (a.netRunRate || 0)
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        <p className="text-xs font-black uppercase tracking-widest text-cric-muted">Fetching Standings...</p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="py-12 text-center">
        <h4 className="mb-2 text-lg font-black text-cric-accent">No Points Table Available</h4>
        <p className="text-xs text-cric-muted">
          Standings appear once matches begin for this competition.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-4 text-lg font-black uppercase tracking-tight text-cric-accent">{title}</h3>
      <div className="overflow-hidden overflow-x-auto rounded-2xl border border-cric-border bg-cric-card">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="bg-cric-accent text-white">
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest">Pos</th>
              <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest">Team</th>
              <th className="px-4 py-5 text-center text-[10px] font-black uppercase tracking-widest">M</th>
              <th className="px-4 py-5 text-center text-[10px] font-black uppercase tracking-widest text-green-300">W</th>
              <th className="px-4 py-5 text-center text-[10px] font-black uppercase tracking-widest text-red-300">L</th>
              <th className="px-4 py-5 text-center text-[10px] font-black uppercase tracking-widest">T/NR</th>
              <th className="px-4 py-5 text-center text-[10px] font-black uppercase tracking-widest">NRR</th>
              <th className="px-6 py-5 text-center text-[10px] font-black uppercase tracking-widest">PTS</th>
              <th className="px-4 py-5 text-[10px] font-black uppercase tracking-widest">Form</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cric-bg">
            {sorted.map((row, index) => {
              const form = normalizeForm(row.seriesForm);
              return (
                <tr key={row._id || row.team?._id || index} className="transition-colors hover:bg-cric-bg">
                  <td className="px-6 py-5 text-lg font-black text-cric-muted">{index + 1}</td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cric-border bg-cric-bg p-2">
                        {row.team?.logo ? (
                          <img src={row.team.logo} alt="" className="h-full w-full object-contain" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center rounded-lg bg-cric-accent text-xs font-black text-white">
                            {row.team?.name?.charAt(0) || "T"}
                          </div>
                        )}
                      </div>
                      <span className="font-bold text-cric-text">{row.team?.name || "Team"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-5 text-center font-bold text-cric-muted">{row.matchesPlayed || 0}</td>
                  <td className="px-4 py-5 text-center font-bold text-green-600">{row.won || 0}</td>
                  <td className="px-4 py-5 text-center font-bold text-red-600">{row.lost || 0}</td>
                  <td className="px-4 py-5 text-center font-bold text-cric-muted">
                    {(row.tied || 0) + (row.noResult || 0)}
                  </td>
                  <td className="px-4 py-5 text-center font-bold text-cric-accent">
                    {Number(row.netRunRate || 0).toFixed(3)}
                  </td>
                  <td className="px-6 py-5 text-center text-2xl font-black text-cric-accent">{row.points || 0}</td>
                  <td className="px-4 py-5">
                    {form.length ? (
                      <div className="flex gap-1">
                        {form.map((result, i) => {
                          const letter = formLetter(result);
                          return (
                            <span
                              key={i}
                              className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white ${formClass(letter)}`}
                            >
                              {letter}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-cric-muted">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-2xl border border-cric-border bg-cric-card p-4">
        <p className="text-xs font-bold text-cric-accent">Qualification Rules</p>
        <p className="mt-1 text-xs text-cric-accent">
          Top 4 teams qualify for playoffs. When points are tied, Net Run Rate (NRR) is the primary tie-breaker.
        </p>
      </div>
    </div>
  );
}
