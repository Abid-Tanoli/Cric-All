import Series from '../models/Series.js';
import Match from '../models/Match.js';
import Event from '../models/Event.js';
import Team from '../models/Team.js';
import mongoose from 'mongoose';
import {
  filterHiddenTeams,
  hiddenTeamIds,
  reservedNamesMongoClause,
} from '../utils/publicProjection.js';

const idOf = (value) => String(value?._id || value || "");
const sameId = (a, b) => idOf(a) && idOf(a) === idOf(b);
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const normalStatus = (status = "upcoming") => (status === "innings-break" ? "innings_break" : status);

/** Drops matches that involve a hidden team (ids or populated docs). */
const filterHiddenMatches = (matches, hiddenSet) => {
  if (!Array.isArray(matches)) return matches;
  return matches.filter((match) => {
    const teams = match?.teams || [];
    return !teams.some((team) => hiddenSet.has(String(team?._id || team)));
  });
};
const formatOvers = (balls = 0) => `${Math.floor(number(balls) / 6)}.${number(balls) % 6}`;
const formatBowlerOvers = (row = {}) => {
  if (number(row.balls) > 0) return formatOvers(row.balls);
  return `${number(row.overs)}.0`;
};
const playerName = (player) => player?.name || player?.fullName || "Unknown";
const teamName = (team) => team?.name || team?.shortName || "Unknown";

const matchPopulate = (query) => query
  .populate('teams', 'name shortName logo players')
  .populate({
    path: 'teams',
    populate: { path: 'players', select: 'name role playingRole' }
  })
  .populate('result.winner', 'name shortName logo')
  .populate('innings.team', 'name shortName logo')
  .populate('innings.batting.player', 'name role playingRole')
  .populate('innings.bowling.player', 'name role playingRole')
  .populate('playingXI.team', 'name shortName logo')
  .populate('playingXI.players', 'name role playingRole')
  .populate('squad15.team', 'name shortName logo')
  .populate('squad15.players', 'name role playingRole')
  .populate('twelfthMan.team', 'name shortName logo')
  .populate('twelfthMan.player', 'name role playingRole');

const findSeriesOrEvent = async (id) => {
  const query = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
  const series = await Series.findOne(query).populate('teams', 'name shortName logo players');
  if (series) return { type: 'series', entity: series };

  const event = await Event.findOne(query)
    .populate('teams', 'name shortName logo players')
    .populate('pointsTable.team', 'name shortName logo');
  if (event) return { type: 'event', entity: event };

  return null;
};

const getSeriesMatches = async (id, entity) => {
  const idsToMatch = [id, entity?._id, entity?.slug, entity?.name].filter(Boolean).map(String);
  const or = [
    { series: { $in: idsToMatch } }
  ];

  if (entity?._id && mongoose.isValidObjectId(entity._id)) {
    or.push({ tournament: entity._id });
    or.push({ event: entity._id });
  }

  return matchPopulate(Match.find({ $or: or })).sort({ startAt: 1 });
};

const groupMatchesByStatus = (matches) => {
  const groups = { live: [], completed: [], upcoming: [] };
  matches.forEach((match) => {
    const status = normalStatus(match.status);
    const payload = match.toObject ? match.toObject({ virtuals: true }) : match;
    payload.status = status;
    if (status === 'live' || status === 'innings_break' || status === 'toss_done') {
      groups.live.push(payload);
    } else if (status === 'completed') {
      groups.completed.push(payload);
    } else {
      groups.upcoming.push(payload);
    }
  });
  return groups;
};

const aggregateSeriesStats = (matches) => {
  const batting = new Map();
  const bowling = new Map();
  const fielding = new Map();

  matches.filter((match) => normalStatus(match.status) === 'completed' || normalStatus(match.status) === 'live' || normalStatus(match.status) === 'innings_break').forEach((match) => {
    (match.innings || []).forEach((innings) => {
      const battingTeam = teamName(innings.team);
      (innings.batting || []).forEach((row) => {
        const key = idOf(row.player);
        if (!key) return;
        const current = batting.get(key) || {
          playerId: key,
          name: playerName(row.player),
          team: battingTeam,
          matches: 0,
          innings: 0,
          notOuts: 0,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          highest: 0,
          fifties: 0,
          hundreds: 0
        };
        current.matches += 1;
        current.innings += 1;
        current.notOuts += row.isOut ? 0 : 1;
        current.runs += number(row.runs);
        current.balls += number(row.balls);
        current.fours += number(row.fours);
        current.sixes += number(row.sixes);
        current.highest = Math.max(current.highest, number(row.runs));
        if (number(row.runs) >= 100) current.hundreds += 1;
        else if (number(row.runs) >= 50) current.fifties += 1;
        batting.set(key, current);
      });

      (innings.batting || []).forEach((row) => {
        if (row.dismissalType && row.fielder) {
          const fielderKey = idOf(row.fielder);
          if (!fielderKey) return;
          const fielderName = row.fielder?.name || playerName(row.fielder) || "Unknown";
          const fielderTeam = teamName(innings.team);
          const current = fielding.get(fielderKey) || {
            playerId: fielderKey,
            name: fielderName,
            team: fielderTeam,
            matches: 0,
            catches: 0,
            stumpings: 0,
            runOuts: 0
          };
          current.matches += 1;
          if (row.dismissalType === "caught") current.catches += 1;
          else if (row.dismissalType === "stumped") current.stumpings += 1;
          else if (row.dismissalType === "run out") current.runOuts += 1;
          fielding.set(fielderKey, current);
        }
      });

      (innings.bowling || []).forEach((row) => {
        const key = idOf(row.player);
        if (!key) return;
        const current = bowling.get(key) || {
          playerId: key,
          name: playerName(row.player),
          team: battingTeam,
          matches: 0,
          balls: 0,
          overs: "0.0",
          maidens: 0,
          runs: 0,
          wickets: 0,
          dotBalls: 0,
          wides: 0,
          noBalls: 0,
          best: "0/0",
          fourWickets: 0,
          fiveWickets: 0
        };
        current.matches += 1;
        current.balls += number(row.balls);
        current.maidens += number(row.maidens);
        current.runs += number(row.runs);
        current.wickets += number(row.wickets);
        current.dotBalls += number(row.dotBalls ?? row.dots);
        current.wides += number(row.wides);
        current.noBalls += number(row.noBalls);
        const bestParts = current.best.split("/").map(Number);
        if (number(row.wickets) > bestParts[0] || (number(row.wickets) === bestParts[0] && number(row.runs) < bestParts[1])) {
          current.best = `${number(row.wickets)}/${number(row.runs)}`;
        }
        if (number(row.wickets) >= 5) current.fiveWickets += 1;
        else if (number(row.wickets) >= 4) current.fourWickets += 1;
        bowling.set(key, current);
      });
    });
  });

  const topRunScorers = Array.from(batting.values()).map((row) => ({
    ...row,
    average: row.innings - row.notOuts > 0 ? (row.runs / (row.innings - row.notOuts)).toFixed(2) : row.runs.toFixed(2),
    strikeRate: row.balls ? ((row.runs / row.balls) * 100).toFixed(2) : "0.00"
  })).sort((a, b) => b.runs - a.runs);

  const topWicketTakers = Array.from(bowling.values()).map((row) => ({
    ...row,
    overs: formatOvers(row.balls),
    average: row.wickets ? (row.runs / row.wickets).toFixed(2) : "-",
    economy: row.balls ? ((row.runs / row.balls) * 6).toFixed(2) : "-",
    strikeRate: row.wickets ? (row.balls / row.wickets).toFixed(1) : "-"
  })).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs);

  const boundaryPlayers = topRunScorers;
  const boundaryMeter = {
    sixes: boundaryPlayers.reduce((sum, player) => sum + number(player.sixes), 0),
    fours: boundaryPlayers.reduce((sum, player) => sum + number(player.fours), 0),
    mostSixes: boundaryPlayers.filter((player) => player.sixes > 0).sort((a, b) => b.sixes - a.sixes).slice(0, 5).map((player) => ({ playerId: player.playerId, name: player.name, team: player.team, count: player.sixes })),
    mostFours: boundaryPlayers.filter((player) => player.fours > 0).sort((a, b) => b.fours - a.fours).slice(0, 5).map((player) => ({ playerId: player.playerId, name: player.name, team: player.team, count: player.fours }))
  };

  const topFielders = Array.from(fielding.values())
    .sort((a, b) => (b.catches + b.stumpings + b.runOuts) - (a.catches + a.stumpings + a.runOuts));

  return { topRunScorers, topWicketTakers, topFielders, boundaryMeter };
};

const aggregateSeriesSquads = async (entity, matches) => {
  const teamMap = new Map();
  const ensureTeam = (team) => {
    const key = idOf(team);
    if (!key) return null;
    if (!teamMap.has(key)) {
      teamMap.set(key, {
        team: {
          _id: team?._id || team,
          name: team?.name || "Team",
          shortName: team?.shortName || "",
          logo: team?.logo || ""
        },
        players: new Map()
      });
    }
    return teamMap.get(key);
  };

  (entity?.teams || []).forEach((team) => {
    const entry = ensureTeam(team);
    if (!entry) return;
    (team.players || []).forEach((player) => {
      entry.players.set(idOf(player), { ...(player.toObject?.() || player), isPlayingXI: false });
    });
  });

  matches.forEach((match) => {
    (match.teams || []).forEach((team) => {
      const entry = ensureTeam(team);
      if (!entry) return;
      (team.players || []).forEach((player) => {
        entry.players.set(idOf(player), { ...(player.toObject?.() || player), isPlayingXI: false });
      });
    });
    (match.playingXI || []).forEach((xi) => {
      const entry = ensureTeam(xi.team);
      if (!entry) return;
      (xi.players || []).forEach((player) => {
        const existing = entry.players.get(idOf(player)) || {};
        entry.players.set(idOf(player), { ...existing, ...(player.toObject?.() || player), isPlayingXI: true });
      });
    });
    (match.squad15 || []).forEach((squad) => {
      const entry = ensureTeam(squad.team);
      if (!entry) return;
      (squad.players || []).forEach((player) => {
        const existing = entry.players.get(idOf(player)) || {};
        entry.players.set(idOf(player), { ...(player.toObject?.() || player), isPlayingXI: existing.isPlayingXI || false });
      });
    });
  });

  const missingTeamIds = Array.from(teamMap.keys()).filter((teamId) => !teamMap.get(teamId).players.size);
  if (missingTeamIds.length) {
    const fullTeams = await Team.find({ _id: { $in: missingTeamIds } }).populate("players", "name role playingRole");
    fullTeams.forEach((team) => {
      const entry = teamMap.get(idOf(team));
      (team.players || []).forEach((player) => {
        entry.players.set(idOf(player), { ...player.toObject(), isPlayingXI: false });
      });
    });
  }

  return {
    teams: Array.from(teamMap.values()).map((entry) => ({
      team: entry.team,
      name: entry.team.name,
      players: Array.from(entry.players.values()).map((player) => ({
        _id: player._id,
        name: player.name || "Unknown",
        role: player.role || player.playingRole || "",
        playingRole: player.playingRole || player.role || "",
        isPlayingXI: !!player.isPlayingXI
      }))
    }))
  };
};

export const getSeries = async (req, res) => {
  try {
    // Fix B: the public series board omits fixtures and series whose teams are
    // all hidden; embedded team lists drop the hidden ones either way.
    const series = await Series.find({ $and: [reservedNamesMongoClause("name")] })
      .populate('teams', 'name shortName logo')
      .sort({ startDate: -1 });
    res.json(series.map((entry) => ({
      ...entry.toObject(),
      teams: filterHiddenTeams(entry.teams || []),
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSeriesById = async (req, res) => {
  try {
    const { id } = req.params;
    // Fix B: detail-by-id stays reachable, but the embedded team lists and the
    // points table drop hidden teams for a guest.
    const hidden = new Set(await hiddenTeamIds());
    const seriesQuery = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
    const series = await Series.findOne(seriesQuery).populate('teams', 'name shortName logo');
    
    if (!series) {
      const eventQuery = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
      const event = await Event.findOne(eventQuery)
        .populate('teams', 'name shortName logo')
        .populate('matches')
        .populate('pointsTable.team', 'name shortName logo');
      if (event) {
        const matches = await Match.find({ $or: [{ event: event._id }, { tournament: event._id }] })
          .populate('teams', 'name shortName logo')
          .populate('result.winner', 'name')
          .sort({ startAt: 1 });
        const payload = {
          _id: event._id,
          slug: event.slug,
          name: event.name,
          eventType: event.eventType,
          matchType: event.format || event.category?.name || 'T20',
          format: event.format,
          teams: event.teams || [],
          matches: matches.length ? matches : event.matches || [],
          pointsTable: event.pointsTable || [],
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          venue: event.venue,
          logo: event.logo,
          totalMatches: event.totalMatches
        };
        stripHiddenTeamRefs(payload, hidden);
        return res.json(payload);
      }
      return res.status(404).json({ message: 'Series not found' });
    }
    
    const matches = await Match.find({ series: series._id })
      .populate('teams', 'name shortName logo')
      .populate('result.winner', 'name')
      .sort({ startAt: 1 });

    const payload = { ...series.toObject(), teams: filterHiddenTeams(series.teams || []), matches: filterHiddenMatches(matches, hidden) };
    stripHiddenTeamRefs(payload, hidden);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSeriesMatchesById = async (req, res) => {
  try {
    const found = await findSeriesOrEvent(req.params.id);
    if (!found) return res.status(404).json({ message: 'Series not found' });

    const matches = await getSeriesMatches(req.params.id, found.entity);
    const grouped = groupMatchesByStatus(matches);

    res.json({
      seriesId: found.entity._id,
      slug: found.entity.slug,
      name: found.entity.name,
      ...grouped
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSeriesStatsById = async (req, res) => {
  try {
    const found = await findSeriesOrEvent(req.params.id);
    if (!found) return res.status(404).json({ message: 'Series not found' });

    const matches = await getSeriesMatches(req.params.id, found.entity);
    const activeMatches = matches.filter((match) => ['completed', 'live', 'innings_break', 'innings-break'].includes(normalStatus(match.status)));
    const stats = aggregateSeriesStats(activeMatches);

    res.json({
      seriesId: found.entity._id,
      hasCompletedMatches: activeMatches.length > 0,
      emptyMessage: activeMatches.length ? "" : "Stats will be available after matches are played.",
      ...stats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSeriesSquadsById = async (req, res) => {
  try {
    const found = await findSeriesOrEvent(req.params.id);
    if (!found) return res.status(404).json({ message: 'Series not found' });

    const matches = await getSeriesMatches(req.params.id, found.entity);
    const squads = await aggregateSeriesSquads(found.entity, matches);

    res.json({
      seriesId: found.entity._id,
      ...squads
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createSeries = async (req, res) => {
  try {
    const series = new Series(req.body);
    await series.save();
    res.status(201).json(series);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateSeries = async (req, res) => {
  try {
    const series = await Series.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(series);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteSeries = async (req, res) => {
  try {
    await Series.findByIdAndDelete(req.params.id);
    res.json({ message: 'Series deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
