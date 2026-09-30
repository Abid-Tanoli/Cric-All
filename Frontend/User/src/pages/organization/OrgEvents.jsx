import React, { useState } from "react";
import {
  createOrgEvent,
  deleteOrgEvent,
  updateOrgEvent,
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

// Mirrors Backend/src/validators/matchValidators.js. A single-match event has
// exactly two teams, so `totalTeams` does not apply to it — the server rejects
// the combination, and hiding the field is kinder than a 422.
const EVENT_TYPES = [
  "single-match",
  "series",
  "tri-series",
  "tournament",
  "world-cup",
  "champions-trophy",
  "league",
];

const EVENT_FORMATS = ["T20", "ODI", "Test", "T10", "6 Overs", "8 Overs", "Tape Ball"];

const emptyEvent = { name: "", eventType: "series", format: "T20", venue: "", startDate: "", endDate: "", totalTeams: "" };

function EventForm({ orgId, initial, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({ ...emptyEvent, ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const isSingle = form.eventType === "single-match";

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (initial) {
        const payload = {
          ...(form.name.trim() ? { name: form.name.trim() } : {}),
          ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
          ...(form.format ? { format: form.format } : {}),
          ...(form.endDate ? { endDate: new Date(form.endDate).toISOString() } : {}),
        };
        if (Object.keys(payload).length) await updateOrgEvent(orgId, initial._id, payload);
      } else {
        await createOrgEvent(orgId, {
          name: form.name.trim(),
          eventType: form.eventType,
          ...(form.format ? { format: form.format } : {}),
          ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
          ...(form.startDate ? { startDate: new Date(form.startDate).toISOString() } : {}),
          ...(form.endDate ? { endDate: new Date(form.endDate).toISOString() } : {}),
          ...(!isSingle && form.totalTeams ? { totalTeams: Number(form.totalTeams) } : {}),
        });
      }
      onDone();
    } catch (error) {
      setErr(error.message || "Could not save the event");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={initial ? "Name" : "Name *"}>
          <input value={form.name} onChange={set("name")} className={input} required={!initial} maxLength={200} />
        </Field>
        {!initial ? (
          <Field label="Type">
            <select value={form.eventType} onChange={set("eventType")} className={input}>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Format">
          <select value={form.format} onChange={set("format")} className={input}>
            {EVENT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Venue">
          <input value={form.venue} onChange={set("venue")} className={input} maxLength={200} />
        </Field>
        {!initial ? (
          <>
            <Field label="Starts">
              <input type="date" value={form.startDate} onChange={set("startDate")} className={input} />
            </Field>
            <Field label="Ends" hint={isSingle ? "A single match happens on one day." : undefined}>
              <input type="date" value={form.endDate} onChange={set("endDate")} className={input} />
            </Field>
            {!isSingle ? (
              <Field label="Number of teams" hint="How many sides you expect to take part.">
                <input
                  type="number"
                  min={2}
                  max={64}
                  value={form.totalTeams}
                  onChange={set("totalTeams")}
                  className={input}
                />
              </Field>
            ) : null}
          </>
        ) : (
          <Field label="Ends">
            <input type="date" value={form.endDate} onChange={set("endDate")} className={input} />
          </Field>
        )}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : initial ? "Save event" : "Create event"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The event list is owned by the dashboard shell, not by this tab: the Matches
 * tab needs the same list to file a fixture inside an event, and two components
 * fetching it independently is how the two views start disagreeing.
 */
export default function OrgEvents({ orgId, events = [], loading, error, onChanged }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState("");

  const refresh = () => {
    onChanged?.();
  };

  const setStatus = async (event, status) => {
    setBusyId(event._id);
    setErr("");
    try {
      await updateOrgEvent(orgId, event._id, { status });
      setNotice({ kind: "success", text: `${event.name} marked ${status}.` });
      refresh();
    } catch (error) {
      setErr(error.message || "Could not update the event");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (event) => {
    setBusyId(event._id);
    setErr("");
    try {
      await deleteOrgEvent(orgId, event._id);
      setNotice({ kind: "success", text: `${event.name} deleted.` });
      refresh();
    } catch (error) {
      setErr(error.message || "Could not delete the event");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={eyebrow}>Competitions</p>
            <h2 className={sectionTitle}>Events</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              A league, a cup, a one-off friendly. Fixtures created under Matches can be filed inside
              an event, and the event keeps the count of them.
            </p>
          </div>
          <button type="button" onClick={() => setCreating((v) => !v)} className={primaryButton}>
            {creating ? "Close" : "+ New event"}
          </button>
        </div>
        {creating ? (
          <div className="mt-4">
            <EventForm
              orgId={orgId}
              onDone={() => {
                setCreating(false);
                setNotice({ kind: "success", text: "Event created." });
                refresh();
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : null}
      </div>

      {err ? <Banner kind="error">{err}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}

      {loading ? (
        <div className={card}>
          <p className="text-sm font-semibold text-cric-muted">Loading events…</p>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card p-10 text-center">
          <p className="text-sm font-black">No events yet</p>
          <p className="mt-2 text-xs font-semibold text-cric-muted">
            Create one above if you run more than a handful of matches. A single match does not need
            an event.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event._id} className={cardSubtle}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black uppercase tracking-wide">{event.name}</p>
                  <p className="mt-1 text-xs font-semibold text-cric-muted">
                    {event.eventType}
                    {event.format ? ` · ${event.format}` : ""}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                    {event.status}
                    {event.startDate ? ` · ${formatDate(event.startDate)}` : ""}
                    {event.totalTeams ? ` · ${event.totalTeams} teams` : ""}
                    {` · ${event.matchCount} fixture${event.matchCount === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {event.status === "upcoming" ? (
                    <button
                      type="button"
                      onClick={() => setStatus(event, "completed")}
                      disabled={busyId === event._id}
                      className={secondaryButton}
                    >
                      Mark completed
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStatus(event, "upcoming")}
                      disabled={busyId === event._id}
                      className={secondaryButton}
                    >
                      Reopen
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(event)} className={secondaryButton}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(event)}
                    disabled={busyId === event._id}
                    className={dangerButton}
                    title={event.matchCount ? "Delete the fixtures inside it first" : undefined}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {editing?._id === event._id ? (
                <div className="mt-4">
                  <EventForm
                    orgId={orgId}
                    initial={{
                      name: event.name,
                      format: event.format,
                      venue: event.venue,
                      endDate: event.endDate ? new Date(event.endDate).toISOString().slice(0, 10) : "",
                    }}
                    onDone={() => {
                      setEditing(null);
                      setNotice({ kind: "success", text: "Event updated." });
                      refresh();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
