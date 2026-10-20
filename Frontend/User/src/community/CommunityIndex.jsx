import { Link } from "react-router-dom";
import CommunityFeed from "./CommunityFeed";
import { useCommunityConfig } from "./CommunityConfigContext";

/**
 * The /community route. When the runtime switch is off it renders the friendly
 * "coming soon" placeholder instead of the feed, so the route can stay mounted
 * (deep links keep working) while the section is dark.
 */
export default function CommunityIndex() {
  const { status, enabled } = useCommunityConfig();

  if (status === "ready" && !enabled) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cric-accent">CricAll Community</p>
        <h1 className="mt-4 text-2xl font-black text-cric-text">Coming soon</h1>
        <p className="mt-3 text-sm font-semibold text-cric-muted">
          The community section is being prepared. Soon you will be able to share photos, videos and stories with
          your team, your players and the whole CricAll community.
        </p>
        <Link to="/" className="mt-6 inline-block rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white">
          Back to matches
        </Link>
      </div>
    );
  }

  return <CommunityFeed />;
}
