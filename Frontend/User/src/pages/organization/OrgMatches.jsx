import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createOrgMatch,
  deleteOrgMatch,
  listOrgMatches,
  listOrgTeamsManaged,
  setOrgMatchSquads,
  updateOrgMatch,
} from "../../services/organizationApi";
import { formatDate } from "../../lib/orgUi";
import {
  Banner,
  Field,
  card,
  cardSubtle,
  dangerButton,
  eyebrow,
  input,
  primaryButton,
  secondaryButton,
  sectionTitle,
} from "./orgStyles";

const MATCH_TYPES = ["T10", "T20", "6 Overs", "8 Overs", "ODI", "Test", "Tape Ball", "Super Over"];

// A squad is 11 for a side and 20 for a tournament squad; the server enforces
// the same bound, and this is only here to avoid a 422 on a typo.
const MAX_SQUAD = 20;

const emptyMatch = { teamA: "", teamB: "", matchType: "T20", venue: "", startAt: "", eventId: "" };

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const teamName = (team) => team?.name || "Unknown team";

/** Both sides of a fixture, as a fixture stores them: two ids, in order. */
function SquadEditor({ orgId, match, teams, onClose, onSaved }) {
  const [selection, setSelection] = useState(() => {
    const initial = {};
    for (const team of match.teams || []) initial[team._id] = [];
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const toggle = (teamId, playerId) => {
    setSelection((prev) => {
      const current = prev[teamId] || [];
      if (current.includes(playerId)) return { ...prev, [teamId]: current.filter((id) => id !== playerId) };
      if (current.length >= MAX_SQUAD) return prev;
      return { ...prev, [teamId]: [...current, playerId] };
    });
  };

  const save = async () => {
    const squads = Object.entries(selection)
      .filter(([, players]) => players.length > 0)
      .map(([team, players]) => ({ team, players }));
    if (!squads.length) {
      setErr("Pick at least one player for one of the sides");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await setOrgMatchSquads(orgId, match._id, squads);
      onSaved();
    } catch (error) {
      setErr(error.message || "Could not save the squads");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-cric-border bg-cric-bg p-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      {(match.teams || []).map((team) => {
        const roster = teams.find((t) => t._id === team._id);
        const chosen = selection[team._id] || [];
        return (
          <div key={team._id}>
            <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
              {teamName(team)} · {chosen.length} selected
            </p>
            {(!roster || (roster.roster || []).length === 0) ? (
              <p className="mt-1 text-xs font-semibold text-cric-muted">
                This team has no players yet. Add them under Teams first — a squad can only be
                chosen from the team roster.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {roster.roster.map((player) => {
                  const on = chosen.includes(player._id);
                  return (
                    <button
                      key={player._id}
                      type="button"
                      onClick={() => toggle(team._id, player._id)}
                      title={player.playingRole}
                      className={`rounded-lg border px-3 py-1 text-[10px] font-black uppercase tracking-widest transition ${
                        on
                          ? "border-cric-accent bg-cric-accent text-white"
                          : "border-cric-border bg-cric-card text-cric-muted hover:text-cric-text"
                      }`}
                    >
                      {player.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : "Save squads"}
        </button>
        <button type="button" onClick={onClose} className={secondaryButton}>
          Close
        </button>
      </div>
    </div>
  );
}

function MatchForm({ orgId, teams, events, initial, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({ ...emptyMatch, ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!initial && form.teamA === form.teamB) {
      setErr("Pick two different teams");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      if (initial) {
        const payload = {
          title: form.title?.trim() || undefined,
          venue: form.venue?.trim() || undefined,
          matchType: form.matchType,
          startAt: form.startAt || undefined,
        };
        await updateOrgMatch(orgId, initial._id, Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
      } else {
        await createOrgMatch(orgId, {
          teams: [form.teamA, form.teamB],
          matchType: form.matchType,
          ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
          ...(form.startAt ? { startAt: new Date(form.startAt).toISOString() } : {}),
          ...(form.eventId ? { eventId: form.eventId } : {}),
        });
      }
      onDone();
    } catch (error) {
      setErr(error.message || "Could not save the fixture");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      {initial ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <input value={form.title || initial.title || ""} onChange={set("title")} className={input} maxLength={200} />
          </Field>
          <Field label="Format">
            <select value={form.matchType} onChange={set("matchType")} className={input}>
              {MATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <input value={form.venue || ""} onChange={set("venue")} className={input} maxLength={200} />
          </Field>
          <Field label="Date">
            <input type="date" value={form.startAt || ""} onChange={set("startAt")} className={input} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Home side *">
            <select value={form.teamA} onChange={set("teamA")} className={input} required>
              <option value="">— Select a team —</option>
              {teams.map((team) => (
                <option key={team._id} value={team._id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Away side *">
            <select value={form.teamB} onChange={set("teamB")} className={input} required>
              <option value="">— Select a team —</option>
              {teams.map((team) => (
                <option key={team._id} value={team._id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select value={form.matchType} onChange={set("matchType")} className={input}>
              {MATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue">
            <input value={form.venue} onChange={set("venue")} className={input} maxLength={200} />
          </Field>
          <Field label="Date and time">
            <input type="datetime-local" value={form.startAt} onChange={set("startAt")} className={input} />
          </Field>
          <Field label="Event" hint="Optional — puts the fixture inside one of your events.">
            <select value={form.eventId} onChange={set("eventId")} className={input}>
              <option value="">— No event —</option>
              {events.map((event) => (
                <option key={event._id} value={event._id}>
                  {event.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : initial ? "Save fixture" : "Create fixture"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function OrgMatches({ orgId, events = [], onChanged }) {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [squadFor, setSquadFor] = useState(null);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await listOrgMatches(orgId);
      setMatches(Array.isArray(res?.items) ? res.items : []);
    } catch (error) {
      setErr(error.message || "Failed to load your fixtures");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
    // The team list is needed for the create form and the squad editor, and both
    // change when a team or a player is added, so it is re-read with the fixtures
    // rather than cached for the life of the tab.
    listOrgTeamsManaged(orgId)
      .then((res) => setTeams(Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []))
      .catch(() => setTeams([]));
  }, [orgId, load]);

  const refresh = () => {
    load();
    onChanged?.();
  };

  const abandon = async (match) => {
    setBusyId(match._id);
    setErr("");
    try {
      await updateOrgMatch(orgId, match._id, { status: "abandoned" });
      setNotice({ kind: "success", text: `${match.title} called off.` });
      refresh();
    } catch (error) {
      setErr(error.message || "Could not call the fixture off");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (match) => {
    setBusyId(match._id);
    setErr("");
    try {
      await deleteOrgMatch(orgId, match._id);
      setNotice({ kind: "success", text: `${match.title} deleted.` });
      refresh();
    } catch (error) {
      setErr(error.message || "Could not delete the fixture");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={eyebrow}>Fixtures</p>
            <h2 className={sectionTitle}>Matches</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              Schedule a game between two of your own teams, nominate the squads, and call it off if
              the weather turns. Running the match — toss, ball by ball, result — stays with the
              platform scorers.
            </p>
          </div>
          {teams.length < 2 ? (
            <p className="max-w-xs text-[10px] font-bold uppercase tracking-widest text-cric-muted">
              A fixture needs two teams. Create them under Teams first.
            </p>
          ) : (
            <button type="button" onClick={() => setCreating((v) => !v)} className={primaryButton}>
              {creating ? "Close" : "+ New fixture"}
            </button>
          )}
        </div>

        {creating ? (
          <div className="mt-4">
            <MatchForm
              orgId={orgId}
              teams={teams}
              events={events}
              onDone={() => {
                setCreating(false);
                setNotice({ kind: "success", text: "Fixture created." });
                refresh();
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : null}
      </div>

      {err ? <Banner kind="error">{err}</Banner> : null}
      {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}

      {loading ? (
        <div className={card}>
          <p className="text-sm font-semibold text-cric-muted">Loading fixtures…</p>
        </div>
      ) : matches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card p-10 text-center">
          <p className="text-sm font-black">No fixtures yet</p>
          <p className="mt-2 text-xs font-semibold text-cric-muted">
            {teams.length < 2 ? (
              <>
                You need two teams before you can schedule a match.{" "}
                <Link to="/organization" className="font-black text-cric-accent underline">
                  Add them under Teams
                </Link>
                .
              </>
            ) : (
              "Create one above and it will show up here with its squads and status."
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((match) => {
            const [first, second] = match.teams || [];
            return (
              <div key={match._id} className={cardSubtle}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase tracking-wide">
                      {teamName(first)} v {teamName(second)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-cric-muted">
                      {match.matchType}
                      {match.venue ? ` · ${match.venue}` : ""}
                      {match.startAt ? ` · ${formatDate(match.startAt)}` : " · Date not set"}
                      {match.event ? ` · ${match.event.name}` : ""}
                    </p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                      {match.status.replace(/_/g, " ")}
                      {match.hasScore ? " · has a recorded score" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSquadFor(squadFor?._id === match._id ? null : match)} className={secondaryButton}>
                      Squads
                    </button>
                    <button type="button" onClick={() => setEditing(editing?._id === match._id ? null : match)} className={secondaryButton}>
                      Edit
                    </button>
                    {match.status !== "abandoned" ? (
                      <button
                        type="button"
                        onClick={() => abandon(match)}
                        disabled={busyId === match._id}
                        className={secondaryButton}
                      >
                        Call off
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => remove(match)}
                      disabled={busyId === match._id}
                      className={dangerButton}
                      title={match.hasScore ? "A fixture with a score cannot be deleted" : undefined}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {editing?._id === match._id ? (
                  <div className="mt-4">
                    <MatchForm
                      orgId={orgId}
                      teams={teams}
                      events={events}
                      initial={{ ...match, title: match.title, venue: match.venue, matchType: match.matchType, startAt: toDateInput(match.startAt) }}
                      onDone={() => {
                        setEditing(null);
                        setNotice({ kind: "success", text: "Fixture updated." });
                        refresh();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : null}

                {squadFor?._id === match._id ? (
                  <SquadEditor
                    orgId={orgId}
                    match={match}
                    teams={teams}
                    onClose={() => setSquadFor(null)}
                    onSaved={() => {
                      setSquadFor(null);
                      setNotice({ kind: "success", text: "Squads saved." });
                      refresh();
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
