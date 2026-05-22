import { getCurrentMatches, getMatchScorecard } from './cricketDataService.js';

const INTERVAL = (parseInt(process.env.CRICKET_POLL_INTERVAL) || 30) * 1000;
let running = false;
let io;

export function startPoller(socketIO) {
  io = socketIO;
  if (running) return;
  running = true;
  console.log(`[International Poller] Started — every ${INTERVAL / 1000}s`);
  poll();
}

async function poll() {
  while (running) {
    try {
      const matches = await getCurrentMatches();
      if (matches?.length) {
        io.emit('INTERNATIONAL_MATCHES_UPDATE', { matches, ts: Date.now() });

        const liveMatches = matches.filter(m => m.ms === 'live' || m.matchStarted);
        for (const match of liveMatches) {
          const scorecard = await getMatchScorecard(match.id);
          if (scorecard) {
            io.to(`imatch_${match.id}`).emit('INTERNATIONAL_MATCH_UPDATE', {
              matchId: match.id,
              score: match.score,
              status: match.status,
              scorecard,
              ts: Date.now()
            });
          }
        }
      }
    } catch (e) {
      console.error('[International Poller] Error:', e.message);
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

export function stopPoller() { running = false; }
