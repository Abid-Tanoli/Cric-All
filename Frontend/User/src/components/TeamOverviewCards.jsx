import React from 'react';
import { Link } from 'react-router-dom';
import SafeImage from '../../../Shared/components/SafeImage.jsx';

// PR 7 built these two cards for the team page; PR 8's club page needs the same
// fixture and performer rendering, so they live here and both pages import them.
// The team page passes `teamId` and keeps its opponent/W-L view unchanged; the
// club page passes `club` because both sides may belong to the club, so it
// prints both innings and never a W/L badge.

const idOf = (v) => v?._id || v?.id || v;

export const EMPTY_PERFORMERS = {
  topRunScorer: null,
  topWicketTaker: null,
  bestStrikeRate: null,
  bestPlayers: [],
};

/** Date and time in the visitor's own locale; an undated fixture says so. */
export function formatMatchWhen(startAt) {
  if (!startAt) return 'Date to be confirmed';
  const when = new Date(startAt);
  if (Number.isNaN(when.getTime())) return 'Date to be confirmed';
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDecimal(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00';
}

/** "154/6 (20)" for one team's innings in a match, or "" when it did not bat. */
function scoreLineFor(match, teamId) {
  if (!teamId) return '';
  const innings = (match.innings || []).filter(
    (entry) => String(idOf(entry.team)) === String(teamId),
  );
  if (innings.length === 0) return '';
  return innings
    .map((entry) => {
      const overs = entry.overs ? ` (${entry.overs})` : '';
      return `${entry.runs ?? 0}/${entry.wickets ?? 0}${overs}`;
    })
    .join(' & ');
}

/**
 * One fixture card.
 *
 * Team mode (`teamId`): opponent, when, where, both sides' scores, the result
 * sentence and a W/L badge. Club mode (`club`): every side's innings and the
 * result sentence, with a neutral badge, because a club's two teams can be the
 * two sides of the same match. Stacked for a 375px screen in both modes.
 */
export function TeamMatchRow({ match, teamId, live = false, result = false, club = false }) {
  const teams = match.teams || [];
  const opponents = club
    ? []
    : teams.filter((entry) => String(idOf(entry)) !== String(teamId));
  const opponentNames = opponents.map((entry) => entry?.name).filter(Boolean);
  const title = match.title || teams.map((entry) => entry?.name).filter(Boolean).join(' vs ');
  const ourScore = club ? '' : scoreLineFor(match, teamId);
  const theirScore = club ? '' : scoreLineFor(match, opponents[0] ? idOf(opponents[0]) : null);
  const clubScores = club
    ? teams
        .map((entry) => {
          const line = scoreLineFor(match, idOf(entry));
          return line ? `${entry?.name || 'Team'} ${line}` : '';
        })
        .filter(Boolean)
    : [];
  const winnerId = idOf(match.result?.winner);
  const won = Boolean(winnerId) && String(winnerId) === String(teamId);
  const lost = Boolean(winnerId) && !won;
  const resultText = match.result?.description || match.resultText || '';
  const meta = [
    opponentNames.length ? `vs ${opponentNames.join(', ')}` : '',
    match.venue || '',
  ].filter(Boolean).join(' • ');

  return (
    <Link
      to={`/match/${idOf(match)}`}
      className="block rounded-xl border border-cric-border bg-cric-bg px-4 py-3 transition-all hover:border-cric-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-cric-muted">
            {live ? 'In progress' : formatMatchWhen(match.startAt)}
          </p>
          <p className="mt-1 truncate font-bold text-cric-text">{title}</p>
          {meta ? <p className="truncate text-xs text-cric-muted">{meta}</p> : null}
          {club && clubScores.length ? (
            <p className="mt-1 text-xs font-bold text-cric-text">{clubScores.join(' • ')}</p>
          ) : null}
          {!club && (ourScore || theirScore) && (
            <p className="mt-1 text-xs font-bold text-cric-text">
              {ourScore || '—'} <span className="font-semibold text-cric-muted">vs</span> {theirScore || '—'}
            </p>
          )}
          {resultText ? <p className="mt-1 text-xs text-cric-muted">{resultText}</p> : null}
        </div>
        {live ? (
          <span className="shrink-0 rounded-full bg-red-600 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
            Live
          </span>
        ) : club ? (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              result ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-800'
            }`}
          >
            {result ? 'Result' : 'Upcoming'}
          </span>
        ) : result ? (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              won ? 'bg-green-100 text-green-800' : lost ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {won ? 'Won' : lost ? 'Lost' : 'No result'}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/** A performer card: photo or initials, name, one key number, link to the player. */
export function PerformerCard({ label, performer, detail }) {
  if (!performer || !performer._id) {
    return (
      <div className="rounded-xl border border-dashed border-cric-border bg-cric-bg px-4 py-5 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">{label}</p>
        <p className="mt-2 text-xs font-semibold text-cric-muted">No data yet</p>
      </div>
    );
  }
  return (
    <Link
      to={`/players/${performer._id}`}
      className="flex items-center gap-3 rounded-xl border border-cric-border bg-cric-bg px-4 py-3 transition-all hover:border-cric-accent"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cric-accent font-black text-white">
        {performer.imageUrl ? (
          <SafeImage src={performer.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          (performer.name || '?').charAt(0).toUpperCase()
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">{label}</p>
        <p className="truncate font-bold text-cric-text">{performer.name || 'Player'}</p>
        <p className="text-xs text-cric-muted">{detail(performer)}</p>
      </div>
    </Link>
  );
}
