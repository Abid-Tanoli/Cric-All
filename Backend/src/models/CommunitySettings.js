import mongoose from "mongoose";

const communitySettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

const CommunitySettings = mongoose.model("CommunitySettings", communitySettingsSchema);

export const COMMUNITY_SETTINGS_KEY = "community";

export const DEFAULT_COMMUNITY_SETTINGS = Object.freeze({
  communityEnabled: false,
  postMode: "auto", // "auto" | "approval"
  bannedPosters: [],
  maxPostsPerUserPerDay: 10,
  maxImagesPerPost: 6,
});

export async function getCommunitySettings() {
  const doc = await CommunitySettings.findOne({ key: COMMUNITY_SETTINGS_KEY });
  if (doc) {
    return { ...DEFAULT_COMMUNITY_SETTINGS, ...doc.value };
  }
  const created = await CommunitySettings.create({
    key: COMMUNITY_SETTINGS_KEY,
    value: DEFAULT_COMMUNITY_SETTINGS,
  });
  return { ...DEFAULT_COMMUNITY_SETTINGS, ...created.value };
}

export async function setCommunitySettings(patch = {}) {
  const current = await getCommunitySettings();
  const next = { ...current, ...patch };
  await CommunitySettings.findOneAndUpdate(
    { key: COMMUNITY_SETTINGS_KEY },
    { $set: { value: next } },
    { upsert: true, new: true }
  );
  return next;
}

export default CommunitySettings;
