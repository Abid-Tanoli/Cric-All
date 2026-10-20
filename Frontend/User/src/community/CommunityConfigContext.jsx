import { createContext, useContext, useEffect, useState } from "react";
import { getCommunityConfig } from "../services/communityApi";

// Runtime on/off for the community.
//
// The switch lives in the backend (Admin → Community → communityEnabled), not in
// a build-time VITE flag, so the owner can turn the section on or off without a
// redeploy. This context fetches the public GET /api/community/config exactly
// once per page load (module-level promise cache) and shares it with the header,
// the routes and the Posts tabs.
//
// Shape: { status: "loading" | "ready" | "error", enabled: bool, postMode, refresh }.
// While loading, `enabled` is false (nav + tabs stay hidden) — the community
// never flashes on before the switch is known. When the request fails (offline,
// API down) we also treat it as disabled; the pages show their own friendly note.
const CommunityConfigContext = createContext({
  status: "loading",
  enabled: false,
  postMode: "auto",
  refresh: () => {},
});

// One in-flight promise for the whole tab. `?fresh=1` busts it, which is what
// `refresh()` uses after an admin flips the switch in another tab/session.
let cachedPromise = null;

function loadConfig(fresh = false) {
  if (fresh || !cachedPromise) {
    cachedPromise = getCommunityConfig().catch((err) => {
      // Do not cache a failure forever: the next mount retries.
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}

export function CommunityConfigProvider({ children }) {
  const [state, setState] = useState({ status: "loading", enabled: false, postMode: "auto" });

  const apply = (config, status) => {
    setState({
      status,
      enabled: Boolean(config?.enabled),
      postMode: config?.postMode === "approval" ? "approval" : "auto",
    });
  };

  const refresh = async () => {
    try {
      apply(await loadConfig(true), "ready");
    } catch {
      apply({ enabled: false }, "error");
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadConfig(false)
      .then((config) => {
        if (!cancelled) apply(config, "ready");
      })
      .catch(() => {
        if (!cancelled) apply({ enabled: false }, "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CommunityConfigContext.Provider value={{ ...state, refresh }}>
      {children}
    </CommunityConfigContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- provider + hook live together, same as context/ThemeContext.jsx
export function useCommunityConfig() {
  return useContext(CommunityConfigContext);
}

export default CommunityConfigContext;
