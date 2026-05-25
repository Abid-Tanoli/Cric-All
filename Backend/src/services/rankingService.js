import Team from "../models/Team.js";
import TeamRanking from "../models/TeamRanking.js";
import TeamPlayerRanking from "../models/TeamPlayerRanking.js";
import TeamCategory from "../models/TeamCategory.js";
import Player from "../models/Player.js";
import Match from "../models/Match.js";

export async function computeTeamRanking(teamId) {
  const team = await Team.findById(teamId);
  if (!team) throw new Error("Team not found");

  const matches = await Match.find({
    teams: teamId,
    status: "completed",
  });

  const stats = {
    matches_played: matches.length,
    matches_won: 0,
    matches_lost: 0,
    matches_drawn: 0,
    matches_no_result: 0,
  };

  let totalRunsScored = 0;
  let totalRunsConceded = 0;
  let totalWicketsTaken = 0;
  let totalOversBatting = 0;
  let totalOversBowling = 0;
  const formResults = [];

  for (const match of matches) {
    const teamIndex = match.teams.findIndex((t) => t.toString() === teamId);
    const opponentIndex = teamIndex === 0 ? 1 : 0;

    const winner = match.result?.winner?.toString();

    if (match.result?.resultType === "no result" || match.result?.resultType === "abandoned") {
      stats.matches_no_result++;
      formResults.push("NR");
    } else if (match.result?.resultType === "draw" || winner === undefined) {
      stats.matches_drawn++;
      formResults.push("D");
    } else if (winner === teamId) {
      stats.matches_won++;
      formResults.push("W");
    } else {
      stats.matches_lost++;
      formResults.push("L");
    }

    for (const innings of match.innings || []) {
      const inningsTeamId = innings.team?.toString();
      if (inningsTeamId === teamId) {
        totalRunsScored += innings.runs || 0;
        totalWicketsTaken += innings.wickets || 0;
        totalOversBatting += innings.overs || 0;
      } else {
        totalRunsConceded += innings.runs || 0;
        totalOversBowling += innings.overs || 0;
      }
    }
  }

  stats.points = stats.matches_won * 2 + stats.matches_drawn + stats.matches_no_result;
  const completedMatches = stats.matches_played - stats.matches_no_result;
  stats.rating = completedMatches > 0
    ? (stats.points / (completedMatches * 2)) * 100
    : 0;

  stats.form = formResults.slice(0, 5).join("");

  totalRunsScored = stats.matches_played > 0 ? totalRunsScored : 0;
  totalRunsConceded = stats.matches_played > 0 ? totalRunsConceded : 0;

  const battingOvers = totalOversBatting || 1;
  const bowlingOvers = totalOversBowling || 1;
  const netRunRate = (totalRunsScored / battingOvers) - (totalRunsConceded / bowlingOvers);

  const ranking = await TeamRanking.findOneAndUpdate(
    { team: teamId },
    {
      team: teamId,
      category: team.categoryRef,
      matchesPlayed: stats.matches_played,
      matchesWon: stats.matches_won,
      matchesLost: stats.matches_lost,
      matchesDrawn: stats.matches_drawn,
      matchesNoResult: stats.matches_no_result,
      points: stats.points,
      rating: Math.round(stats.rating * 100) / 100,
      totalRunsScored,
      totalRunsConceded,
      totalWicketsTaken,
      netRunRate: Math.round(netRunRate * 10000) / 10000,
      form: stats.form,
    },
    { upsert: true, new: true }
  );

  return ranking;
}

export async function computeAllRankings() {
  const activeTeams = await Team.find({ isActive: true });
  for (const team of activeTeams) {
    try {
      await computeTeamRanking(team._id);
    } catch (err) {
      console.error(`Ranking computation failed for team ${team._id}:`, err.message);
    }
  }

  await TeamRanking.collection.aggregate([
    {
      $setWindowFields: {
        sortBy: { rating: -1, points: -1 },
        output: { overallRank: { $rank: {} } },
      },
    },
    { $merge: { into: "teamrankings", on: "_id", whenMatched: "replace" } },
  ]);

  const categories = await TeamCategory.find({ isActive: true });
  for (const cat of categories) {
    await TeamRanking.collection.aggregate([
      {
        $match: { category: cat._id },
      },
      {
        $setWindowFields: {
          partitionBy: "$category",
          sortBy: { rating: -1, points: -1 },
          output: { categoryRank: { $rank: {} } },
        },
      },
      { $merge: { into: "teamrankings", on: "_id", whenMatched: "replace" } },
    ]);
  }
}

export async function getOverallRankings() {
  return TeamRanking.find()
    .populate("team", "name shortName logo category branchName city")
    .populate("category", "name slug icon")
    .sort({ overallRank: 1 });
}

export async function getCategoryRankings(categoryId) {
  return TeamRanking.find({ category: categoryId })
    .populate("team", "name shortName logo branchName city")
    .sort({ categoryRank: 1 });
}

export async function getCrossCategoryRankings() {
  const categories = await TeamCategory.find({ isActive: true });
  const result = [];

  for (const cat of categories) {
    const topTeam = await TeamRanking.findOne({ category: cat._id })
      .populate("team", "name shortName logo branchName city")
      .sort({ categoryRank: 1 });

    result.push({
      category: cat,
      topTeam,
      teamCount: await TeamRanking.countDocuments({ category: cat._id }),
    });
  }

  return result;
}

export async function getTeamPlayerRankings(teamId) {
  const players = await Player.find({ team: teamId })
    .sort({ "stats.runs": -1 });

  const rankings = players.map((p, i) => ({
    player: p,
    teamBattingRank: i + 1,
    teamRuns: p.stats?.runs || 0,
    teamBattingAvg: p.stats?.average || 0,
    teamBattingSr: p.stats?.strikeRate || 0,
    teamHighestScore: p.stats?.highScore || 0,
    teamFifties: p.stats?.fifties || 0,
    teamHundreds: p.stats?.hundreds || 0,
  }));

  rankings.sort((a, b) => b.teamRuns - a.teamRuns);
  rankings.forEach((r, i) => (r.teamBattingRank = i + 1));

  const bowlerSorted = [...players]
    .sort((a, b) => (b.stats?.wickets || 0) - (a.stats?.wickets || 0));

  const fullRankings = rankings.map((r, i) => {
    const bowlerIdx = bowlerSorted.findIndex(
      (b) => b._id.toString() === r.player._id.toString()
    );
    return {
      ...r,
      teamBowlingRank: bowlerIdx >= 0 ? bowlerIdx + 1 : undefined,
      teamWickets: r.player.stats?.wickets || 0,
      teamBowlingAvg: r.player.stats?.bowlingAverage || 0,
      teamEconomy: r.player.stats?.economy || 0,
      teamBestBowling: r.player.stats?.bestBowling || "",
      teamMatches: r.player.stats?.matches || 0,
      teamPlayerRating: r.teamRuns * 1 + (r.player.stats?.wickets || 0) * 25,
    };
  });

  return fullRankings;
}

export async function computePlayerRankings() {
  const players = await Player.find({ team: { $exists: true, $ne: null } })
    .populate("team", "name shortName");

  const battingRanked = players
    .map((p) => ({
      _id: p._id,
      name: p.name,
      role: p.role,
      playingRole: p.playingRole,
      imageUrl: p.imageUrl,
      team: p.team,
      stats: p.stats,
      rankingPoints: (p.stats?.runs || 0) * 1 + (p.stats?.fifties || 0) * 25 + (p.stats?.hundreds || 0) * 50,
    }))
    .sort((a, b) => b.rankingPoints - a.rankingPoints)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const bowlingRanked = players
    .map((p) => ({
      _id: p._id,
      name: p.name,
      role: p.role,
      playingRole: p.playingRole,
      imageUrl: p.imageUrl,
      team: p.team,
      stats: p.stats,
      rankingPoints: (p.stats?.wickets || 0) * 25 + (p.stats?.fourWickets || 0) * 50 + (p.stats?.fiveWickets || 0) * 100,
    }))
    .sort((a, b) => b.rankingPoints - a.rankingPoints)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const allRounderRanked = players
    .map((p) => {
      const battingPoints = (p.stats?.runs || 0) * 1 + (p.stats?.fifties || 0) * 25 + (p.stats?.hundreds || 0) * 50;
      const bowlingPoints = (p.stats?.wickets || 0) * 20 + (p.stats?.fourWickets || 0) * 25 + (p.stats?.fiveWickets || 0) * 50;
      return {
        _id: p._id,
        name: p.name,
        role: p.role,
        playingRole: p.playingRole,
        imageUrl: p.imageUrl,
        team: p.team,
        stats: p.stats,
        battingPoints,
        bowlingPoints,
        rankingPoints: battingPoints + bowlingPoints,
      };
    })
    .sort((a, b) => b.rankingPoints - a.rankingPoints)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  return { battingRanked, bowlingRanked, allRounderRanked };
}
