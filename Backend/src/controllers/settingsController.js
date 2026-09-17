import {
  getExternalApiSettings,
  setExternalApiSettings,
} from "../models/SystemSettings.js";
import cricketPolling from "../services/cricketPolling.js";
import { startPoller, stopPoller, isPollerRunning } from "../services/internationalPoller.js";
import { startSyncScheduler, stopSyncScheduler } from "../services/syncScheduler.js";
import { hasCricApiKey, hasExternalCricketProvider } from "../services/cricketDataService.js";
import log from "../utils/logger.js";

const RECONCILE_INTERVAL_MS = 10000;

let ioRef = null;
let reconcileTimer = null;

export function setSocketIo(io) {
  ioRef = io;
}

async function providerAvailable() {
  try {
    return await hasExternalCricketProvider();
  } catch {
    return false;
  }
}

// Re-reads the SystemSettings document each time it runs and starts/stops the
// external sync services (live polling, international poller, sync scheduler)
// so the external cricket API can be toggled on/off at runtime.
export async function evaluateExternalSync() {
  try {
    const settings = await getExternalApiSettings();
    const syncEnabled = Boolean(settings?.syncEnabled);

    if (!syncEnabled) {
      cricketPolling.stop();
      stopPoller();
      stopSyncScheduler();
      return;
    }

    if (hasCricApiKey() && !cricketPolling.isRunning) {
      cricketPolling.start();
    }

    if (await providerAvailable()) {
      if (ioRef && !isPollerRunning()) {
        startPoller(ioRef);
      }
      startSyncScheduler();
    } else {
      stopPoller();
      stopSyncScheduler();
    }
  } catch (err) {
    log.error(err, "evaluateExternalSync failed");
  }
}

export function startExternalSyncManager(io) {
  setSocketIo(io);
  evaluateExternalSync();
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(evaluateExternalSync, RECONCILE_INTERVAL_MS);
}

export const getExternalApiSettingsHandler = async (req, res) => {
  try {
    const settings = await getExternalApiSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateExternalApiSettingsHandler = async (req, res) => {
  try {
    const { syncEnabled, freeCricbuzzEnabled } = req.body;
    const patch = {};
    if (typeof syncEnabled !== "undefined") patch.syncEnabled = Boolean(syncEnabled);
    if (typeof freeCricbuzzEnabled !== "undefined") patch.freeCricbuzzEnabled = Boolean(freeCricbuzzEnabled);

    const settings = await setExternalApiSettings(patch);
    // Apply the change immediately without waiting for the next reconcile tick.
    await evaluateExternalSync();

    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};