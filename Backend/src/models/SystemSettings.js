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

export default SystemSettings;