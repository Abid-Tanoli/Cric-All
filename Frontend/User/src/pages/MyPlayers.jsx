// "My players" — the signed-in account's own player profiles.
//
// The page is deliberately narrow: a profile you created, the fields you may
// change on it, and a way to delete it. It does *not* offer a team picker,
// because team membership is not the profile owner's decision to make — a
// manager of that team adds them to a squad, and until then the profile is a
// free agent, which is a perfectly normal thing to be.

import React, { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { createMyPlayer, deleteMyPlayer, listMyPlayers, updateMyPlayer } from "../services/playerApi";
import { getStoredUser } from "./auth/auth";
import { Banner, card, dangerButton, eyebrow, primaryButton, secondaryButton, Field, input } from "./organization/orgStyles";
import { PLAYING_ROLES, BATTING_STYLES, BOWLING_STYLES, PLAYER_CATEGORIES, AGE_GROUPS } from "../lib/playerFields";

const EMPTY = {
  name: "",
  playingRole: "",
  battingStyle: "",
  bowlingStyle: "",
  category: "",
  subCategory: "",
  ageGroup: "",
  organization: "",
  imageUrl: "",
  town: "",
  district: "",
  city: "",
  province: "",
};

/** Only send the keys the user actually filled in, so a PUT never blanks a field. */
function toPayload(form) {
  const payload = {};
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === "string" && value.trim() === "") continue;
    payload[key] = typeof value === "string" ? value.trim() : value;
  }
  if (
    payload.town ||
    payload.district ||
    payload.city ||
    payload.province
  ) {
    payload.address = {
      ...(payload.town ? { town: payload.town } : {}),
      ...(payload.district ? { district: payload.district } : {}),
      ...(payload.city ? { city: payload.city } : {}),
      ...(payload.province ? { province: payload.province } : {}),
    };
  }
  for (const key of ["town", "district", "city", "province"]) delete payload[key];
  return payload;
}

function PlayerFormFields({ form, setForm }) {
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const select = (key, options, placeholder) => (
    <select value={form[key] || ""} onChange={set(key)} className={input}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <Field label="Full name">
        <input value={form.name} onChange={set("name")} className={input} placeholder="As it should appear on a scorecard" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Playing role">{select("playingRole", PLAYING_ROLES, "Select role")}</Field>
        <Field label="Batting style">{select("battingStyle", BATTING_STYLES, "Select style")}</Field>
        <Field label="Bowling style">{select("bowlingStyle", BOWLING_STYLES, "Select style")}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category">{select("category", PLAYER_CATEGORIES, "Not set")}</Field>
        <Field label="Age group">{select("ageGroup", AGE_GROUPS, "Not set")}</Field>
        <Field label="Institution or club">
          <input value={form.organization} onChange={set("organization")} className={input} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Photo URL" hint="An http(s) link to a photo, or leave it empty.">
        <input value={form.imageUrl} onChange={set("imageUrl")} className={input} placeholder="https://…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Town">
          <input value={form.town} onChange={set("town")} className={input} />
        </Field>
        <Field label="District">
          <input value={form.district} onChange={set("district")} className={input} />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={set("city")} className={input} />
        </Field>
        <Field label="Province">
          <input value={form.province} onChange={set("province")} className={input} />
        </Field>
      </div>
    </div>
  );
}

function PlayerRow({ player, onEdit, onDelete, busyId }) {
  const busy = busyId === player._id;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-cric-border bg-cric-bg p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-black uppercase tracking-wide text-cric-text">{player.name}</p>
        <p className="mt-1 text-xs font-semibold text-cric-muted">
          {[player.playingRole, player.battingStyle, player.category, player.ageGroup]
            .filter(Boolean)
            .join(" · ") || "No role set yet"}
        </p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
          {player.team?.name ? `Plays for ${player.team.name}` : "Free agent — not in a squad yet"}
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onEdit(player)} className={secondaryButton}>
          Edit
        </button>
        <button type="button" onClick={() => onDelete(player)} disabled={busy} className={dangerButton}>
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

export default function MyPlayers() {
  const storedUser = getStoredUser();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await listMyPlayers();
      setPlayers(Array.isArray(res?.items) ? res.items : []);
    } catch (error) {
      setErr(error.message || "Failed to load your players");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (storedUser) load();
  }, [storedUser, load]);

  if (!storedUser) return <Navigate to="/login?next=/my-players" replace />;

  // An unverified account is refused by the server with a 403. Saying so here
  // is more useful than a bare "you do not have permission".
  const unverified = storedUser.emailVerified === false;

  const reset = () => {
    setForm(EMPTY);
    setEditingId(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setErr("A player needs a name");
      return;
    }
    setSaving(true);
    setErr("");
    setNotice(null);
    try {
      const payload = toPayload(form);
      const saved = editingId
        ? await updateMyPlayer(editingId, payload)
        : await createMyPlayer(payload);
      const ignored = saved?.ignoredFields;
      setNotice({
        kind: ignored?.length ? "info" : "success",
        text: ignored?.length
          ? `Saved. These fields are managed elsewhere and were left alone: ${ignored.join(", ")}.`
          : editingId
            ? "Profile updated"
            : "Profile created — it is a free agent until a manager adds it to a squad.",
      });
      reset();
      load();
    } catch (error) {
      setErr(error.message || "Could not save the profile");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (player) => {
    setEditingId(player._id);
    setNotice(null);
    setErr("");
    setForm({
      ...EMPTY,
      name: player.name || "",
      playingRole: player.playingRole || "",
      battingStyle: player.battingStyle || "",
      bowlingStyle: player.bowlingStyle || "",
      category: player.category || "",
      subCategory: player.subCategory || "",
      ageGroup: player.ageGroup || "",
      organization: player.organization || "",
      imageUrl: player.imageUrl || "",
      town: player.address?.town || "",
      district: player.address?.district || "",
      city: player.address?.city || "",
      province: player.address?.province || "",
    });
  };

  const doDelete = async (player) => {
    setBusyId(player._id);
    setErr("");
    try {
      await deleteMyPlayer(player._id);
      if (editingId === player._id) reset();
      setNotice({ kind: "success", text: `Deleted ${player.name}.` });
      load();
    } catch (error) {
      setErr(error.message || "Could not delete the profile");
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  };

  return (
    <div className="min-h-screen bg-cric-bg px-4 py-8 text-cric-text">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className={card}>
          <p className={eyebrow}>Player profiles</p>
          <h1 className="mt-1 text-2xl font-black uppercase tracking-tight">My players</h1>
          <p className="mt-2 text-xs font-semibold text-cric-muted">
            A profile you create here belongs to you: you can edit or delete it at any time. Career
            statistics are not editable here — they are produced by scoring real matches. To put a
            player into a squad, ask a manager of that team, or manage the team yourself under{" "}
            <Link to="/organization" className="font-black text-cric-accent underline">
              My Organizations
            </Link>
            .
          </p>
        </div>

        {unverified ? (
          <Banner kind="error">
            Confirm your email address before creating a player profile — a profile is a public claim
            about a person, so it needs a verified account behind it.
          </Banner>
        ) : null}
        {err ? <Banner kind="error">{err}</Banner> : null}
        {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}

        <div className={card}>
          <h2 className="text-sm font-black uppercase tracking-widest">
            {editingId ? "Edit player" : "Add a player"}
          </h2>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <PlayerFormFields form={form} setForm={setForm} />
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={saving || unverified} className={primaryButton}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Create profile"}
              </button>
              {editingId ? (
                <button type="button" onClick={reset} className={secondaryButton}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </div>

        <div className={card}>
          <h2 className="text-sm font-black uppercase tracking-widest">Your profiles</h2>
          {loading ? (
            <p className="mt-4 text-sm font-semibold text-cric-muted">Loading…</p>
          ) : players.length === 0 ? (
            <p className="mt-4 text-sm font-semibold text-cric-muted">
              You have not created a player profile yet. Anything you add here stays a free agent
              until a team manager signs it up to a squad.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {players.map((player) => (
                <PlayerRow
                  key={player._id}
                  player={player}
                  busyId={busyId}
                  onEdit={startEdit}
                  onDelete={(p) => setConfirming(p)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-cric-text/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest">Delete {confirming.name}?</h2>
            <p className="mt-2 text-xs font-semibold text-cric-muted">
              This removes the profile for good, along with its place in any squad. Matches that
              already record this player keep their scorecard.
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => doDelete(confirming)} className={dangerButton}>
                Delete permanently
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={secondaryButton}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
