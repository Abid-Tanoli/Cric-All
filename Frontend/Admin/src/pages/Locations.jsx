import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";

const TYPES = [
  { value: "country", label: "Country", parent: null },
  { value: "province", label: "Province / Territory", parent: "country" },
  { value: "district", label: "District", parent: "province" },
  { value: "city", label: "City / Tehsil", parent: "district" },
  { value: "town", label: "Town / Area", parent: "city" },
];

const typeLabel = (type) => TYPES.find((item) => item.value === type)?.label || type;
const parentTypeOf = (type) => TYPES.find((item) => item.value === type)?.parent || null;

const inputCls =
  "w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#031d44]";
const btnPrimary =
  "rounded-xl bg-[#031d44] px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 disabled:opacity-50";
const btnGhost =
  "rounded-xl bg-slate-200 px-4 py-2 text-xs font-black uppercase tracking-widest text-[#031d44] hover:bg-slate-300 disabled:opacity-50";
const btnDanger =
  "rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50";

const errorMessage = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

export default function Locations() {
  const [tab, setTab] = useState("tree");

  const [filters, setFilters] = useState({ type: "province", parent: "", q: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [mergeTarget, setMergeTarget] = useState({});

  const [form, setForm] = useState({ type: "district", name: "", parent: "", source: "" });
  const [parents, setParents] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { limit: 500 };
      if (filters.type) params.type = filters.type;
      if (filters.parent) params.parent = filters.parent;
      if (filters.q.trim()) params.q = filters.q.trim();
      const res = await api.get("/locations/admin", { params });
      setRows(res.data?.locations || []);
    } catch (err) {
      setError(errorMessage(err, "Could not load locations"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const res = await api.get("/locations/admin/suggestions");
      setSuggestions(res.data?.locations || []);
    } catch (err) {
      setError(errorMessage(err, "Could not load suggestions"));
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === "suggestions") loadSuggestions();
  }, [tab, loadSuggestions]);

  // Candidate parents for the "add" form: the level directly above the chosen
  // type. A country has none.
  useEffect(() => {
    const parentType = parentTypeOf(form.type);
    if (!parentType) {
      setParents([]);
      setForm((f) => ({ ...f, parent: "" }));
      return;
    }
    api
      .get("/locations/admin", { params: { type: parentType, limit: 500, active: true, approved: true } })
      .then((res) => setParents(res.data?.locations || []))
      .catch(() => setParents([]));
  }, [form.type]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = String(row.parent || "root");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [rows]);

  const parentName = (parentId) => rows.find((row) => row._id === parentId)?.name || "";

  const submitAdd = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/locations/admin", {
        type: form.type,
        name: form.name.trim(),
        parent: parentTypeOf(form.type) ? form.parent || null : null,
        source: form.source.trim() || "Created by admin",
      });
      setForm((f) => ({ ...f, name: "", source: "" }));
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not create the location"));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (row, body) => {
    setError("");
    try {
      await api.patch(`/locations/admin/${row._id}`, body);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not update the location"));
    }
  };

  const rename = async (row) => {
    const name = window.prompt(`Rename “${row.name}”`, row.name);
    if (!name || name.trim() === row.name) return;
    await patch(row, { name: name.trim() });
  };

  const approve = async (row) => {
    setError("");
    try {
      await api.post(`/locations/admin/${row._id}/approve`);
      await loadSuggestions();
    } catch (err) {
      setError(errorMessage(err, "Could not approve the suggestion"));
    }
  };

  const reject = async (row) => {
    if (!window.confirm(`Reject “${row.name}”? This removes the suggestion.`)) return;
    setError("");
    try {
      await api.post(`/locations/admin/${row._id}/reject`);
      await loadSuggestions();
    } catch (err) {
      setError(errorMessage(err, "Could not reject the suggestion"));
    }
  };

  const merge = async (row) => {
    const target = (mergeTarget[row._id] || "").trim();
    if (!target) {
      setError("Paste the id of the location to merge into.");
      return;
    }
    if (!window.confirm("Merge this location into the target? References are rewritten.")) return;
    setError("");
    try {
      await api.post(`/locations/admin/${row._id}/merge`, { intoId: target });
      await loadSuggestions();
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not merge the locations"));
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Admin</p>
          <h1 className="mt-1 text-2xl font-black uppercase tracking-tight text-slate-900">Locations</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            Curated country / province / district / city / town tree and the user suggestion queue.
          </p>
        </header>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("tree")}
            className={tab === "tree" ? btnPrimary : btnGhost}
            aria-pressed={tab === "tree"}
          >
            Tree
          </button>
          <button
            type="button"
            onClick={() => setTab("suggestions")}
            className={tab === "suggestions" ? btnPrimary : btnGhost}
            aria-pressed={tab === "suggestions"}
          >
            Suggestions {suggestions.length ? `(${suggestions.length})` : ""}
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {tab === "tree" && (
          <>
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Level
                  <select
                    aria-label="Location level"
                    value={filters.type}
                    onChange={(event) => setFilters((f) => ({ ...f, type: event.target.value, parent: "" }))}
                    className={`${inputCls} mt-1`}
                  >
                    {TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Parent id (optional)
                  <input
                    aria-label="Parent id"
                    value={filters.parent}
                    onChange={(event) => setFilters((f) => ({ ...f, parent: event.target.value.trim() }))}
                    placeholder="Location id"
                    className={`${inputCls} mt-1`}
                  />
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Search
                  <input
                    aria-label="Search locations"
                    value={filters.q}
                    onChange={(event) => setFilters((f) => ({ ...f, q: event.target.value }))}
                    placeholder="Name or alias"
                    className={`${inputCls} mt-1`}
                  />
                </label>
                <div className="flex items-end">
                  <button type="button" onClick={load} className={btnGhost}>
                    Refresh
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Add a location</h2>
              <form onSubmit={submitAdd} className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Level
                  <select
                    aria-label="New location level"
                    value={form.type}
                    onChange={(event) => setForm((f) => ({ ...f, type: event.target.value, parent: "" }))}
                    className={`${inputCls} mt-1`}
                  >
                    {TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Parent
                  <select
                    aria-label="New location parent"
                    value={form.parent}
                    onChange={(event) => setForm((f) => ({ ...f, parent: event.target.value }))}
                    disabled={!parentTypeOf(form.type)}
                    className={`${inputCls} mt-1 disabled:opacity-50`}
                  >
                    <option value="">{parentTypeOf(form.type) ? `Select ${parentTypeOf(form.type)}` : "No parent"}</option>
                    {parents.map((parent) => (
                      <option key={parent._id} value={parent._id}>
                        {parent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Name
                  <input
                    aria-label="New location name"
                    value={form.name}
                    onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                    className={`${inputCls} mt-1`}
                    required
                  />
                </label>
                <div className="flex items-end">
                  <button type="submit" disabled={busy} className={btnPrimary}>
                    {busy ? "Saving…" : "Add"}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">
                {typeLabel(filters.type)}s {loading ? "· loading…" : `· ${rows.length}`}
              </h2>
              {rows.length === 0 && !loading ? (
                <p className="mt-3 text-sm font-semibold text-slate-500">No locations at this level.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <th className="py-2">Name</th>
                        <th className="py-2">Parent</th>
                        <th className="py-2">Source</th>
                        <th className="py-2">State</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row._id} className="border-t border-slate-200">
                          <td className="py-2 font-bold text-slate-900">
                            {row.name}
                            {row.aliases?.length ? (
                              <span className="ml-2 text-[11px] font-semibold text-slate-400">
                                ({row.aliases.join(", ")})
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 text-slate-600">{row.parent ? parentName(row.parent) || row.parent : "—"}</td>
                          <td className="py-2 text-[11px] text-slate-500">{row.source || "—"}</td>
                          <td className="py-2">
                            <span
                              className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                                row.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {row.active ? "Active" : "Inactive"}
                            </span>
                            {!row.approved && (
                              <span className="ml-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                                Unapproved
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button type="button" onClick={() => rename(row)} className={btnGhost}>
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => patch(row, { active: !row.active })}
                                className={row.active ? btnDanger : btnPrimary}
                              >
                                {row.active ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {grouped.size > 1 && (
                <p className="mt-3 text-[11px] font-semibold text-slate-500">
                  Rows span {grouped.size} parents; use the parent filter to narrow the tree.
                </p>
              )}
            </section>
          </>
        )}

        {tab === "suggestions" && (
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">
              Suggested locations {suggestionsLoading ? "· loading…" : `· ${suggestions.length}`}
            </h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Unapproved nodes are hidden from everyone except their creator and admins.
            </p>
            {suggestions.length === 0 && !suggestionsLoading ? (
              <p className="mt-3 text-sm font-semibold text-slate-500">Nothing waiting for review.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {suggestions.map((row) => (
                  <li key={row._id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-900">
                          {row.name} <span className="text-[11px] font-black uppercase text-slate-400">{row.type}</span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Parent {row.parent || "—"}
                          {row.createdBy?.name ? ` · by ${row.createdBy.name}` : ""}
                          {row.createdAt ? ` · ${new Date(row.createdAt).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <button type="button" onClick={() => approve(row)} className={btnPrimary}>
                          Approve
                        </button>
                        <button type="button" onClick={() => reject(row)} className={btnDanger}>
                          Reject
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Merge into (target id)
                        <input
                          aria-label={`Merge ${row.name} into`}
                          value={mergeTarget[row._id] || ""}
                          onChange={(event) =>
                            setMergeTarget((current) => ({ ...current, [row._id]: event.target.value.trim() }))
                          }
                          placeholder="Approved location id"
                          className={`${inputCls} mt-1 w-64`}
                        />
                      </label>
                      <button type="button" onClick={() => merge(row)} className={btnGhost}>
                        Merge
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
