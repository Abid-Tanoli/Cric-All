import {
  getExternalApiSettings,
  setExternalApiSettings,
  getPlatformSettings,
  setPlatformSettings,
} from "../models/SystemSettings.js";
import { recordAudit } from "../utils/audit.js";
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

// Platform product switches. `requireOrgApproval` is the one that matters
// most: it is off by default so organizations never wait on the Admin app for
// routine operations, and the platform can turn it on without a deploy.
export const getPlatformSettingsHandler = async (req, res) => {
  try {
    const settings = await getPlatformSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updatePlatformSettingsHandler = async (req, res) => {
  try {
    const patch = {};
    if (typeof req.body?.requireOrgApproval === "boolean") {
      patch.requireOrgApproval = req.body.requireOrgApproval;
    }
    if (typeof req.body?.requireMemberApproval === "boolean") {
      patch.requireMemberApproval = req.body.requireMemberApproval;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        message: "Nothing to update. Send requireOrgApproval and/or requireMemberApproval.",
        code: "NO_SETTINGS_PROVIDED",
      });
    }
    const settings = await setPlatformSettings(patch);
    await recordAudit({
      req,
      action: "platform.settings_updated",
      targetType: "settings",
      targetId: "platform",
      metadata: patch,
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};