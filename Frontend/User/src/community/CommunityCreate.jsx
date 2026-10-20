import { Link, useNavigate } from "react-router-dom";
import { useCommunityConfig } from "./CommunityConfigContext";
import RequireAuth from "./RequireAuth";
import PostForm from "./PostForm";
import { card } from "../pages/organization/orgStyles";

// Create-post route (logged-in only). In approval mode the post comes back as
// `pending`, so we show the "waiting for approval" message instead of a link to
// a public feed the post is not yet in.
export default function CommunityCreate() {
  const navigate = useNavigate();
  const { enabled, postMode, status } = useCommunityConfig();

  if (status === "ready" && !enabled) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm font-bold text-cric-muted">
          Community is switched off right now. You cannot post until an admin turns it back on.
        </p>
      </div>
    );
  }

  return (
    <RequireAuth message="Sign in to share a post with the community.">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        <Link to="/community" className="text-[10px] font-black uppercase tracking-widest text-cric-muted hover:text-cric-accent">
          ← Back to community
        </Link>
        <h1 className="mt-3 text-xl font-black uppercase tracking-widest text-cric-text">New post</h1>
        <div className={`mt-4 ${card}`}>
          <PostForm
            mode="create"
            onCreated={(post) => navigate(`/community/post/${post?._id || ""}`)}
            onCancel={() => navigate("/community")}
          />
        </div>
        {postMode === "approval" ? (
          <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-amber-600">
            New posts are reviewed by an admin before they appear publicly.
          </p>
        ) : null}
      </div>
    </RequireAuth>
  );
}
