import React, { useState } from 'react';
import { buildBowlerGroups, getOversSummary } from '../../utils/nextBowler';
import { overByOverList } from '../../utils/plainCommentary';

const ROLES = ['Bowler', 'All-Rounder', 'Batting All-Rounder', 'Wicket Keeper', 'Batter'];

function BowlerRow({ option, disabled, onSelect }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : () => onSelect?.(option._id)}
      disabled={disabled}
      aria-disabled={disabled}
      className={`w-full rounded-2xl border p-3 text-left transition-all score-touch-btn ${
        disabled
          ? 'cursor-not-allowed border-cric-border bg-black/5 opacity-55 dark:bg-white/5'
          : 'border-cric-border bg-cric-card hover:border-cric-accent hover:bg-cric-accent/5'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-black text-cric-text">{option.name}</span>
        <span className="shrink-0 text-sm font-black tabular-nums text-cric-text">
          {option.overs}-{option.maidens}-{option.runs}-{option.wickets}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
        <span>O-M-R-W</span>
        {option.oversRemaining != null && <span>{option.oversRemaining} overs left</span>}
      </div>
      {option.overNumbers?.length > 0 && (
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
          Overs: {option.overNumbers.join(', ')}
        </div>
      )}
      {option.reasons?.length > 0 && (
        <div className="mt-1 text-[10px] font-bold text-red-500">{option.reasons.join(' • ')}</div>
      )}
    </button>
  );
}

export default function NextBowlerModal({
  open,
  required = false,
  curInn,
  bowlers = [],
  quota = 0,
  totalOvers = 0,
  lastOverBowlerId = '',
  onSelect,
  onClose,
  onPlayerCreated,
  createTeamPlayer,
  teamId,
  showToast,
}) {
  const [showNewPlayer, setShowNewPlayer] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Bowler');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const { bowled, yetToBowl } = buildBowlerGroups({
    bowlers,
    bowlingStats: curInn?.bowling || [],
    lastOverBowlerId,
    quota,
    innings: curInn,
  });
  const summary = getOversSummary({ totalOvers, quota, innings: curInn });
  const overList = overByOverList(curInn?.oversHistory || []);
  const availableCount = [...bowled, ...yetToBowl].filter(
    (option) => !(option.reasons?.length > 0)
  ).length;
  const canCreate = typeof createTeamPlayer === 'function';

  const resetForm = () => {
    setShowNewPlayer(false);
    setName('');
    setRole('Bowler');
    setError('');
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter the player name.');
      return;
    }
    if (!canCreate) {
      setError('Player creation is not available here.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await createTeamPlayer({ teamId, name: trimmed, role });
      const player = created?.player || created;
      if (!player?._id) throw new Error('Player was created but no id was returned.');
      onPlayerCreated?.(player);
      resetForm();
      onSelect?.(player._id);
      showToast?.(`${player.name || trimmed} added and selected`, 'success');
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not create the player.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-cric-border bg-cric-card p-4 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-accent">
              {required ? 'Over complete' : 'Bowler change'}
            </p>
            <h3 className="mt-1 text-xl font-black uppercase tracking-tight text-cric-text sm:text-2xl">
              {required ? 'Select next bowler' : 'Change bowler'}
            </h3>
            {required && (
              <p className="mt-1 text-[11px] font-semibold text-cric-muted">
                Scoring is paused until the next bowler is selected.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="score-touch-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/5 text-cric-text hover:bg-red-500 hover:text-white dark:bg-white/5"
            aria-label="Close bowler selection"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cric-muted">
          <span>Innings {summary.bowled}/{summary.totalOvers || '-'}</span>
          <span>Bowler quota {summary.quota || '-'} overs</span>
          <span>{availableCount} available</span>
        </div>

        {canCreate && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowNewPlayer((current) => !current)}
              className="score-touch-btn w-full rounded-xl border border-dashed border-cric-accent/50 bg-cric-accent/5 px-3 py-3 text-xs font-black uppercase tracking-widest text-cric-accent hover:bg-cric-accent/10"
            >
              + New player
            </button>
            {showNewPlayer && (
              <div className="mt-2 space-y-2 rounded-2xl border border-cric-border bg-cric-bg p-3">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Player name"
                  className="w-full rounded-xl border border-cric-border bg-cric-card px-3 py-3 text-sm font-bold text-cric-text outline-none focus:border-cric-accent"
                />
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="w-full rounded-xl border border-cric-border bg-cric-card px-3 py-3 text-sm font-bold text-cric-text outline-none focus:border-cric-accent"
                >
                  {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                {error && <p className="text-[11px] font-bold text-red-500">{error}</p>}
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving}
                  className="score-touch-btn w-full rounded-xl bg-cric-accent px-3 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
                >
                  {saving ? 'Creating…' : 'Create & select'}
                </button>
              </div>
            )}
          </div>
        )}

        {overList.length > 0 && (
          <div className="mt-4 rounded-2xl border border-cric-border bg-cric-bg p-3">
            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">
              Over by over
            </h4>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-cric-text">
              {overList.map((entry) => (
                <span key={entry.overNumber} className="whitespace-nowrap">
                  Over {entry.overNumber}: <span className="text-cric-muted">{entry.name || 'Bowler'}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">
            Already bowled
          </h4>
          {bowled.length === 0 ? (
            <p className="rounded-xl border border-cric-border bg-cric-bg px-3 py-3 text-xs font-semibold text-cric-muted">
              No one has bowled yet.
            </p>
          ) : (
            bowled.map((option) => (
              <BowlerRow
                key={option._id}
                option={option}
                disabled={option.reasons?.length > 0}
                onSelect={onSelect}
              />
            ))
          )}
        </div>

        <div className="mt-5 space-y-2 border-t border-cric-border pt-4">
          <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-muted">
            Yet to bowl
          </h4>
          {yetToBowl.length === 0 ? (
            <p className="rounded-xl border border-cric-border bg-cric-bg px-3 py-3 text-xs font-semibold text-cric-muted">
              Everyone in the squad has bowled. Add a player or undo the last ball.
            </p>
          ) : (
            yetToBowl.map((option) => (
              <BowlerRow
                key={option._id}
                option={option}
                disabled={option.reasons?.length > 0}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
