import React from "react";
import { Link } from "react-router-dom";

export default function LiveScoreCard({ match }) {
  return (
    <Link
      to={`/cricket/match/${match.id}`}
      className="block rounded-2xl border-2 border-red-500 bg-white p-5 shadow-sm transition hover:shadow-xl"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{match.matchType || "Match"}</p>
          <h3 className="mt-1 text-base font-black text-[#031d44]">{match.name}</h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Live
        </span>
      </div>

      <div className="space-y-2">
        {match.score.length ? match.score.map((score, index) => (
          <div key={`${score.team}-${index}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <div>
              <p className="text-sm font-black text-slate-800">{score.team || `Innings ${index + 1}`}</p>
              {score.inning && <p className="text-[10px] font-bold text-slate-400">{score.inning}</p>}
            </div>
            <p className="text-lg font-black tabular-nums text-slate-900">
              {score.runs}/{score.wickets} <span className="text-xs text-slate-500">({score.overs})</span>
            </p>
          </div>
        )) : (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-500">Score not available yet</p>
        )}
      </div>

      <p className="mt-4 text-xs font-semibold text-slate-500">{match.venue || "Venue TBA"}</p>
    </Link>
  );
}
