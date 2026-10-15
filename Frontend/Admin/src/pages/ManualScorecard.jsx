import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import { useToast } from "../components/Toast";

// P1: fast entry of a completed match from a paper scorebook. The form writes
// the same summary innings a live-scored match has, so standings, tournament
// stats and the public scorecard need no special case. "Save draft" keeps it out
// of the standings until published.

const STAGES = [
  { value: "", label: "— none —" },
  { value: "group", label: "Group" },
  { value: "quarter_final", label: "Quarter-final" },
  { value: "semi_final", label: "Semi-final" },
  { value: "final", label: "Final" },
  { value: "third_place", label: "Third-place" },
];

const DISMISSAL_OPTIONS = [
  "", "bowled", "caught", "lbw", "stumped", "run out", "hit wicket", "retired hurt", "retired",
];

const emptyInnings = () => ({
  team: "",
  batting: [],
  bowling: [],
  extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
  overs: "",
  fallOfWickets: [],
});

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const inningsRuns = (inn) =>
  inn.batting.reduce((sum, row) => sum + num(row.runs), 0) +
  num(inn.extras.wides) + num(inn.extras.noBalls) + num(inn.extras.byes) + num(inn.extras.legByes);

const inningsWickets = (inn) => inn.batting.filter((row) => row.isOut).length;

export default function ManualScorecard() {
  const { id: editId } = useParams();
  const navigate = useNavigate();
  // `useToast` returns undefined when rendered outside the provider (e.g. a
  // focused unit test), so never destructure it blindly.
  const { showToast } = useToast() || {};

  const [tournaments, setTournaments] = useState([]);
  const [tournament, setTournament] = useState(null);
  const [playersByTeam, setPlayersByTeam] = useState({});
  const [meta, setMeta] = useState({
    tournamentId: "",
    stage: "",
    stageLabel: "",
    teamA: "",
    teamB: "",
    startAt: "",
    totalOvers: 20,
    venue: "",
    title: "",
    tossWinner: "",
    tossDecision: "bat",
  });
  const [innings, setInnings] = useState([emptyInnings(), emptyInnings()]);
  const [result, setResult] = useState({ resultType: "normal", winner: "", margin: "", note: "" });
  const [manOfMatch, setManOfMatch] = useState("");
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const teams = tournament?.teams || [];
  const teamOptions = useMemo(
    () => teams.map((team) => ({ value: String(team._id || team), label: team.name || team.shortName || "Team" })),
    [teams]
  );

  useEffect(() => {
    let active = true;
    api.get("/tournaments")
      .then((res) => {
        if (!active) return;
        const list = res.data?.tournaments || res.data || [];
        setTournaments(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!meta.tournamentId) { setTournament(null); return; }
    let active = true;
    api.get(`/tournaments/${meta.tournamentId}`)
      .then((res) => { if (active) setTournament(res.data); })
      .catch(() => { if (active) setTournament(null); });
    return () => { active = false; };
  }, [meta.tournamentId]);

  // Keep each innings' batting team in step with the two selected teams.
  useEffect(() => {
    setInnings((prev) => prev.map((inn, index) => ({
      ...inn,
      team: index === 0 ? meta.teamA : meta.teamB,
    })));
  }, [meta.teamA, meta.teamB]);

  // Load the squad of any newly selected team (for the player dropdowns).
  useEffect(() => {
    const ids = [meta.teamA, meta.teamB].filter(Boolean);
    ids.forEach((teamId) => {
      if (playersByTeam[teamId]) return;
      api.get(`/teams/${teamId}/players`)
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : (res.data?.players || []);
          setPlayersByTeam((prev) => ({ ...prev, [teamId]: list }));
        })
        .catch(() => setPlayersByTeam((prev) => ({ ...prev, [teamId]: [] })));
    });
  }, [meta.teamA, meta.teamB, playersByTeam]);

  const playersFor = (teamId) => playersByTeam[teamId] || [];

  const setMetaField = (key, value) => setMeta((prev) => ({ ...prev, [key]: value }));

  const updateInnings = (index, patch) =>
    setInnings((prev) => prev.map((inn, i) => (i === index ? { ...inn, ...patch } : inn)));

  const updateBatting = (index, rowIndex, patch) =>
    setInnings((prev) => prev.map((inn, i) => {
      if (i !== index) return inn;
      const batting = inn.batting.map((row, r) => (r === rowIndex ? { ...row, ...patch } : row));
      return { ...inn, batting };
    }));

  const updateBowling = (index, rowIndex, patch) =>
    setInnings((prev) => prev.map((inn, i) => {
      if (i !== index) return inn;
      const bowling = inn.bowling.map((row, r) => (r === rowIndex ? { ...row, ...patch } : row));
      return { ...inn, bowling };
    }));

  const addBatsman = (index) =>
    setInnings((prev) => prev.map((inn, i) => (i === index
      ? { ...inn, batting: [...inn.batting, { player: "", runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, dismissalType: "", dismissalText: "" }] }
      : inn)));
  const removeBatsman = (index, rowIndex) =>
    setInnings((prev) => prev.map((inn, i) => (i === index
      ? { ...inn, batting: inn.batting.filter((_, r) => r !== rowIndex) }
      : inn)));
  const addBowler = (index) =>
    setInnings((prev) => prev.map((inn, i) => (i === index
      ? { ...inn, bowling: [...inn.bowling, { player: "", overs: "", maidens: 0, runs: 0, wickets: 0 }] }
      : inn)));
  const removeBowler = (index, rowIndex) =>
    setInnings((prev) => prev.map((inn, i) => (i === index
      ? { ...inn, bowling: inn.bowling.filter((_, r) => r !== rowIndex) }
      : inn)));

  const buildPayload = (draft) => ({
    tournamentId: meta.tournamentId || undefined,
    stage: meta.stage || "",
    stageLabel: meta.stageLabel || "",
    teamA: meta.teamA,
    teamB: meta.teamB,
    startAt: meta.startAt || undefined,
    totalOvers: num(meta.totalOvers) || 20,
    venue: meta.venue,
    title: meta.title,
    tossWinner: meta.tossWinner || undefined,
    tossDecision: meta.tossDecision || undefined,
    draft,
    innings: innings.map((inn) => ({
      team: inn.team,
      runs: inningsRuns(inn),
      wickets: inningsWickets(inn),
      overs: draft && !inn.overs ? undefined : inn.overs,
      extras: {
        wides: num(inn.extras.wides),
        noBalls: num(inn.extras.noBalls),
        byes: num(inn.extras.byes),
        legByes: num(inn.extras.legByes),
      },
      batting: inn.batting.map((row) => ({
        player: row.player,
        runs: num(row.runs),
        balls: num(row.balls),
        fours: num(row.fours),
        sixes: num(row.sixes),
        isOut: !!row.isOut,
        dismissalType: row.dismissalType || "",
        dismissalText: row.dismissalText || "",
      })),
      bowling: inn.bowling.map((row) => ({
        player: row.player,
        overs: row.overs,
        maidens: num(row.maidens),
        runs: num(row.runs),
        wickets: num(row.wickets),
      })),
    })),
    result: {
      resultType: result.resultType,
      winner: result.resultType === "normal" ? (result.winner || "") : "",
      margin: result.margin,
      note: result.note,
    },
    manOfMatch: manOfMatch || "",
  });

  const save = async (draft) => {
    setSaving(true);
    setErrors([]);
    try {
      const payload = buildPayload(draft);
      const res = editId
        ? await api.put(`/matches/${editId}/manual`, payload)
        : await api.post("/matches/manual", payload);
      const saved = res.data?.match;
      showToast?.(draft ? "Draft saved." : "Manual scorecard published.", "success");
      if (!editId && saved?._id) {
        navigate(`/admin/manual-scorecard/${saved._id}`, { replace: true });
      }
    } catch (error) {
      const lines = error.response?.data?.errorLines;
      setErrors(lines || [error.response?.data?.message || "Failed to save."]);
    } finally {
      setSaving(false);
    }
  };

  const totalOvers = num(meta.totalOvers) || 20;

  return (
    <div className="min-h-screen bg-cric-bg text-cric-text p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black">{editId ? "Edit manual scorecard" : "Manual scorecard entry"}</h1>
            <p className="text-xs text-cric-muted mt-1">Enter a completed match from the paper scorebook.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="px-3 py-2 rounded-lg border border-cric-border text-sm font-bold">
              {showPreview ? "Hide preview" : "Preview scorecard"}
            </button>
            <button type="button" disabled={saving} onClick={() => save(true)} className="px-3 py-2 rounded-lg border border-cric-border text-sm font-bold disabled:opacity-50">
              Save draft
            </button>
            <button type="button" disabled={saving} onClick={() => save(false)} className="px-4 py-2 rounded-lg bg-cric-accent text-white text-sm font-black disabled:opacity-50">
              Publish
            </button>
          </div>
        </header>

        {errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <p className="font-black mb-1">Fix these before publishing:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {errors.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>
        )}

        <section className="rounded-xl border border-cric-border bg-cric-card p-4">
          <h2 className="text-sm font-black uppercase tracking-wider text-cric-muted mb-3">Match</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-bold">
              Tournament
              <select aria-label="Tournament" value={meta.tournamentId} onChange={(e) => setMetaField("tournamentId", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal">
                <option value="">— none —</option>
                {tournaments.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold">
              Stage
              <select aria-label="Stage" value={meta.stage} onChange={(e) => setMetaField("stage", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal">
                {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold">
              Stage label
              <input aria-label="Stage label" value={meta.stageLabel} onChange={(e) => setMetaField("stageLabel", e.target.value)} placeholder="QF1" className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold">
              Team A (bats first)
              <select aria-label="Team A" value={meta.teamA} onChange={(e) => setMetaField("teamA", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal">
                <option value="">— select —</option>
                {teamOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold">
              Team B
              <select aria-label="Team B" value={meta.teamB} onChange={(e) => setMetaField("teamB", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal">
                <option value="">— select —</option>
                {teamOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold">
              Date
              <input aria-label="Date" type="datetime-local" value={meta.startAt} onChange={(e) => setMetaField("startAt", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold">
              Overs
              <input aria-label="Overs" type="number" min="1" value={meta.totalOvers} onChange={(e) => setMetaField("totalOvers", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold">
              Venue
              <input aria-label="Venue" value={meta.venue} onChange={(e) => setMetaField("venue", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold">
              Toss winner
              <select aria-label="Toss winner" value={meta.tossWinner} onChange={(e) => setMetaField("tossWinner", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal">
                <option value="">— select —</option>
                {[{ value: meta.teamA }, { value: meta.teamB }].filter((t) => t.value).map((t) => (
                  <option key={t.value} value={t.value}>{teamOptions.find((o) => o.value === t.value)?.label || t.value}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold">
              Toss decision
              <select aria-label="Toss decision" value={meta.tossDecision} onChange={(e) => setMetaField("tossDecision", e.target.value)} className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-2 py-2 text-sm font-normal">
                <option value="bat">Bat</option>
                <option value="bowl">Bowl</option>
              </select>
            </label>
          </div>
        </section>

        {innings.map((inn, index) => {
          const battingTeam = teamOptions.find((t) => t.value === inn.team);
          const bowlingTeamId = index === 0 ? meta.teamB : meta.teamA;
          const bowlingTeam = teamOptions.find((t) => t.value === bowlingTeamId);
          return (
            <section key={index} className="rounded-xl border border-cric-border bg-cric-card p-4 space-y-3" data-testid={`innings-${index}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-wider text-cric-muted">
                  Innings {index + 1} — {battingTeam?.label || "batting team TBD"}
                </h2>
                <span className="text-xs font-bold text-cric-muted">
                  {inningsRuns(inn)}/{inningsWickets(inn)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase text-cric-muted">Batting</h3>
                <button type="button" onClick={() => addBatsman(index)} className="text-xs font-bold text-cric-accent">+ Add batsman</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-cric-muted">
                      <th className="py-1">Player</th><th>R</th><th>B</th><th>4s</th><th>6s</th>
                      <th>How out</th><th>Text</th><th>Out</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {inn.batting.map((row, r) => (
                      <tr key={r} className="border-t border-cric-border/50">
                        <td className="py-1 pr-1">
                          <select aria-label={`batting player ${index}-${r}`} value={row.player} onChange={(e) => updateBatting(index, r, { player: e.target.value })} className="w-36 rounded border border-cric-border bg-cric-bg px-1 py-1">
                            <option value="">— player —</option>
                            {playersFor(inn.team).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td><input aria-label={`runs ${index}-${r}`} type="number" min="0" value={row.runs} onChange={(e) => updateBatting(index, r, { runs: e.target.value })} className="w-14 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td><input aria-label={`balls ${index}-${r}`} type="number" min="0" value={row.balls} onChange={(e) => updateBatting(index, r, { balls: e.target.value })} className="w-14 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td><input aria-label={`fours ${index}-${r}`} type="number" min="0" value={row.fours} onChange={(e) => updateBatting(index, r, { fours: e.target.value })} className="w-12 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td><input aria-label={`sixes ${index}-${r}`} type="number" min="0" value={row.sixes} onChange={(e) => updateBatting(index, r, { sixes: e.target.value })} className="w-12 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td>
                          <select aria-label={`dismissal ${index}-${r}`} value={row.dismissalType} onChange={(e) => updateBatting(index, r, { dismissalType: e.target.value })} className="w-28 rounded border border-cric-border bg-cric-bg px-1 py-1">
                            {DISMISSAL_OPTIONS.map((d) => <option key={d || "none"} value={d}>{d || "—"}</option>)}
                          </select>
                        </td>
                        <td><input aria-label={`dismissal text ${index}-${r}`} value={row.dismissalText} onChange={(e) => updateBatting(index, r, { dismissalText: e.target.value })} placeholder="c Khan b Ali" className="w-40 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td className="text-center"><input aria-label={`out ${index}-${r}`} type="checkbox" checked={!!row.isOut} onChange={(e) => updateBatting(index, r, { isOut: e.target.checked })} /></td>
                        <td className="text-right"><button type="button" onClick={() => removeBatsman(index, r)} className="text-red-400 font-bold px-1">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase text-cric-muted">Bowling — {bowlingTeam?.label || "bowling team TBD"}</h3>
                <button type="button" onClick={() => addBowler(index)} className="text-xs font-bold text-cric-accent">+ Add bowler</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-cric-muted">
                      <th className="py-1">Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {inn.bowling.map((row, r) => (
                      <tr key={r} className="border-t border-cric-border/50">
                        <td className="py-1 pr-1">
                          <select aria-label={`bowler ${index}-${r}`} value={row.player} onChange={(e) => updateBowling(index, r, { player: e.target.value })} className="w-40 rounded border border-cric-border bg-cric-bg px-1 py-1">
                            <option value="">— bowler —</option>
                            {playersFor(bowlingTeamId).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td><input aria-label={`bowler overs ${index}-${r}`} value={row.overs} onChange={(e) => updateBowling(index, r, { overs: e.target.value })} placeholder="4" className="w-14 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td><input aria-label={`maidens ${index}-${r}`} type="number" min="0" value={row.maidens} onChange={(e) => updateBowling(index, r, { maidens: e.target.value })} className="w-12 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td><input aria-label={`bowler runs ${index}-${r}`} type="number" min="0" value={row.runs} onChange={(e) => updateBowling(index, r, { runs: e.target.value })} className="w-14 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td><input aria-label={`wickets ${index}-${r}`} type="number" min="0" value={row.wickets} onChange={(e) => updateBowling(index, r, { wickets: e.target.value })} className="w-12 rounded border border-cric-border bg-cric-bg px-1 py-1" /></td>
                        <td className="text-right"><button type="button" onClick={() => removeBowler(index, r)} className="text-red-400 font-bold px-1">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 sm:grid-cols-5">
                <label className="text-xs font-bold">Overs<input aria-label={`innings overs ${index}`} value={inn.overs} onChange={(e) => updateInnings(index, { overs: e.target.value })} placeholder={`${totalOvers}`} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" /></label>
                <label className="text-xs font-bold">Wides<input aria-label={`wides ${index}`} type="number" min="0" value={inn.extras.wides} onChange={(e) => updateInnings(index, { extras: { ...inn.extras, wides: e.target.value } })} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" /></label>
                <label className="text-xs font-bold">No-balls<input aria-label={`no balls ${index}`} type="number" min="0" value={inn.extras.noBalls} onChange={(e) => updateInnings(index, { extras: { ...inn.extras, noBalls: e.target.value } })} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" /></label>
                <label className="text-xs font-bold">Byes<input aria-label={`byes ${index}`} type="number" min="0" value={inn.extras.byes} onChange={(e) => updateInnings(index, { extras: { ...inn.extras, byes: e.target.value } })} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" /></label>
                <label className="text-xs font-bold">Leg-byes<input aria-label={`leg byes ${index}`} type="number" min="0" value={inn.extras.legByes} onChange={(e) => updateInnings(index, { extras: { ...inn.extras, legByes: e.target.value } })} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" /></label>
              </div>
            </section>
          );
        })}

        <section className="rounded-xl border border-cric-border bg-cric-card p-4 space-y-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-cric-muted">Result</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold">
              Outcome
              <select aria-label="Outcome" value={result.resultType} onChange={(e) => setResult((prev) => ({ ...prev, resultType: e.target.value }))} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal">
                <option value="normal">Win</option>
                <option value="tie">Tie</option>
                <option value="no result">No result</option>
                <option value="abandoned">Abandoned</option>
              </select>
            </label>
            {result.resultType === "normal" && (
              <label className="text-xs font-bold">
                Winner
                <select aria-label="Winner" value={result.winner} onChange={(e) => setResult((prev) => ({ ...prev, winner: e.target.value }))} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal">
                  <option value="">— select —</option>
                  {[{ value: meta.teamA }, { value: meta.teamB }].filter((t) => t.value).map((t) => (
                    <option key={t.value} value={t.value}>{teamOptions.find((o) => o.value === t.value)?.label || t.value}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-xs font-bold">
              Margin
              <input aria-label="Margin" value={result.margin} onChange={(e) => setResult((prev) => ({ ...prev, margin: e.target.value }))} placeholder="35 runs / 4 wickets" className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" />
            </label>
            <label className="text-xs font-bold">
              Player of the match
              <select aria-label="Player of the match" value={manOfMatch} onChange={(e) => setManOfMatch(e.target.value)} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal">
                <option value="">— select —</option>
                {[...playersFor(meta.teamA), ...playersFor(meta.teamB)].map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-bold">
            Note / description
            <input aria-label="Note" value={result.note} onChange={(e) => setResult((prev) => ({ ...prev, note: e.target.value }))} className="mt-1 w-full rounded border border-cric-border bg-cric-bg px-2 py-1.5 text-sm font-normal" />
          </label>
        </section>

        {showPreview && (
          <section className="rounded-xl border border-cric-border bg-cric-card p-4" data-testid="manual-preview">
            <h2 className="text-sm font-black uppercase tracking-wider text-cric-muted mb-2">Scorecard preview</h2>
            {innings.map((inn, index) => {
              const battingTeam = teamOptions.find((t) => t.value === inn.team);
              return (
                <div key={index} className="mb-3">
                  <p className="font-black text-sm">
                    {battingTeam?.label || `Team ${index + 1}`} — {inningsRuns(inn)}/{inningsWickets(inn)}
                    {inn.overs ? ` (${inn.overs} ov)` : ""}
                  </p>
                  <ul className="text-xs text-cric-muted">
                    {inn.batting.filter((r) => r.player).map((r, i) => (
                      <li key={i}>
                        {playersFor(inn.team).find((p) => p._id === r.player)?.name || "Player"} {r.runs} ({r.balls})
                        {r.isOut ? "" : " not out"}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {result.resultType === "normal" && result.winner && (
              <p className="text-sm font-bold">
                {teamOptions.find((o) => o.value === result.winner)?.label} won {result.margin}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
