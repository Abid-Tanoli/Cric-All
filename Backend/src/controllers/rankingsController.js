import mongoose from 'mongoose';
import Player from '../models/Player.js';
import Team from '../models/Team.js';
import {
  hiddenTeamIds,
  reservedNamesMongoClause,
  publicTeamClause,
} from '../utils/publicProjection.js';

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toLimit = (value) => Math.min(Math.max(toNumber(value, 50), 1), 100);
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textRegex = (value) => ({ $regex: escapeRegex(value), $options: 'i' });
const isTransientDbError = (error) => (
  error?.name === 'MongooseError' ||
  error?.name === 'MongoServerSelectionError' ||
  error?.name === 'MongoNetworkTimeoutError' ||
  /timed out|buffering|not connected/i.test(error?.message || '')
);

const buildScopeQuery = async (queryParams = {}, type = 'all') => {
  const { scope = 'country', scopeValue = '', teamId, category, city, district, town, country } = queryParams;
  const query = {};
  const value = String(scopeValue || '').trim();

  if (teamId && isObjectId(teamId)) {
    query.team = teamId;
  } else if (scope === 'team' && value) {
    if (isObjectId(value)) {
      query.team = value;
    } else {
      // Fix B: a name lookup over Team must not resolve to a hidden team or a
      // fixture — otherwise `?scope=team&scopeValue=...` would re-introduce the
      // very teams the rankings are meant to leave out.
      const teams = await Team.find({
        $and: [
          publicTeamClause(),
          {
            $or: [
              { name: textRegex(value) },
              { shortName: textRegex(value) },
              { organization: textRegex(value) },
              { branchName: textRegex(value) },
            ],
          },
        ],
      }).select('_id').limit(1000).maxTimeMS(5000).lean();
      query.team = { $in: teams.map((team) => team._id) };
    }
  }
  if (category) query.category = category;
  if (city) query['address.city'] = textRegex(city);
  if (district) query['address.district'] = textRegex(district);
  if (town) query['address.town'] = textRegex(town);
  if (country) query['address.country'] = textRegex(country);

  if (value && scope !== 'team') {
    if (scope === 'pre-town' || scope === 'pre_town' || scope === 'area') {
      query['address.town'] = textRegex(value);
    }
    if (scope === 'town') query['address.town'] = textRegex(value);
    if (scope === 'district') query['address.district'] = textRegex(value);
    if (scope === 'city') query['address.city'] = textRegex(value);
    if (scope === 'country') query['address.country'] = textRegex(value);
  }

  if (type === 'wicket-keeper') {
    query.playingRole = 'Wicket-Keeper';
  }

  return query;
};

const stat = (field, fallback = 0) => ({ $ifNull: [`$stats.${field}`, fallback] });
const positive = (expression) => ({ $max: [expression, 0] });

const rankingExpression = (type) => {
  const battingPoints = {
    $add: [
      stat('runs'),
      { $multiply: [stat('fifties'), 50] },
      { $multiply: [stat('hundreds'), 100] },
      { $multiply: [positive({ $subtract: [stat('strikeRate'), 100] }), 2] },
    ],
  };
  const bowlingPoints = {
    $add: [
      { $multiply: [stat('wickets'), 25] },
      { $multiply: [stat('fourWickets'), 50] },
      { $multiply: [stat('fiveWickets'), 100] },
      { $multiply: [positive({ $subtract: [10, stat('economy', 10)] }), 10] },
    ],
  };
  const fieldingPoints = {
    $add: [
      { $multiply: [stat('catches'), 10] },
      { $multiply: [stat('runOuts'), 15] },
      { $multiply: [stat('stumpings'), 15] },
    ],
  };
  const wicketKeeperPoints = {
    $add: [
      { $multiply: [stat('stumpings'), 20] },
      { $multiply: [stat('catches'), 10] },
      { $multiply: [stat('runOuts'), 10] },
    ],
  };

  if (type === 'batting') return battingPoints;
  if (type === 'bowling') return bowlingPoints;
  if (type === 'fielder') return fieldingPoints;
  if (type === 'wicket-keeper') return wicketKeeperPoints;
  return { $add: [battingPoints, bowlingPoints] };
};

const rankPlayer = (player, type) => {
  const stats = player.stats || {};
  const battingPoints = toNumber(stats.runs)
    + toNumber(stats.fifties) * 50
    + toNumber(stats.hundreds) * 100
    + Math.max(toNumber(stats.strikeRate) - 100, 0) * 2;
  const bowlingPoints = toNumber(stats.wickets) * 25
    + toNumber(stats.fourWickets) * 50
    + toNumber(stats.fiveWickets) * 100
    + Math.max(10 - toNumber(stats.economy, 10), 0) * 10;
  const fieldingPoints = toNumber(stats.catches) * 10
    + toNumber(stats.runOuts) * 15
    + toNumber(stats.stumpings) * 15;
  const wicketKeeperPoints = toNumber(stats.stumpings) * 20
    + toNumber(stats.catches) * 10
    + toNumber(stats.runOuts) * 10;

  if (type === 'batting') return battingPoints;
  if (type === 'bowling') return bowlingPoints;
  if (type === 'fielder') return fieldingPoints;
  if (type === 'wicket-keeper') return wicketKeeperPoints;
  return battingPoints + bowlingPoints;
};

const buildRankings = async (req, type) => {
  const limit = toLimit(req.query.limit);
  const query = await buildScopeQuery(req.query, type);

  // Fix B: these routes are public, so the ranking omits fixtures and the
  // players of hidden teams. No viewer exemption is needed — a platform admin
  // reads rankings from the same public boards as everyone else.
  const excluded = await hiddenTeamIds();
  const andClauses = [reservedNamesMongoClause('name')];
  if (excluded.length) andClauses.push({ team: { $nin: excluded } });
  query.$and = [...(query.$and || []), ...andClauses];

  const players = await Player.aggregate([
    { $match: query },
    { $addFields: { rankingPoints: rankingExpression(type) } },
    { $sort: { rankingPoints: -1, 'stats.runs': -1, 'stats.wickets': -1, updatedAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'teams',
        localField: 'team',
        foreignField: '_id',
        as: 'team',
      },
    },
    { $unwind: { path: '$team', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        name: 1,
        role: 1,
        playingRole: 1,
        imageUrl: 1,
        stats: 1,
        rankingPoints: 1,
        team: { _id: 1, name: 1, shortName: 1, logo: 1 },
      },
    },
  ]).option({ maxTimeMS: 5000 });

  const rankings = players.map((player) => {
    const stats = player.stats || {};
    const rankingPoints = rankPlayer(player, type);

    return {
      _id: player._id,
      rank: 0,
      name: player.name,
      player: {
        _id: player._id,
        name: player.name,
        team: player.team,
        playingRole: player.playingRole || player.role || 'Player',
        imageUrl: player.imageUrl || '',
      },
      team: player.team,
      role: player.role,
      playingRole: player.playingRole,
      imageUrl: player.imageUrl,
      matches: toNumber(stats.matches),
      innings: toNumber(stats.innings),
      runs: toNumber(stats.runs),
      wickets: toNumber(stats.wickets),
      catches: toNumber(stats.catches),
      stumpings: toNumber(stats.stumpings),
      runOuts: toNumber(stats.runOuts),
      highScore: toNumber(stats.highScore),
      average: toNumber(stats.average),
      strikeRate: toNumber(stats.strikeRate),
      economy: toNumber(stats.economy),
      bowlingAverage: toNumber(stats.bowlingAverage),
      best: stats.bestBowling || '0/0',
      fifties: toNumber(stats.fifties),
      hundreds: toNumber(stats.hundreds),
      rankingPoints,
      points: rankingPoints,
      category: type,
    };
  });

  rankings.sort((a, b) => b.rankingPoints - a.rankingPoints);
  rankings.forEach((ranking, index) => {
    ranking.rank = index + 1;
  });

  return rankings;
};

export const getBattingRankings = async (req, res) => {
  try {
    res.status(200).json(await buildRankings(req, 'batting'));
  } catch (error) {
    console.error('Error fetching batting rankings:', error);
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({ message: 'Failed to fetch batting rankings', error: error.message });
  }
};

export const getBowlingRankings = async (req, res) => {
  try {
    res.status(200).json(await buildRankings(req, 'bowling'));
  } catch (error) {
    console.error('Error fetching bowling rankings:', error);
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({ message: 'Failed to fetch bowling rankings', error: error.message });
  }
};

export const getAllRounderRankings = async (req, res) => {
  try {
    res.status(200).json(await buildRankings(req, 'all-rounder'));
  } catch (error) {
    console.error('Error fetching all-rounder rankings:', error);
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({ message: 'Failed to fetch all-rounder rankings', error: error.message });
  }
};

export const getFielderRankings = async (req, res) => {
  try {
    res.status(200).json(await buildRankings(req, 'fielder'));
  } catch (error) {
    console.error('Error fetching fielder rankings:', error);
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({ message: 'Failed to fetch fielder rankings', error: error.message });
  }
};

export const getWicketKeeperRankings = async (req, res) => {
  try {
    res.status(200).json(await buildRankings(req, 'wicket-keeper'));
  } catch (error) {
    console.error('Error fetching wicket-keeper rankings:', error);
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({ message: 'Failed to fetch wicket-keeper rankings', error: error.message });
  }
};

// New endpoint for player-specific rankings (flexible role-based)
export const getPlayerRankings = async (req, res) => {
  try {
    const type = req.query.type || 'all-rounder';
    const normalizedType = type === 'all' ? 'all-rounder' : type;
    const rankings = await buildRankings(req, normalizedType);
    res.status(200).json(rankings);
  } catch (error) {
    console.error('Error fetching player rankings:', error);
    if (isTransientDbError(error)) return res.status(200).json([]);
    res.status(500).json({
      message: 'Failed to fetch player rankings',
      error: error.message
    });
  }
};
