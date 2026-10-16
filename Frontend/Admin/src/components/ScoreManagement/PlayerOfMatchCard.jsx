import React, { useEffect, useMemo, useState } from "react";
import api from "../../services/api";

const selectCls =
  "border border-cric-border rounded-xl px-4 py-3 bg-cric-bg text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent w-full font-bold";
const btnCls =
  "bg-cric-accent hover:bg-[#e55a2b] text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2.5 disabled:opacity-50 transition-all";

/**
 * P4: award the player of the match on a finished fixture.
 *
 * The candidate list is built from the players who actually appear in the
 * scorecard (batting, bowling, or a named XI) rather than the whole squad, so a
 * scorer cannot honour someone who sat the game out. The server enforces the
 * same rule, this only makes the common case easy.
 */
export default function PlayerOfMatchCard({ match, onSaved, showToast }) {
  const candidates = useMemo(() => {
    const seen = new Map();
    const add = (player) => {
      if (!player) return;
      const id = String(player._id || player);
      if (!id || id === "undefined" || seen.has(id)) return;
      const name = player.name || player.fullName || "Unknown player";
      seen.set(id, { id, name });
    };
    (match?.playingXI || []).forEach((xi) => (xi?.players || []).forEach(add));
    (match?.innings || []).forEach((innings) => {
      (innings?.batting || []).forEach((row) => add(row?.player));
      (innings?.bowling || []).forEach((row) => add(row?.player));
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [match]);

  const currentId = match?.manOfMatch?._id || match?.manOfMatch || "";
  const [playerId, setPlayerId] = useState(currentId ? String(currentId) : "");
  const [saving, setSaving] = useState(false);

  // The parent reloads the match after a save, so re-sync when it changes.
  useEffect(() => {
    setPlayerId(currentId ? String(currentId) : "");
  }, [currentId]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/matches/${match._id}/mom`, { playerId });
      showToast?.(playerId ? "Player of the match saved" : "Player of the match cleared", "success");
      onSaved?.();
    } catch (err) {
      showToast?.(err.response?.data?.message || "Failed to save the player of the match", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 w-full max-w-md mx-auto text-left">
      <label htmlFor="mom-player" className="block text-[10px] font-black uppercase tracking-widest text-cric-muted mb-2">
        Player of the Match
      </label>
      <select
        id="mom-player"
        aria-label="Player of the match"
        className={selectCls}
        value={playerId}
        onChange={(event) => setPlayerId(event.target.value)}
      >
        <option value="">No player of the match</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
      {candidates.length === 0 && (
        <p className="mt-2 text-xs font-bold text-cric-muted">
          No players are listed in this scorecard yet.
        </p>
      )}
      <button
        type="button"
        className={`${btnCls} mt-3 w-full`}
        onClick={save}
        disabled={saving || playerId === (currentId ? String(currentId) : "")}
      >
        {saving ? "Saving..." : "Save Player of the Match"}
      </button>
    </div>
  );
}
