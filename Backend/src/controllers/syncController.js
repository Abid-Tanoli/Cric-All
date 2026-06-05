import Tournament from "../models/Tournament.js";
import Match from "../models/Match.js";
import Team from "../models/Team.js";
import * as externalSource from "../services/externalCricketScraper.js";

const syncLog = [];

function addLog(level, message, data = {}) {
  const entry = { level, message, data, ts: new Date().toISOString() };
  syncLog.push(entry);
  if (syncLog.length > 200) syncLog.splice(0, syncLog.length - 200);
  console.log(`[Sync] ${message}`);
}

export async function getAvailableSeries(req, res) {
  try {
    const series = await externalSource.getSeriesList();
    res.json({ success: true, data: series });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function syncSeries(req, res) {
  const { slug, seriesId } = req.params;
  try {
    addLog("info", `Syncing series: ${slug} (${seriesId})`);
    const data = await externalSource.getSeriesInfo(slug, seriesId);
    if (!data) return res.status(404).json({ success: false, error: "Series not found" });

    let tournament = await Tournament.findOne({ espnSeriesId: seriesId });
    const tournamentData = {
      name: data.name,
      shortName: data.shortName || data.name,
      longName: data.longName || data.name,
      slug: data.slug,
      espnSeriesId: data.espnId,
      format: data.matchType,
      status: data.status,
      startDate: data.startDate,
      endDate: data.endDate,
      season: data.season,
    };

    if (tournament) {
      Object.assign(tournament, tournamentData);
    } else {
      tournament = new Tournament(tournamentData);
    }

    const teamMap = {};
    for (const t of data.teams) {
      let team = await Team.findOne({ espnTeamId: t.espnId });
      if (!team) {
        team = await Team.create({
          name: t.name,
          shortName: t.shortName,
          longName: t.longName || t.name,
          espnTeamId: t.espnId,
          logo: t.logo,
          isCountry: t.isCountry,
        });
      }
      teamMap[t.espnId] = team._id;
      if (!tournament.teams.includes(team._id)) {
        tournament.teams.push(team._id);
      }
    }

    if (data.standings) {
      tournament.pointsTable = data.standings.map(s => ({
        team: s.teamId ? teamMap[s.teamId] : null,
        matchesPlayed: s.played || 0,
        won: s.won || 0,
        lost: s.lost || 0,
        tied: s.tied || 0,
        noResult: s.drawn || 0,
        points: s.points || 0,
        netRunRate: s.nrr || 0,
      }));
    }

    await tournament.save();

    let matchCount = 0;
    const allFixtures = [...(data.fixtures || []), ...(data.results || [])];
    for (const f of allFixtures) {
      if (!f.espnId) continue;
      const homeTeam = f.teams?.[0]?.espnId ? teamMap[f.teams[0].espnId] : null;
      const awayTeam = f.teams?.[1]?.espnId ? teamMap[f.teams[1].espnId] : null;
      const teamList = [homeTeam, awayTeam].filter(Boolean);

      const existing = await Match.findOne({ espnMatchId: f.espnId });
      const matchData = {
        title: f.title || `${f.teams?.[0]?.name || ""} vs ${f.teams?.[1]?.name || ""}`,
        tournament: tournament._id,
        teams: teamList,
        status: f.status,
        venue: f.venue,
        startAt: f.startDate || f.startTime || new Date(),
        matchType: f.format || tournament.format,
        slug: f.slug || "",
        series: tournament.name,
      };

      if (existing) {
        for (const [key, val] of Object.entries(matchData)) {
          if (val !== undefined && val !== null) existing[key] = val;
        }
        await existing.save();
      } else {
        await Match.create(matchData);
      }
      matchCount++;
    }

    addLog("success", `Synced series: ${data.name} (${matchCount} matches)`);
    res.json({ success: true, data: { series: tournament, matchCount } });
  } catch (err) {
    addLog("error", `Failed to sync series ${slug}: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function syncMatch(req, res) {
  const { slug, seriesSlug, seriesId, matchId } = req.params;
  try {
    addLog("info", `Syncing match: ${slug} (${matchId})`);
    const data = await externalSource.getMatchScorecard(seriesSlug, seriesId, slug, matchId);
    if (!data) return res.status(404).json({ success: false, error: "Match not found" });

    const matchDoc = await Match.findOne({ espnMatchId: matchId });
    if (!matchDoc) return res.status(404).json({ success: false, error: "Match not found in DB. Sync series first." });

    if (data.title) matchDoc.title = data.title;
    if (data.status) matchDoc.status = data.status;
    if (data.venue) matchDoc.venue = data.venue;
    if (data.startDate) matchDoc.startAt = data.startDate;
    if (data.format) matchDoc.matchType = data.format;

    if (data.result) {
      matchDoc.result = matchDoc.result || {};
      matchDoc.result.description = data.result;
    }

    if (data.innings?.length) {
      for (let i = 0; i < data.innings.length; i++) {
        const inn = data.innings[i];
        const teamIdx = Math.min(i, matchDoc.teams.length - 1);
        const inningsData = {
          team: matchDoc.teams[teamIdx] || undefined,
          runs: inn.runs || 0,
          wickets: inn.wickets || 0,
          overs: inn.overs || 0,
          batting: (inn.batting || []).map(b => ({
            runs: b.runs || 0,
            balls: b.balls || 0,
            fours: b.fours || 0,
            sixes: b.sixes || 0,
            strikeRate: b.strikeRate || 0,
            isOut: b.isOut || false,
            dismissalType: b.howOut || "",
          })),
          bowling: (inn.bowling || []).map(b => ({
            overs: Math.floor(b.overs || 0),
            runs: b.runs || 0,
            wickets: b.wickets || 0,
            maidens: b.maidens || 0,
            economy: b.economy || 0,
            wides: b.wides || 0,
            noBalls: b.noBalls || 0,
          })),
          fallOfWickets: (inn.fallOfWickets || []).map(f => ({
            runs: parseInt(f.score?.split("/")[0]) || 0,
            wickets: parseInt(f.score?.split("/")[1]) || 0,
            overs: f.overs || 0,
          })),
        };

        if (i < matchDoc.innings.length) {
          Object.assign(matchDoc.innings[i], inningsData);
        } else {
          matchDoc.innings.push(inningsData);
        }
      }
    }

    if (data.commentary) {
      matchDoc.set("commentary", data.commentary);
    }

    await matchDoc.save();
    addLog("success", `Synced match: ${data.title || slug} (${data.status})`);
    res.json({ success: true, data: matchDoc });
  } catch (err) {
    addLog("error", `Failed to sync match ${slug}: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function syncLiveScores(req, res) {
  try {
    addLog("info", "Syncing live scores from external source");
    const liveList = await externalSource.getLiveMatches();

    let updated = 0;
    for (const lm of liveList) {
      if (!lm.espnId) continue;
      const updateData = { status: lm.status, statusText: lm.statusText };

      const doc = await Match.findOne({ espnMatchId: lm.espnId });
      if (!doc) continue;

      const oldStatus = doc.status;
      for (const [key, val] of Object.entries(updateData)) {
        if (val) doc[key] = val;
      }

      if (lm.teams?.length >= 2) {
        for (let i = 0; i < 2 && i < lm.teams.length; i++) {
          const t = lm.teams[i];
          if (!t.score) continue;
          if (i < doc.innings.length) {
            doc.innings[i].runs = parseInt(t.score.split("/")[0]) || t.score;
            const wktMatch = t.score.match(/\/(\d+)/);
            if (wktMatch) doc.innings[i].wickets = parseInt(wktMatch[1]);
          } else {
            const wktMatch = t.score.match(/\/(\d+)/);
            doc.innings.push({
              team: doc.teams[i] || undefined,
              runs: parseInt(t.score.split("/")[0]) || 0,
              wickets: wktMatch ? parseInt(wktMatch[1]) : 0,
              overs: 0,
            });
          }
        }
      }

      await doc.save();
      updated++;
    }

    addLog("success", `Live scores synced: ${updated} matches updated`);
    if (res) res.json({ success: true, data: { matchesFound: liveList.length, updated } });
  } catch (err) {
    addLog("error", `Failed to sync live scores: ${err.message}`);
    if (res) res.status(500).json({ success: false, error: err.message });
  }
}

export async function syncAll(req, res) {
  try {
    addLog("info", "Syncing all series from fixtures");
    const seriesList = await externalSource.getSeriesList();
    let total = 0;

    for (const s of seriesList.slice(0, 10)) {
      if (!s.slug || !s.espnId) continue;
      try {
        const data = await externalSource.getSeriesInfo(s.slug, s.espnId);
        if (data) total += (data.fixtures?.length || 0) + (data.results?.length || 0);
      } catch { /* skip */ }
    }

    addLog("success", `All series synced: ${seriesList.length} series, ~${total} matches`);
    res.json({ success: true, data: { seriesCount: seriesList.length, estimatedMatches: total } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getSyncLog(req, res) {
  res.json({ success: true, data: [...syncLog].reverse().slice(0, 100) });
}
