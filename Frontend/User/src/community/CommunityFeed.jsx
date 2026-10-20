import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCommunityConfig } from "./CommunityConfigContext";
import PostCard from "./PostCard";
import ShareMenu from "./ShareMenu";
import { KINDS, friendlyWriteError } from "./communityConfig";
import { getFeed, sharePost, toggleLike } from "../services/communityApi";
import { Banner, primaryButton } from "../pages/organization/orgStyles";

// Public community feed with cursor pagination ("Load more") and a kind filter.
// Rate-limit (429), empty, loading and error states are all handled inline.
const LIMIT = 12;

export default function CommunityFeed() {
  const { status: configStatus, enabled } = useCommunityConfig();
  const [kind, setKind] = useState("");
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [likePending, setLikePending] = useState(null);

  const load = useCallback(
    async ({ reset = false } = {}) => {
      setLoading(true);
      setError("");
      try {
        const data = await getFeed({
          kind: kind || undefined,
          cursor: reset ? undefined : cursor || undefined,
          limit: LIMIT,
        });
        setPosts((prev) => (reset ? data.posts : [...prev, ...data.posts]));
        setCursor(data.nextCursor);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        setError(friendlyWriteError(err));
      } finally {
        setLoading(false);
      }
    },
    [kind, cursor]
  );

  // Reload from the top whenever the filter changes or the switch turns on.
  useEffect(() => {
    if (configStatus !== "ready" || !enabled) return;
    setPosts([]);
    setCursor(null);
    setHasMore(false);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, configStatus, enabled]);

  const handleLike = async (post) => {
    setLikePending(post._id);
    try {
      const data = await toggleLike(post._id);
      setPosts((prev) =>
        prev.map((p) =>
          p._id === post._id
            ? { ...p, likedByMe: data.liked, likeCount: Math.max(0, (p.likeCount || 0) + (data.liked ? 1 : -1)) }
            : p
        )
      );
    } catch (err) {
      setError(friendlyWriteError(err));
    } finally {
      setLikePending(null);
    }
  };

  if (configStatus === "loading") {
    return <FeedSpinner />;
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Banner kind="info">
          Community is not available right now. Please check back later — an admin can switch it on at any time.
        </Banner>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black uppercase tracking-widest text-cric-text">Community</h1>
        <Link to="/community/new" className={primaryButton}>
          Share a post
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by type">
        {[{ value: "", label: "All" }, ...KINDS].map((option) => (
          <button
            key={option.value || "all"}
            type="button"
            role="tab"
            aria-selected={kind === option.value}
            onClick={() => setKind(option.value)}
            className={`min-h-[40px] rounded-full border px-4 text-[10px] font-black uppercase tracking-widest transition ${
              kind === option.value
                ? "border-cric-accent bg-cric-accent text-white"
                : "border-cric-border bg-cric-card text-cric-muted hover:text-cric-text"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && posts.length === 0 ? <div className="mt-4"><Banner kind="error">{error}</Banner></div> : null}

      <div className="mt-5 space-y-4">
        {posts.map((post) => (
          <PostCard key={post._id} post={post} compact likePending={likePending === post._id} onLike={handleLike}>
            <ShareMenu kind="post" id={post._id} title={post.title || "CricAll community post"} onShare={() => sharePost(post._id)} />
          </PostCard>
        ))}
      </div>

      {!loading && posts.length === 0 && !error ? (
        <p className="mt-8 text-center text-sm font-bold text-cric-muted" data-testid="feed-empty">
          No posts yet. Be the first to share something!
        </p>
      ) : null}

      {error && posts.length > 0 ? <div className="mt-4"><Banner kind="error">{error}</Banner></div> : null}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => load()} disabled={loading} className={primaryButton} data-testid="load-more">
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}

      {loading && posts.length === 0 ? <FeedSpinner /> : null}
    </div>
  );
}

function FeedSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-cric-accent border-t-transparent" />
    </div>
  );
}
