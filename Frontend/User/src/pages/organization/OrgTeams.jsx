import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createOrgTeam,
  deleteOrgTeam,
  listOrgTeamsManaged,
  listOrganizationTypes,
  updateOrgTeam,
} from "../../services/organizationApi";
import { PERMISSIONS, can, formatDate } from "../../lib/orgUi";
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

const AGE_GROUPS = ["U-10", "U-13", "U-15", "U-17", "U-19", "Open"];

const emptyTeam = {
  name: "",
  shortName: "",
  category: "",
  ageGroup: "Open",
  homeGround: "",
  description: "",
};

const TEAM_NAME_HINT =
  "Team names are unique across CricAll, so pick something specific to this organization.";

function TeamForm({ orgId, categories, initial, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({ ...emptyTeam, ...(initial || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const payload = {
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        ageGroup: form.ageGroup,
        homeGround: form.homeGround.trim(),
        description: form.description.trim(),
      };
      if (form.category) payload.category = form.category;
      if (initial) await updateOrgTeam(orgId, initial._id, payload);
      else await createOrgTeam(orgId, payload);
      onDone();
    } catch (error) {
      setErr(error.message || "Could not save the team");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {err ? <Banner kind="error">{err}</Banner> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Team name *" hint={TEAM_NAME_HINT}>
          <input value={form.name} onChange={set("name")} className={input} required minLength={2} maxLength={150} />
        </Field>
        <Field label="Short name">
          <input value={form.shortName} onChange={set("shortName")} className={input} maxLength={20} />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Category" hint={categories.length === 0 ? "No categories configured yet." : undefined}>
          <select value={form.category} onChange={set("category")} className={input}>
            <option value="">— Not set —</option>
            {categories.map((category) => (
              <option key={category._id} value={category.name}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Age group">
          <select value={form.ageGroup} onChange={set("ageGroup")} className={input}>
            {AGE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Home ground">
          <input value={form.homeGround} onChange={set("homeGround")} className={input} maxLength={200} />
        </Field>
      </div>
      <Field label="About this team">
        <textarea value={form.description} onChange={set("description")} rows={3} className={input} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={busy || form.name.trim().length < 2} className={primaryButton}>
          {busy ? "Saving…" : initial ? "Save team" : "Create team"}
        </button>
      </div>
    </form>
  );
}

export default function OrgTeams({ orgId, access, onChanged }) {
  const [teams, setTeams] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const permissions = access?.permissions || [];
  const canManageTeams = can(permissions, PERMISSIONS.MANAGE_TEAMS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOrgTeamsManaged(orgId, search.trim() ? { search: search.trim() } : {});
      setTeams(res.items || []);
    } catch (error) {
      setErr(error.message || "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [orgId, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listOrganizationTypes()
      .then((res) => setCategories(Array.isArray(res) ? res : []))
      .catch(() => setCategories([]));
  }, []);

  const remove = async (team) => {
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      await deleteOrgTeam(orgId, team._id);
      setNotice(`"${team.name}" deleted.`);
      setConfirmDelete(null);
      await load();
      onChanged?.();
    } catch (error) {
      setErr(error.message || "Could not delete the team");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>Teams</h2>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              Teams created here belong to this organization only. {TEAM_NAME_HINT}
            </p>
          </div>
          {canManageTeams && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams"
                className="w-48 rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-xs font-semibold text-cric-text focus:outline-none focus:border-cric-accent"
              />
              <button
                type="button"
                onClick={() => {
                  setCreating((v) => !v);
                  setEditingId(null);
                }}
                className={primaryButton}
              >
                {creating ? "Cancel" : "+ New team"}
              </button>
            </div>
          )}
        </div>

        {err ? <div className="mt-4"><Banner kind="error">{err}</Banner></div> : null}
        {notice ? <div className="mt-4"><Banner kind="success">{notice}</Banner></div> : null}

        {creating && (
          <div className="mt-5 border-t border-cric-border pt-5">
            <TeamForm
              orgId={orgId}
              categories={categories}
              onCancel={() => setCreating(false)}
              onDone={async () => {
                setCreating(false);
                setNotice("Team created.");
                await load();
                onChanged?.();
              }}
            />
          </div>
        )}

        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="text-sm font-semibold text-cric-muted">Loading teams…</p>
          ) : teams.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cric-border bg-cric-bg p-6 text-center">
              <p className="text-sm font-bold text-cric-text">
                {search.trim() ? "No teams match your search" : "No teams yet"}
              </p>
              <p className="mt-1 text-xs font-semibold text-cric-muted">
                {canManageTeams
                  ? "Create the first team for this organization above."
                  : "Your roles do not include creating teams."}
              </p>
            </div>
          ) : (
            teams.map((team) => (
              <div key={team._id} className={cardSubtle}>
                {editingId === team._id ? (
                  <TeamForm
                    orgId={orgId}
                    categories={categories}
                    initial={{
                      _id: team._id,
                      name: team.name,
                      shortName: team.shortName,
                      category: team.category,
                      ageGroup: team.ageGroup,
                      homeGround: team.homeGround,
                      description: team.description,
                    }}
                    onCancel={() => setEditingId(null)}
                    onDone={async () => {
                      setEditingId(null);
                      setNotice("Team updated.");
                      await load();
                    }}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-cric-text">{team.name}</p>
                        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                          {team.shortName ? `${team.shortName} · ` : ""}
                          {team.category || "Uncategorised"} · {team.ageGroup || "Open"}
                          {team.isActive === false ? " · inactive" : ""}
                        </p>
                        {team.homeGround ? (
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                            {team.homeGround}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                          {Array.isArray(team.players) ? team.players.length : 0} player(s) · created{" "}
                          {formatDate(team.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/teams/${team._id}`}
                          className="rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                        >
                          View
                        </Link>
                        {canManageTeams && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(team._id);
                                setCreating(false);
                              }}
                              className="rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(team)}
                              className={dangerButton}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {confirmDelete?._id === team._id && (
                      <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4">
                        <p className="text-sm font-bold text-red-700">
                          Delete “{team.name}”? Its players are detached and the team is removed for
                          everyone.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => remove(team)}
                            disabled={busy}
                            className="rounded-lg bg-red-600 px-5 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
                          >
                            Yes, delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className="rounded-lg border border-cric-border bg-white px-5 py-2 text-xs font-black uppercase tracking-widest text-cric-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <p className={`mt-4 ${eyebrow}`}>
          Squads and match scheduling are edited on the team&apos;s own page.
        </p>
      </div>
    </div>
  );
}
