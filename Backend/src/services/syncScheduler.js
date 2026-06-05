import * as externalSource from "./externalCricketScraper.js";
import Match from "../models/Match.js";

let intervalId = null;
const getInterval = () => (parseInt(process.env.SYNC_INTERVAL, 10) || 30) * 1000;

export function startSyncScheduler() {
  if (intervalId) return;
  const interval = getInterval();
  console.log(`[SyncScheduler] Starting - every ${interval / 1000}s`);
  intervalId = setInterval(poll, interval);
}

export function stopSyncScheduler() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

async function poll() {
  try {
    const liveList = await externalSource.getLiveMatches();
    let updated = 0;
    for (const lm of liveList) {
      if (!lm.espnId) continue;
      try {
        const doc = await Match.findOne({ espnMatchId: lm.espnId });
        if (!doc) continue;

        if (lm.status) doc.status = lm.status;
        if (lm.statusText) doc.statusText = lm.statusText;

        if (lm.teams?.length >= 2) {
          for (let i = 0; i < 2 && i < lm.teams.length; i++) {
            const t = lm.teams[i];
            if (!t.score) continue;
            if (i < doc.innings.length) {
              doc.innings[i].runs = parseInt(t.score.split("/")[0]) || 0;
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
      } catch { /* skip individual match errors */ }
    }
    if (updated > 0) console.log(`[SyncScheduler] Updated ${updated} live matches`);
  } catch (err) {
    console.error(`[SyncScheduler] Error: ${err.message}`);
  }
}
