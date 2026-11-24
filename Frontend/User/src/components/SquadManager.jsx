import React, { useCallback, useEffect, useState } from "react";
import LocationSelect from "../../../Shared/components/LocationSelect.jsx";
import {
  addOrgTeamNewPlayers,
  addOrgTeamPlayer,
  addOrgTeamPlayers,
  searchOrgTeamAvailablePlayers,
} from "../services/organizationApi";
import { BATTING_STYLES, BOWLING_STYLES, PLAYING_ROLES } from "../lib/playerFields";
import {
  EMPTY_SQUAD_PLAYER,
  buildBulkPlayersPayload,
  buildNewPlayerPayload,
  parsePlayerNames,
} from "../lib/squadAdd";

// The team page's "Add players" action.
//
// It only ever talks to the owner-side squad routes
// (POST/DELETE /organizations/:id/teams/:teamId/players). Those routes are
// already guarded by the organization's manage_players permission, so this
// component adds no authorization of its own — it is rendered only when the
// caller's access response says they may manage this squad, and every request
// is re-checked on the server.

const TABS = [
  { id: "new", label: "New player" },
  { id: "existing", label: "Add existing" },
  { id: "several", label: "Add several" },
];

const inputClass =
  "min-h-12 w-full rounded-xl border border-cric-border bg-cric-bg px-3 py-3 text-sm font-bold text-cric-text outline-none focus:border-cric-accent";
const labelClass = "mb-1 block text-[10px] font-black uppercase tracking-widest text-cric-muted";
const primaryClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cric-accent px-5 py-3 text-[11px] font-black uppercase tracking-widest text-white transition-all hover:bg-cric-accent/90 active:scale-95 disabled:opacity-60";
const secondaryClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cric-border bg-cric-bg px-5 py-3 text-[11px] font-black uppercase tracking-widest text-cric-text disabled:opacity-60";

export default function SquadManager({ orgId, teamId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState(EMPTY_SQUAD_PLAYER);

  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);

  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState(null);

  const reset = () => {
    setError("");
    setNotice("");
  };

  const loadCandidates = useCallback(
    async (term = "") => {
      setBusy(true);
      reset();
      try {
        const res = await searchOrgTeamAvailablePlayers(orgId, teamId, term);
        setCandidates(Array.isArray(res?.items) ? res.items : []);
        setCandidatesLoaded(true);
      } catch (err) {
        setError(err.message || "Could not search players");
        setCandidates([]);
      } finally {
        setBusy(false);
      }
    },
    [orgId, teamId]
  );

  // The picker opens with the attachable players already listed, so the owner
  // does not have to guess a search term before seeing anybody.
  useEffect(() => {
    if (!open || tab !== "existing" || candidatesLoaded) return;
    loadCandidates("");
  }, [open, tab, candidatesLoaded, loadCandidates]);

  const done = async (message) => {
    setNotice(message);
    setForm({ ...EMPTY_SQUAD_PLAYER, locationRefs: { ...EMPTY_SQUAD_PLAYER.locationRefs }, locationLabels: { ...EMPTY_SQUAD_PLAYER.locationLabels } });
    setBulkText("");
    setBulkPreview(null);
    setCandidatesLoaded(false);
    await onChanged?.();
  };

  const submitNew = async (event) => {
    event.preventDefault();
    const payload = buildNewPlayerPayload(form);
    if (!payload) {
      setError("Enter the player's name.");
      return;
    }
    setBusy(true);
    reset();
    try {
      await addOrgTeamPlayer(orgId, teamId, payload);
      await done(`“${payload.name}” was added to the squad.`);
    } catch (err) {
      setError(err.message || "Could not add the player");
    } finally {
      setBusy(false);
    }
  };

  const addExisting = async (player) => {
    setBusy(true);
    reset();
    try {
      await addOrgTeamPlayers(orgId, teamId, [String(player._id)]);
      await done(`“${player.name}” was added to the squad.`);
    } catch (err) {
      setError(err.message || "Could not add that player");
    } finally {
      setBusy(false);
    }
  };

  const previewBulk = () => {
    reset();
    const names = parsePlayerNames(bulkText);
    setBulkPreview(names);
    if (names.length === 0) setError("Paste at least one name, one per line.");
  };

  const submitBulk = async () => {
    const names = bulkPreview || [];
    if (names.length === 0) return;
    setBusy(true);
    reset();
    try {
      await addOrgTeamNewPlayers(orgId, teamId, buildBulkPlayersPayload(names).newPlayers);
      await done(`${names.length} player${names.length === 1 ? "" : "s"} added to the squad.`);
    } catch (err) {
      setError(err.message || "Could not add those players");
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={primaryClass}>
        + Add players
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-cric-border bg-cric-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-widest text-cric-text">Add players</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="min-h-10 rounded-lg border border-cric-border px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted"
        >
          Close
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="How to add players">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => {
              setTab(entry.id);
              reset();
            }}
            className={`min-h-11 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === entry.id
                ? "bg-cric-accent text-white"
                : "border border-cric-border bg-cric-bg text-cric-muted"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700">
          {notice}
        </p>
      ) : null}

      {tab === "new" ? (
        <form onSubmit={submitNew} className="mt-4 space-y-4">
          <div>
            <label className={labelClass} htmlFor="squad-player-name">
              Full name *
            </label>
            <input
              id="squad-player-name"
              value={form.name}
              onChange={set("name")}
              required
              maxLength={150}
              placeholder="Player name"
              className={inputClass}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="squad-player-role">
                Playing role
              </label>
              <select id="squad-player-role" value={form.playingRole} onChange={set("playingRole")} className={inputClass}>
                <option value="">Not set</option>
                {PLAYING_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="squad-player-jersey">
                Shirt number
              </label>
              <input
                id="squad-player-jersey"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                value={form.jerseyNumber}
                onChange={set("jerseyNumber")}
                placeholder="Optional"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="squad-player-batting">
                Batting style
              </label>
              <select
                id="squad-player-batting"
                value={form.battingStyle}
                onChange={set("battingStyle")}
                className={inputClass}
              >
                <option value="">Not set</option>
                {BATTING_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="squad-player-bowling">
                Bowling style
              </label>
              <select
                id="squad-player-bowling"
                value={form.bowlingStyle}
                onChange={set("bowlingStyle")}
                className={inputClass}
              >
                <option value="">Not set</option>
                {BOWLING_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-cric-border bg-cric-bg p-3">
            <p className={labelClass}>Location</p>
            <LocationSelect
              compact
              value={form.locationRefs}
              labels={form.locationLabels}
              onChange={(refs, labels) => setForm((prev) => ({ ...prev, locationRefs: refs, locationLabels: labels }))}
            />
          </div>
          <p className="text-[11px] font-semibold text-cric-muted">
            No CricAll account is needed. The player is created straight into this squad.
          </p>
          <button type="submit" disabled={busy || !form.name.trim()} className={primaryClass}>
            {busy ? "Adding…" : "Add player"}
          </button>
        </form>
      ) : null}

      {tab === "existing" ? (
        <div className="mt-4 space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadCandidates(search.trim());
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or phone"
              aria-label="Search players by name or phone"
              className={inputClass}
            />
            <button type="submit" disabled={busy} className={secondaryClass}>
              Search
            </button>
          </form>
          {busy ? <p className="text-xs font-bold text-cric-muted">Searching…</p> : null}
          {!busy && candidatesLoaded && candidates.length === 0 ? (
            <p className="text-xs font-semibold text-cric-muted">
              Nobody free to add. Create a new player instead.
            </p>
          ) : null}
          <ul className="space-y-2">
            {candidates.map((player) => (
              <li
                key={player._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cric-border bg-cric-bg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-cric-text">{player.name}</p>
                  <p className="truncate text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                    {player.playingRole || player.role || "Player"}
                    {player.team?.name ? ` · ${player.team.name}` : " · free agent"}
                    {player.phone ? ` · ${player.phone}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => addExisting(player)}
                  disabled={busy}
                  className={secondaryClass}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "several" ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className={labelClass} htmlFor="squad-bulk-names">
              One name per line
            </label>
            <textarea
              id="squad-bulk-names"
              value={bulkText}
              onChange={(event) => {
                setBulkText(event.target.value);
                setBulkPreview(null);
              }}
              rows={5}
              placeholder={"Ali Raza\nSana Mir\nBilal Shah"}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={previewBulk} disabled={busy} className={secondaryClass}>
              Preview
            </button>
            {bulkPreview && bulkPreview.length > 0 ? (
              <button type="button" onClick={submitBulk} disabled={busy} className={primaryClass}>
                {busy ? "Adding…" : `Add ${bulkPreview.length} player${bulkPreview.length === 1 ? "" : "s"}`}
              </button>
            ) : null}
          </div>
          {bulkPreview ? (
            <div className="rounded-xl border border-cric-border bg-cric-bg p-3">
              <p className={labelClass}>
                Will add {bulkPreview.length} player{bulkPreview.length === 1 ? "" : "s"}
              </p>
              {bulkPreview.length === 0 ? (
                <p className="text-xs font-semibold text-cric-muted">No names found in that list.</p>
              ) : (
                <ol className="list-decimal space-y-1 pl-5 text-sm font-bold text-cric-text">
                  {bulkPreview.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
