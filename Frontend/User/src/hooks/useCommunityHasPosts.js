import { useEffect, useState } from "react";
import { getFeed } from "../services/communityApi";

// One shared answer per page load, so re-mounting the header never asks twice.
let pending = null;
let cached = null;

const load = () => {
  if (!pending) {
    // limit=1 keeps this to a single indexed row: only "is there anything?"
    // matters here, not the posts themselves.
    pending = getFeed({ limit: 1 })
      .then((feed) => {
        cached = Array.isArray(feed?.posts) && feed.posts.length > 0;
        return cached;
      })
      // A failed check is not proof of an empty community, so the link stays.
      // The failure is not cached: the next mount asks again.
      .catch(() => true)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
};

/**
 * Whether the community feed has at least one public post. False until the
 * answer is known, so the nav link never flashes on and off. Nothing is
 * requested while the community itself is switched off.
 */
export function useCommunityHasPosts(communityEnabled) {
  const [hasPosts, setHasPosts] = useState(cached === true);

  useEffect(() => {
    if (!communityEnabled) return undefined;
    let cancelled = false;
    const answer = cached === null ? load() : Promise.resolve(cached);
    answer.then((value) => {
      if (!cancelled) setHasPosts(value);
    });
    return () => {
      cancelled = true;
    };
  }, [communityEnabled]);

  return Boolean(communityEnabled) && hasPosts;
}

// Tests swap the feed between cases; the cache is per page load, so they need a
// way to start each case from a clean slate.
export function resetCommunityHasPostsCache() {
  pending = null;
  cached = null;
}

export default useCommunityHasPosts;
