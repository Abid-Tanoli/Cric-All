import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import * as communityApi from "../services/communityApi";

// Community settings: the RUNTIME switch + moderation mode + limits.
//
// Every field here is stored in the backend community settings document and read
// through GET /community/admin/settings (admin/superadmin only). The
// `communityEnabled` toggle is what the public GET /community/config exposes, so
// flipping it on/off changes the user app's nav/routes/posts tabs without a
// rebuild — that is the whole point of this section.

const inputCls =
  "w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-2.5 text-sm font-semibold text-cric-text focus:outline-none focus:ring-2 focus:ring-cric-accent/30 focus:border-cric-accent disabled:opacity-60";
const cardCls = "rounded-2xl border border-cric-border bg-cric-card p-6 shadow-sm";

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cric-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-emerald-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function CommunitySettings() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dailyLimit, setDailyLimit] = useState("");
  const [imageLimit, setImageLimit] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await communityApi.getSettings();
      setSettings(data);
      setDailyLimit(String(data.maxPostsPerUserPerDay ?? 10));
      setImageLimit(String(data.maxImagesPerPost ?? 6));
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch, successMsg) => {
    setSaving(true);
    const previous = settings;
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev)); // optimistic
    try {
      const data = await communityApi.updateSettings(patch);
      setSettings(data);
      showToast(successMsg, "success");
    } catch (err) {
      setSettings(previous);
      showToast(err.response?.data?.message || err.message || "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveLimits = () => {
    const daily = Number(dailyLimit);
    const images = Number(imageLimit);
    if (!Number.isInteger(daily) || daily < 1 || !Number.isInteger(images) || images < 0 || images > 6) {
      showToast("Limits must be whole numbers (daily ≥ 1, images 0–6).", "warning");
      return;
    }
    save({ maxPostsPerUserPerDay: daily, maxImagesPerPost: images }, "Limits saved");
  };

  if (loading) {
    return <p className="text-sm font-semibold text-cric-muted">Loading settings...</p>;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
        <button onClick={load} className="rounded-lg border border-cric-border bg-cric-card px-4 py-2 text-xs font-black uppercase tracking-widest text-cric-muted hover:text-cric-text">
          Retry
        </button>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-cric-text">Community Settings</h1>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            Turn the community on or off at runtime and control how posts are moderated.
          </p>
        </div>
        <button
          onClick={() => navigate("/admin/community")}
          className="rounded-lg border border-cric-border bg-cric-card px-4 py-2 text-xs font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
        >
          Moderation queue
        </button>
      </div>

      <div className={cardCls}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-black text-cric-text">Community enabled</h2>
            <p className="mt-1 text-xs text-slate-500">
              The master runtime switch. When off, the user app hides the Community link, shows a “coming soon”
              page for the community routes, hides the team/player Posts tabs and refuses every write — with no
              redeploy required.
            </p>
            <div className="mt-2">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${settings.communityEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {settings.communityEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
          <Switch
            label="Toggle community"
            checked={settings.communityEnabled}
            disabled={saving}
            onChange={(v) =>
              save({ communityEnabled: v }, v ? "Community enabled" : "Community disabled")
            }
          />
        </div>
      </div>

      <div className={cardCls}>
        <h2 className="text-sm font-black text-cric-text">Post mode</h2>
        <p className="mt-1 text-xs text-slate-500">
          Auto publishes posts immediately. Approval holds new posts as “pending” until a moderator approves them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { value: "auto", label: "Auto (publish immediately)" },
            { value: "approval", label: "Approval (review first)" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => {
                if (settings.postMode !== opt.value) save({ postMode: opt.value }, `Post mode: ${opt.label}`);
              }}
              className={`rounded-lg border px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                settings.postMode === opt.value
                  ? "border-cric-accent bg-cric-accent text-white"
                  : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className={cardCls}>
        <h2 className="text-sm font-black text-cric-text">Limits</h2>
        <p className="mt-1 text-xs text-slate-500">
          Per-user daily post budget and the maximum images a single post may attach (hard cap 6).
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-cric-muted" htmlFor="daily-limit">
              Max posts per user per day
            </label>
            <input
              id="daily-limit"
              type="number"
              min={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-cric-muted" htmlFor="image-limit">
              Max images per post (0–6)
            </label>
            <input
              id="image-limit"
              type="number"
              min={0}
              max={6}
              value={imageLimit}
              onChange={(e) => setImageLimit(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={saveLimits}
          disabled={saving}
          className="mt-4 rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-orange-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save limits"}
        </button>
      </div>

      <div className={cardCls}>
        <h2 className="text-sm font-black text-cric-text">Banned posters</h2>
        <p className="mt-1 text-xs text-slate-500">
          {Array.isArray(settings.bannedPosters) && settings.bannedPosters.length > 0
            ? `${settings.bannedPosters.length} user account(s) are banned from every community write. Unban them from the moderation queue.`
            : "No banned posters."}
        </p>
      </div>
    </div>
  );
}
