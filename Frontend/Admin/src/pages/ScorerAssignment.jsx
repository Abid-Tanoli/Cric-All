import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";

// P2: assign one (or more) scorers to a single fixture. The list of candidate
// scorers is the fixture organization's members, so a platform admin can run
// this without knowing the club's user ids by heart. The backend stays the
// source of truth: an empty selection clears the restriction and restores the
// org-wide `score_match` rule.
const inputClass =
  "w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent";

const statusLabel = (match) => {
  const teamNames = (match.teams || [])
    .map((team) => team?.shortName || team?.name || "")
    .filter(Boolean);
  const vs = teamNames.length >= 2 ? `${teamNames[0]} v ${teamNames[1]}` : match.title;
  return `${vs}${match.status ? ` — ${match.status}` : ""}`;
};

export default function ScorerAssignment() {
  const { showToast } = useToast() || {};
  const [matches, setMatches] = useState([]);
  const [matchId, setMatchId] = useState("");
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/matches?limit=200");
        const list = Array.isArray(res.data) ? res.data : res.data?.matches || [];
        if (!cancelled) setMatches(list);
      } catch (err) {
        showToast?.(
          err?.response?.data?.message || "Could not load matches",
          "error"
        );
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const match = useMemo(
    () => matches.find((m) => String(m._id) === String(matchId)) || null,
    [matches, matchId]
  );

  useEffect(() => {
    if (!match) {
      setMembers([]);
      setSelected([]);
      return;
    }
    setSelected(
      (match.assignedScorers || []).map((scorer) => String(scorer?._id || scorer))
    );

    const orgId = match.organizationRef?._id || match.organizationRef;
    if (!orgId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    setLoadingMembers(true);
    (async () => {
      try {
        const res = await api.get(`/organizations/${orgId}/members?limit=200`);
        const list = res.data?.items || res.data?.members || [];
        if (!cancelled) setMembers(list);
      } catch (err) {
        if (!cancelled) {
          setMembers([]);
          showToast?.(
            err?.response?.data?.message || "Could not load this club's members",
            "error"
          );
        }
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match]);

  const toggle = (userId) => {
    setSelected((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const save = async () => {
    if (!match) return;
    setSaving(true);
    try {
      const res = await api.put(`/matches/${match._id}/scorers`, {
        scorerIds: selected,
      });
      const assigned = res.data?.assignedScorers || [];
      setMatches((prev) =>
        prev.map((m) =>
          String(m._id) === String(match._id)
            ? {
                ...m,
                assignedScorers: assigned.map((scorer) => scorer?._id || scorer),
              }
            : m
        )
      );
      showToast?.(
        assigned.length ? "Scorer assigned" : "Scorer assignment cleared",
        "success"
      );
    } catch (err) {
      showToast?.(
        err?.response?.data?.message || "Could not save the assignment",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const candidates = members.filter((member) => member.user);

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-black font-raj text-cric-text">
        Scorer assignment
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-cric-muted">
        Pick a fixture, then tick the scorer who will run it. Leave everyone
        unticked to fall back to the club-wide scoring rule. The assigned scorer
        can open only this match&apos;s scoring screen; club owners and platform
        admins keep supervisory access.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-cric-border bg-cric-card p-4">
          <label className="text-xs font-bold text-cric-muted" htmlFor="scorer-match">
            Fixture
          </label>
          <select
            id="scorer-match"
            aria-label="Fixture"
            className={`mt-1 ${inputClass}`}
            value={matchId}
            onChange={(event) => setMatchId(event.target.value)}
            disabled={loadingMatches}
          >
            <option value="">
              {loadingMatches ? "Loading fixtures…" : "— select a fixture —"}
            </option>
            {matches.map((m) => (
              <option key={m._id} value={m._id}>
                {statusLabel(m)}
              </option>
            ))}
          </select>

          {match && (
            <p className="mt-3 text-xs text-cric-muted">
              Currently assigned:{" "}
              {selected.length
                ? selected
                    .map(
                      (id) =>
                        candidates.find(
                          (member) => String(member.user._id) === String(id)
                        )?.user?.name || id
                    )
                    .join(", ")
                : "no one (club-wide scoring)"}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-cric-border bg-cric-card p-4">
          <h2 className="text-xs font-bold text-cric-muted">Club scorers</h2>
          {!match && (
            <p className="mt-2 text-sm text-cric-muted">
              Select a fixture to list its club&apos;s members.
            </p>
          )}
          {match && loadingMembers && (
            <p className="mt-2 text-sm text-cric-muted">Loading members…</p>
          )}
          {match && !loadingMembers && candidates.length === 0 && (
            <p className="mt-2 text-sm text-cric-muted">
              No members found for this fixture&apos;s organization.
            </p>
          )}
          {match && !loadingMembers && candidates.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="scorer-candidates">
              {candidates.map((member) => {
                const userId = String(member.user._id);
                return (
                  <li key={member._id || userId}>
                    <label className="flex items-center gap-2 text-sm text-cric-text">
                      <input
                        type="checkbox"
                        aria-label={`assign ${member.user.name}`}
                        checked={selected.includes(userId)}
                        onChange={() => toggle(userId)}
                      />
                      <span>
                        {member.user.name}
                        <span className="text-cric-muted">
                          {" "}
                          ({member.user.email})
                        </span>
                        {member.roles?.length ? (
                          <span className="text-cric-muted">
                            {" "}
                            — {member.roles.join(", ")}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            className="mt-4 rounded-lg bg-cric-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            onClick={save}
            disabled={!match || saving}
          >
            {saving ? "Saving…" : "Save assignment"}
          </button>
        </section>
      </div>
    </div>
  );
}
