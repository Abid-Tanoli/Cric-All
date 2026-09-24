import Match from "../models/Match.js";
import Team from "../models/Team.js";
import Event from "../models/Event.js";
import Tournament from "../models/Tournament.js";
import Partnership from "../models/Partnership.js";
import { getIO } from "../socket/socket.js";
import { getBallRunText, normalizeBallRunText } from "../utils/cricketHelpers.js";

const normalStatus = (status = "upcoming") => (status === "innings-break" ? "innings_break" : status);
const legalMatchStatuses = [
  "upcoming",
  "toss_done",
  "live",
  "innings_break",
  "innings-break",
  "completed",
  "abandoned",
  "pending_tie_resolution",
  "super_over",
];
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const idOf = (value) => String(value?._id || value || "");
const sameId = (a, b) => idOf(a) && idOf(a) === idOf(b);
const displayName = (entity, fallback = "Unknown") => entity?.name || entity?.shortName || entity?.fullName || fallback;
const formatOversFromBalls = (balls = 0) => `${Math.floor(toNumber(balls) / 6)}.${toNumber(balls) % 6}`;
const formatBowlerOvers = (row = {}) => {
  if (toNumber(row.balls) > 0) return formatOversFromBalls(row.balls);
  return `${toNumber(row.overs)}.0`;
};
const inningsScore = (innings) => `${toNumber(innings?.runs)}/${toNumber(innings?.wickets)} (${formatOversFromBalls(innings?.balls)} ov)`;

const playerPayload = (player) => ({
  _id: player?._id || player,
  name: player?.name || "Unknown",
  role: player?.role || player?.playingRole || "",
  playingRole: player?.playingRole || player?.role || ""
});

const populateMatch = (query) => {
  return query.lean()
    .populate({
      path: "teams",
      select: "name shortName logo players",
      populate: { path: "players", select: "name playingRole role" }
    })
    .populate({
      path: 'tournament',
      select: 'name shortName pointsTable',
      populate: { path: 'pointsTable.team', select: 'name shortName logo' }
    })
    .populate("innings.team", "name shortName")
    .populate("innings.batting.player", "name playingRole role")
    .populate("innings.bowling.player", "name playingRole role")
    .populate("innings.currentBatsman1", "name playingRole role")
    .populate("innings.currentBatsman2", "name playingRole role")
    .populate("innings.onStrikeBatsman", "name playingRole role")
    .populate("innings.currentBowler", "name playingRole role")
    .populate("innings.fallOfWickets.player", "name playingRole role")
    .populate("innings.partnerships.batsman1", "name playingRole role")
    .populate("innings.partnerships.batsman2", "name playingRole role")
    .populate("result.winner", "name shortName")
    .populate("tossWinner", "name shortName")
    .populate("manOfMatch", "name playingRole role")
    .populate("playingXI.players", "name playingRole role")
    .populate("playingXI.team", "name shortName logo")
    .populate("squad15.players", "name playingRole role")
    .populate("squad15.team", "name shortName logo")
    .populate("squad15.captain", "name playingRole role")
    .populate("squad15.viceCaptain", "name playingRole role")
    .populate("squad15.wicketKeepers", "name playingRole role")
    .populate("twelfthMan.team", "name shortName logo")
    .populate("twelfthMan.player", "name playingRole role")
    .populate("bowlingXI.players", "name playingRole role")
    .populate("bowlingXI.team", "name shortName logo")
    .populate("teamRoles.captain", "name playingRole role")
    .populate("teamRoles.viceCaptain", "name playingRole role")
    .populate("teamRoles.wicketKeepers", "name playingRole role");
};

const populateMatchList = (query) => {
  return query
    .select([
      "title",
      "venue",
      "matchType",
      "matchCategory",
      "matchSubcategory",
      "category",
      "subCategory",
      "ageGroup",
      "organization",
      "address",
      "tournament",
      "totalOvers",
      "startAt",
      "teams",
      "innings.team",
      "innings.runs",
      "innings.wickets",
      "innings.overs",
      "innings.balls",
      "innings.status",
      "innings.target",
      "innings.runRate",
      "innings.requiredRunRate",
      "currentInnings",
      "status",
      "result",
      "tossWinner",
      "tossDecision",
      "manOfMatch",
      "series",
      "seriesMatchNumber",
      "slug",
      "resultText",
      "statusText",
      "isFeatured",
      "createdAt",
      "updatedAt"
    ].join(" "))
    .populate("teams", "name shortName logo")
    .populate("tournament", "name shortName slug")
    .populate("innings.team", "name shortName logo")
    .populate("result.winner", "name shortName logo")
    .populate("tossWinner", "name shortName")
    .populate("manOfMatch", "name playingRole role");
};

const matchRoom = (matchId) => `match-${matchId}`;
const isTransientDbError = (error) => (
  error?.name === "MongooseError" ||
  error?.name === "MongoServerSelectionError" ||
  error?.name === "MongoNetworkTimeoutError" ||
  /timed out|buffering|not connected/i.test(error?.message || "")
);

export const getMatches = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 250, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;
    const query = {};

    if (req.query.status) {
      const statuses = String(req.query.status)
        .split(",")
        .map((status) => status.trim())
        .filter(Boolean);
      if (statuses.length) query.status = { $in: statuses };
    }

    const seriesFilter = req.query.series || req.query.seriesId;
    if (seriesFilter) query.series = seriesFilter;
    if (req.query.tournament) query.tournament = req.query.tournament;

    const matches = await populateMatchList(Match.find(query))
      .sort({ startAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .maxTimeMS(5000)
      .lean();

    res.status(200).json(normalizeBallRunText(matches));
  } catch (error) {
    console.error("Error fetching matches:", error);
    if (isTransientDbError(error)) {
      return res.status(200).json([]);
    }
    res.status(500).json({
      message: "Failed to fetch matches",
      error: error.message
    });
  }
};

export const getMatch = async (req, res) => {
  try {
    const match = await populateMatch(Match.findById(req.params.id));

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    res.status(200).json(normalizeBallRunText(match));
  } catch (error) {
    console.error("Error fetching match:", error);
    res.status(500).json({
      message: "Failed to fetch match",
      error: error.message
    });
  }
};

export const createMatch = async (req, res) => {
  try {
    const { 
      title, venue, matchType, matchCategory, matchSubcategory, startAt, teams, 
      powerplayConfig, series, seriesMatchNumber,
      category, subCategory, ageGroup, organization, address
    } = req.body;

    if (!teams || teams.length !== 2) {
      return res.status(400).json({
        message: "Exactly 2 teams are required"
      });
    }

    if (teams[0] === teams[1]) {
      return res.status(400).json({
        message: "Teams must be different"
      });
    }

    const team1 = await Team.findById(teams[0]);
    const team2 = await Team.findById(teams[1]);

    if (!team1 || !team2) {
      return res.status(404).json({
        message: "One or both teams not found"
      });
    }

    const innings = [
      {
        team: teams[0],
        runs: 0,
        wickets: 0,
        balls: 0,
        extras: 0,
        status: "upcoming",
        commentary: [],
        batting: [],
        bowling: []
      },
      {
        team: teams[1],
        runs: 0,
        wickets: 0,
        balls: 0,
        extras: 0,
        status: "upcoming",
        commentary: [],
        batting: [],
        bowling: []
      }
    ];

    const match = new Match({
      title: title || `${team1.name} vs ${team2.name}`,
      venue: venue || "",
      matchType: matchType || "T20",
      matchCategory: matchCategory || category || "Other",
      category: category || matchCategory || "Other",
      subCategory: subCategory || "",
      ageGroup: ageGroup || "Open",
      organization: organization || "",
      address: address || { town: "", district: "", city: "", province: "", country: "Pakistan" },
      tournament: req.body.tournamentId || null,
      startAt,
      teams,
      innings,
      status: "upcoming",
      powerplayConfig: powerplayConfig || { enabled: false, overs: 0 },
      series: series || "",
      seriesMatchNumber: seriesMatchNumber || null
    });

    await match.save({ validateModifiedOnly: true });

    // Link match to tournament if provided
    if (req.body.tournamentId) {
      await Tournament.findByIdAndUpdate(req.body.tournamentId, {
        $push: { matches: match._id }
      });
    }

    await match.populate("teams", "name shortName logo");
    await match.populate("innings.team", "name shortName");

    try {
      const io = getIO();
      io.emit("match:created", match);
      io.emit("match:updateList");
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(201).json({
      match,
      message: "Match created successfully"
    });
  } catch (error) {
    console.error("Error creating match details:", error);
    res.status(400).json({
      message: error.message || "Failed to create match",
      error: error.message
    });
  }
};

export const updateMatch = async (req, res) => {
  try {
    const { title, venue, matchType, totalOvers, startAt, teams, status, powerplayConfig, series, seriesMatchNumber } = req.body;

    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    if (teams && teams.length === 2) {
      if (teams[0] === teams[1]) {
        return res.status(400).json({
          message: "Teams must be different"
        });
      }

      const team1 = await Team.findById(teams[0]);
      const team2 = await Team.findById(teams[1]);

      if (!team1 || !team2) {
        return res.status(404).json({
          message: "One or both teams not found"
        });
      }

      if (match.innings.length >= 2) {
        match.innings[0].team = teams[0];
        match.innings[1].team = teams[1];
      }

      match.teams = teams;
      match.title = title || `${team1.name} vs ${team2.name}`;
    }

    if (title !== undefined) match.title = title;
    if (venue !== undefined) match.venue = venue;
    if (matchType !== undefined) match.matchType = matchType;
    if (totalOvers !== undefined) match.totalOvers = totalOvers;
    if (startAt !== undefined) match.startAt = startAt;
    if (status !== undefined) match.status = status;
    if (powerplayConfig !== undefined) match.powerplayConfig = powerplayConfig;
    if (series !== undefined) match.series = series;
    if (seriesMatchNumber !== undefined) match.seriesMatchNumber = seriesMatchNumber;

    await match.save({ validateModifiedOnly: true });

    if (totalOvers !== undefined && match.innings[1]) {
      const inn2 = match.innings[1];
      if (inn2.status === "live" || inn2.status === "completed") {
        const totalBallsFaced = inn2.balls || 0;
        const remainingOvers = Math.max(totalOvers - Math.floor(totalBallsFaced / 6) - (totalBallsFaced % 6) / 6, 0);
        const remainingRuns = (inn2.target || 0) - (inn2.runs || 0);
        inn2.requiredRunRate = remainingOvers > 0 ? (remainingRuns / remainingOvers).toFixed(2) : 0;
      }
    }

    await match.populate("teams", "name shortName logo");
    await match.populate("innings.team", "name shortName");

    try {
      const io = getIO();
      io.emit("match:updated", match);
      io.emit("match:updateList");
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "Match updated successfully"
    });
  } catch (error) {
    console.error("Error updating match:", error);
    res.status(400).json({
      message: "Failed to update match",
      error: error.message
    });
  }
};

export const deleteMatch = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    await Match.findByIdAndDelete(req.params.id);

    try {
      const io = getIO();
      io.emit("match:deleted", { id: req.params.id });
      io.emit("match:updateList");
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({ message: "Match deleted successfully" });
  } catch (error) {
    console.error("Error deleting match:", error);
    res.status(500).json({
      message: "Failed to delete match",
      error: error.message
    });
  }
};

export const setMOM = async (req, res) => {
  try {
    const { playerId } = req.body;

    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    match.manOfMatch = playerId;
    await match.save({ validateModifiedOnly: true });

    await match.populate("manOfMatch", "name role");
    await match.populate("teams", "name shortName logo");

    try {
      const io = getIO();
      io.emit("match:updated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "Man of the Match set successfully"
    });
  } catch (error) {
    console.error("Error setting MOM:", error);
    res.status(400).json({
      message: "Failed to set Man of the Match",
      error: error.message
    });
  }
};

export const getMatchStats = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .populate("teams", "name shortName")
      .populate("innings.batting.player", "name")
      .populate("innings.bowling.player", "name");

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const stats = {
      matchId: match._id,
      title: match.title,
      status: match.status,
      teams: match.teams,
      innings: match.innings.map(inn => ({
        team: inn.team,
        totalRuns: inn.runs,
        totalWickets: inn.wickets,
        overs: `${inn.overs}.${inn.balls}`,
        extras: inn.extras,
        topBatsmen: inn.batting
          .sort((a, b) => b.runs - a.runs)
          .slice(0, 3)
          .map(b => ({
            player: b.player,
            runs: b.runs,
            balls: b.balls,
            strikeRate: b.strikeRate
          })),
        topBowlers: inn.bowling
          .sort((a, b) => b.wickets - a.wickets)
          .slice(0, 3)
          .map(b => ({
            player: b.player,
            wickets: b.wickets,
            runs: b.runs,
            overs: b.overs,
            economy: b.economy
          }))
      })),
      result: match.result,
      manOfMatch: match.manOfMatch
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error("Error fetching match stats:", error);
    res.status(500).json({
      message: "Failed to fetch match statistics",
      error: error.message
    });
  }
};

export const getMatchLiveStats = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .populate("innings.team", "name shortName")
      .populate("innings.batting.player", "name playingRole role")
      .populate("innings.bowling.player", "name playingRole role");

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const battingRows = [];
    const bowlingRows = [];

    (match.innings || []).forEach((innings, index) => {
      const teamName = displayName(innings.team, `Innings ${index + 1}`);
      (innings.batting || []).forEach((row) => {
        battingRows.push({
          playerId: row.player?._id || row.player,
          name: displayName(row.player, "Unknown"),
          team: teamName,
          runs: toNumber(row.runs),
          balls: toNumber(row.balls),
          fours: toNumber(row.fours),
          sixes: toNumber(row.sixes),
          sr: row.strikeRate ? toNumber(row.strikeRate).toFixed(2) : (row.balls ? ((toNumber(row.runs) / toNumber(row.balls)) * 100).toFixed(2) : "0.00")
        });
      });
      (innings.bowling || []).forEach((row) => {
        bowlingRows.push({
          playerId: row.player?._id || row.player,
          name: displayName(row.player, "Unknown"),
          team: teamName,
          overs: formatBowlerOvers(row),
          balls: toNumber(row.balls),
          maidens: toNumber(row.maidens),
          runs: toNumber(row.runs),
          wickets: toNumber(row.wickets),
          dotBalls: toNumber(row.dotBalls ?? row.dots),
          econ: row.economy ? toNumber(row.economy).toFixed(2) : (row.balls ? ((toNumber(row.runs) / toNumber(row.balls)) * 6).toFixed(2) : "0.00"),
          wides: toNumber(row.wides),
          noBalls: toNumber(row.noBalls)
        });
      });
    });

    res.status(200).json({
      matchId: match._id,
      status: normalStatus(match.status),
      currentInnings: match.currentInnings,
      currentInningsNumber: toNumber(match.currentInnings) + 1,
      topScorers: battingRows
        .sort((a, b) => b.runs - a.runs || b.sr - a.sr)
        .slice(0, 10),
      topBowlers: bowlingRows
        .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)
        .slice(0, 10)
    });
  } catch (error) {
    console.error("Error fetching live stats:", error);
    res.status(500).json({
      message: "Failed to fetch live stats",
      error: error.message
    });
  }
};

export const getMatchSummary = async (req, res) => {
  try {
    const match = await populateMatch(Match.findById(req.params.id));

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const innings = (match.innings || []).map((inn, index) => ({
      innings: index + 1,
      team: displayName(inn.team, `Team ${index + 1}`),
      teamId: inn.team?._id || inn.team,
      score: `${toNumber(inn.runs)}/${toNumber(inn.wickets)}`,
      overs: formatOversFromBalls(inn.balls),
      extras: inn.extras || {},
      topBatsmen: [...(inn.batting || [])]
        .sort((a, b) => toNumber(b.runs) - toNumber(a.runs))
        .slice(0, 3)
        .map((row) => ({
          name: displayName(row.player, "Unknown"),
          runs: toNumber(row.runs),
          balls: toNumber(row.balls),
          fours: toNumber(row.fours),
          sixes: toNumber(row.sixes)
        })),
      topBowlers: [...(inn.bowling || [])]
        .sort((a, b) => toNumber(b.wickets) - toNumber(a.wickets) || toNumber(a.runs) - toNumber(b.runs))
        .slice(0, 3)
        .map((row) => ({
          name: displayName(row.player, "Unknown"),
          wickets: toNumber(row.wickets),
          runs: toNumber(row.runs),
          overs: formatBowlerOvers(row),
          economy: row.economy || "0.00"
        }))
    }));

    const topBatter = innings.flatMap((inn) => inn.topBatsmen).sort((a, b) => b.runs - a.runs)[0];
    const topBowler = innings.flatMap((inn) => inn.topBowlers).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];

    const keyMoments = [
      ...(match.highlights || []).map((item) => item.description).filter(Boolean),
      topBatter?.runs >= 50 ? `${topBatter.name} scored ${topBatter.runs} from ${topBatter.balls} balls` : "",
      topBowler?.wickets >= 3 ? `${topBowler.name} took ${topBowler.wickets}/${topBowler.runs}` : ""
    ].filter(Boolean).slice(0, 8);

    res.status(200).json({
      matchId: match._id,
      status: normalStatus(match.status),
      result: match.result?.description || match.resultText || "",
      playerOfMatch: match.manOfMatch
        ? {
          _id: match.manOfMatch?._id || match.manOfMatch,
          name: displayName(match.manOfMatch, "Player of the Match"),
          reason: topBatter ? `${topBatter.runs} runs (${topBatter.balls} balls)` : ""
        }
        : null,
      innings,
      keyMoments
    });
  } catch (error) {
    console.error("Error fetching match summary:", error);
    res.status(500).json({
      message: "Failed to fetch match summary",
      error: error.message
    });
  }
};

export const getMatchPartnershipsSummary = async (req, res) => {
  try {
    const match = await populateMatch(Match.findById(req.params.id));

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const mapEmbedded = (inn, index) => (inn.partnerships || []).map((partnership, idx) => {
      const wicket = partnership.wicket || partnership.endedAt || partnership.startedAt || idx + 1;
      return {
        _id: partnership._id,
        wicket,
        wicketNumber: wicket,
        runs: toNumber(partnership.runs),
        balls: toNumber(partnership.balls),
        batsmen: [
          displayName(partnership.batsman1, playerPayload(partnership.batsman1).name),
          displayName(partnership.batsman2, playerPayload(partnership.batsman2).name)
        ],
        batsman1: partnership.batsman1,
        batsman2: partnership.batsman2,
        isCurrent: index === toNumber(match.currentInnings) && idx === (inn.partnerships || []).length - 1 && normalStatus(match.status) === "live",
        percentOfScore: inn.runs ? Number(((toNumber(partnership.runs) / toNumber(inn.runs)) * 100).toFixed(1)) : 0
      };
    });

    const inningsPayload = await Promise.all((match.innings || []).map(async (inn, index) => {
      let partnerships = mapEmbedded(inn, index);
      if (!partnerships.length) {
        const stored = await Partnership.find({ matchId: match._id, inning: index + 1 })
          .populate("batsman1Id", "name playingRole role")
          .populate("batsman2Id", "name playingRole role")
          .sort({ wicketNumber: 1 });
        partnerships = stored.map((partnership) => ({
          _id: partnership._id,
          wicket: partnership.wicketNumber,
          wicketNumber: partnership.wicketNumber,
          runs: toNumber(partnership.runs),
          balls: toNumber(partnership.balls),
          batsmen: [displayName(partnership.batsman1Id), displayName(partnership.batsman2Id)],
          batsman1: partnership.batsman1Id,
          batsman2: partnership.batsman2Id,
          isCurrent: !!partnership.isActive,
          percentOfScore: inn.runs ? Number(((toNumber(partnership.runs) / toNumber(inn.runs)) * 100).toFixed(1)) : 0
        }));
      }

      return {
        innings: index + 1,
        team: displayName(inn.team, `Team ${index + 1}`),
        teamId: inn.team?._id || inn.team,
        score: inningsScore(inn),
        partnerships
      };
    }));

    res.status(200).json({
      innings1: inningsPayload[0] || null,
      innings2: inningsPayload[1] || null,
      innings: inningsPayload
    });
  } catch (error) {
    console.error("Error fetching partnerships summary:", error);
    res.status(500).json({
      message: "Failed to fetch partnerships",
      error: error.message
    });
  }
};

export const getMatchSquads = async (req, res) => {
  try {
    const match = await populateMatch(Match.findById(req.params.id));

    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const teams = (match.teams || []).map((team) => {
      const playingXI = (match.playingXI || []).find((entry) => sameId(entry.team, team))?.players || [];
      const squad15 = (match.squad15 || []).find((entry) => sameId(entry.team, team))?.players || [];
      const twelfth = (match.twelfthMan || []).filter((entry) => sameId(entry.team, team)).map((entry) => entry.player).filter(Boolean);
      const playingIds = new Set(playingXI.map(idOf));
      const benchMap = new Map();
      [...squad15, ...twelfth].forEach((player) => {
        if (!playingIds.has(idOf(player))) benchMap.set(idOf(player), player);
      });
      const benchIds = new Set(benchMap.keys());
      const seriesSquad = (team.players || []).filter((player) => !playingIds.has(idOf(player)) && !benchIds.has(idOf(player)));

      return {
        team: {
          _id: team._id,
          name: team.name,
          shortName: team.shortName,
          logo: team.logo
        },
        playingXI: playingXI.map(playerPayload),
        benchPlayers: Array.from(benchMap.values()).map(playerPayload),
        seriesSquad: seriesSquad.map(playerPayload)
      };
    });

    res.status(200).json({ matchId: match._id, teams });
  } catch (error) {
    console.error("Error fetching match squads:", error);
    res.status(500).json({
      message: "Failed to fetch squads",
      error: error.message
    });
  }
};

export const updateMatchStatus = async (req, res) => {
  try {
    const { status, currentInnings, tossWinnerId, tossDecision, decision } = req.body;
    const normalizedStatus = normalStatus(status);

    if (!legalMatchStatuses.includes(status) || !legalMatchStatuses.map(normalStatus).includes(normalizedStatus)) {
      return res.status(400).json({
        message: "Invalid status. Must be: upcoming, toss_done, live, innings_break, or completed"
      });
    }

    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    match.status = normalizedStatus;
    if (currentInnings !== undefined) {
      const inningsNumber = toNumber(currentInnings);
      match.currentInnings = inningsNumber > 0 && inningsNumber <= match.innings.length
        ? inningsNumber - 1
        : Math.max(0, Math.min(inningsNumber, Math.max(match.innings.length - 1, 0)));
    }
    if (tossWinnerId !== undefined) match.tossWinner = tossWinnerId;
    if (tossDecision !== undefined || decision !== undefined) match.tossDecision = tossDecision || decision;
    if (normalizedStatus === "toss_done" && match.innings?.[match.currentInnings]) {
      match.innings[match.currentInnings].status = "upcoming";
    }
    if (normalizedStatus === "live" && match.innings?.[match.currentInnings]) {
      match.innings[match.currentInnings].status = "live";
    }
    if (normalizedStatus === "innings_break" && match.innings?.[match.currentInnings]) {
      match.innings[match.currentInnings].status = "upcoming";
    }
    await match.save({ validateModifiedOnly: true });

    await match.populate("teams", "name shortName logo");

    try {
      const io = getIO();
      io.emit("match:statusChanged", { matchId: match._id, status: normalizedStatus });
      io.emit("match:updated", match);
      io.emit("match:updateList");
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: `Match status updated to ${normalizedStatus}`
    });
  } catch (error) {
    console.error("Error updating match status:", error);
    res.status(400).json({
      message: "Failed to update match status",
      error: error.message
    });
  }
};

export const setPlayingXI = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId, players } = req.body;

    if (!players || players.length !== 11) {
      return res.status(400).json({
        message: "Exactly 11 players required for Playing XI"
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    // Check if team is part of the match
    const isTeamInMatch = match.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInMatch) {
      return res.status(400).json({
        message: "Team is not part of this match"
      });
    }

    // Update or add playing XI
    const existingXI = match.playingXI.find(
      xi => xi.team.toString() === teamId.toString()
    );

    if (existingXI) {
      existingXI.players = players;
    } else {
      match.playingXI.push({ team: teamId, players });
    }

    await match.save({ validateModifiedOnly: true });
    const updatedMatch = await populateMatch(Match.findById(matchId));

    try {
      const io = getIO();
      io.to(matchRoom(matchId)).emit("match:playingXIUpdated", updatedMatch);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match: updatedMatch,
      message: "Playing XI set successfully"
    });
  } catch (error) {
    console.error("Error setting Playing XI:", error);
    res.status(400).json({
      message: "Failed to set Playing XI",
      error: error.message
    });
  }
};

export const setOpeners = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { inningsIndex, batsman1Id, batsman2Id } = req.body;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const innings = match.innings[inningsIndex];
    if (!innings) {
      return res.status(400).json({ message: "Invalid innings index" });
    }

    innings.currentBatsman1 = batsman1Id;
    innings.currentBatsman2 = batsman2Id;
    innings.onStrikeBatsman = batsman1Id;

    // Add to batting order if not already present
    if (!innings.battingOrder.includes(batsman1Id)) {
      innings.battingOrder.push(batsman1Id);
    }
    if (!innings.battingOrder.includes(batsman2Id)) {
      innings.battingOrder.push(batsman2Id);
    }

    await match.save({ validateModifiedOnly: true });
    const updatedMatch = await populateMatch(Match.findById(matchId));

    try {
      const io = getIO();
      io.to(matchRoom(matchId)).emit("match:openersSet", { matchId, inningsIndex });
      io.to(matchRoom(matchId)).emit("match:updated", updatedMatch);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match: updatedMatch,
      message: "Openers set successfully"
    });
  } catch (error) {
    console.error("Error setting openers:", error);
    res.status(400).json({
      message: "Failed to set openers",
      error: error.message
    });
  }
};

export const updateToss = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { tossWinnerId, decision } = req.body;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    match.tossWinner = tossWinnerId;
    match.tossDecision = decision;
    if (!["live", "innings_break", "innings-break", "completed", "pending_tie_resolution", "super_over"].includes(match.status)) {
      match.status = "toss_done";
    }

    // Update innings teams based on toss
    const team1Id = match.teams[0]._id || match.teams[0];
    const team2Id = match.teams[1]._id || match.teams[1];

    let battingFirst, bowlingFirst;
    if (String(tossWinnerId) === String(team1Id)) {
      if (decision === 'bat') {
        battingFirst = team1Id;
        bowlingFirst = team2Id;
      } else {
        battingFirst = team2Id;
        bowlingFirst = team1Id;
      }
    } else {
      if (decision === 'bat') {
        battingFirst = team2Id;
        bowlingFirst = team1Id;
      } else {
        battingFirst = team1Id;
        bowlingFirst = team2Id;
      }
    }

    if (match.innings && match.innings.length >= 2) {
      match.innings[0].team = battingFirst;
      match.innings[1].team = bowlingFirst;
    }

    await match.save({ validateModifiedOnly: true });
    const updatedMatch = await populateMatch(Match.findById(matchId));

    try {
      const io = getIO();
      io.emit("match:tossUpdated", updatedMatch);
      io.emit("match:updated", updatedMatch);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match: updatedMatch,
      message: "Toss updated successfully"
    });
  } catch (error) {
    console.error("Error updating toss:", error);
    res.status(400).json({
      message: "Failed to update toss",
      error: error.message
    });
  }
};

export const setSquad15 = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId, players, captain, viceCaptain, wicketKeepers } = req.body;

    if (!players || players.length < 11 || players.length > 20) {
      return res.status(400).json({
        message: "Squad size must be between 11 and 20 players"
      });
    }

    if (!captain) {
      return res.status(400).json({
        message: "Captain is required"
      });
    }

    if (!viceCaptain) {
      return res.status(400).json({
        message: "Vice-captain is required"
      });
    }

    if (!wicketKeepers || wicketKeepers.length === 0) {
      return res.status(400).json({
        message: "At least one wicket-keeper is required"
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const isTeamInMatch = match.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInMatch) {
      return res.status(400).json({
        message: "Team is not part of this match"
      });
    }

    const existingSquad = match.squad15.find(
      xi => xi.team.toString() === teamId.toString()
    );

    if (existingSquad) {
      existingSquad.players = players;
      existingSquad.captain = captain;
      existingSquad.viceCaptain = viceCaptain;
      existingSquad.wicketKeepers = wicketKeepers;
    } else {
      match.squad15.push({ team: teamId, players, captain, viceCaptain, wicketKeepers });
    }

    await match.save({ validateModifiedOnly: true });
    await match.populate("squad15.team", "name shortName logo");
    await match.populate("squad15.players", "name role playingRole");

    try {
      const io = getIO();
      io.to(matchRoom(matchId)).emit("match:squadUpdated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "15-member squad set successfully"
    });
  } catch (error) {
    console.error("Error setting squad:", error);
    res.status(400).json({
      message: "Failed to set squad",
      error: error.message
    });
  }
};

export const setTwelfthMan = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId, playerId } = req.body;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const isTeamInMatch = match.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInMatch) {
      return res.status(400).json({
        message: "Team is not part of this match"
      });
    }

    const existingEntry = match.twelfthMan.find(
      tm => tm.team.toString() === teamId.toString()
    );

    if (existingEntry) {
      existingEntry.player = playerId;
    } else {
      match.twelfthMan.push({ team: teamId, player: playerId });
    }

    await match.save({ validateModifiedOnly: true });
    await match.populate("twelfthMan.team", "name shortName logo");
    await match.populate("twelfthMan.player", "name role playingRole");

    try {
      const io = getIO();
      io.to(matchRoom(matchId)).emit("match:twelfthManUpdated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "12th man set successfully"
    });
  } catch (error) {
    console.error("Error setting 12th man:", error);
    res.status(400).json({
      message: "Failed to set 12th man",
      error: error.message
    });
  }
};

export const setBowlingXI = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId, players } = req.body;

    if (!players || players.length < 1 || players.length > 11) {
      return res.status(400).json({
        message: "Select 1-11 bowlers from Playing XI"
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const isTeamInMatch = match.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInMatch) {
      return res.status(400).json({
        message: "Team is not part of this match"
      });
    }

    const existingXI = match.bowlingXI.find(
      xi => xi.team.toString() === teamId.toString()
    );

    if (existingXI) {
      existingXI.players = players;
    } else {
      match.bowlingXI.push({ team: teamId, players });
    }

    await match.save({ validateModifiedOnly: true });
    await match.populate("bowlingXI.team", "name shortName logo");
    await match.populate("bowlingXI.players", "name role playingRole");

    try {
      const io = getIO();
      io.to(matchRoom(matchId)).emit("match:bowlingXIUpdated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "Bowling XI set successfully"
    });
  } catch (error) {
    console.error("Error setting Bowling XI:", error);
    res.status(400).json({
      message: "Failed to set Bowling XI",
      error: error.message
    });
  }
};

export const setTeamRoles = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { teamId, captain, viceCaptain, wicketKeepers } = req.body;

    if (!captain) {
      return res.status(400).json({
        message: "Captain is required"
      });
    }

    if (!viceCaptain) {
      return res.status(400).json({
        message: "Vice-captain is required"
      });
    }

    if (!wicketKeepers || wicketKeepers.length === 0) {
      return res.status(400).json({
        message: "At least one wicket-keeper is required"
      });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: "Match not found" });
    }

    const isTeamInMatch = match.teams.some(
      t => t.toString() === teamId.toString()
    );

    if (!isTeamInMatch) {
      return res.status(400).json({
        message: "Team is not part of this match"
      });
    }

    const existingRoles = match.teamRoles?.find(
      r => r.team.toString() === teamId.toString()
    );

    if (existingRoles) {
      existingRoles.captain = captain;
      existingRoles.viceCaptain = viceCaptain;
      existingRoles.wicketKeepers = wicketKeepers;
    } else {
      if (!match.teamRoles) {
        match.teamRoles = [];
      }
      match.teamRoles.push({ team: teamId, captain, viceCaptain, wicketKeepers });
    }

    await match.save({ validateModifiedOnly: true });
    await match.populate("teamRoles.team", "name shortName logo");
    await match.populate("teamRoles.captain", "name role playingRole");
    await match.populate("teamRoles.viceCaptain", "name role playingRole");
    await match.populate("teamRoles.wicketKeepers", "name role playingRole");

    try {
      const io = getIO();
      io.to(matchRoom(matchId)).emit("match:teamRolesUpdated", match);
    } catch (socketError) {
      console.log("Socket not available:", socketError.message);
    }

    res.status(200).json({
      match,
      message: "Team roles set successfully"
    });
  } catch (error) {
    console.error("Error setting team roles:", error);
    res.status(400).json({
      message: "Failed to set team roles",
      error: error.message
    });
  }
};

const FEATURED_MATCH_CAP = 5;

export const toggleMatchFeatured = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const enabling = !match.isFeatured;
    if (enabling) {
      const count = await Match.countDocuments({ isFeatured: true });
      if (count >= FEATURED_MATCH_CAP) {
        return res.status(400).json({
          message: `Cannot feature more than ${FEATURED_MATCH_CAP} matches at once. Unfeature another match first.`
        });
      }
    }

    match.isFeatured = enabling;
    await match.save();

    try { getIO()?.emit("match:updated", match); } catch (e) {}

    res.json({
      match,
      isFeatured: match.isFeatured,
      message: enabling ? "Match featured" : "Match unfeatured"
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
