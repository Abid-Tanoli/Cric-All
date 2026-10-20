import { Link } from "react-router-dom";
import SafeImage from "../../../Shared/components/SafeImage.jsx";
import {
  KIND_LABELS,
  MAX_IMAGES,
  isReservedName,
  postNames,
  timeAgo,
  toAbsoluteMediaUrl,
  videoEmbed,
} from "./communityConfig";

/**
 * One post in a feed (community feed, team/player Posts tab).
 *
 * Renders every user-supplied string as a React text node — never
 * dangerouslySetInnerHTML — and treats media/video as untrusted data: images go
 * through SafeImage (placeholder on error), embeds are built only from the
 * allowlisted provider+id the backend stored.
 *
 * `compact` trims the body to an excerpt for the main feed; the post page uses
 * the full body instead (it renders PostBody itself).
 */
export default function PostCard({ post, compact = false, onLike, likePending, children }) {
  const { authorName, teamName, playerName, teamId, playerId } = postNames(post);
  const kind = KIND_LABELS[post.kind] || post.kind;
  const when = timeAgo(post.createdAt);
  const media = Array.isArray(post.media) ? post.media.slice(0, MAX_IMAGES) : [];
  const embed = videoEmbed(post.videoProvider, post.videoId);
  const body = String(post.body || "");
  const excerpt = compact && body.length > 320 ? `${body.slice(0, 320)}...` : body;
  const hiddenAuthor = isReservedName(authorName);

  return (
    <article
      data-testid="post-card"
      className="rounded-2xl border border-cric-border bg-cric-card p-4 sm:p-5 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-cric-text truncate" data-testid="post-author">
            {hiddenAuthor ? "Community member" : authorName || "Community member"}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-cric-muted">
            <span>{kind}</span>
            {teamId ? (
              <>
                <span aria-hidden="true">·</span>
                <Link to={`/teams/${teamId}`} className="hover:text-cric-accent truncate">
                  {teamName || "Team"}
                </Link>
              </>
            ) : null}
            {playerId ? (
              <>
                <span aria-hidden="true">·</span>
                <Link to={`/players/${playerId}`} className="hover:text-cric-accent truncate">
                  {playerName || "Player"}
                </Link>
              </>
            ) : null}
            {when ? (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={post.createdAt}>{when}</time>
              </>
            ) : null}
          </p>
        </div>
        {post.status && post.status !== "published" ? (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
            {post.status}
          </span>
        ) : null}
      </header>

      {post.title ? (
        <h3 className="mt-3 text-base font-black text-cric-text leading-snug">{post.title}</h3>
      ) : null}

      {excerpt ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-cric-text">
          {excerpt}
        </p>
      ) : null}

      {media.length > 0 ? (
        <div
          className={`mt-3 grid gap-2 ${media.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}
        >
          {media.map((item, index) => (
            <SafeImage
              key={`${item?.url}-${index}`}
              src={toAbsoluteMediaUrl(item?.url)}
              alt={item?.alt || post.title || "Community photo"}
              loading="lazy"
              className={`w-full rounded-xl border border-cric-border object-cover ${
                media.length === 1 ? "max-h-96" : "h-32 sm:h-40"
              }`}
            />
          ))}
        </div>
      ) : null}

      {embed ? (
        <div className="mt-3 aspect-video overflow-hidden rounded-xl border border-cric-border">
          <iframe
            src={embed.src}
            title={embed.title}
            className="h-full w-full"
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : post.videoUrl && post.videoProvider === "instagram" ? (
        <a
          href={post.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-cric-border bg-cric-bg px-4 py-3 text-xs font-black uppercase tracking-widest text-cric-accent"
        >
          Watch on Instagram ↗
        </a>
      ) : post.videoUrl ? (
        <a
          href={post.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block break-all text-xs font-bold text-cric-accent underline"
        >
          {post.videoUrl}
        </a>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center gap-3 border-t border-cric-border pt-3">
        <button
          type="button"
          onClick={() => onLike?.(post)}
          disabled={likePending || !onLike}
          aria-pressed={Boolean(post.likedByMe)}
          className={`min-h-[40px] rounded-lg px-3 text-xs font-black uppercase tracking-widest transition ${
            post.likedByMe
              ? "bg-cric-accent text-white"
              : "text-cric-muted hover:text-cric-accent disabled:opacity-60"
          }`}
        >
          ♥ {post.likeCount ?? 0}
        </button>
        <Link
          to={`/community/post/${post._id}`}
          className="min-h-[40px] flex items-center px-1 text-xs font-black uppercase tracking-widest text-cric-muted hover:text-cric-accent"
        >
          Comments {post.commentCount ?? 0}
        </Link>
        {children}
      </footer>
    </article>
  );
}
