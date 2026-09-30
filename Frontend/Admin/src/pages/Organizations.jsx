import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import ConfirmModal from "../components/ConfirmModal";

const errMsg = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

const inputCls =
  "w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-3 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent";
const labelCls = "block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2";
const btnCls =
  "rounded-lg bg-cric-accent px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-orange-600 disabled:opacity-60";

export default function Organizations() {
  const [orgs, setOrgs] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const [editing, setEditing] = useState(null); // org object being edited
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null); // org pending delete

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [orgRes, catRes] = await Promise.all([
        api.get("/organizations", {
          params: { page, limit: PAGE_SIZE, ...(search.trim() ? { search: search.trim() } : {}) },
        }),
        api.get("/team-categories").catch(() => ({ data: [] })),
      ]);
      // The endpoint is paginated: { items, total, page, limit, pages }.
      const payload = orgRes.data || {};
      setOrgs(Array.isArray(payload) ? payload : payload.items || []);
      if (!Array.isArray(payload)) setTotal(payload.total || 0);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
    } catch (error) {
      setErr(errMsg(error, "Failed to load organizations"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const openEdit = (org) => {
    setEditing(org);
    setForm({
      name: org.name || "",
      shortName: org.shortName || "",
      description: org.description || "",
      website: org.website || "",
      category: org.category?._id || "",
      isActive: org.isActive !== false,
    });
    setErr(null);
    setNotice("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await api.put(`/organizations/${editing._id}`, {
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        description: form.description.trim(),
        website: form.website.trim(),
        category: form.category || undefined,
        isActive: form.isActive,
      });
      setNotice(`"${form.name}" updated.`);
      setEditing(null);
      setForm(null);
      await load();
    } catch (error) {
      setErr(errMsg(error, "Could not update the organization"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (org) => {
    setErr(null);
    try {
      await api.put(`/organizations/${org._id}`, { isActive: org.isActive === false });
      setNotice(`"${org.name}" ${org.isActive === false ? "activated" : "deactivated"}.`);
      await load();
    } catch (error) {
      setErr(errMsg(error, "Could not change status"));
    }
  };

  const confirmDelete = async () => {
    setErr(null);
    try {
      await api.delete(`/organizations/${deleting._id}`);
      setNotice(`"${deleting.name}" deleted.`);
      setDeleting(null);
      await load();
    } catch (error) {
      setErr(errMsg(error, "Could not delete the organization"));
      setDeleting(null);
    }
  };

  // Searching happens server side so it covers every page, not just this one.
  const filtered = orgs;
  // These two describe the current page, so they are labelled as such below.
  const ownerless = orgs.filter((o) => !o.owner).length;
  const inactive = orgs.filter((o) => o.isActive === false).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-cric-text">Organizations</h1>
          <p className="text-sm text-cric-muted mt-1">
            Supervisory view — organizations self-manage from the user site; you can override anything here.
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search organizations..."
          className={`${inputCls} max-w-xs`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total", value: total },
          { label: "Ownerless on this page", value: ownerless },
          { label: "Inactive on this page", value: inactive },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-cric-border bg-cric-card p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">{s.label}</p>
            <p className="mt-1 text-2xl font-black text-cric-text">{s.value}</p>
          </div>
        ))}
      </div>

      {err && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{err}</div>}
      {notice && <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</div>}

      <div className="rounded-2xl border border-cric-border bg-cric-card shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-cric-border text-[10px] font-black uppercase tracking-widest text-cric-muted">
              <th className="text-left px-4 py-3">Organization</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Owner</th>
              <th className="text-right px-4 py-3">Teams</th>
              <th className="text-right px-4 py-3">Players</th>
              <th className="text-right px-4 py-3">Members</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-cric-muted font-semibold">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-cric-muted font-semibold">No organizations found.</td></tr>
            ) : (
              filtered.map((org) => (
                <tr key={org._id} className="border-b border-cric-border/60 last:border-0 hover:bg-cric-bg/50">
                  <td className="px-4 py-3">
                    <p className="font-black text-cric-text">{org.name}</p>
                    {org.shortName && <p className="text-[10px] font-bold uppercase tracking-widest text-cric-muted">{org.shortName}</p>}
                  </td>
                  <td className="px-4 py-3 text-cric-muted font-semibold">{org.category?.name || "—"}</td>
                  <td className="px-4 py-3">
                    {org.owner ? (
                      <span className="font-semibold text-cric-text">{org.owner.name}</span>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Platform-managed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-cric-muted">{org.branchCount ?? 0}</td>
                  <td className="px-4 py-3 text-right font-semibold text-cric-muted">{org.totalPlayers ?? 0}</td>
                  <td className="px-4 py-3 text-right font-semibold text-cric-muted">{org.memberCount ?? 0}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                        org.isActive === false
                          ? "border-red-300 bg-red-50 text-red-600"
                          : "border-green-300 bg-green-50 text-green-700"
                      }`}
                    >
                      {org.isActive === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => openEdit(org)}
                        className="rounded-lg border border-cric-border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(org)}
                        className="rounded-lg border border-cric-border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                      >
                        {org.isActive === false ? "Activate" : "Deactivate"}
                      </button>
                      <button
                        onClick={() => setDeleting(org)}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
            Page {page} of {totalPages} · {total} organizations
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={loading || page <= 1}
              className="rounded-lg border border-cric-border px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={loading || page >= totalPages}
              className="rounded-lg border border-cric-border px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && form && (
        <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form onSubmit={save} className="bg-cric-card rounded-2xl border border-cric-border shadow-2xl max-w-lg w-full mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-black text-cric-text">Edit Organization</h3>
              <p className="text-xs text-cric-muted">Full supervisory control — every field is editable here.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} required minLength={2} />
              </div>
              <div>
                <label className={labelCls}>Short Name</label>
                <input value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls}>
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://..." className={inputCls} />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-cric-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4 accent-[var(--color-cric-accent,#f97316)]"
              />
              Active (visible on the site)
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setEditing(null); setForm(null); }}
                className="rounded-lg border border-cric-border px-5 py-2.5 text-xs font-black uppercase tracking-widest text-cric-muted"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving || form.name.trim().length < 2} className={btnCls}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        variant="danger"
        title="Delete organization"
        message={deleting ? `"${deleting.name}" can only be deleted if it has no teams and no sub-organizations.` : ""}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
