import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";

export const updateTournamentPoints = async (tournamentId) => {
  try {
    const tournament = await Tournament.findById(tournamentId).populate({
      path: "matches",
      populate: { path: "teams", select: "name" }
    });

    if (!tournament) return;

    // Reset points table to recalculate from scratch to ensure accuracy
    const newPointsTable = tournament.teams.map(teamId => ({
      team: teamId,
      matchesPlayed: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      netRunRate: 0,
      for: 0,
      against: 0,
      wicketsFor: 0,
      wicketsAgainst: 0,
      seriesForm: []
    }));

    const finishedMatches = tournament.matches.filter(m => m.status === "completed" && m.result && m.result.winner !== undefined);

    for (const match of finishedMatches) {
      const { winner, resultType } = match.result;
      const team1Id = match.teams[0]._id.toString();
      const team2Id = match.teams[1]._id.toString();

      const team1Stats = newPointsTable.find(t => t.team.toString() === team1Id);
      const team2Stats = newPointsTable.find(t => t.team.toString() === team2Id);

      if (!team1Stats || !team2Stats) continue;

      team1Stats.matchesPlayed += 1;
      team2Stats.matchesPlayed += 1;

      if (resultType === "tie" || resultType === "no_result") {
        team1Stats.tied += 1;
        team2Stats.tied += 1;
        team1Stats.points += 1;
        team2Stats.points += 1;
        team1Stats.seriesForm.push("T");
        team2Stats.seriesForm.push("T");
      } else if (winner) {
        const winnerId = winner.toString();
        if (winnerId === team1Id) {
          team1Stats.won += 1;
          team1Stats.points += 2;
          team1Stats.seriesForm.push("W");
          team2Stats.lost += 1;
          team2Stats.seriesForm.push("L");
        } else {
          team2Stats.won += 1;
          team2Stats.points += 2;
          team2Stats.seriesForm.push("W");
          team1Stats.lost += 1;
          team1Stats.seriesForm.push("L");
        }
      }

      // Net Run Rate Logic (Simplified: Total Runs / Total Overs)
      // Team 1
      const inn1 = match.innings[0];
      const inn2 = match.innings[1];
      if (inn1 && inn2) {
        team1Stats.for += inn1.runs;
        team1Stats.against += inn2.runs;
        team1Stats.wicketsFor += inn2.wickets;
        team1Stats.wicketsAgainst += inn1.wickets;

        team2Stats.for += inn2.runs;
        team2Stats.against += inn1.runs;
        team2Stats.wicketsFor += inn1.wickets;
        team2Stats.wicketsAgainst += inn2.wickets;
      }
    }

    // Final NRR Calculation
    newPointsTable.forEach(stats => {
       // This is a simplified NRR for demonstration, real NRR requires over accounting
       const runsFor = stats.for;
       const runsAgainst = stats.against;
       // NRR = (Runs Scored / Overs Faced) - (Runs Conceded / Overs Bowled)
       // For now just keep it 0 or simple
       stats.netRunRate = stats.matchesPlayed > 0 ? ((runsFor - runsAgainst) / 20).toFixed(3) : 0;
    });

    tournament.pointsTable = newPointsTable;
    await tournament.save();
    console.log(`[TournamentSync] Updated points table for tournament: ${tournament.name}`);
  } catch (err) {
    console.error("[TournamentSync] Error:", err);
  }
};
