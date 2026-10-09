import mongoose from "mongoose";

const systemSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

const SystemSettings = mongoose.model("SystemSettings", systemSettingsSchema);

export const EXTERNAL_API_KEY = "externalApi";
export const PLATFORM_KEY = "platform";

// Product rule (Phase 2 spec): organizations self-serve by default. Admin
// approval is opt-in, because making it mandatory would put the platform Admin
// app back on the critical path for routine club operations.
export const DEFAULT_PLATFORM_SETTINGS = Object.freeze({
  // When true a newly created organization starts at verificationStatus
  // "pending" instead of "unverified" and the platform can approve it.
  requireOrgApproval: false,
  // When true new sign-ups with an organization intent must wait for approval
  // before they can create teams/matches.
  requireMemberApproval: false,
  // Task 6: the "Super Sub" (Impact Player) rule. Off by default — a match may
  // only name a 12th man as an impact player for a top-11 player when the
  // platform turns this on, mirroring how the IPL-style rule is opt-in.
  enableSuperSub: false,
});

const envDefaultPlatformSettings = () => ({
  requireOrgApproval:
    String(process.env.REQUIRE_ORG_APPROVAL ?? "false").toLowerCase() === "true",
  requireMemberApproval:
    String(process.env.REQUIRE_MEMBER_APPROVAL ?? "false").toLowerCase() === "true",
  enableSuperSub:
    String(process.env.SUPER_SUB_ENABLED ?? "false").toLowerCase() === "true",
});

const envDefaultExternalApi = () => ({
  syncEnabled:
    process.env.ENABLE_EXTERNAL_SYNC === "true" ||
    process.env.ENABLE_ESPN_SYNC === "true",
  freeCricbuzzEnabled:
    String(process.env.ENABLE_FREE_CRICBUZZ ?? "true").toLowerCase() !== "false",
});

export async function getExternalApiSettings() {
  const doc = await SystemSettings.findOne({ key: EXTERNAL_API_KEY });
  if (doc) return doc.value;
  const created = await SystemSettings.create({
    key: EXTERNAL_API_KEY,
    value: envDefaultExternalApi(),
  });
  return created.value;
}

export async function setExternalApiSettings(patch = {}) {
  const current = await getExternalApiSettings();
  const next = { ...current, ...patch };
  await SystemSettings.findOneAndUpdate(
    { key: EXTERNAL_API_KEY },
    { $set: { value: next } },
    { upsert: true, new: true }
  );
  return next;
}

export async function getPlatformSettings() {
  const doc = await SystemSettings.findOne({ key: PLATFORM_KEY });
  if (doc) return { ...DEFAULT_PLATFORM_SETTINGS, ...doc.value };
  const created = await SystemSettings.create({
    key: PLATFORM_KEY,
    value: envDefaultPlatformSettings(),
  });
  return { ...DEFAULT_PLATFORM_SETTINGS, ...created.value };
}

export async function setPlatformSettings(patch = {}) {
  const current = await getPlatformSettings();
  const next = { ...current, ...patch };
  await SystemSettings.findOneAndUpdate(
    { key: PLATFORM_KEY },
    { $set: { value: next } },
    { upsert: true, new: true }
  );
  return next;
}

export default SystemSettings;