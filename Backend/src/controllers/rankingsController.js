import Player from '../models/Player.js';
import Match from '../models/Match.js';

export const getBattingRankings = async (req, res) => {
  try {
    const { tournamentId, limit = 50 } = req.query;

    const players = await Player.find()
      .populate('team', 'name shortName logo')
      .limit(parseInt(limit));

    // Calculate batting average, strike rate etc from match data
    const rankings = players.map((player, index) => ({
      rank: index + 1,
      player: {
        _id: player._id,
        name: player.name,
        team: player.team,
        playingRole: player.playingRole || 'Batsman'
      },
      matches: player.stats?.matches || 0,
      innings: player.stats?.innings || 0,
      notOuts: player.stats?.notOuts || 0,
      runs: player.stats?.runs || 0,
      highScore: player.stats?.highScore || 0,
      average: player.stats?.average || 0,
      strikeRate: player.stats?.strikeRate || 0,
      fifties: player.stats?.fifties || 0,
      hundreds: player.stats?.hundreds || 0,
      dotBalls: player.stats?.dotBalls || 0,
      // Calculate ranking points based on performance
      rankingPoints: (player.stats?.runs || 0) +
        (player.stats?.fifties || 0) * 50 +
        (player.stats?.hundreds || 0) * 100 +
        ((player.stats?.strikeRate || 0) - 100) * 2
    }));

    // Sort by runs (primary), then by ranking points
    rankings.sort((a, b) => {
      if (b.runs !== a.runs) return b.runs - a.runs;
      return b.rankingPoints - a.rankingPoints;
    });
    rankings.forEach((r, i) => r.rank = i + 1);

    res.status(200).json(rankings);
  } catch (error) {
    console.error('Error fetching batting rankings:', error);
    res.status(500).json({
      message: 'Failed to fetch batting rankings',
      error: error.message
    });
  }
};

export const getBowlingRankings = async (req, res) => {
  try {
    const { tournamentId, limit = 50 } = req.query;

    const players = await Player.find()
      .populate('team', 'name shortName logo')
      .limit(parseInt(limit));

    const rankings = players.map((player, index) => ({
      rank: index + 1,
      player: {
        _id: player._id,
        name: player.name,
        team: player.team,
        playingRole: player.playingRole || 'Bowler'
      },
      matches: player.stats?.matches || 0,
      innings: player.stats?.innings || 0,
      overs: Math.floor((player.stats?.balls || 0) / 6),
      balls: player.stats?.balls || 0,
      wickets: player.stats?.wickets || 0,
      runs: player.stats?.runs || 0,
      average: player.stats?.bowlingAverage || 0,
      economy: player.stats?.economy || 0,
      strikeRate: player.stats?.bowlingStrikeRate || 0,
      best: player.stats?.bestBowling || '0/0',
      fourWickets: player.stats?.fourWickets || 0,
      fiveWickets: player.stats?.fiveWickets || 0,
      dotBalls: player.stats?.dotBalls || 0,
      // Calculate ranking points
      rankingPoints: (player.stats?.wickets || 0) * 25 +
        (player.stats?.fourWickets || 0) * 50 +
        (player.stats?.fiveWickets || 0) * 100 +
        (10 - (player.stats?.economy || 10)) * 10
    }));

    // Sort by wickets (primary), then by ranking points
    rankings.sort((a, b) => {
      if (b.wickets !== a.wickets) return b.wickets - a.wickets;
      return b.rankingPoints - a.rankingPoints;
    });
    rankings.forEach((r, i) => r.rank = i + 1);

    res.status(200).json(rankings);
  } catch (error) {
    console.error('Error fetching bowling rankings:', error);
    res.status(500).json({
      message: 'Failed to fetch bowling rankings',
      error: error.message
    });
  }
};

export const getAllRounderRankings = async (req, res) => {
  try {
    const { tournamentId, limit = 50 } = req.query;

    const players = await Player.find()
      .populate('team', 'name shortName logo')
      .limit(parseInt(limit));

    const rankings = players.map((player, index) => {
      const battingPoints = (player.stats?.runs || 0) * 1 +
        (player.stats?.fifties || 0) * 25 +
        (player.stats?.hundreds || 0) * 50;
      const bowlingPoints = (player.stats?.wickets || 0) * 20 +
        (player.stats?.fourWickets || 0) * 25 +
        (player.stats?.fiveWickets || 0) * 50;
      const totalPoints = battingPoints + bowlingPoints;

      return {
        rank: index + 1,
        player: {
          _id: player._id,
          name: player.name,
          team: player.team,
          playingRole: player.playingRole || 'All-Rounder'
        },
        matches: player.stats?.matches || 0,
        runs: player.stats?.runs || 0,
        wickets: player.stats?.wickets || 0,
        battingAverage: player.stats?.average || 0,
        bowlingAverage: player.stats?.bowlingAverage || 0,
        battingStrikeRate: player.stats?.strikeRate || 0,
        bowlingEconomy: player.stats?.economy || 0,
        points: totalPoints,
        battingPoints,
        bowlingPoints
      };
    });

    rankings.sort((a, b) => b.points - a.points);
    rankings.forEach((r, i) => r.rank = i + 1);

    res.status(200).json(rankings);
  } catch (error) {
    console.error('Error fetching all-rounder rankings:', error);
    res.status(500).json({
      message: 'Failed to fetch all-rounder rankings',
      error: error.message
    });
  }
};

// New endpoint for player-specific rankings (flexible role-based)
export const getPlayerRankings = async (req, res) => {
  try {
    const { type = 'all', limit = 50 } = req.query;

    const players = await Player.find()
      .populate('team', 'name shortName logo')
      .limit(parseInt(limit));

    let rankings = players.map((player) => {
      const battingPoints = (player.stats?.runs || 0) +
        (player.stats?.fifties || 0) * 50 +
        (player.stats?.hundreds || 0) * 100;
      const bowlingPoints = (player.stats?.wickets || 0) * 25 +
        (player.stats?.fourWickets || 0) * 50 +
        (player.stats?.fiveWickets || 0) * 100;

      let rankingPoints = 0;
      let category = 'all-rounder';

      if (type === 'batting') {
        rankingPoints = battingPoints;
        category = 'batting';
      } else if (type === 'bowling') {
        rankingPoints = bowlingPoints;
        category = 'bowling';
      } else {
        // Flexible: player appears based on performance, not main role
        if (battingPoints > bowlingPoints * 2) {
          rankingPoints = battingPoints;
          category = 'batting';
        } else if (bowlingPoints > battingPoints) {
          rankingPoints = bowlingPoints;
          category = 'bowling';
        } else {
          rankingPoints = battingPoints + bowlingPoints;
          category = 'all-rounder';
        }
      }

      return {
        _id: player._id,
        name: player.name,
        team: player.team,
        role: player.role,
        playingRole: player.playingRole,
        imageUrl: player.imageUrl,
        stats: player.stats,
        rankingPoints,
        category,
        battingPoints,
        bowlingPoints
      };
    });

    rankings.sort((a, b) => b.rankingPoints - a.rankingPoints);
    rankings.forEach((r, i) => r.rank = i + 1);

    res.status(200).json(rankings);
  } catch (error) {
    console.error('Error fetching player rankings:', error);
    res.status(500).json({
      message: 'Failed to fetch player rankings',
      error: error.message
    });
  }
};