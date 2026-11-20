import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { initSocket, joinMatchRoom, leaveMatchRoom } from "../services/socket";

const POLL_INTERVAL_MS = 5000;
const KNOWN_SECTIONS = new Set(["teams", "logos", "score", "target", "batters", "bowler", "balls"]);

function parseOptions(searchParams) {
  const themeRaw = (searchParams.get("theme") || "").toLowerCase();
  const theme = themeRaw === "light" ? "light" : "dark";

  const positionRaw = (searchParams.get("position") || "").toLowerCase();
  const position = positionRaw === "top" ? "top" : "bottom";

  const scaleRaw = Number.parseFloat(searchParams.get("scale") || "1");
  const scale = Number.isFinite(scaleRaw) ? Math.min(3, Math.max(0.25, scaleRaw)) : 1;

  const hideRaw = searchParams.get("hide") || "";
  const hidden = new Set(
    hideRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => KNOWN_SECTIONS.has(s))
  );

  return { theme, position, scale, hidden };
}

const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value._id || value.id || "");
};

const sameId = (a, b) => {
  const left = idOf(a);
  return left && left === idOf(b);
};

const teamName = (team, fallback = "Team") => team?.shortName || team?.name || fallback;

const formatOvers = (balls = 0) => `${Math.floor(Number(balls || 0) / 6)}.${Number(balls || 0) % 6}`;

const formatBall = (ball) => {
  if (!ball) return "";
  if (ball.isWicket) {
    if (ball.wicketType === "retired hurt" || ball.wicketType === "retiredOut" || ball.wicketType === "retired_out") return "RH";
    return "W";
  }
  if (ball.isWide) {
    const extra = Number(ball.extraRuns ?? 1);
    return extra > 1 ? `${extra}wd` : "wd";
  }
  if (ball.isNoBall) {
    const extra = Number(ball.extraRuns ?? 1);
    return extra > 1 ? `${extra}nb` : "nb";
  }
  if (ball.isBye) return `${Number(ball.extraRuns ?? ball.runs ?? 0) || 0}b`;
  if (ball.isLegBye) return `${Number(ball.extraRuns ?? ball.runs ?? 0) || 0}lb`;
  const runs = Number(ball.runs ?? 0);
  return String(Number.isFinite(runs) ? runs : 0);
};

function getLastBalls(innings, count = 6) {
  const overs = Array.isArray(innings?.oversHistory) ? innings.oversHistory : [];
  const ordered = [...overs].sort((a, b) => Number(a?.overNumber || 0) - Number(b?.overNumber || 0));
  const flat = [];
  for (const over of ordered) {
    const balls = Array.isArray(over?.balls) ? [...over.balls] : [];
    balls.sort((a, b) => Number(a?.ballNumber || 0) - Number(b?.ballNumber || 0));
    for (const ball of balls) flat.push(ball);
  }
  return flat.slice(-count);
}

function getBattingRow(innings, playerId) {
  if (!playerId) return null;
  return (innings?.batting || []).find((row) => sameId(row?.player, playerId)) || null;
}

function getBowlingRow(innings, playerId) {
  if (!playerId) return null;
  return (innings?.bowling || []).find((row) => sameId(row?.player, playerId)) || null;
}

function buildView(match) {
  if (!match) return null;
  const teams = Array.isArray(match.teams) ? match.teams : [];
  const inningsArr = Array.isArray(match.innings) ? match.innings : [];
  const currentIndex = Number.isInteger(match.currentInnings) ? match.currentInnings : 0;
  const current = inningsArr[currentIndex] || inningsArr[inningsArr.length - 1] || null;

  const teamScores = teams.map((team) => {
    const inn = inningsArr.find((i) => sameId(i?.team, team)) || null;
    return {
      team,
      innings: inn,
      scoreText: inn ? `${Number(inn.runs || 0)}/${Number(inn.wickets || 0)}` : "-",
      oversText: inn ? `(${formatOvers(inn.balls || 0)} ov)` : "",
    };
  });

  let targetText = "";
  if (current) {
    const isChase = currentIndex === 1 || (Number(current.target || 0) > 0 && (inningsArr.length > 1 || currentIndex > 0));
    if (isChase && Number(current.target || 0) > 0) {
      const runs = Number(current.runs || 0);
      const target = Number(current.target || 0);
      const remaining = Math.max(0, target - runs);
      if (["live", "in_progress", "innings_break", "innings-break"].includes(String(match.status || "").toLowerCase()) && remaining > 0) {
        const rrr = current.requiredRunRate != null && current.requiredRunRate !== "" ? Number(current.requiredRunRate) : null;
        targetText = `Target ${target} · Need ${remaining}${Number.isFinite(rrr) ? ` · RRR ${rrr.toFixed ? rrr.toFixed(2) : rrr}` : ""}`;
      } else if (remaining <= 0 && ["completed", "live", "in_progress"].includes(String(match.status || "").toLowerCase())) {
        targetText = `Target ${target}`;
      } else {
        targetText = `Target ${target}`;
      }
    }
  }

  const strikerId = idOf(current?.onStrikeBatsman || current?.currentBatsman1);
  const nonStrikerId = idOf(current?.currentBatsman2);
  const batterIds = [strikerId, nonStrikerId].filter(Boolean);
  const uniqueBatterIds = batterIds.filter((id, idx) => batterIds.indexOf(id) === idx);
  const batters = uniqueBatterIds.map((pid) => {
    const row = getBattingRow(current, pid);
    const player = row?.player || current?.onStrikeBatsman || current?.currentBatsman1 || current?.currentBatsman2 || null;
    const name = typeof player === "object" ? (player?.name || player?.shortName || "Batter") : "Batter";
    const runs = Number(row?.runs ?? 0);
    const balls = Number(row?.balls ?? 0);
    return { id: pid, name, runs, balls, onStrike: pid === strikerId };
  });

  const bowlerPlayer = current?.currentBowler || null;
  const bowlerRow = getBowlingRow(current, idOf(bowlerPlayer));
  const bowler = bowlerPlayer
    ? {
        name: typeof bowlerPlayer === "object" ? (bowlerPlayer?.name || "Bowler") : "Bowler",
        wickets: Number(bowlerRow?.wickets ?? 0),
        runs: Number(bowlerRow?.runs ?? 0),
        overs: bowlerRow
          ? (Number(bowlerRow.balls || 0) > 0 ? formatOvers(bowlerRow.balls) : `${Number(bowlerRow.overs || 0)}.0`)
          : formatOvers(current?.balls || 0),
      }
    : null;

  const lastBalls = getLastBalls(current, 6).map(formatBall).filter((x) => x !== "");

  const status = String(match.status || "upcoming").toLowerCase();
  const isLive = ["live", "in_progress", "innings_break", "innings-break", "super_over", "pending_tie_resolution"].includes(status);
  const isCompleted = ["completed", "abandoned"].includes(status);

  return {
    teams,
    teamScores,
    current,
    targetText,
    batters,
    bowler,
    lastBalls,
    status,
    isLive,
    isCompleted,
    resultText: match?.result?.description || match?.result?.margin || match?.resultText || "",
  };
}

export default function Overlay() {
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const options = useMemo(() => parseOptions(searchParams), [searchParams]);
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  const loadMatch = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await api.get(`/matches/${matchId}`);
      if (!mountedRef.current) return;
      setMatch(res.data);
      setError("");
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.response?.status === 404) {
        setError("Match not found");
        setMatch(null);
      } else if (!match) {
        setError("Waiting for match data…");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId, match]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    loadMatch();
  }, [matchId, loadMatch]);

  useEffect(() => {
    if (!matchId) return undefined;
    const socket = initSocket();
    const join = () => joinMatchRoom(matchId);

    const refresh = (payload) => {
      if (!mountedRef.current) return;
      const payloadId = idOf(payload?.matchId || payload?.match?._id || payload?._id || payload?.match || payload);
      if (payloadId && payloadId !== String(matchId)) return;
      const updated = payload?.match && payload.match._id ? payload.match : null;
      if (updated && idOf(updated._id) === String(matchId)) {
        setMatch(updated);
        setError("");
        return;
      }
      loadMatch();
    };

    const events = [
      "connect",
      "match:updated",
      "match:update",
      "match:scoreUpdate",
      "match:ballUpdate",
      "match:ballWithCommentary",
      "match:ballReverted",
      "match:bowlerSet",
      "match:overComplete",
      "ball:recorded",
      "score:update",
      "strike:changed",
      "over:completed",
      "innings:end",
      "match:end",
      "scoreUpdate",
      "ballRecorded",
      "inningsComplete",
      "matchComplete",
      "BALL_UPDATE",
      "WICKET_ALERT",
      "MILESTONE_ALERT",
      "INNINGS_COMPLETE",
      "MATCH_RESULT",
    ];

    events.forEach((event) => socket.on(event, refresh));
    join();

    const poll = window.setInterval(() => {
      loadMatch();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(poll);
      events.forEach((event) => socket.off(event, refresh));
      leaveMatchRoom(matchId);
    };
  }, [matchId, loadMatch]);

  const view = useMemo(() => buildView(match), [match]);
  const { theme, position, scale, hidden } = options;

  const showTeams = !hidden.has("teams");
  const showLogos = !hidden.has("logos");
  const showScore = !hidden.has("score");
  const showTarget = !hidden.has("target");
  const showBatters = !hidden.has("batters");
  const showBowler = !hidden.has("bowler");
  const showBalls = !hidden.has("balls");

  const rootStyle = {
    minHeight: "100vh",
    width: "100vw",
    background: "transparent",
    color: "#fff",
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  };

  const dockStyle = {
    position: "fixed",
    left: "50%",
    [position]: 24,
    transform: `translateX(-50%) scale(${scale})`,
    transformOrigin: position === "top" ? "top center" : "bottom center",
    width: "min(1600px, calc(100vw - 48px))",
    pointerEvents: "none",
  };

  const panelStyle = {
    borderRadius: 18,
    padding: "14px 18px",
    background: theme === "light" ? "rgba(255,255,255,0.94)" : "rgba(10,14,22,0.88)",
    color: theme === "light" ? "#0f172a" : "#f8fafc",
    border: theme === "light" ? "1px solid rgba(15,23,42,0.12)" : "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
    backdropFilter: "blur(6px)",
  };

  const muted = theme === "light" ? "rgba(15,23,42,0.7)" : "rgba(248,250,252,0.75)";
  const accent = "#ff6b1a";

  if (loading && !match) {
    return (
      <div style={rootStyle}>
        <div style={dockStyle}>
          <div style={panelStyle}><span style={{ fontWeight: 700 }}>Loading live overlay…</span></div>
        </div>
      </div>
    );
  }

  if (error && !match) {
    return (
      <div style={rootStyle}>
        <div style={dockStyle}>
          <div style={panelStyle}><span style={{ fontWeight: 700 }}>{error}</span></div>
        </div>
      </div>
    );
  }

  if (!view) return <div style={rootStyle} />;

  const [teamA, teamB] = view.teamScores;

  return (
    <div style={rootStyle}>
      <div style={dockStyle}>
        <div style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            {showTeams || showScore ? (
              <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", minWidth: 0 }}>
                {teamA ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {showLogos && teamA.team?.logo ? <img src={teamA.team.logo} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,0.1)" }} /> : null}
                    <div style={{ minWidth: 0 }}>
                      {showTeams ? <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1, whiteSpace: "nowrap" }}>{teamName(teamA.team)}</div> : null}
                      {showScore ? <div style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{teamA.scoreText} <span style={{ fontSize: 14, fontWeight: 600, color: muted }}>{teamA.oversText}</span></div> : null}
                    </div>
                  </div>
                ) : null}
                {teamB ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {showLogos && teamB.team?.logo ? <img src={teamB.team.logo} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", background: "rgba(255,255,255,0.1)" }} /> : null}
                    <div style={{ minWidth: 0 }}>
                      {showTeams ? <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1, whiteSpace: "nowrap" }}>{teamName(teamB.team)}</div> : null}
                      {showScore ? <div style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>{teamB.scoreText} <span style={{ fontSize: 14, fontWeight: 600, color: muted }}>{teamB.oversText}</span></div> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : <div />}

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {view.isLive ? <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, color: "#fff", background: "#dc2626", padding: "4px 10px", borderRadius: 999 }}>LIVE</span> : null}
              {view.isCompleted ? <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1, color: "#fff", background: "#16a34a", padding: "4px 10px", borderRadius: 999 }}>FINAL</span> : null}
              {showTarget && view.targetText ? <span style={{ fontSize: 15, fontWeight: 700, color: muted }}>{view.targetText}</span> : null}
              {view.isCompleted && view.resultText ? <span style={{ fontSize: 15, fontWeight: 700, color: muted }}>{view.resultText}</span> : null}
            </div>
          </div>

          {(showBatters || showBowler || showBalls) ? (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: theme === "light" ? "1px solid rgba(15,23,42,0.12)" : "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                {showBatters && view.batters.length ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    {view.batters.map((b) => (
                      <span key={b.id || b.name} style={{ fontSize: 16, fontWeight: 700 }}>
                        {b.name}{b.onStrike ? "*" : ""} <span style={{ color: muted, fontWeight: 600 }}>{b.runs} ({b.balls})</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {showBowler && view.bowler ? (
                  <span style={{ fontSize: 16, fontWeight: 700 }}>
                    {view.bowler.name} <span style={{ color: muted, fontWeight: 600 }}>{view.bowler.wickets}-{view.bowler.runs} ({view.bowler.overs})</span>
                  </span>
                ) : null}
              </div>
              {showBalls && view.lastBalls.length ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.8, color: muted, textTransform: "uppercase" }}>Last 6</span>
                  {view.lastBalls.map((ball, idx) => (
                    <span key={`${ball}-${idx}`} style={{ minWidth: 28, height: 28, padding: "0 6px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, fontSize: 13, fontWeight: 800, background: ball === "W" ? "#dc2626" : (ball === "4" || ball === "6" ? accent : (theme === "light" ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.12)")), color: (ball === "W" || ball === "4" || ball === "6") ? "#fff" : (theme === "light" ? "#0f172a" : "#f8fafc") }}>
                      {ball}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}