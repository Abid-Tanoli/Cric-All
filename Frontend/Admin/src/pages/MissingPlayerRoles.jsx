import React, { useEffect, useState } from "react";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

// Mirrors PLAYING_ROLES in Backend/src/validators/playerValidators.js.
const ROLES = [
  "Batsman",
  "Bowler",
  "All-Rounder",
  "Batting-All-Rounder",
  "Bowling-All-Rounder",
  "Wicket-Keeper",
];

const errorText = (error) => {
  const data = error?.response?.data;
  if (Array.isArray(data?.errors) && data.errors.length) {
    return data.errors.map((item) => item.message).join("; ");
  }
  return data?.message || error?.message || "Something went wrong";
};

export default function MissingPlayerRoles() {
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [team, setTeam] = useState("");
  const [roles, setRoles] = useState({});
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState({ open: false, updates: [] });
  const { showToast } = useToast();

  const load = async () => {
    setError("");
    try {
      const { data } = await api.get("/admin/players/missing-role", {
        params: { page, limit: 25, search: term, team },
      });
      setPlayers(data.players || []);
      setTotal(data.totalPlayers ?? data.count ?? 0);
    } catch (err) {
      setError(errorText(err));
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    load();
  }, [page, term, team]);

  useEffect(() => {
    api
      .get("/teams", { params: { limit: 100 } })
      .then(({ data }) => setTeams(data.teams || data || []))
      .catch(() => setTeams([]));
  }, []);

  const setRole = (id, role) => setRoles((prev) => ({ ...prev, [id]: role }));

  const useSuggestion = (player) => {
    if (player.suggestedRole) setRole(player._id, player.suggestedRole);
  };

  const applyAllSuggestions = () => {
    const next = { ...roles };
    players.forEach((player) => {
      if (player.suggestedRole) next[player._id] = player.suggestedRole;
    });
    setRoles(next);
  };

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );

  const startBulkSave = async () => {
    if (!selected.length) {
      showToast("Select players first", "warning");
      return;
    }
    const updates = selected.map((playerId) => ({ playerId, role: roles[playerId] || "" }));
    if (updates.some((item) => !item.role)) {
      setError("Choose a role for every selected player.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Always dry-run first: the dialog only opens when the server agrees.
      await api.post("/admin/players/bulk-role", { dryRun: true, updates });
      setConfirm({ open: true, updates });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const saveRoles = async () => {
    const { updates } = confirm;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/players/bulk-role", { updates });
      showToast(`Updated role for ${data.count} player(s)`, "success");
      setConfirm({ open: false, updates: [] });
      setSelected([]);
      await load();
    } catch (err) {
      setError(errorText(err));
      setConfirm({ open: false, updates: [] });
    } finally {
      setBusy(false);
    }
  };

  const confirmMessage = confirm.updates
    .map((item) => {
      const player = players.find((row) => row._id === item.playerId);
      return `${player?.name || item.playerId} → ${item.role}`;
    })
    .join(", ");

  return (
    <div className="min-h-screen bg-cric-bg p-6 lg:p-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-widest text-cric-text">
            Players missing role
          </h1>
          <p className="mt-2 text-sm text-cric-muted">
            <span className="rounded-full bg-cric-accent/15 px-3 py-1 font-black text-cric-accent">
              {total} remaining
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={applyAllSuggestions}
            className="rounded-xl border border-cric-border px-4 py-3 text-xs font-black uppercase tracking-widest text-cric-text hover:bg-cric-card"
          >
            Apply all suggestions
          </button>
          <button
            type="button"
            onClick={startBulkSave}
            disabled={busy}
            className="rounded-xl bg-cric-accent px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
          >
            Set role for selected
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          aria-label="Search players"
          placeholder="Search players…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-64 flex-1 rounded-xl border border-cric-border bg-cric-card px-4 py-3 text-sm text-cric-text"
        />
        <select
          aria-label="Team filter"
          value={team}
          onChange={(event) => {
            setTeam(event.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-cric-border bg-cric-card px-4 py-3 text-sm text-cric-text"
        >
          <option value="">All teams</option>
          {teams.map((item) => (
            <option key={item._id} value={item._id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-cric-border bg-cric-card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
              <th className="p-3"><span className="sr-only">Select</span></th>
              <th className="p-3 text-left">Player</th>
              <th className="p-3 text-left">Team / Organization</th>
              <th className="p-3 text-left">Styles</th>
              <th className="p-3 text-left">Stats (M/R/W)</th>
              <th className="p-3 text-left">New role</th>
              <th className="p-3 text-left">Suggestion</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={player._id} className="border-t border-cric-border/60">
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${player.name}`}
                    checked={selected.includes(player._id)}
                    onChange={() => toggle(player._id)}
                  />
                </td>
                <td className="p-3 font-bold text-cric-text">
                  {player.name}
                  <div className="text-xs font-medium text-cric-muted">Current: {player.role || "blank"}</div>
                </td>
                <td className="p-3 text-cric-muted">
                  {player.teams?.length ? player.teams.map((item) => item.name).join(", ") : "No team"}
                  {player.organization ? <div className="text-xs">{player.organization}</div> : null}
                </td>
                <td className="p-3 text-cric-muted">
                  {player.battingStyle || "—"} / {player.bowlingStyle || "—"}
                </td>
                <td className="p-3 text-cric-muted">
                  {player.stats?.matches || 0} / {player.stats?.runs || 0} / {player.stats?.wickets || 0}
                </td>
                <td className="p-3">
                  <select
                    aria-label={`Role for ${player.name}`}
                    value={roles[player._id] || ""}
                    onChange={(event) => setRole(player._id, event.target.value)}
                    className="rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm text-cric-text"
                  >
                    <option value="">Choose role…</option>
                    {ROLES.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  {player.suggestedRole ? (
                    <button
                      type="button"
                      aria-label={`Use suggestion for ${player.name}`}
                      onClick={() => useSuggestion(player)}
                      className="rounded-lg border border-cric-border px-2 py-2 text-xs font-black text-cric-accent"
                    >
                      Use {player.suggestedRole}
                    </button>
                  ) : (
                    <span className="text-xs text-cric-muted">No data</span>
                  )}
                </td>
              </tr>
            ))}
            {!players.length && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-cric-muted">
                  No players missing a role.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs font-black uppercase tracking-widest text-cric-muted">
        <button
          type="button"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-cric-border px-4 py-2 disabled:opacity-40"
        >
          Prev
        </button>
        <span>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
        <button
          type="button"
          onClick={() => setPage((value) => value + 1)}
          disabled={page >= Math.ceil(total / 25)}
          className="rounded-lg border border-cric-border px-4 py-2 disabled:opacity-40"
        >
          Next
        </button>
      </div>

      <ConfirmModal
        open={confirm.open}
        title="Confirm role changes"
        message={`Update ${confirm.updates.length} player(s): ${confirmMessage}.`}
        confirmLabel={busy ? "Saving…" : "Save roles"}
        onCancel={() => setConfirm({ open: false, updates: [] })}
        onConfirm={saveRoles}
      />
    </div>
  );
}
