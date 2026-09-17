// Background polling service for cricket API
// Fetches live scores periodically and broadcasts via WebSocket

import cricketApi from '../services/cricketApi.js';
import { emitCricketLiveUpdate } from '../socket/socket.js';
import { getExternalApiSettings } from '../models/SystemSettings.js';

class CricketPollingService {
  constructor() {
    this.interval = null;
    this.pollingInterval = 10000; // 10 seconds
    this.isRunning = false;
    this.lastMatchData = new Map(); // Track changes
  }

  // Start polling
  start() {
    if (this.isRunning) {
      console.log('[CricketPolling] Already running');
      return;
    }

    console.log('[CricketPolling] Starting live score polling...');
    this.isRunning = true;

    // Poll immediately
    this.poll();

    // Then set interval
    this.interval = setInterval(() => {
      this.poll();
    }, this.pollingInterval);
  }

  // Stop polling
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.isRunning = false;
      console.log('[CricketPolling] Stopped live score polling');
    }
  }

  // Poll for updates
  async poll() {
    try {
      // Re-read the runtime setting each tick so live polling stops as soon as
      // the external cricket API is switched off without a restart.
      const settings = await getExternalApiSettings();
      if (!settings?.syncEnabled) {
        this.stop();
        return;
      }

      console.log('[CricketPolling] Polling for live matches...');
      
      const liveMatches = await cricketApi.getLiveMatches();
      
      if (liveMatches.length === 0) {
        console.log('[CricketPolling] No live matches found');
        return;
      }

      console.log(`[CricketPolling] Found ${liveMatches.length} live match(es)`);

      // Check for changes and emit updates
      for (const match of liveMatches) {
        const lastData = this.lastMatchData.get(match.id);
        const hasChanges = this.checkForChanges(lastData, match);

        if (hasChanges) {
          console.log(`[CricketPolling] Changes detected for match ${match.id}`);
          
          // Emit update via WebSocket
          emitCricketLiveUpdate({
            type: 'match_update',
            matchId: match.id,
            data: match,
            timestamp: new Date().toISOString(),
          });

          // Update cached data
          this.lastMatchData.set(match.id, {
            score: match.score,
            status: match.status,
            result: match.result,
            timestamp: Date.now(),
          });
        }
      }

      // Clean old entries (matches that ended)
      this.cleanOldEntries(liveMatches);

    } catch (error) {
      console.error('[CricketPolling] Error during poll:', error.message);
    }
  }

  // Check if match data has changed
  checkForChanges(lastData, currentMatch) {
    if (!lastData) {
      return true; // First time seeing this match
    }

    // Check if score changed
    const lastScore = JSON.stringify(lastData.score);
    const currentScore = JSON.stringify(currentMatch.score);
    
    if (lastScore !== currentScore) {
      return true;
    }

    // Check if status changed
    if (lastData.status !== currentMatch.status) {
      return true;
    }

    // Check if result changed
    if (lastData.result !== currentMatch.result) {
      return true;
    }

    return false;
  }

  // Clean up old match entries
  cleanOldEntries(currentMatches) {
    const currentIds = new Set(currentMatches.map(m => m.id));
    
    for (const [matchId] of this.lastMatchData.entries()) {
      if (!currentIds.has(matchId)) {
        // Match is no longer live, remove from tracking after 5 minutes
        const lastUpdate = this.lastMatchData.get(matchId).timestamp;
        if (Date.now() - lastUpdate > 5 * 60 * 1000) {
          this.lastMatchData.delete(matchId);
          console.log(`[CricketPolling] Cleaned up old match ${matchId}`);
        }
      }
    }
  }

  // Clear all cached data
  clearCache() {
    this.lastMatchData.clear();
    console.log('[CricketPolling] Cache cleared');
  }

  // Update polling interval
  setPollingInterval(ms) {
    this.pollingInterval = ms;
    
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }
}

// Export singleton
export default new CricketPollingService();
