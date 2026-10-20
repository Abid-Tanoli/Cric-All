import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SafeImage from "../../../Shared/components/SafeImage.jsx";
import { useCommunityConfig } from "./CommunityConfigContext";
import PostForm from "./PostForm";
import ShareMenu from "./ShareMenu";
import {
  MAX_COMMENT,
  REPORT_REASONS,
  friendlyWriteError,
  postNames,
  timeAgo,
  toAbsoluteMediaUrl,
  videoEmbed,
} from "./communityConfig";
import {
  createComment,
  deleteComment,
  deletePost,
  getComments,
  getPost,
  reportPost,
  sharePost,
  toggleLike,
} from "../services/communityApi";
import { Banner, card, dangerButton, input, label, primaryButton, secondaryButton } from "../pages/organization/orgStyles";

// Full post view: body, media/video, like toggle, share menu, report, comments
// (cursor paginated) and edit/delete for the author.
export default function CommunityPost() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enabled, postMode, status: configStatus } = useCommunityConfig();

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [likePending, setLikePending] = useState(false);
  const [editing, setEditing] = useState(false);

  const [comments, setComments] = useState([]);
  const [commentCursor, setCommentCursor] = useState(null);
  const [commentsMore, setCommentsMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [reportNote, setReportNote] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportDone, setReportDone] = useState(false);

  const loadPost = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getPost(id);
      setPost(data.post || data);
    } catch (err) {
      setError(err.status === 404 ? "This post is not available." : friendlyWriteError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadComments = useCallback(
    async ({ reset = false } = {}) => {
      setCommentsLoading(true);
      setCommentsError("");
      try {
        const data = await getComments(id, { cursor: reset ? undefined : commentCursor || undefined });
        setComments((prev) => (reset ? data.comments : [...prev, ...data.comments]));
        setCommentCursor(data.nextCursor);
        setCommentsMore(Boolean(data.hasMore));
      } catch (err) {
        setCommentsError(friendlyWriteError(err));
      } finally {
        setCommentsLoading(false);
      }
    },
    [id, commentCursor]
  );

  useEffect(() => {
    if (configStatus === "ready" && !enabled) {
      setLoading(false);
      return;
    }
    loadPost();
    loadComments({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, configStatus, enabled]);

  const { authorName, authorId, teamName, playerName, teamId, playerId } = postNames(post);
  const me = (() => {
    try {
      return JSON.parse(localStorage.getItem("bq_user") || "null");
    } catch {
      return null;
    }
  })();
  const isAuthor = Boolean(me?._id && authorId && String(me._id) === String(authorId));

  const handleLike = async () => {
    setLikePending(true);
    try {
      const data = await toggleLike(post._id);
      setPost((p) => ({
        ...p,
        likedByMe: data.liked,
        likeCount: Math.max(0, (p.likeCount || 0) + (data.liked ? 1 : -1)),
      }));
    } catch (err) {
      setError(friendlyWriteError(err));
    } finally {
      setLikePending(false);
    }
  };

  const handleComment = async (event) => {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setCommentSaving(true);
    setCommentsError("");
    try {
      const data = await createComment(post._id, commentBody.trim());
      setComments((prev) => [data.comment, ...prev]);
      setPost((p) => ({ ...p, commentCount: (p.commentCount || 0) + 1 }));
      setCommentBody("");
    } catch (err) {
      setCommentsError(friendlyWriteError(err));
    } finally {
      setCommentSaving(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await deleteComment(post._id, commentId);
      setComments((prev) => prev.filter((c) => c._id !== commentId));
      setPost((p) => ({ ...p, commentCount: Math.max(0, (p.commentCount || 0) - 1) }));
    } catch (err) {
      setCommentsError(friendlyWriteError(err));
    }
  };

  const handleDeletePost = async () => {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    try {
      await deletePost(post._id);
      navigate("/community");
    } catch (err) {
      setError(friendlyWriteError(err));
    }
  };

  const handleReport = async (event) => {
    event.preventDefault();
    setReportError("");
    try {
      const data = await reportPost(post._id, reportReason, reportNote);
      setReportDone(true);
      setPost((p) => ({ ...p, reportCount: data.reportCount, status: data.status }));
      setTimeout(() => setReportOpen(false), 1500);
    } catch (err) {
      setReportError(friendlyWriteError(err));
    }
  };

  if (configStatus === "loading" || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-cric-accent border-t-transparent" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Banner kind="info">Community is not available right now.</Banner>
      </div>
    );
  }

  if (error && !post) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Banner kind="error">{error}</Banner>
        <Link to="/community" className="mt-4 inline-block text-xs font-black uppercase tracking-widest text-cric-accent">
          ← Back to community
        </Link>
      </div>
    );
  }

  if (!post) return null;

  const embed = videoEmbed(post.videoProvider, post.videoId);
  const media = Array.isArray(post.media) ? post.media : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <Link to="/community" className="text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-accent">
        ← Back to community
      </Link>

      {post.status === "pending" ? (
        <div className="mt-4">
          <Banner kind="info">This post is waiting for admin approval and is not visible to others yet.</Banner>
        </div>
      ) : null}
      {post.status === "hidden" ? (
        <div className="mt-4">
          <Banner kind="info">This post is hidden pending moderation review.</Banner>
        </div>
      ) : null}

      <article className={`mt-4 ${card}`} data-testid="post-detail">
        {editing ? (
          <>
            <h2 className="mb-4 text-lg font-black uppercase tracking-widest text-cric-text">Edit post</h2>
            <PostForm
              mode="edit"
              initial={post}
              onUpdated={(updated) => {
                setPost(updated);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-cric-text">{authorName || "Community member"}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                  <span>{post.kind}</span>
                  {teamId ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <Link to={`/teams/${teamId}`} className="hover:text-cric-accent">{teamName || "Team"}</Link>
                    </>
                  ) : null}
                  {playerId ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <Link to={`/players/${playerId}`} className="hover:text-cric-accent">{playerName || "Player"}</Link>
                    </>
                  ) : null}
                  <span aria-hidden="true">·</span>
                  <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
                </p>
              </div>
              {isAuthor ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
                    Edit
                  </button>
                  <button type="button" onClick={handleDeletePost} className={dangerButton}>
                    Delete
                  </button>
                </div>
              ) : null}
            </header>

            {post.title ? <h1 className="mt-4 text-xl font-black text-cric-text leading-snug">{post.title}</h1> : null}
            {post.body ? (
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-cric-text">{post.body}</p>
            ) : null}

            {media.length > 0 ? (
              <div className={`mt-4 grid gap-2 ${media.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
                {media.map((item, index) => (
                  <SafeImage
                    key={`${item?.url}-${index}`}
                    src={toAbsoluteMediaUrl(item?.url)}
                    alt={item?.alt || post.title || "Community photo"}
                    loading="lazy"
                    className={`w-full rounded-xl border border-cric-border object-cover ${media.length === 1 ? "max-h-[32rem]" : "h-40"}`}
                  />
                ))}
              </div>
            ) : null}

            {embed ? (
              <div className="mt-4 aspect-video overflow-hidden rounded-xl border border-cric-border">
                <iframe
                  src={embed.src}
                  title={embed.title}
                  className="h-full w-full"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : post.videoUrl ? (
              <a
                href={post.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block break-all text-sm font-bold text-cric-accent underline"
              >
                {post.videoUrl}
              </a>
            ) : null}

            <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-cric-border pt-4">
              <button
                type="button"
                onClick={handleLike}
                disabled={likePending}
                aria-pressed={Boolean(post.likedByMe)}
                className={`min-h-[40px] rounded-lg px-4 text-xs font-black uppercase tracking-widest transition ${
                  post.likedByMe ? "bg-cric-accent text-white" : "border border-cric-border text-cric-muted hover:text-cric-accent"
                }`}
              >
                ♥ {post.likeCount ?? 0}
              </button>
              <ShareMenu kind="post" id={post._id} title={post.title || "CricAll community post"} onShare={() => sharePost(post._id)} />
              <button
                type="button"
                onClick={() => setReportOpen((v) => !v)}
                className="min-h-[40px] rounded-lg px-3 text-xs font-black uppercase tracking-widest text-cric-muted hover:text-red-600"
              >
                Report
              </button>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-cric-muted">
                {post.commentCount ?? 0} comments · {post.shareCount ?? 0} shares
              </span>
            </footer>

            {reportOpen ? (
              <form onSubmit={handleReport} className="mt-4 space-y-3 rounded-xl border border-cric-border bg-cric-bg p-4" data-testid="report-form">
                {reportDone ? (
                  <Banner kind="success">Thanks — your report was sent to the moderators.</Banner>
                ) : (
                  <>
                    <div>
                      <label className={label} htmlFor="report-reason">Why are you reporting this?</label>
                      <select id="report-reason" value={reportReason} onChange={(e) => setReportReason(e.target.value)} className={input}>
                        {REPORT_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={label} htmlFor="report-note">Note (optional)</label>
                      <textarea id="report-note" rows={3} maxLength={500} value={reportNote} onChange={(e) => setReportNote(e.target.value)} className={input} />
                    </div>
                    {reportError ? <Banner kind="error">{reportError}</Banner> : null}
                    <div className="flex gap-3">
                      <button type="submit" className={dangerButton}>Send report</button>
                      <button type="button" onClick={() => setReportOpen(false)} className={secondaryButton}>Cancel</button>
                    </div>
                  </>
                )}
              </form>
            ) : null}
          </>
        )}
      </article>

      {error && post ? <div className="mt-4"><Banner kind="error">{error}</Banner></div> : null}

      <section className="mt-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-cric-text">Comments</h2>

        <form onSubmit={handleComment} className="mt-3">
          <label className={label} htmlFor="new-comment">Add a comment</label>
          <textarea
            id="new-comment"
            rows={3}
            maxLength={MAX_COMMENT}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            className={input}
            placeholder="Say something kind…"
          />
          <div className="mt-2 flex items-center gap-3">
            <button type="submit" disabled={commentSaving || !commentBody.trim()} className={primaryButton}>
              {commentSaving ? "Posting…" : "Comment"}
            </button>
            <span className="text-[10px] font-semibold text-cric-muted">{MAX_COMMENT - commentBody.length} left</span>
          </div>
        </form>

        {commentsError ? <div className="mt-3"><Banner kind="error">{commentsError}</Banner></div> : null}

        <div className="mt-4 space-y-3" data-testid="comments-list">
          {comments.map((comment) => {
            const commentAuthor = comment.author?.name || comment.authorName || "Community member";
            const mineComment = me?._id && String(comment.author?._id || comment.author) === String(me._id);
            return (
              <div key={comment._id} className="rounded-xl border border-cric-border bg-cric-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-black text-cric-text">{commentAuthor}</p>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-cric-muted">{timeAgo(comment.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-cric-text">{comment.body}</p>
                {mineComment ? (
                  <button type="button" onClick={() => handleDeleteComment(comment._id)} className="mt-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:underline">
                    Delete
                  </button>
                ) : null}
              </div>
            );
          })}
          {!commentsLoading && comments.length === 0 ? (
            <p className="text-center text-xs font-bold text-cric-muted">No comments yet.</p>
          ) : null}
        </div>

        {commentsMore ? (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => loadComments()} disabled={commentsLoading} className={secondaryButton}>
              {commentsLoading ? "Loading…" : "Load more comments"}
            </button>
          </div>
        ) : null}
      </section>

      {postMode === "approval" ? (
        <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-widest text-cric-muted">
          This community is in approval mode — new posts are reviewed before going public.
        </p>
      ) : null}
    </div>
  );
}
