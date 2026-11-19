import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import RequestDeletionButton from "../../components/RequestDeletionButton";
import { competitionErrorMessage } from "../../lib/orgCompetitions";
import { PERMISSIONS, can, formatDate, formatDateTime } from "../../lib/orgUi";
import {
  completeOrgSeries,
  getMyOrgAccess,
  getOrgSeries,
  linkOrgSeriesMatch,
  listOrgMatches,
  unlinkOrgSeriesMatch,
} from "../../services/organizationApi";
import { MatchForm, MatchSetup } from "./OrgMatches";
import {
  Banner,
  Field,
  card,
  cardSubtle,
  chip,
  eyebrow,
  input,
  primaryButton,
  secondaryButton,
  sectionTitle,
} from "./orgStyles";

const idOf = (value) => String(value?._id || value || "");

const asArray = (value) => (Array.isArray(value) ? value : value?.items || []);

const teamName = (team) => team?.name || team?.shortName || "Unknown team";

const SERIES_STATUS = {
  upcoming: "Upcoming",
  ongoing: "Live",
  completed: "Completed",
};

const MATCH_STATUS = {
  upcoming: "Upcoming",
  toss_done: "Toss done",
  live: "Live",
  completed: "Completed",
  "innings-break": "Innings break",
  innings_break: "Innings break",
  abandoned: "Called off",
};

const seriesStatus = (status) => SERIES_STATUS[status] || status || "Upcoming";

const matchStatus = (status) => MATCH_STATUS[status] || status || "Upcoming";

const flowLabel = (match) => {
  if (match.status === "abandoned") return "No result";
  if (match.result?.winner) return `${teamName(match.result.winner)} won`;
  if (match.result?.description) return match.result.description;
  if (match.resultText) return match.resultText;
  if (match.status === "completed") return "Result recorded";
  return "";
};

const outcomeLine = (detail) => {
  if (!detail) return "";
  if (detail.status !== "completed") {
    if (detail.score?.outcome === "winner") return `Leading: ${teamName(detail.score.winner)}`;
    return "Series in progress";
  }
  if (detail.score?.outcome === "winner") return `${teamName(detail.score.winner)} won the series`;
  if (detail.score?.outcome === "drawn") return "Series drawn";
  return "Series completed without a result";
};

function SeriesScore({ score }) {
  const rows = score?.teams || [];
  if (!rows.length) {
    return <p className="mt-3 text-xs font-semibold text-cric-muted">No teams entered yet.</p>;
  }
  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row, index) => (
          <div key={idOf(row.team) || index} className={cardSubtle}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-black text-cric-text">{teamName(row.team)}</p>
              <p className="text-2xl font-black leading-none text-cric-text">{row.wins}</p>
            </div>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
              {row.wins === 1 ? "win" : "wins"} · {row.played} played · {row.ties} tie
              {row.ties === 1 ? "" : "s"} · {row.noResult} no result
            </p>
          </div>
        ))}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-cric-muted">
        {score.completed} completed · {score.ties} tie{score.ties === 1 ? "" : "s"} · {score.noResult} no
        result
      </p>
    </div>
  );
}

function SeriesMatchCard({ orgId, match, index, canFixture, canScore, completed, busy, onUnlink }) {
  const label = match.seriesMatchNumber ? `Match ${match.seriesMatchNumber}` : `Match ${index + 1}`;
  const result = flowLabel(match);
  return (
    <div className={cardSubtle}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={eyebrow}>{label}</p>
            <span className={chip}>{matchStatus(match.status)}</span>
          </div>
          <p className="mt-1 text-sm font-black text-cric-text">
            {teamName(match.teams?.[0])} v {teamName(match.teams?.[1])}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
            {match.startAt ? formatDateTime(match.startAt) : "Date TBD"}
            {match.venue ? ` · ${match.venue}` : ""}
          </p>
          {result ? <p className="mt-2 text-xs font-semibold text-cric-muted">{result}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/match/${match._id}`} className={secondaryButton}>
            Open
          </Link>
          {canScore ? (
            <Link
              to={`/organization/${orgId}/matches/${match._id}/score/live`}
              className={`${primaryButton} inline-flex min-h-11 items-center justify-center`}
            >
              Score
            </Link>
          ) : null}
          {canFixture && !completed ? (
            <button
              type="button"
              onClick={() => onUnlink(match)}
              disabled={busy}
              className={secondaryButton}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function OrgSeriesDetail() {
  const { orgId, seriesId } = useParams();
  const [access, setAccess] = useState(null);
  const [detail, setDetail] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(false);
  const [setupFor, setSetupFor] = useState(null);
  const [linkId, setLinkId] = useState("");

  const permissions = access?.permissions || [];
  const canManage = can(permissions, PERMISSIONS.MANAGE_COMPETITIONS);
  const canFixture = can(permissions, PERMISSIONS.CREATE_MATCH);
  const canScore = can(permissions, PERMISSIONS.SCORE_MATCH);
  const completed = detail?.status === "completed";

  const load = useCallback(
    async ({ spinner = true } = {}) => {
      if (!orgId || !seriesId) return;
      if (spinner) setLoading(true);
      setErr("");
      try {
        const nextAccess = await getMyOrgAccess(orgId);
        const canAdd = can(nextAccess?.permissions || [], PERMISSIONS.CREATE_MATCH);
        const [nextDetail, matchResponse] = await Promise.all([
          getOrgSeries(orgId, seriesId),
          // The link picker needs the organization's unlinked fixtures. A member
          // who cannot create matches never sees the picker, so do not ask.
          canAdd ? listOrgMatches(orgId).catch(() => null) : Promise.resolve(null),
        ]);
        setAccess(nextAccess);
        setDetail(nextDetail);
        if (matchResponse) setMatches(asArray(matchResponse));
      } catch (error) {
        setErr(competitionErrorMessage(error, "Could not load the series."));
      } finally {
        if (spinner) setLoading(false);
      }
    },
    [orgId, seriesId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const seriesTeamIds = useMemo(
    () => new Set((detail?.teams || []).map(idOf).filter(Boolean)),
    [detail?.teams]
  );

  const candidates = useMemo(
    () =>
      (matches || []).filter(
        (match) =>
          !match.series &&
          (match.teams || []).length === 2 &&
          (match.teams || []).every((team) => seriesTeamIds.has(idOf(team)))
      ),
    [matches, seriesTeamIds]
  );

  const defaultTeams = (detail?.teams || []).map(idOf);
  const defaultFormat = ["T20", "ODI", "Test"].includes(detail?.matchType)
    ? detail.matchType
    : "T20";

  const runAction = async (key, action, success) => {
    setBusy(key);
    setErr("");
    try {
      const next = await action();
      if (next?.score) setDetail(next);
      setNotice({ kind: "success", text: success(next) });
      await load({ spinner: false });
      return next;
    } catch (error) {
      setErr(competitionErrorMessage(error, "That did not work."));
      return null;
    } finally {
      setBusy("");
    }
  };

  const linkMatch = () => {
    if (!linkId) return;
    const candidate = candidates.find((match) => idOf(match) === linkId);
    const label = candidate ? `${teamName(candidate.teams?.[0])} v ${teamName(candidate.teams?.[1])}` : "the match";
    runAction(
      "link",
      () => linkOrgSeriesMatch(orgId, seriesId, linkId),
      () => `${label} added to the series.`
    ).then((next) => {
      if (next) setLinkId("");
    });
  };

  const unlinkMatch = (match) => {
    if (typeof window !== "undefined" && !window.confirm(`Remove this match from the series? The match itself is kept.`)) {
      return;
    }
    runAction(
      `unlink:${idOf(match)}`,
      () => unlinkOrgSeriesMatch(orgId, seriesId, match._id),
      () => "Match removed from the series."
    );
  };

  const complete = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Complete this series from the recorded results? Matches cannot be added or removed afterwards.")
    ) {
      return;
    }
    runAction(
      "complete",
      () => completeOrgSeries(orgId, seriesId),
      (next) => {
        if (next?.score?.outcome === "winner") return `${teamName(next.score.winner)} won the series.`;
        if (next?.score?.outcome === "drawn") return "Series completed as a draw.";
        return "Series completed.";
      }
    );
  };

  const createdMatch = (match) => {
    setCreating(false);
    setNotice({ kind: "success", text: "Fixture created. Pick the Playing XI next." });
    if (match?._id) setSetupFor(match);
    load({ spinner: false });
  };

  if (loading && !detail) {
    return (
      <div className={card}>
        <p className="text-sm font-semibold text-cric-muted">Loading series…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Banner kind="error">{err || "This series was not found in this organization."}</Banner>
        <Link to={`/organization?org=${orgId}`} className={secondaryButton}>
          Back to organization
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/organization?org=${orgId}`}
              className="text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
            >
              ← Organization
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className={eyebrow}>Series</p>
              <span className={chip}>{seriesStatus(detail.status)}</span>
            </div>
            <h1 className="mt-1 text-2xl font-black text-cric-text">{detail.name}</h1>
            <p className="mt-1 text-xs font-semibold text-cric-muted">
              {detail.matchType || "—"} · {detail.matches?.length || 0} match
              {(detail.matches?.length || 0) === 1 ? "" : "es"}
              {detail.venue ? ` · ${detail.venue}` : ""}
            </p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
              {formatDate(detail.startDate)} – {formatDate(detail.endDate)}
            </p>
            <p className="mt-2 text-sm font-black text-cric-text">{outcomeLine(detail)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && !completed ? (
              <button type="button" onClick={complete} disabled={busy === "complete"} className={primaryButton}>
                {busy === "complete" ? "Completing…" : "Complete series"}
              </button>
            ) : null}
            {canManage ? (
              <RequestDeletionButton
                orgId={orgId}
                targetType="series"
                targetId={detail._id}
                subject={`Delete series: ${detail.name}`}
                label="Request series deletion"
              />
            ) : null}
          </div>
        </div>
        <SeriesScore score={detail.score} />
      </div>

      {err ? <Banner kind="error">{err}</Banner> : null}
      {notice ? <Banner kind={notice.kind}>{notice.text}</Banner> : null}

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className={eyebrow}>Fixtures</p>
            <h2 className={`${sectionTitle} mt-1`}>Matches ({detail.matches?.length || 0})</h2>
          </div>
          {canFixture && !completed ? (
            <button type="button" onClick={() => setCreating((value) => !value)} className={primaryButton}>
              {creating ? "Close" : "+ Add match"}
            </button>
          ) : null}
        </div>

        {creating && canFixture && !completed ? (
          <div className="mt-4 border-t border-cric-border pt-4">
            <p className={eyebrow}>New fixture in this series</p>
            <p className="mb-3 mt-1 text-xs font-semibold text-cric-muted">
              Pick two teams from the series. The XI is chosen from each club&apos;s whole roster after
              the fixture is created.
            </p>
            <MatchForm
              orgId={orgId}
              teams={detail.teams || []}
              events={[]}
              seriesId={seriesId}
              defaults={{
                teamA: defaultTeams[0] || "",
                teamB: defaultTeams[1] || "",
                matchType: defaultFormat,
                venue: detail.venue || "",
              }}
              onDone={createdMatch}
              onCancel={() => setCreating(false)}
            />

            <div className="mt-5 border-t border-cric-border pt-4">
              <p className={eyebrow}>Or link an existing unlinked match</p>
              {candidates.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-cric-muted">
                  No unlinked matches between these two teams.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <Field label="Existing match">
                    <select value={linkId} onChange={(event) => setLinkId(event.target.value)} className={input}>
                      <option value="">— Select a match —</option>
                      {candidates.map((match) => (
                        <option key={match._id} value={match._id}>
                          {teamName(match.teams?.[0])} v {teamName(match.teams?.[1])}
                          {match.startAt ? ` · ${formatDate(match.startAt)}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    onClick={linkMatch}
                    disabled={!linkId || busy === "link"}
                    className={primaryButton}
                  >
                    {busy === "link" ? "Linking…" : "Link match"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {detail.matches?.length ? (
            detail.matches.map((match, index) => (
              <SeriesMatchCard
                key={idOf(match) || index}
                orgId={orgId}
                match={match}
                index={index}
                canFixture={canFixture}
                canScore={canScore}
                completed={completed}
                busy={busy === `unlink:${idOf(match)}`}
                onUnlink={unlinkMatch}
              />
            ))
          ) : (
            <p className="text-xs font-semibold text-cric-muted">
              No matches yet.
              {canFixture && !completed ? " Add the first fixture above." : ""}
            </p>
          )}
        </div>
      </div>

      {setupFor ? (
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className={eyebrow}>Playing XI</p>
              <h2 className={`${sectionTitle} mt-1`}>
                {teamName(setupFor.teams?.[0])} v {teamName(setupFor.teams?.[1])}
              </h2>
            </div>
            <button type="button" onClick={() => setSetupFor(null)} className={secondaryButton}>
              Close
            </button>
          </div>
          <div className="mt-4">
            <MatchSetup
              orgId={orgId}
              match={setupFor}
              onClose={() => setSetupFor(null)}
              onSaved={(message) => {
                setSetupFor(null);
                setNotice({ kind: "success", text: message });
                load({ spinner: false });
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
