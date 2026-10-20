import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCommunityConfig } from "./CommunityConfigContext";
import PostCard from "./PostCard";
import ShareMenu from "./ShareMenu";
import { friendlyWriteError } from "./communityConfig";
import { getPlayerPosts, getTeamPosts, sharePost } from "../services/communityApi";
import { Banner, secondaryButton } from "../pages/organization/orgStyles";

// Posts tab for a team or player profile.
//
// `kind`: "team" | "player"; `subjectId`: the team/player id. Only rendered when
// the runtime switch is on (see TeamProfile/PlayerProfile). A "Post" button is
// shown for signed-in users; the backend still authorises the subject, so the
// button is a convenience, and a refusal surfaces on the create page.
export default function PostsTab({ kind, subjectId, subjectName }) {
  const { enabled, status } = useCommunityConfig();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetcher = kind === "player" ? getPlayerPosts : getTeamPosts;

  const load = useCallback(
    async ({ reset = false } = {}) => {
      if (!subjectId) return;
      setLoading(true);
      setError("");
      try {
        const data = await fetcher(subjectId, { cursor: reset ? undefined : cursor || undefined, limit: 10 });
        setPosts((prev) => (reset ? data.posts : [...prev, ...data.posts]));
        setCursor(data.nextCursor);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        setError(friendlyWriteError(err));
      } finally {
        setLoading(false);
      }
    },
    [fetcher, subjectId, cursor]
  );

  useEffect(() => {
    if (status !== "ready" || !enabled) return;
    setPosts([]);
    setCursor(null);
    setHasMore(false);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, status, enabled]);

  if (status === "ready" && !enabled) {
    return <Banner kind="info">Community posts are not available right now.</Banner>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-cric-muted">
          Posts{subjectName ? ` about ${subjectName}` : ""}
        </h3>
        <Link
          to={`/community/new`}
          className="min-h-[40px] flex items-center rounded-lg bg-cric-accent px-5 text-xs font-black uppercase tracking-widest text-white"
        >
          Post
        </Link>
      </div>

      {error ? <div className="mt-4"><Banner kind="error">{error}</Banner></div> : null}

      <div className="mt-4 space-y-4">
        {posts.map((post) => (
          <PostCard key={post._id} post={post}>
            <ShareMenu kind="post" id={post._id} title={post.title || "CricAll community post"} onShare={() => sharePost(post._id)} />
          </PostCard>
        ))}
      </div>

      {!loading && posts.length === 0 && !error ? (
        <p className="mt-6 text-center text-sm font-bold text-cric-muted">
          No posts yet for this {kind === "player" ? "player" : "team"}.
        </p>
      ) : null}

      {hasMore ? (
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={() => load()} disabled={loading} className={secondaryButton}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}

      {loading && posts.length === 0 ? (
        <div className="mt-6 flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-cric-accent border-t-transparent" />
        </div>
      ) : null}
    </div>
  );
}
