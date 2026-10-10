import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSelector } from "react-redux";
import { api } from "../services/api";
import { useToast } from "../components/Toast";

export default function SyncPanel() {
  const [seriesList, setSeriesList] = useState([]);
  const [syncLog, setSyncLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState({});
  const [urlInput, setUrlInput] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [externalApi, setExternalApi] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const intervalRef = useRef(null);
  const { showToast } = useToast();

  const currentUser = useSelector((state) => state.auth.user);
  const isSuperAdmin = currentUser?.role === "superadmin";

  const fetchExternalApiSettings = useCallback(async () => {
    try {
      const [sync, platformRes] = await Promise.all([
        api.get("/settings/external-api"),
        api.get("/settings/platform").catch(() => null),
      ]);
      if (sync.data.success) setExternalApi(sync.data.data);
      if (platformRes?.data?.success) setPlatform(platformRes.data.data);
    } catch {
      // Non-fatal; the toggles show a fallback state.
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const savePlatformSetting = async (key, value) => {
    setSettingsSaving(true);
    const previous = platform;
    // Optimistic: the switch should not lag behind the click.
    setPlatform((prev) => (prev ? { ...prev, [key]: value } : prev));
    try {
      const { data } = await api.put("/settings/platform", { [key]: value });
      if (data.success) {
        setPlatform(data.data);
        showToast("Platform setting updated", "success");
      }
    } catch (err) {
      setPlatform(previous);
      showToast(err.response?.data?.message || "Failed to update setting", "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleToggleExternalApi = async (checked) => {
    setSettingsSaving(true);
    try {
      const { data } = await api.put("/settings/external-api", { syncEnabled: checked });
      if (data.success) {
        setExternalApi(data.data);
        showToast(
          checked ? "External Cricket API sync enabled" : "External Cricket API sync disabled",
          "success"
        );
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to update setting", "error");
    } finally {
      setSettingsSaving(false);
    }
  };

  const fetchSeries = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/sync/series");
      if (data.success) setSeriesList(data.data);
    } catch {} finally { setLoading(false); }
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const { data } = await api.get("/sync/log");
      if (data.success) setSyncLog(data.data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchSeries();
    fetchLog();
    fetchExternalApiSettings();
  }, [fetchSeries, fetchLog, fetchExternalApiSettings]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLog();
        if (!syncing["__all__"]) fetchSeries();
      }, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchSeries, fetchLog, syncing]);

  const handleSyncSeries = async (slug, seriesId) => {
    const key = `${slug}:${seriesId}`;
    setSyncing(prev => ({ ...prev, [key]: true }));
    try {
      const { data } = await api.post(`/sync/series/${slug}/${seriesId}`);
      if (data.success) {
        fetchSeries();
        fetchLog();
      }
    } catch (err) {
            showToast(`Sync failed: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setSyncing(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSyncAll = async () => {
    setSyncing(prev => ({ ...prev, __all__: true }));
    try {
      const { data } = await api.post("/sync/all");
      if (data.success) {
        fetchSeries();
        fetchLog();
      }
    } catch (err) {
            showToast(`Sync all failed: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setSyncing(prev => ({ ...prev, __all__: false }));
    }
  };

  const handleSyncLive = async () => {
    setSyncing(prev => ({ ...prev, __live__: true }));
    try {
      const { data } = await api.post("/sync/live");
      if (data.success) {
        fetchSeries();
        fetchLog();
      }
    } catch (err) {
            showToast(`Live sync failed: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setSyncing(prev => ({ ...prev, __live__: false }));
    }
  };

  const handleUrlSubmit = () => {
    const match = urlInput.match(/\/series\/([\w-]+)-(\d+)/);
    if (match) {
      handleSyncSeries(match[1], match[2]);
      setUrlInput("");
    } else {
      const seriesIdMatch = urlInput.match(/\d+/);
      if (seriesIdMatch) showToast("Enter a full source series URL.", 'info');
      else showToast("Invalid URL. Paste a source series URL.", 'warning');
    }
  };

  const parseSlugId = (url) => {
    const match = url.match(/\/series\/([\w-]+)-(\d+)/);
    if (match) return match;
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-[#031d44] tracking-tight">SYNC PANEL</h1>
        <p className="text-slate-500 mt-2 font-medium">
          Sync real cricket data from an approved source.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">

        <div className="space-y-6">

          {/* External Cricket API toggle */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">External Cricket API</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Toggle live score polling and external sync on/off without restarting the server.
                </p>
                {!isSuperAdmin && (
                  <p className="text-[10px] font-bold text-amber-600 mt-1" title="Only super admin can change this.">
                    Only super admin can change this.
                  </p>
                )}
              </div>
              {settingsLoading ? (
                <div className="w-12 h-7 bg-slate-200 rounded-full animate-pulse" />
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(externalApi?.syncEnabled)}
                  disabled={!isSuperAdmin || settingsSaving}
                  title={isSuperAdmin ? "Toggle external cricket API sync" : "Only super admin can change this."}
                  onClick={() => handleToggleExternalApi(!externalApi?.syncEnabled)}
                  className={`relative w-12 h-7 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                    externalApi?.syncEnabled ? "bg-emerald-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                      externalApi?.syncEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              )}
            </div>
            {settingsSaving && (
              <p className="text-xs text-slate-400 mt-3">Applying change…</p>
            )}
            {externalApi && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
                <span className={`text-[10px] font-black uppercase rounded-full px-2.5 py-1 ${
                  externalApi.syncEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  Sync: {externalApi.syncEnabled ? "Enabled" : "Disabled"}
                </span>
                <span className={`text-[10px] font-black uppercase rounded-full px-2.5 py-1 ${
                  externalApi.freeCricbuzzEnabled ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                }`}>
                  Free Cricbuzz: {externalApi.freeCricbuzzEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            )}
          </div>

          {/* Organization approval */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-black text-slate-800">Organization approval</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Organizations self-serve by default. Turning approval on makes new organizations start as
                  pending, so they have to be verified here before they show as active.
                </p>
                {!isSuperAdmin && (
                  <p className="text-[10px] font-bold text-amber-600 mt-1" title="Only super admin can change this.">
                    Only super admin can change this.
                  </p>
                )}
              </div>
              {settingsLoading ? (
                <div className="w-12 h-7 bg-slate-200 rounded-full animate-pulse shrink-0" />
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(platform?.requireOrgApproval)}
                  disabled={!isSuperAdmin || settingsSaving}
                  title={isSuperAdmin ? "Toggle organization approval" : "Only super admin can change this."}
                  onClick={() => savePlatformSetting("requireOrgApproval", !platform?.requireOrgApproval)}
                  className={`relative w-12 h-7 rounded-full shrink-0 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                    platform?.requireOrgApproval ? "bg-emerald-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                      platform?.requireOrgApproval ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              )}
            </div>
            {platform && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <span className={`text-[10px] font-black uppercase rounded-full px-2.5 py-1 ${
                  platform.requireOrgApproval ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  New organizations: {platform.requireOrgApproval ? "Pending approval" : "Active immediately"}
                </span>
              </div>
            )}
          </div>

          {/* AI commentary kill switch (Terminal A) */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-black text-slate-800">AI commentary</h3>
                <p className="text-xs text-slate-500 mt-1">
                  When off, no paid model calls are made — scoring falls back to the built-in
                  template commentary. Use this to cap spend during a live tournament.
                </p>
                {!isSuperAdmin && (
                  <p className="text-[10px] font-bold text-amber-600 mt-1" title="Only super admin can change this.">
                    Only super admin can change this.
                  </p>
                )}
              </div>
              {settingsLoading ? (
                <div className="w-12 h-7 bg-slate-200 rounded-full animate-pulse shrink-0" />
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(platform?.aiCommentaryEnabled)}
                  disabled={!isSuperAdmin || settingsSaving}
                  title={isSuperAdmin ? "Toggle AI commentary" : "Only super admin can change this."}
                  onClick={() => savePlatformSetting("aiCommentaryEnabled", !platform?.aiCommentaryEnabled)}
                  className={`relative w-12 h-7 rounded-full shrink-0 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                    platform?.aiCommentaryEnabled ? "bg-emerald-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                      platform?.aiCommentaryEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              )}
            </div>
            {platform && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <span className={`text-[10px] font-black uppercase rounded-full px-2.5 py-1 ${
                  platform.aiCommentaryEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                }`}>
                  AI commentary: {platform.aiCommentaryEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            )}
          </div>

          {/* Add Series */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-1">Add Series</h2>
            <p className="text-xs text-slate-400 mb-4">Paste a source series URL to fetch its fixtures</p>
            <div className="flex gap-3">
              <input
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleUrlSubmit()}
                placeholder="https://source.example/series/australia-in-pakistan-2026-1535643"
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim()}
                className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Add
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Quick Actions</h2>
            <div className="flex gap-3">
              <button
                onClick={handleSyncLive}
                disabled={syncing["__live__"]}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-40 transition-all"
              >
                {syncing["__live__"] ? <Spinner /> : "⚡"} Sync Live Scores
              </button>
              <button
                onClick={handleSyncAll}
                disabled={syncing["__all__"]}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-800 disabled:opacity-40 transition-all"
              >
                {syncing["__all__"] ? <Spinner /> : "📥"} Sync All Series
              </button>
            </div>
          </div>

          {/* Series List */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Available Series</h2>
              <button
                onClick={fetchSeries}
                className="text-xs font-bold text-blue-600 hover:text-blue-800"
              >
                Refresh
              </button>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}
              </div>
            ) : seriesList.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-3xl mb-2">🏏</p>
                <p className="text-sm text-slate-400 font-medium">No series found</p>
                <p className="text-xs text-slate-400 mt-1">Paste a series URL above to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {seriesList.map(s => (
                  <div key={s.espnId} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-all border border-transparent hover:border-slate-200">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">{s.name}</p>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">
                        {s.season || ""} • {s.startDate ? new Date(s.startDate).toLocaleDateString() : "TBD"}
                      </p>
                    </div>
                    <button
                      onClick={() => handleSyncSeries(s.slug, s.espnId)}
                      disabled={syncing[`${s.slug}:${s.espnId}`]}
                      className="ml-3 px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-all flex-shrink-0"
                    >
                      {syncing[`${s.slug}:${s.espnId}`] ? "..." : "Sync Now"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right: Sync Log */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit lg:sticky lg:top-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-800">Sync Log</h2>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="rounded border-slate-300"
              />
              Auto-refresh
            </label>
          </div>
          {syncLog.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No sync activity yet</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {syncLog.map((entry, i) => (
                <div key={i} className={`p-3 rounded-xl text-xs ${
                  entry.level === "error" ? "bg-red-50 border border-red-100" :
                  entry.level === "success" ? "bg-emerald-50 border border-emerald-100" :
                  "bg-slate-50 border border-slate-100"
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      entry.level === "error" ? "bg-red-500" :
                      entry.level === "success" ? "bg-emerald-500" :
                      "bg-blue-500"
                    }`} />
                    <span className="font-bold text-slate-700">{entry.message}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 ml-3.5">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function Spinner() {
  return <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />;
}
