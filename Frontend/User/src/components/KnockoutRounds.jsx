import React from "react";
import { Link } from "react-router-dom";
import { buildKnockoutBracket, slotTeams, winnerIdOf } from "./knockoutBracket";

// Self-contained knockout bracket: three columns (quarter-finals, semi-finals,
// final) with "To be decided" placeholders for rounds that are not drawn yet.
// It takes the tournament's matches as a prop and does no data fetching of its
// own, so it can be dropped into any tournament page — see Series.jsx for the
// (guarded) mount and knockoutBracket.js for the pure shape helper.

const whenLabel = (value) => {
  if (!value) return "Date TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBD";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function SlotCard({ match }) {
  if (!match) {
    return (
      <div className="rounded-xl border border-dashed border-cric-border bg-cric-card/60 p-4 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">To be decided</p>
      </div>
    );
  }

  const teams = slotTeams(match);
  const winnerId = winnerIdOf(match);

  return (
    <Link
      to={`/match/${match._id}`}
      className="block rounded-xl border border-cric-border bg-cric-card shadow-sm p-3 hover:border-cric-text/40 transition"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
          {match.stageLabel || "\u00A0"}
        </span>
        <span className="text-[10px] font-bold text-cric-muted">{whenLabel(match.startAt)}</span>
      </div>
      {teams.map((team, index) => {
        const isWinner = Boolean(winnerId && team.id === winnerId);
        return (
          <div
            key={team.id || `${match._id}-${index}`}
            className={`flex items-center justify-between gap-2 py-1 text-sm ${
              isWinner ? "font-black text-green-700" : "font-semibold text-cric-text"
            }`}
          >
            <span className="truncate">{team.name}</span>
            {isWinner && <span className="text-[10px] font-black text-green-600">WON</span>}
          </div>
        );
      })}
    </Link>
  );
}

export default function KnockoutRounds({ matches = [] }) {
  const columns = buildKnockoutBracket(matches);
  const hasAnyMatch = columns.some((column) => column.slots.some(Boolean));

  if (!hasAnyMatch) {
    return (
      <div className="bg-cric-card rounded-2xl shadow-sm p-12 text-center border border-cric-border">
        <p className="text-cric-muted font-bold text-lg mb-2">Bracket not drawn yet</p>
        <p className="text-sm text-cric-muted/60">Knockout fixtures will appear here once they are scheduled.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
      {columns.map((column) => (
        <div key={column.stage}>
          <h3 className="text-sm font-black uppercase tracking-widest text-cric-muted mb-3 text-center">
            {column.heading}
          </h3>
          <div className="flex flex-col justify-around gap-3">
            {column.slots.map((match, index) => (
              <SlotCard key={match?._id || `${column.stage}-${index}`} match={match} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
