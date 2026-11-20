import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { API_BASE_URL } from "../services/api";
import { useToast } from "../components/Toast";

// Local sponsor catalog. These are plain public-content records, deliberately
// kept separate from AdSense and AdSlot placements. The backend validates link
// schemes and logo bytes, enforces the per-tournament caps, and audits deletes.

const BLANK_FORM = {
  name: "",
  logoUrl: "",
  linkUrl: "",
  tier: "supporting",
  order: 0,
  active: true,
  scope: "tournament",
  tournamentRef: "",
};

const inputCls =
  "border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44] w-full";
const btnPrimary =
  "bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2 disabled:opacity-50";
const btnGhost =
  "bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2 disabled:opacity-50";
const btnDanger =
  "bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2 disabled:opacity-50";

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const assetUrl = (url) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const idOf = (value) => String(value?._id || value || "");
const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const formFromSponsor = (sponsor) => ({
  name: sponsor.name || "",
  logoUrl: sponsor.logoUrl || "",
  linkUrl: sponsor.linkUrl || "",
  tier: sponsor.tier === "title" ? "title" : "supporting",
  order: Number(sponsor.order) || 0,
  active: sponsor.active !== false,
  scope: sponsor.scope === "platform" ? "platform" : "tournament",
  tournamentRef: sponsor.scope === "platform" ? "" : idOf(sponsor.tournamentRef),
});

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-slate-500 mt-1">{hint}</span> : null}
    </label>
  );
}

export default function Sponsors() {
  const { showToast } = useToast();
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [tournaments, setTournaments] = useState([]);
  const [filterId, setFilterId] = useState("");
  const [sponsors, setSponsors] = useState([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const loadSponsors = useCallback(
    async (tournamentId) => {
      setStatus("loading");
      setError("");
      try {
        const response = await api.get(
          "/admin/sponsors",
          tournamentId ? { params: { tournamentId } } : {}
        );
        setSponsors(Array.isArray(response.data) ? response.data : response.data?.data || []);
        setStatus("ready");
      } catch (err) {
        setError(errorMessage(err, "Failed to load sponsors"));
        setStatus("error");
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await api.get("/tournaments");
        const list = Array.isArray(response.data) ? response.data : response.data?.data || [];
        if (active) setTournaments(list);
      } catch (err) {
        if (active) setTournaments([]);
      }
      if (active) await loadSponsors("");
    })();
    return () => {
      active = false;
    };
  }, [loadSponsors]);

  // A filtered view is a convenient default target for a new tournament sponsor.
  useEffect(() => {
    if (!editingId && filterId) {
      setForm((prev) => ({ ...prev, tournamentRef: prev.tournamentRef || filterId }));
    }
  }, [filterId, editingId]);

  const titleCount = useMemo(
    () => sponsors.filter((sponsor) => sponsor.active && sponsor.tier === "title").length,
    [sponsors]
  );
  const supportingCount = useMemo(
    () => sponsors.filter((sponsor) => sponsor.active && sponsor.tier === "supporting").length,
    [sponsors]
  );

  const resetForm = () => {
    setForm({ ...BLANK_FORM, tournamentRef: filterId });
    setEditingId(null);
    setLogoFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const changeFilter = (event) => {
    const next = event.target.value;
    setFilterId(next);
    setForm((prev) => ({ ...prev, tournamentRef: next || prev.tournamentRef }));
    loadSponsors(next);
  };

  const saveSponsor = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.logoUrl.trim()) {
      showToast("Enter a name and a logo URL, or upload a logo first", "error");
      return;
    }
    if (form.scope === "tournament" && !form.tournamentRef) {
      showToast("Choose the tournament this sponsor belongs to", "error");
      return;
    }
    const payload = {
      name: form.name.trim(),
      logoUrl: form.logoUrl.trim(),
      linkUrl: form.linkUrl.trim(),
      tier: form.tier,
      order: Number(form.order) || 0,
      active: form.active,
      scope: form.scope,
      tournamentRef: form.scope === "tournament" ? form.tournamentRef : null,
    };
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/admin/sponsors/${editingId}`, payload);
      } else {
        await api.post("/admin/sponsors", payload);
      }
      resetForm();
      await loadSponsors(filterId);
      showToast(editingId ? "Sponsor updated" : "Sponsor created", "success");
    } catch (err) {
      showToast(errorMessage(err, "Failed to save sponsor"), "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async () => {
    if (!logoFile) {
      showToast("Choose a logo file first", "error");
      return;
    }
    const formData = new FormData();
    formData.append("logo", logoFile);
    setBusy(true);
    try {
      const response = await api.post("/admin/sponsors/logo", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = response.data?.url || "";
      if (!url) throw new Error("The upload did not return a logo URL");
      setForm((prev) => ({ ...prev, logoUrl: url }));
      setLogoFile(null);
      if (fileRef.current) fileRef.current.value = "";
      showToast("Logo uploaded", "success");
    } catch (err) {
      showToast(errorMessage(err, "Failed to upload logo"), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (sponsor) => {
    setBusy(true);
    try {
      await api.put(`/admin/sponsors/${idOf(sponsor)}`, { active: !sponsor.active });
      await loadSponsors(filterId);
      showToast(sponsor.active ? "Sponsor deactivated" : "Sponsor activated", "success");
    } catch (err) {
      showToast(errorMessage(err, "Failed to change sponsor status"), "error");
    } finally {
      setBusy(false);
    }
  };

  const moveSponsor = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sponsors.length) return;
    const next = [...sponsors];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const response = await api.put("/admin/sponsors/reorder", { ids: next.map(idOf) });
      const saved = Array.isArray(response.data) ? response.data : null;
      setSponsors(saved?.length ? saved : next);
      showToast("Sponsor order saved", "success");
    } catch (err) {
      showToast(errorMessage(err, "Failed to reorder sponsors"), "error");
    } finally {
      setBusy(false);
    }
  };

  const removeSponsor = async (sponsor) => {
    if (!window.confirm(`Delete sponsor ${sponsor.name}? The deletion is audit-logged.`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/sponsors/${idOf(sponsor)}`);
      if (editingId === idOf(sponsor)) resetForm();
      await loadSponsors(filterId);
      showToast("Sponsor deleted and audit-logged", "success");
    } catch (err) {
      showToast(errorMessage(err, "Failed to delete sponsor"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading" && sponsors.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
        <p className="text-slate-500">Loading sponsors…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
        <Link to="/admin/tournaments" className="text-sm font-bold text-[#031d44] hover:underline">
          ← Back to tournaments
        </Link>
        <div className="mt-6 bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
          <p className="text-red-600 font-bold">{error}</p>
          <button type="button" className={`${btnGhost} mt-4`} onClick={() => loadSponsors(filterId)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      <Link to="/admin/tournaments" className="text-sm font-bold text-[#031d44] hover:underline">
        ← Back to tournaments
      </Link>
      <h1 className="text-3xl lg:text-4xl font-black text-[#031d44] mt-2 mb-1" data-testid="sponsors-title">
        Local sponsors
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        Plain sponsor content for the public tournament and match strips. AdSense and AdSlot placements
        are managed separately.
      </p>

      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <Field label="Tournament filter">
              <select
                aria-label="Tournament filter"
                className={inputCls}
                value={filterId}
                onChange={changeFilter}
              >
                <option value="">All tournaments (whole catalog)</option>
                {tournaments.map((tournament) => (
                  <option key={idOf(tournament)} value={idOf(tournament)}>
                    {tournament.name || "Untitled tournament"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-xs font-bold text-slate-500 pb-3">
            Showing {sponsors.length} sponsor(s) · {titleCount} active title · {supportingCount} active supporting
          </p>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          A tournament filter shows that tournament&apos;s sponsors plus platform-wide sponsors. Only one
          active title and six active supporting sponsors are allowed per tournament view.
        </p>
      </div>

      <form onSubmit={saveSponsor} className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-6 max-w-4xl">
        <h2 className="text-xl font-bold text-[#031d44] mb-4">
          {editingId ? "Edit sponsor" : "Add a sponsor"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Sponsor name">
            <input
              aria-label="Sponsor name"
              className={inputCls}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              maxLength={100}
            />
          </Field>
          <Field label="Logo URL" hint="Or upload a logo; the upload fills this field.">
            <input
              aria-label="Logo URL"
              className={inputCls}
              value={form.logoUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, logoUrl: event.target.value }))}
              placeholder="/uploads/logo.png or https://…"
              maxLength={600}
            />
          </Field>
          <Field label="Link URL" hint="Optional. Only https:// links and https://wa.me/<number> are stored.">
            <input
              aria-label="Link URL"
              className={inputCls}
              value={form.linkUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, linkUrl: event.target.value }))}
              placeholder="https://example.com"
              maxLength={600}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tier">
              <select
                aria-label="Tier"
                className={inputCls}
                value={form.tier}
                onChange={(event) => setForm((prev) => ({ ...prev, tier: event.target.value }))}
              >
                <option value="supporting">Supporting</option>
                <option value="title">Title</option>
              </select>
            </Field>
            <Field label="Order">
              <input
                aria-label="Order"
                type="number"
                min={0}
                max={999}
                className={inputCls}
                value={form.order}
                onChange={(event) => setForm((prev) => ({ ...prev, order: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Scope" hint="Platform-wide sponsors appear on every tournament and count toward its caps.">
            <select
              aria-label="Scope"
              className={inputCls}
              value={form.scope}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  scope: event.target.value,
                  tournamentRef: event.target.value === "platform" ? "" : filterId || prev.tournamentRef,
                }))
              }
            >
              <option value="tournament">This tournament</option>
              <option value="platform">Platform-wide</option>
            </select>
          </Field>
          <Field label="Tournament">
            <select
              aria-label="Tournament"
              className={inputCls}
              value={form.tournamentRef}
              disabled={form.scope !== "tournament"}
              onChange={(event) => setForm((prev) => ({ ...prev, tournamentRef: event.target.value }))}
            >
              <option value="">— Choose a tournament —</option>
              {tournaments.map((tournament) => (
                <option key={idOf(tournament)} value={idOf(tournament)}>
                  {tournament.name || "Untitled tournament"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid items-end gap-3 md:grid-cols-[1fr_auto] mt-4">
          <Field label="Logo file" hint="PNG, JPEG, WebP or SVG up to 5 MB; file bytes are checked by the server.">
            <input
              ref={fileRef}
              aria-label="Logo file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className={inputCls}
              onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
            />
          </Field>
          <button type="button" className={btnGhost} disabled={busy || !logoFile} onClick={uploadLogo}>
            Upload logo
          </button>
        </div>
        {form.logoUrl ? (
          <img
            src={assetUrl(form.logoUrl)}
            alt="Sponsor logo preview"
            className="mt-4 h-20 w-20 rounded-xl border border-slate-200 bg-white object-contain"
          />
        ) : null}
        <label className="flex items-center gap-2 mt-4 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
          />
          Active (shown publicly)
        </label>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? "Saving…" : editingId ? "Save sponsor" : "Add sponsor"}
          </button>
          {editingId ? (
            <button type="button" className={btnGhost} disabled={busy} onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6" data-testid="sponsor-list">
        <h2 className="text-xl font-bold text-[#031d44] mb-4">Sponsors ({sponsors.length})</h2>
        {sponsors.length === 0 ? (
          <p className="text-sm text-slate-500">No sponsors match this filter.</p>
        ) : (
          <div className="space-y-3">
            {sponsors.map((sponsor, index) => (
              <div key={idOf(sponsor)} className="border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <img
                      src={assetUrl(sponsor.logoUrl)}
                      alt={`${sponsor.name} logo`}
                      className="h-full w-full object-contain"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-[#031d44] truncate">{sponsor.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {sponsor.tier} · {sponsor.scope === "platform" ? "platform-wide" : "tournament"} ·{" "}
                      {sponsor.active ? "active" : "inactive"} · order {sponsor.order || 0}
                      {sponsor.linkUrl ? ` · ${sponsor.linkUrl}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${sponsor.name} up`}
                    className={btnGhost}
                    disabled={busy || index === 0}
                    onClick={() => moveSponsor(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${sponsor.name} down`}
                    className={btnGhost}
                    disabled={busy || index === sponsors.length - 1}
                    onClick={() => moveSponsor(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => {
                      setForm(formFromSponsor(sponsor));
                      setEditingId(idOf(sponsor));
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className={btnGhost} disabled={busy} onClick={() => toggleActive(sponsor)}>
                    {sponsor.active ? "Deactivate" : "Activate"}
                  </button>
                  <button type="button" className={btnDanger} disabled={busy} onClick={() => removeSponsor(sponsor)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
