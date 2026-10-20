import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import * as communityApi from "../services/communityApi";

// Community moderation queue.
//
// Status tabs mirror the backend `GET /community/admin/queue?status=` enum
// (published|pending|hidden|removed). Every row shows who reported it and why
// (reportCount + the report reasons the backend exposes on the post), the author
// and subject, and the moderation actions. Remove and ban ask for confirmation.
const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "published", label: "Published" },
  { value: "hidden", label: "Hidden" },
  { value: "removed", label: "Removed" },
];

const statusStyles = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  published: "bg-green-100 text-green-800 border-green-300",
  hidden: "bg-orange-100 text-orange-800 border-orange-300",
  removed: "bg-red-100 text-red-800 border-red-300",
};

const btn =
  "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50";

export default function CommunityModeration() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState("pending");
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [bannedPosters, setBannedPosters] = useState([]);

  const load = useCallback(
    async ({ reset = false } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const data = await communityApi.getQueue({
          status,
          cursor: reset ? undefined : cursor || undefined,
          limit: 20,
        });
        setPosts((prev) => (reset ? data.posts : [...prev, ...data.posts]));
        setCursor(data.nextCursor);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        setError(err.response?.data?.message || err.message || "Failed to load the queue");
      } finally {
        setLoading(false);
      }
    },
    [status, cursor]
  );

  // bannedPosters live in the settings doc; the queue does not carry per-post
  // ban state, so we read the list once to label the Ban/Unban button correctly.
  useEffect(() => {
    communityApi
      .getSettings()
      .then((s) => setBannedPosters(Array.isArray(s?.bannedPosters) ? s.bannedPosters.map(String) : []))
      .catch(() => {});
  }, []);

  const isBanned = (post) => {
    const userId = String(post.authorUser?._id || post.authorUser || "");
    return Boolean(userId) && bannedPosters.includes(userId);
  };

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    setHasMore(false);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (post, action) => {
    setBusyId(post._id);
    try {
      const label = { approve: "approved", hide: "hidden", remove: "removed", restore: "restored" }[action];
      await communityApi[`${action}Post`](post._id);
      showToast(`Post ${label}.`, action === "remove" ? "warning" : "success");
      // Drop it from the current list; it belongs to another tab now.
      setPosts((prev) => prev.filter((p) => p._id !== post._id));
    } catch (err) {
      showToast(err.response?.data?.message || err.message || `Failed to ${action} the post`, "error");
    } finally {
      setBusyId(null);
    }
  };

  const toggleBan = async (post, banned) => {
    const userId = post.authorUser?._id || post.authorUser;
    if (!userId) {
      showToast("This post has no author to ban.", "error");
      return;
    }
    setBusyId(post._id);
    try {
      const res = await communityApi.banPoster(userId, banned);
      const list = Array.isArray(res?.bannedPosters) ? res.bannedPosters.map(String) : [];
      setBannedPosters(list);
      showToast(banned ? "Poster banned from the community." : "Poster unbanned.", banned ? "warning" : "success");
    } catch (err) {
      showToast(err.response?.data?.message || err.message || "Failed to update the ban", "error");
    } finally {
      setBusyId(null);
    }
  };

  const authorName = (post) => post.authorUser?.name || post.authorUser?.email || "Unknown author";
  const subjectLabel = (post) => {
    const s = post.subject || {};
    const ref = s.ref;
    const name = typeof ref === "object" && ref ? ref.name || ref.shortName : null;
    if (!name) return s.type || "post";
    return `${s.type}: ${name}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-cric-text">Community Moderation</h1>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            Approve new posts, review reported ones, hide or remove content and ban repeat offenders.
          </p>
        </div>
        <button
          onClick={() => navigate("/admin/community/settings")}
          className="rounded-lg border border-cric-border bg-cric-card px-4 py-2 text-xs font-black uppercase tracking-widest text-cric-muted hover:text-cric-text"
        >
          Community settings
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={`rounded-lg border px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
              status === t.value
                ? "border-cric-accent bg-cric-accent text-white"
                : "border-cric-border bg-cric-card text-cric-muted hover:text-cric-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
      )}

      {loading && posts.length === 0 ? (
        <p className="text-sm font-semibold text-cric-muted">Loading...</p>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card p-10 text-center">
          <p className="text-sm font-black text-cric-text">Nothing in this queue</p>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            {status === "pending"
              ? "Posts awaiting approval (approval mode) will appear here."
              : `No ${status} posts right now.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {posts.map((post) => (
            <article key={post._id} data-testid="queue-post" className="rounded-2xl border border-cric-border bg-cric-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${statusStyles[post.status] || statusStyles.pending}`}>
                      {post.status}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-cric-muted">{post.kind}</span>
                    {post.reportCount > 0 && (
                      <span className="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-700">
                        {post.reportCount} report{post.reportCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {isBanned(post) && (
                      <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
                        poster banned
                      </span>
                    )}
                  </div>
                  {post.title ? <h3 className="mt-2 text-sm font-black text-cric-text">{post.title}</h3> : null}
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs font-semibold text-cric-muted">
                    {post.body || "(no text)"}
                  </p>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                    {authorName(post)} · {subjectLabel(post)} · {new Date(post.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {post.videoUrl ? (
                    <a
                      href={post.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-black uppercase tracking-widest text-cric-accent hover:underline"
                    >
                      Open video ↗
                    </a>
                  ) : null}
                  {Array.isArray(post.media) && post.media.length > 0 ? (
                    <span className="text-[10px] font-bold text-cric-muted">{post.media.length} image(s)</span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {post.status !== "published" && (
                  <button
                    disabled={busyId === post._id}
                    onClick={() => act(post, "approve")}
                    className={`${btn} bg-green-600 text-white hover:bg-green-700`}
                  >
                    Approve
                  </button>
                )}
                {post.status !== "hidden" && (
                  <button
                    disabled={busyId === post._id}
                    onClick={() => act(post, "hide")}
                    className={`${btn} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`}
                  >
                    Hide
                  </button>
                )}
                {post.status !== "removed" && (
                  <button
                    disabled={busyId === post._id}
                    onClick={() =>
                      setConfirm({
                        title: "Remove this post?",
                        message: "It will stop being visible everywhere. You can restore it later from the Removed tab.",
                        confirmLabel: "Remove",
                        variant: "danger",
                        onConfirm: () => {
                          setConfirm(null);
                          act(post, "remove");
                        },
                      })
                    }
                    className={`${btn} bg-red-50 text-red-700 hover:bg-red-100 border border-red-200`}
                  >
                    Remove
                  </button>
                )}
                {(post.status === "hidden" || post.status === "removed") && (
                  <button
                    disabled={busyId === post._id}
                    onClick={() => act(post, "restore")}
                    className={`${btn} border border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text`}
                  >
                    Restore
                  </button>
                )}
                <button
                  disabled={busyId === post._id}
                  onClick={() =>
                    setConfirm({
                      title: isBanned(post) ? "Unban this poster?" : "Ban this poster?",
                      message: isBanned(post)
                        ? `${authorName(post)} will be able to post, like and comment again.`
                        : `${authorName(post)} will be blocked from every community write (posts, likes, comments, reports) until unbanned.`,
                      confirmLabel: isBanned(post) ? "Unban" : "Ban",
                      variant: isBanned(post) ? undefined : "danger",
                      onConfirm: () => {
                        setConfirm(null);
                        toggleBan(post, !isBanned(post));
                      },
                    })
                  }
                  className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                >
                  {isBanned(post) ? "Unban poster" : "Ban poster"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button onClick={() => load()} disabled={loading} className="rounded-lg border border-cric-border bg-cric-card px-6 py-3 text-xs font-black uppercase tracking-widest text-cric-muted hover:text-cric-text disabled:opacity-50">
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}

      {confirm && (
        <ConfirmModal
          open
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          variant={confirm.variant}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
