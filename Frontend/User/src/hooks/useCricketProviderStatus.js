import { useEffect, useState } from "react";
import { getCricketProviderStatus } from "../services/cricApi";

// One shared answer per page load: the header, footer, quick links and the
// /international page all ask the same question and must not each hit the API.
let pending = null;
let cached = null;

const load = () => {
  if (!pending) {
    pending = getCricketProviderStatus()
      .then((status) => {
        cached = status ?? { configured: false };
        return cached;
      })
      .catch(() => {
        cached = cached ?? { configured: false };
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
};

/**
 * Whether the server has an external cricket (international) provider
 * configured. `configured === true` is the only state that shows the
 * international sections: while the status is unknown or the call fails they
 * stay hidden, so visitors never land on a page that cannot load.
 */
export function useCricketProviderStatus() {
  const [status, setStatus] = useState(cached);

  useEffect(() => {
    if (cached) {
      setStatus(cached);
      return undefined;
    }
    let cancelled = false;
    load().then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

export const isProviderConfigured = (status) => status?.configured === true;

// Tests swap the status between cases; the cache is per page load, so they need
// a way to start each case from a clean slate.
export function resetCricketProviderStatusCache() {
  pending = null;
  cached = null;
}

export default useCricketProviderStatus;
