import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import Commentary from "./Commentary";
import LiveStats from "./LiveStats";
import Overs from "./Overs";
import PlayingXI from "./PlayingXI";
import PointsTable from "../pages/PointsTable";
import Scoreboard from "./Scoreboard";
import BlogGallery from "./BlogGallery";
import InningsDashboard from "./InningsDashboard";
import OverTimeline from "./OverTimeline";

/**
 * Tabs now sync with URL hash. Clicking a tab sets the hash (e.g. #scorecard)
 * and the component reads the hash to set active tab. Using anchors also
 * allows direct linking / copy-paste of a specific tab.
 * 
 * Live tab is hidden when match is completed - redirects to Scorecard
 */

const TABS = [
  { key: "live", label: "Live" },
  { key: "scorecard", label: "Scorecard" },
  { key: "commentary", label: "Commentary" },
  { key: "livestats", label: "Live Stats" },
  { key: "overs", label: "Overs" },
  { key: "playingxi", label: "Playing XI" },
  { key: "table", label: "Table" },
];

export default function MatchTabs({ matchId, match }) {
  const location = useLocation();
  const navigate = useNavigate();

  const team1 = match?.teams?.[0];
  const team2 = match?.teams?.[1];
  const innings1 = match?.innings?.[0];
  const innings2 = match?.innings?.[1];

  const isMatchCompleted = match?.status === 'completed';

  // Filter tabs based on match status - hide Live tab when match is completed
  const availableTabs = isMatchCompleted
    ? TABS.filter(t => t.key !== 'live')
    : TABS;

  const initialFromHash = (location.hash && location.hash.slice(1)) || "live";
  const [tab, setTab] = useState(
    availableTabs.find((t) => t.key === initialFromHash) ? initialFromHash : availableTabs[0]?.key || "live"
  );

  // Redirect to scorecard if trying to access live tab on completed match
  useEffect(() => {
    if (isMatchCompleted && (location.hash === '#live' || location.hash === '')) {
      navigate(`${location.pathname}#scorecard`, { replace: true });
    }
  }, [isMatchCompleted, location.hash, location.pathname, navigate]);

  useEffect(() => {
    const h = (location.hash && location.hash.slice(1)) || "live";
    if (h && h !== tab && availableTabs.find((t) => t.key === h)) {
      setTab(h);
    }
  }, [location.hash, availableTabs, tab]);

  const onSelect = (key) => {
    setTab(key);
    const base = location.pathname + (location.search || "");
    navigate(`${base}#${key}`, { replace: false });
  };

  return (
    <div className="bg-cric-bg min-h-screen">
      {/* Match Header - Premium Style */}
      <div className="bg-cric-accent text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-blue-300/80">
          <div className="flex items-center gap-4">
            {match?.tournament ? (
              <Link to={`/series/${match.tournament._id || match.tournament}`} className="hover:text-white transition-colors underline">{match.tournament.name}</Link>
            ) : (
              <span>Cricket Series</span>
            )}
            <span>•</span>
            <span>{match?.matchType}</span>
            <span>•</span>
            <span>{match?.venue}</span>
          </div>
          <div className="hidden md:block">
            {new Date(match?.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="flex items-center gap-12 flex-1">
              {/* Team 1 */}
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center p-3 backdrop-blur-sm border border-white/20">
                  {team1?.logo ? (
                    <img src={team1.logo} alt={team1.name} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-2xl uppercase border-2 border-white/30">
                      {team1?.name?.charAt(0)}
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight mb-1">{team1?.shortName || team1?.name}</h2>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black">{innings1?.runs || 0}/{innings1?.wickets || 0}</span>
                    <span className="text-sm text-blue-300/80 font-bold uppercase">({innings1?.overs || 0}.{(innings1?.balls || 0) % 6})</span>
                  </div>
                </div>
              </div>

              <div className="h-16 w-px bg-white/10 hidden md:block" />

              {/* Team 2 */}
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center p-3 backdrop-blur-sm border border-white/20">
                  {team2?.logo ? (
                    <img src={team2.logo} alt={team2.name} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full bg-red-600 rounded-full flex items-center justify-center text-white font-black text-2xl uppercase border-2 border-white/30">
                      {team2?.name?.charAt(0)}
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight mb-1">{team2?.shortName || team2?.name}</h2>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black">{innings2?.runs || 0}/{innings2?.wickets || 0}</span>
                    <span className="text-sm text-blue-300/80 font-bold uppercase">({innings2?.overs || 0}.{(innings2?.balls || 0) % 6})</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:items-end gap-3">
              {/* Toss Display */}
              {match?.tossWinner && (
                <div className="bg-white/10 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20 mb-2">
                  <p className="text-xs font-bold text-blue-200 uppercase tracking-widest">
                    Toss: {match.tossWinner.name} elected to {match.tossDecision === 'bat' ? 'bat' : 'bowl'} first
                  </p>
                </div>
              )}
              <span className={`px-4 py-1.5 rounded-full text-xs font-black tracking-widest ${match?.status === "live" ? "bg-red-600 text-white animate-pulse" : "bg-white/20 text-white"
                }`}>
                {match?.status?.replace(/_/g, " ").toUpperCase()}
              </span>
              {match?.result?.description && (
                <p className="text-lg font-black text-blue-300 italic max-w-xs md:text-right">
                  {match.result.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Tab Bar */}
        <div className="bg-white/5 backdrop-blur-md border-t border-white/10 overflow-x-auto no-scrollbar">
          <div className="max-w-7xl mx-auto px-4 flex">
            {availableTabs.map((t) => {
              const isActive = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => onSelect(t.key)}
                  className={`px-6 py-4 text-xs font-black uppercase tracking-widest transition-all relative shrink-0 ${isActive ? "text-white" : "text-blue-200/50 hover:text-white"
                    }`}
                >
                  {t.label}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-red-600 rounded-t" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Content Area */}
          <div className="lg:col-span-2 space-y-8">
            {tab === "live" && availableTabs.find(t => t.key === 'live') && (
              <>
                <div className="bg-cric-card rounded-[2rem] shadow-xl overflow-hidden border border-cric-border">
                  <InningsDashboard innings={match?.currentInnings === 0 ? innings1 : innings2} match={match} />
                </div>
                <OverTimeline innings={match?.currentInnings === 0 ? innings1 : innings2} />
                <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
                  <h3 className="text-xl font-black text-cric-accent mb-6 uppercase tracking-tight flex items-center gap-2">
                    <div className="w-2 h-8 bg-red-600 rounded-full" />
                    Commentary
                  </h3>
                  <Commentary matchId={matchId} />
                </div>
              </>
            )}

            {tab === "scorecard" && (
              <div className="bg-cric-card rounded-2xl shadow-xl overflow-hidden border border-cric-border">
                <Scoreboard matchId={matchId} />
              </div>
            )}

            {tab === "commentary" && (
              <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
                <Commentary matchId={matchId} />
              </div>
            )}

            {tab === "livestats" && <LiveStats matchId={matchId} />}
            {tab === "overs" && <Overs matchId={matchId} />}
            {tab === "playingxi" && <PlayingXI matchId={matchId} />}

            {tab === "table" && (
              <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
                {match?.tournament && (
                  <PointsTable tournamentId={match.tournament._id || match.tournament} isKnockout={match.tournament?.type === "knockout"} />
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-8">
            <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
              <h3 className="text-lg font-black text-cric-accent mb-4 uppercase tracking-tight">Match Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-cric-muted block mb-1">Toss</label>
                  <p className="text-sm font-bold text-cric-text">
                    {match?.tossWinner ? "Winner: " + (match.tossWinner === team1?._id ? team1?.name : team2?.name) : "TBD"}
                  </p>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-cric-muted block mb-1">Series</label>
                  <p className="text-sm font-bold text-cric-accent">{match?.tournament?.name || "Independent Match"}</p>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-cric-muted block mb-1">Season</label>
                  <p className="text-sm font-bold text-cric-text">2024/25</p>
                </div>
              </div>
            </div>

            <div className="bg-cric-card rounded-2xl shadow-xl p-6 border border-cric-border">
              <h3 className="text-lg font-black text-cric-accent mb-4 uppercase tracking-tight">Playing XI Preview</h3>
              <PlayingXI matchId={matchId} compact />
            </div>
          </div>
        </div>

        {/* User Side Blog Gallery */}
        <div className="mt-16">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-black text-cric-accent uppercase tracking-tighter italic">
              Related Live Highlights
            </h2>
            <div className="h-0.5 flex-1 bg-cric-border mx-8" />
          </div>
          <BlogGallery category="Match" relatedId={matchId} />
        </div>
      </div>
    </div>
  );
}