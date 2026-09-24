import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { getStoredUser } from "../pages/auth/auth";

const EVENT_TYPES = ["single-match", "series", "tri-series", "tournament", "world-cup", "champions-trophy", "league"];
const FORMATS = ["T20", "ODI", "Test", "T10", "6 Overs", "8 Overs", "Tape Ball"];
const CATEGORIES = ["School", "College", "University", "Organization", "Business", "Industry", "Club", "Academy", "League", "Other"];

const statusStyles = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-green-100 text-green-800 border-green-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
};

const typeLabel = (type) => (type === "tournament" ? "Tournament" : "Team");

export default function HandlerDashboard() {
  const navigate = useNavigate();
  const storedUser = getStoredUser();
  const isHandler = storedUser && (storedUser.accountType === "handler" || storedUser.accountType === "organization_admin");

  const [resources, setResources] = useState({ teams: [], events: [] });
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [type, setType] = useState("team");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [category, setCategory] = useState("Other");
  const [organization, setOrganization] = useState("");
  const [eventType, setEventType] = useState("tournament");
  const [format, setFormat] = useState("T20");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [myRes, reqRes] = await Promise.all([
        api.get("/handler/my"),
        api.get("/handler/requests"),
      ]);
      setResources(myRes.data);
      setRequests(reqRes.data.requests || []);
    } catch (error) {
      setErr(error.message || "Failed to load your dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isHandler) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!storedUser) return <Navigate to="/login?next=/dashboard" replace />;
  if (!isHandler) return <Navigate to="/" replace />;

  const submitRequest = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await api.post("/handler/requests", {
        type,
        details: {
          name,
          shortName,
          category,
          organization,
          eventType: type === "tournament" ? eventType : "",
          format,
          description,
        },
      });
      setShowForm(false);
      setName("");
      setShortName("");
      setOrganization("");
      setDescription("");
      await loadData();
    } catch (error) {
      setErr(error.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="bg-cric-card rounded-2xl border border-cric-border p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">My Dashboard</p>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-tight">
                {storedUser.accountType === "organization_admin" ? "Organization Admin" : "Cricket Handler"}
              </h1>
            </div>
            <button
              onClick={() => setShowForm(v => !v)}
              className="rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-orange-600"
            >
              {showForm ? "Cancel Request" : "+ Request Team / Tournament"}
            </button>
          </div>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-cric-muted">
            Teams and tournaments linked to your account appear here. New teams/tournaments are reviewed
            and set up by the CricAll admin team before they go live.
          </p>
        </div>

        {err && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{err}</div>}

        {showForm && (
          <form onSubmit={submitRequest} className="rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-cric-text">Request a new {typeLabel(type)}</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Request Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {["team", "tournament"].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`rounded-lg border px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                        type === t ? "border-cric-accent bg-cric-accent text-white" : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
                      }`}
                    >
                      {typeLabel(t)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-bold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">{typeLabel(type)} Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={type === "team" ? "e.g. Shaheen XI, Gulberg Cricket Club" : "e.g. City School League 2026"}
                  className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Short Name (optional)</label>
                <input
                  value={shortName}
                  onChange={e => setShortName(e.target.value)}
                  placeholder="e.g. SHA, CSL"
                  className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Organization / Institution / Club</label>
                <input
                  value={organization}
                  onChange={e => setOrganization(e.target.value)}
                  placeholder="e.g. Government College University"
                  className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                />
              </div>
              {type === "tournament" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Event Type</label>
                    <select
                      value={eventType}
                      onChange={e => setEventType(e.target.value)}
                      className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-bold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                    >
                      {EVENT_TYPES.map(et => <option key={et} value={et}>{et.replace(/-/g, " ").toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Format</label>
                    <select
                      value={format}
                      onChange={e => setFormat(e.target.value)}
                      className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-bold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
                    >
                      {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">Notes for the admin team</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Tell us a bit about what you want to manage — teams, squads, league size, etc."
                className="w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-cric-muted">
                Submitting a request doesn't create anything live — an admin approves it first.
              </p>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </form>
        )}

        {/* My Teams & Events */}
        <section className="rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-cric-text mb-4">My Teams &amp; Events</h2>
          {loading ? (
            <p className="text-sm font-semibold text-cric-muted">Loading...</p>
          ) : resources.teams.length === 0 && resources.events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cric-border bg-cric-bg p-6 text-center">
              <p className="text-sm font-bold text-cric-text">Nothing linked to your account yet</p>
              <p className="mt-1 text-xs font-semibold text-cric-muted">
                Once an admin approves your request, your teams and tournaments will show up here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {resources.teams.map(team => (
                <div
                  key={team._id}
                  onClick={() => navigate(`/teams/${team._id}`)}
                  className="cursor-pointer rounded-xl border border-cric-border bg-cric-bg p-4 transition-all hover:border-cric-accent/40 hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-cric-card text-lg font-black text-cric-muted">
                      {team.logo ? <img src={team.logo} alt="" className="h-full w-full object-cover" /> : team.name?.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-cric-text">{team.name}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                        Team · {team.category || "Other"}{team.isActive === false ? " · Inactive" : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {resources.events.map(event => (
                <div
                  key={event._id}
                  onClick={() => navigate(`/series/${event.slug || event._id}`)}
                  className="cursor-pointer rounded-xl border border-cric-border bg-cric-bg p-4 transition-all hover:border-cric-accent/40 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-cric-text">{event.name}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                        {event.eventType?.replace(/-/g, " ") || "Event"} · {event.format || "T20"} · {event.status || "upcoming"}
                      </p>
                    </div>
                    {event.startDate && (
                      <span className="shrink-0 text-[10px] font-bold text-cric-muted">
                        {new Date(event.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* My Requests */}
        <section className="rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-cric-text mb-4">My Requests</h2>
          {loading ? (
            <p className="text-sm font-semibold text-cric-muted">Loading...</p>
          ) : requests.length === 0 ? (
            <p className="text-xs font-semibold text-cric-muted">No requests yet — use the button above to request a team or tournament.</p>
          ) : (
            <ul className="space-y-3">
              {requests.map(r => (
                <li key={r._id} className="rounded-xl border border-cric-border bg-cric-bg p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-cric-text">{r.details?.name}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                        {typeLabel(r.type)} · submitted {new Date(r.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusStyles[r.status] || statusStyles.pending}`}>
                      {r.status}
                    </span>
                  </div>
                  {r.adminNote && <p className="mt-2 text-xs font-semibold text-cric-muted">Note: {r.adminNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}