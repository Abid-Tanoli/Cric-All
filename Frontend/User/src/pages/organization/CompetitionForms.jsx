import React, { useState } from "react";
import {
  SERIES_FORMATS,
  SERIES_STATUSES,
  TOURNAMENT_FORMATS,
  TOURNAMENT_TYPES,
  buildSeriesPayload,
  buildTournamentPayload,
  competitionErrorMessage,
  idOf,
  minTeamsForType,
  toDateInput,
  uniqueIds,
  validateSeriesForm,
  validateTournamentForm,
} from "../../lib/orgCompetitions";
import {
  Banner,
  Field,
  cardSubtle,
  eyebrow,
  input,
  primaryButton,
  secondaryButton,
} from "./orgStyles";

const emptyTournament = {
  name: "",
  shortName: "",
  type: "league",
  format: "T20",
  startDate: "",
  endDate: "",
  venue: "",
  teams: [],
  twelfthManEnabled: false,
};

const emptySeries = {
  name: "",
  shortName: "",
  matchType: "T20",
  status: "upcoming",
  startDate: "",
  endDate: "",
  venue: "",
  description: "",
  teams: [],
};

const teamName = (team) => team?.name || team?.shortName || "Unnamed team";

/** Toggle chips shared by both forms and the tournament Teams tab. */
export function TeamPicker({ teams = [], selected = [], onToggle, disabled = false, emptyHint }) {
  const selectedIds = new Set(uniqueIds(selected));
  if (!teams.length) {
    return (
      <p className="text-xs font-semibold text-cric-muted">
        {emptyHint || "No teams are available yet. Create one under Teams first."}
      </p>
    );
  }
  return (
    <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto pr-1">
      {teams.map((team) => {
        const active = selectedIds.has(idOf(team));
        return (
          <button
            key={idOf(team)}
            type="button"
            onClick={() => onToggle?.(idOf(team))}
            disabled={disabled}
            aria-pressed={active}
            className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-60 ${
              active
                ? "border-cric-accent bg-cric-accent text-white"
                : "border-cric-border bg-cric-bg text-cric-muted hover:border-cric-accent/60 hover:text-cric-text"
            }`}
          >
            {teamName(team)}
          </button>
        );
      })}
    </div>
  );
}

export function TournamentForm({ initial, availableTeams = [], onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    ...emptyTournament,
    ...(initial
      ? {
          name: initial.name || "",
          shortName: initial.shortName || "",
          type: initial.type || "league",
          format: initial.format || "T20",
          startDate: toDateInput(initial.startDate),
          endDate: toDateInput(initial.endDate),
          venue: initial.venue || "",
          teams: uniqueIds(initial.teams || []),
          twelfthManEnabled: initial.rules?.twelfthManEnabled === true,
        }
      : {}),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleTeam = (teamId) =>
    setForm((prev) => ({
      ...prev,
      teams: prev.teams.includes(teamId)
        ? prev.teams.filter((id) => id !== teamId)
        : [...prev.teams, teamId],
    }));

  const submit = async (event) => {
    event.preventDefault();
    const validation = validateTournamentForm(form);
    if (!validation.ok) {
      setErr(validation.message);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSave(buildTournamentPayload(form));
    } catch (error) {
      setErr(competitionErrorMessage(error, "Could not save the tournament."));
    } finally {
      setBusy(false);
    }
  };

  const minTeams = minTeamsForType(form.type);

  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={initial ? "Tournament name" : "Tournament name *"}>
          <input value={form.name} onChange={set("name")} className={input} required maxLength={200} />
        </Field>
        <Field label="Short name" hint="Left blank, the first ten letters of the name are used.">
          <input value={form.shortName} onChange={set("shortName")} className={input} maxLength={20} />
        </Field>
        <Field label="Type">
          <select value={form.type} onChange={set("type")} className={input}>
            {TOURNAMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace("-", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <select value={form.format} onChange={set("format")} className={input}>
            {TOURNAMENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts *">
          <input type="date" value={form.startDate} onChange={set("startDate")} className={input} required />
        </Field>
        <Field label="Ends *">
          <input type="date" value={form.endDate} onChange={set("endDate")} className={input} required />
        </Field>
        <Field label="Venue">
          <input value={form.venue} onChange={set("venue")} className={input} maxLength={200} />
        </Field>
        <label className="flex items-center gap-3 self-end rounded-lg border border-cric-border bg-cric-bg px-3 py-3">
          <input
            type="checkbox"
            checked={form.twelfthManEnabled}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, twelfthManEnabled: event.target.checked }))
            }
          />
          <span className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
            12th Man for this tournament
          </span>
        </label>
      </div>

      <div className={cardSubtle}>
        <p className={eyebrow}>
          Teams ({form.teams.length} selected · at least {minTeams} for {form.type.replace("-", " ")})
        </p>
        <p className="mt-1 text-[10px] font-semibold text-cric-muted">
          Pick your own teams now. Guest teams can be invited from the tournament screen.
        </p>
        <div className="mt-3">
          <TeamPicker
            teams={availableTeams}
            selected={form.teams}
            onToggle={toggleTeam}
            emptyHint="No teams yet. Create one under Teams, or add a guest team from the tournament screen."
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : initial ? "Save tournament" : "Create tournament"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SeriesForm({ initial, availableTeams = [], onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    ...emptySeries,
    ...(initial
      ? {
          name: initial.name || "",
          shortName: initial.shortName || "",
          matchType: initial.matchType || "T20",
          status: initial.status || "upcoming",
          startDate: toDateInput(initial.startDate),
          endDate: toDateInput(initial.endDate),
          venue: initial.venue || "",
          description: initial.description || "",
          teams: uniqueIds(initial.teams || []),
        }
      : {}),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleTeam = (teamId) =>
    setForm((prev) => ({
      ...prev,
      teams: prev.teams.includes(teamId)
        ? prev.teams.filter((id) => id !== teamId)
        : [...prev.teams, teamId],
    }));

  const submit = async (event) => {
    event.preventDefault();
    const validation = validateSeriesForm(form);
    if (!validation.ok) {
      setErr(validation.message);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSave(buildSeriesPayload(form));
    } catch (error) {
      setErr(competitionErrorMessage(error, "Could not save the series."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={initial ? "Series name" : "Series name *"}>
          <input value={form.name} onChange={set("name")} className={input} required maxLength={200} />
        </Field>
        <Field label="Short name">
          <input value={form.shortName} onChange={set("shortName")} className={input} maxLength={20} />
        </Field>
        <Field label="Format">
          <select value={form.matchType} onChange={set("matchType")} className={input}>
            {SERIES_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={set("status")} className={input}>
            {SERIES_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts">
          <input type="date" value={form.startDate} onChange={set("startDate")} className={input} />
        </Field>
        <Field label="Ends">
          <input type="date" value={form.endDate} onChange={set("endDate")} className={input} />
        </Field>
        <Field label="Venue">
          <input value={form.venue} onChange={set("venue")} className={input} maxLength={200} />
        </Field>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={set("description")}
            rows={3}
            className={input}
            maxLength={2000}
          />
        </Field>
      </div>

      <div className={cardSubtle}>
        <p className={eyebrow}>Teams ({form.teams.length} selected)</p>
        <div className="mt-3">
          <TeamPicker
            teams={availableTeams}
            selected={form.teams}
            onToggle={toggleTeam}
            emptyHint="No teams yet. Create one under Teams first."
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : initial ? "Save series" : "Create series"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
