import React from "react";
import { Link } from "react-router-dom";
import { teamInitials } from "../utils/teamDisplay";
import { teamId, tournamentChampion } from "../utils/tournamentChampion";

// The champion strip that sits inside the tournament header. It renders only
// when the API says the tournament is completed and a winner is decided, so a
// tie, no-result or in-progress tournament keeps the clean hero it has today.
export default function TournamentChampionHero({ tournament, overview = {} }) {
  const champion = tournamentChampion(tournament, overview);
  if (!champion) return null;

  const { winner, runnerUp } = champion;
  const winnerId = teamId(winner);

  return (
    <div
      data-testid="tournament-champion-badge"
      className="mt-5 flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-amber-300/40 bg-amber-400/10 px-4 py-3"
    >
      <span aria-hidden="true" className="text-2xl leading-none">🏆</span>
      {winner.logo ? (
        <img
          src={winner.logo}
          alt={`${winner.name} logo`}
          className="h-11 w-11 shrink-0 rounded-full border-2 border-amber-300/60 object-cover"
        />
      ) : (
        <div
          aria-label={`${winner.name} logo`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-amber-300/60 bg-amber-400/20 text-sm font-black text-amber-200"
        >
          {teamInitials(winner.name)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Champions</p>
        {winnerId ? (
          <Link
            to={`/teams/${winnerId}`}
            className="block truncate text-lg font-black text-white hover:underline"
          >
            {winner.name}
          </Link>
        ) : (
          <p className="block truncate text-lg font-black text-white">{winner.name}</p>
        )}
      </div>
      {runnerUp && (
        <p className="w-full text-xs font-semibold text-white/70 sm:ml-auto sm:w-auto sm:max-w-[45%] sm:text-right">
          Runners-up: <span className="break-words">{runnerUp.name}</span>
        </p>
      )}
    </div>
  );
}
