import { getCurrentMatches, getMatchScorecard, hasExternalCricketProvider } from './cricketDataService.js';

let running = false;
let io;

const getInterval = () => (parseInt(process.env.CRICKET_POLL_INTERVAL, 10) || 60) * 1000;

export function startPoller(socketIO) {
  io = socketIO;
  if (running) return;
  if (!hasExternalCricketProvider()) {
    console.log('[International Poller] Disabled - add RAPIDAPI_KEY or CRICKET_API_KEY to enable');
    return;
  }
  running = true;
  console.log(`[International Poller] Started - every ${getInterval() / 1000}s`);
  poll();
}

async function poll() {
  while (running) {
    try {
      const matches = await getCurrentMatches();
      if (matches?.length) {
        io.emit('INTERNATIONAL_MATCHES_UPDATE', { matches, ts: Date.now() });
        io.emit('INTL_MATCHES', { matches, ts: Date.now() });

        const liveMatches = matches.filter(match =>
          match.ms === 'live' || (match.matchStarted && !match.matchEnded)
        );

        for (const match of liveMatches) {
          const scorecard = await getMatchScorecard(match.id);
          if (!scorecard) continue;

          io.to(`imatch_${match.id}`).emit('INTERNATIONAL_MATCH_UPDATE', {
            matchId: match.id,
            score: match.score,
            status: match.status,
            scorecard,
            ts: Date.now(),
          });

          io.to(`m_${match.id}`).emit('INTL_SCORE', {
            id: match.id,
            data: scorecard,
            ts: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error('[International Poller] Error:', error.message);
    }
    await new Promise(resolve => setTimeout(resolve, getInterval()));
  }
}

export function stopPoller() {
  running = false;
}
