import React from "react";
import { Link } from "react-router-dom";

const statusStyles = {
  live: "bg-red-600 text-white",
  completed: "bg-green-100 text-green-700",
  upcoming: "bg-blue-100 text-blue-700",
};

const formatDate = (value) => value ? new Date(value).toLocaleString(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}) : "TBC";

export default function MatchCard({ match }) {
  const status = match.matchEnded ? "completed" : match.matchStarted ? "live" : match.status || "upcoming";

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{match.matchType || "Match"}</p>
          <h3 className="mt-1 text-base font-black text-[#031d44]">{match.name}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(match.dateTimeGMT || match.date)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${statusStyles[status] || statusStyles.upcoming}`}>
          {status}
        </span>
      </div>

      <p className="mt-3 text-xs font-semibold text-slate-500">{match.venue || "Venue TBA"}</p>

      {match.score.length > 0 && (
        <div className="mt-4 space-y-2">
          {match.score.map((score, index) => (
            <div key={`${score.team}-${index}`} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-sm font-black text-slate-700">{score.team || `Innings ${index + 1}`}</span>
              <span className="text-sm font-black text-slate-900">{score.runs}/{score.wickets} ({score.overs})</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/cricket/match/${match.id}`} className="rounded-lg bg-[#031d44] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-900">
          Details
        </Link>
        {status === "completed" && (
          <Link to={`/cricket/match/${match.id}#scorecard`} className="rounded-lg bg-slate-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-200">
            Scorecard
          </Link>
        )}
      </div>
    </div>
  );
}
