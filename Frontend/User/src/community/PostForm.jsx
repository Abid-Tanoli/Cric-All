import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listMyOrganizations } from "../services/organizationApi";
import {
  MAX_BODY,
  MAX_IMAGES,
  MAX_TITLE,
  POST_KINDS,
  KIND_LABELS,
  VIDEO_HINT,
  friendlyWriteError,
} from "./communityConfig";
import ImagePicker from "./ImagePicker";
import { Banner, input, label, primaryButton, secondaryButton } from "../pages/organization/orgStyles";

// Create / edit a post.
//
// "Posting as" only offers subjects the API will actually authorise: yourself,
// plus the teams you own/manage (org owner or manager) and/or the player
// profiles you created. We resolve those from the existing endpoints
// (`/organizations/mine` → teams, `/players/mine`) — the server re-checks every
// write, so the list here is a convenience, not a security boundary. If the
// server still refuses (403 COMMUNITY_SUBJECT_DENIED) we show the backend's
// message verbatim.

const REASON_HINTS = {
  403: "You do not have permission to post as this team or player.",
  429: "You are posting too fast — please wait a moment.",
};

function kindNeedsVideo(kind) {
  return kind === "video";
}

export default function PostForm({ mode = "create", initial = null, onCreated, onUpdated, onCancel }) {
  const isEdit = mode === "edit";
  const [me, setMe] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [subjectKey, setSubjectKey] = useState("");
  const [kind, setKind] = useState(initial?.kind || "story");
  const [title, setTitle] = useState(initial?.title || "");
  const [body, setBody] = useState(initial?.body || "");
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl || "");
  const [media, setMedia] = useState(initial?.media || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getStoredUser } = await import("../pages/auth/auth");
      const user = getStoredUser();
      if (cancelled) return;
      setMe(user);
      if (!user?._id) {
        setSubjectsLoading(false);
        return;
      }

      const list = [{ key: `user:${user._id}`, type: "user", ref: user._id, label: `Myself (${user.name || "me"})` }];

      // Teams the user manages (org owner/manager) — best effort, failures are silent.
      try {
        const orgs = await listMyOrganizations();
        for (const org of Array.isArray(orgs) ? orgs : []) {
          const membership = org.membership || org.myMembership || {};
          const role = org.role || membership.role;
          if (role && !["owner", "manager"].includes(role)) continue;
          for (const team of org.teams || []) {
            list.push({
              key: `team:${team._id || team.id}`,
              type: "team",
              ref: team._id || team.id,
              label: `${team.name || team.shortName || "Team"} (team)`,
            });
          }
        }
      } catch {
        /* ignore */
      }

      // Player profiles this account created.
      try {
        const { listMyPlayers } = await import("../services/playerApi");
        const res = await listMyPlayers();
        const players = res?.items || res?.players || (Array.isArray(res) ? res : []);
        for (const p of players) {
          list.push({ key: `player:${p._id}`, type: "player", ref: p._id, label: `${p.name} (player)` });
        }
      } catch {
        /* ignore */
      }

      if (cancelled) return;
      setSubjects(list);
      setSubjectsLoading(false);
      // Editing keeps the post's original subject; creating defaults to "myself".
      if (isEdit && initial?.subject) {
        const match = list.find(
          (s) => s.type === initial.subject.type && String(s.ref) === String(initial.subject.ref)
        );
        setSubjectKey(match ? match.key : `user:${user._id}`);
      } else {
        setSubjectKey(`user:${user._id}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, initial]);

  const selected = useMemo(() => subjects.find((s) => s.key === subjectKey), [subjects, subjectKey]);
  const titleLeft = MAX_TITLE - title.length;
  const bodyLeft = MAX_BODY - body.length;
  const overLimit = titleLeft < 0 || bodyLeft < 0;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!selected) {
      setError("Choose who you are posting as.");
      return;
    }
    if (isEdit === false && !body.trim() && media.length === 0 && !videoUrl.trim() && !title.trim()) {
      setError("Add some text, an image or a video link before posting.");
      return;
    }
    if (kindNeedsVideo(kind) && !videoUrl.trim() && !isEdit) {
      setError("A video post needs a YouTube, Facebook or Instagram link.");
      return;
    }
    if (overLimit) {
      setError("Please shorten the title or the body to fit the limits.");
      return;
    }

    const payload = {
      kind,
      subject: { type: selected.type, ref: selected.ref },
      title: title.trim() || undefined,
      body: body.trim() || undefined,
      media,
      videoUrl: videoUrl.trim() || undefined,
    };

    setSaving(true);
    try {
      const { createPost, updatePost } = await import("../services/communityApi");
      if (isEdit) {
        const data = await updatePost(initial._id, {
          title: payload.title,
          body: payload.body,
          media: payload.media,
          videoUrl: payload.videoUrl,
        });
        onUpdated?.(data.post);
      } else {
        const data = await createPost(payload);
        onCreated?.(data.post);
      }
    } catch (err) {
      setError(err.status === 429 ? REASON_HINTS[429] : friendlyWriteError(err));
    } finally {
      setSaving(false);
    }
  };

  if (!me?._id) {
    return (
      <Banner kind="info">
        Please{" "}
        <Link to="/login?next=/community" className="underline">
          sign in
        </Link>{" "}
        to share a post.
      </Banner>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="post-form">
      <div>
        <label className={label} htmlFor="post-as">
          Posting as
        </label>
        <select
          id="post-as"
          value={subjectKey}
          onChange={(e) => setSubjectKey(e.target.value)}
          disabled={subjectsLoading || isEdit}
          className={input}
        >
          {subjectsLoading ? <option value="">Loading…</option> : null}
          {subjects.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {isEdit ? (
          <p className="mt-1 text-[10px] font-semibold text-cric-muted">The subject cannot be changed after posting.</p>
        ) : (
          <p className="mt-1 text-[10px] font-semibold text-cric-muted">
            You can only post as yourself, a team you manage, or a player profile you created.
          </p>
        )}
      </div>

      <div>
        <span className={label}>Type</span>
        <div className="flex flex-wrap gap-2">
          {POST_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`min-h-[40px] rounded-lg border px-4 text-xs font-black uppercase tracking-widest transition ${
                kind === k
                  ? "border-cric-accent bg-cric-accent text-white"
                  : "border-cric-border bg-cric-bg text-cric-muted hover:text-cric-text"
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="post-title">
          Title (optional)
        </label>
        <input
          id="post-title"
          value={title}
          maxLength={MAX_TITLE + 40}
          onChange={(e) => setTitle(e.target.value)}
          className={input}
          placeholder="A short headline"
        />
        <p className={`mt-1 text-[10px] font-semibold ${titleLeft < 0 ? "text-red-600" : "text-cric-muted"}`}>
          {titleLeft} characters left
        </p>
      </div>

      <div>
        <label className={label} htmlFor="post-body">
          Body
        </label>
        <textarea
          id="post-body"
          value={body}
          rows={6}
          onChange={(e) => setBody(e.target.value)}
          className={input}
          placeholder="Write your story…"
        />
        <p className={`mt-1 text-[10px] font-semibold ${bodyLeft < 0 ? "text-red-600" : "text-cric-muted"}`}>
          {bodyLeft} characters left
        </p>
      </div>

      <div>
        <span className={label}>Photos</span>
        <ImagePicker value={media} onChange={setMedia} max={MAX_IMAGES} disabled={saving} />
      </div>

      <div>
        <label className={label} htmlFor="post-video">
          Video link
        </label>
        <input
          id="post-video"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          className={input}
          placeholder="https://www.youtube.com/watch?v=…"
          inputMode="url"
        />
        <p className="mt-1 text-[10px] font-semibold text-cric-muted">{VIDEO_HINT}</p>
      </div>

      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Publish post"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={secondaryButton} disabled={saving}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
