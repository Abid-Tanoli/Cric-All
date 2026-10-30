import React, { lazy, Suspense, useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import useTournamentHub from "./useTournamentHub";
import { resolveTabs } from "./registry";
import TournamentSidebar from "./TournamentSidebar";
import ShareButton from "../../components/ShareButton";
import HomeTab from "./tabs/HomeTab";
import FixturesTab from "./tabs/FixturesTab";
import TableTab from "./tabs/TableTab";
import StatsTab from "./tabs/StatsTab";
import TeamsTab from "./tabs/TeamsTab";
import PhotosTab from "./tabs/PhotosTab";
import VideosTab from "./tabs/VideosTab";
import ArticlesTab from "./tabs/ArticlesTab";
import ArticleDetail from "./tabs/ArticleDetail";

// The legacy page is kept verbatim. If `/series/:id` turns out to be a Series,
// Event or Match rather than a Tournament, the hub hands the URL straight to it
// so every existing shared link keeps working.
const LegacySeries = lazy(() => import("../Series"));

// Tabs that render a right sidebar. Photos / Videos / Articles use the full
// width, matching the "Home/Fixtures/Table/Stats/Teams" sidebar rule.
const SIDEBAR_TABS = new Set(["home", "fixtures", "table", "stats", "teams"]);

const TAB_COMPONENTS = {
  home: HomeTab,
  fixtures: FixturesTab,
  table: TableTab,
  stats: StatsTab,
  teams: TeamsTab,
  photos: PhotosTab,
  videos: VideosTab,
  articles: ArticlesTab,
};

function Spinner() {
  return (
    <div className="min-h-screen bg-cric-bg flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-cric-accent border-t-transparent" />
    </div>
  );
}

function FallbackToSeries() {
  return (
    <Suspense fallback={<Spinner />}>
      <LegacySeries />
    </Suspense>
  );
}

function formatRange(start, end) {
  const fmt = (value) =>
    value
      ? new Date(value).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          // Fixture/tournament dates are published in Pakistan time, so a final
          // at 10:30 AM PKT on 1 Nov must not read as 31 Oct in another zone.
          timeZone: "Asia/Karachi",
        })
      : "";
  const from = fmt(start);
  const to = fmt(end);
  if (from && to) return `${from} - ${to}`;
  return from || to || "";
}

export default function TournamentHub() {
  const { seriesId, tab: tabParam, slug } = useParams();
  const hub = useTournamentHub(seriesId);
  const { status, tournament, content, counts, matches, standings, bracket, stats, squads, teams } = hub;

  const basePath = `/series/${seriesId}`;

  const tabs = useMemo(
    () => resolveTabs({ visibility: hub.visibility, counts, stats, standings, bracket, teams, squads }),
    [hub.visibility, counts, stats, standings, bracket, teams, squads],
  );

  if (status === "loading") return <Spinner />;
  if (status !== "ready" || !tournament) return <FallbackToSeries />;

  const overview = content?.overview || {};
  const banner = overview.bannerImage || tournament.logo || "";
  // The content endpoint derives this from the fixtures. "live" means a match
  // is actually in progress; "ongoing" means the tournament has started or its
  // final is scheduled but no match is live right now.
  const displayStatus = String(overview.status || tournament.status || "upcoming").toLowerCase();
  const activeKey = slug ? "articles" : tabParam || "home";
  const activeTab = tabs.find((t) => t.key === activeKey) || null;

  // A deep link to a tab that is hidden for this tournament (an empty media tab,
  // a tab the admin switched off, or a typo) lands on Home rather than a blank
  // screen. Everything stays reachable from the tab bar.
  if (!slug && tabParam && !activeTab) {
    return <Navigate to={basePath} replace />;
  }

  const showSidebar = SIDEBAR_TABS.has(activeKey);
  const TabComponent = TAB_COMPONENTS[activeKey];
  const params = {
    tournament,
    tournamentId: hub.id,
    content,
    counts,
    matches,
    standings,
    bracket,
    stats,
    squads,
    teams,
    basePath,
  };

  return (
    <div className="bg-cric-bg min-h-screen">
      <div className="bg-gradient-to-r from-cric-text via-slate-800 to-cric-text text-white">
        <div
          className="relative"
          style={banner ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          {banner && <div className="absolute inset-0 bg-black/50" />}
          <div className="relative max-w-7xl mx-auto px-4 py-8">
            <div className="flex items-center gap-3 text-sm text-white/60 mb-4">
              <Link to="/" className="hover:text-white transition-colors">Home</Link>
              <span>/</span>
              <Link to="/series" className="hover:text-white transition-colors">Series</Link>
              <span>/</span>
              <span className="text-white/90 truncate">{tournament.name}</span>
            </div>

            <div className="flex items-center gap-6">
              {tournament.logo ? (
                <img src={tournament.logo} alt={tournament.name} className="w-24 h-24 rounded-2xl object-cover border-2 border-white/20" />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center border-2 border-white/20">
                  <span className="text-4xl font-black text-white/80">{tournament.name?.charAt(0)}</span>
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-3xl font-black uppercase tracking-tight mb-2 truncate">{tournament.name}</h1>
                <div className="flex items-center gap-3 text-sm text-white/70 flex-wrap">
                  {tournament.type && (
                    <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold uppercase">{String(tournament.type).replace("-", " ")}</span>
                  )}
                  {(overview.format || tournament.format) && (
                    <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold uppercase">{overview.format || tournament.format}</span>
                  )}
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                      displayStatus === "live" ? "bg-red-600 text-white animate-pulse"
                        : displayStatus === "ongoing" ? "bg-red-600 text-white"
                          : displayStatus === "completed" ? "bg-green-600 text-white"
                            : "bg-white/20 text-white"
                    }`}
                  >
                    {displayStatus}
                  </span>
                  <span className="text-xs">{counts.matches} Matches</span>
                  <ShareButton title={tournament.name} />
                </div>
                <p className="text-sm text-white/60 mt-2">
                  {formatRange(overview.startDate || tournament.startDate, overview.endDate || tournament.endDate)}
                  {(overview.venue || tournament.venue) && ` - ${overview.venue || tournament.venue}`}
                  {overview.city && ` - ${overview.city}`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-md border-t border-white/10 overflow-x-auto">
          <div className="max-w-7xl mx-auto px-4 flex">
            {tabs.map((t) => {
              const to = t.path ? `${basePath}/${t.path}` : basePath;
              const active = t.key === activeKey;
              return (
                <Link
                  key={t.key}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={`px-6 py-4 text-xs font-black uppercase tracking-widest transition-all relative shrink-0 ${
                    active ? "text-white" : "text-white/50 hover:text-white"
                  }`}
                >
                  {t.label}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-1.5 bg-cric-accent rounded-t" />}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {slug ? (
          <ArticleDetail tournamentId={hub.id} slug={slug} basePath={basePath} />
        ) : (
          <div className={showSidebar ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8" : ""}>
            <div className="min-w-0">{TabComponent ? <TabComponent {...params} /> : null}</div>
            {showSidebar && <TournamentSidebar standings={standings} bracket={bracket} stats={stats} />}
          </div>
        )}
      </div>
    </div>
  );
}
