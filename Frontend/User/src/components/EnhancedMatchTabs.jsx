import React, { useMemo, useState } from "react";
import {
  PRIMARY_TABS, MORE_TABS, idOf, sameId, teamName, longTeamName, playerName,
  number, formatOvers, getMatchBanner, collectPlayers, currentInningsOf, getTeamById,
  getTarget, getRrr, getCrr, getResultLine, getTossLine, flattenCommentary
} from "../utils/matchHelpers";

import SummaryTab from "./SummaryTab";
import ScoreSummary from "./ScoreSummary";
import CurrentPlayers from "./CurrentPlayers";
import RecentBalls from "./RecentBalls";
import CommentaryPreview from "./CommentaryPreview";
import MiniInfo from "./MiniInfo";
import ScoreBreakdown from "./ScoreBreakdown";
import ScorecardTab from "./ScorecardTab";
import CommentaryTab from "./CommentaryTab";
import PlayingXITab from "./PlayingXITab";
import OversTab from "./OversTab";
import LiveStatsTab from "./LiveStatsTab";
import PartnershipsTab from "./PartnershipsTab";
import GraphsTab from "./GraphsTab";
import MatchInfoTab from "./MatchInfoTab";
import StatsTab from "./StatsTab";
import WagonWheelTab from "./WagonWheelTab";

const EnhancedMatchTabs = ({ match, matchId }) => {
  // A manually entered (paper) match has no ball-by-ball timeline, so the
  // live/commentary/overs tabs are hidden and the page opens on the scorecard.
  const isManual = match?.source === "manual";
  const visiblePrimaryTabs = isManual
    ? PRIMARY_TABS.filter((tab) => tab.id !== "live" && tab.id !== "commentary")
    : PRIMARY_TABS;
  const visibleMoreTabs = isManual
    ? MORE_TABS.filter((tab) => tab.id !== "overs" && tab.id !== "live-stats")
    : MORE_TABS;
  const availableTabs = [...visiblePrimaryTabs, ...visibleMoreTabs];

  const [activeTab, setActiveTab] = useState(isManual ? "scorecard" : "live");
  const [selectedInnings, setSelectedInnings] = useState(0);
  const [visibleOvers, setVisibleOvers] = useState(5);
  const [moreOpen, setMoreOpen] = useState(false);
  const effectiveTab = availableTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : (isManual ? "scorecard" : "live");
  const isMoreTab = visibleMoreTabs.some((tab) => tab.id === effectiveTab);

  const players = useMemo(() => collectPlayers(match), [match]);
  const currentInnings = currentInningsOf(match);
  const currentIndex = Math.min(number(match?.currentInnings), Math.max((match?.innings || []).length - 1, 0));
  const battingTeam = getTeamById(match, currentInnings?.team);
  const bowlingTeam = (match?.teams || []).find((team) => !sameId(team, currentInnings?.team));
  const target = getTarget(match);
  const rrr = getRrr(match, currentInnings);
  const selectedInningsData = match?.innings?.[selectedInnings] || currentInnings;
  const selectedBattingTeam = getTeamById(match, selectedInningsData?.team);
  const banner = getMatchBanner(match);

  if (!match) return null;

  const strikerId = idOf(currentInnings?.onStrikeBatsman || currentInnings?.currentBatsman1);
  const batterRows = currentInnings?.batting || [];
  const striker = batterRows.find((row) => sameId(row.player, strikerId));
  const partner = batterRows.find(
    (row) =>
      sameId(row.player, currentInnings?.currentBatsman1) ||
      sameId(row.player, currentInnings?.currentBatsman2)
  );
  const nonStriker = batterRows.find(
    (row) =>
      !sameId(row.player, strikerId) &&
      (sameId(row.player, currentInnings?.currentBatsman1) || sameId(row.player, currentInnings?.currentBatsman2))
  ) || (partner && !sameId(partner.player, strikerId) ? partner : null);
  const bowler = (currentInnings?.bowling || []).find((row) => sameId(row.player, currentInnings?.currentBowler));
  const recentOvers = currentInnings?.oversHistory || [];
  const commentaryOvers = flattenCommentary(currentInnings);
  const currentPartnership = (currentInnings?.partnerships || [])[(currentInnings?.partnerships || []).length - 1] || { runs: 0, balls: 0 };

  return (
    <main className="min-h-screen bg-cric-bg text-cric-text overflow-x-hidden">
      <section className="bg-cric-accent text-white shadow-sm">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-[0.16em] text-white/80">
            <span>{match.tournament?.name || match.matchType || "Live Cricket"}</span>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] sm:text-[10px] ${banner.tone}`}>
              {banner.live && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
              {banner.text}
            </span>
          </div>
          <div className="mt-3 sm:mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl lg:text-3xl font-black tracking-tight break-words leading-tight">
                {longTeamName(match.teams?.[0])} vs {longTeamName(match.teams?.[1])}
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-white/80 break-words">{match.venue || "Venue TBC"}</p>
              {getResultLine(match) && <p className="mt-1.5 text-xs sm:text-sm font-semibold text-amber-100">{getResultLine(match)}</p>}
            </div>
            <div className="match-score-card rounded-xl bg-cric-card px-4 py-3 text-cric-text shadow-lg w-full sm:w-auto sm:min-w-[140px] lg:text-right">
              <div className="text-[9px] sm:text-xs font-black uppercase text-cric-muted truncate">{longTeamName(battingTeam)}</div>
              <div className="text-2xl sm:text-3xl lg:text-4xl font-black tabular-nums leading-none mt-0.5">
                {number(currentInnings?.runs)}/{number(currentInnings?.wickets)}
              </div>
              <div className="text-xs sm:text-sm font-bold text-cric-muted mt-1">
                {formatOvers(currentInnings?.balls)} ov
                {target > 0 && <span className="ml-1.5 text-orange-600 dark:text-orange-400">T:{target}</span>}
              </div>
              {rrr && target > 0 && (
                <div className="text-[10px] font-bold text-cric-muted mt-0.5">RRR {rrr}</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <nav className="sticky top-0 z-30 border-b border-cric-border bg-cric-card/95 backdrop-blur supports-[backdrop-filter]:bg-cric-card/90">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="no-scrollbar flex flex-nowrap items-center gap-1 sm:gap-2 overflow-x-auto">
            {visiblePrimaryTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveTab(tab.id); setMoreOpen(false); }}
                className={`match-tab-btn whitespace-nowrap border-b-2 px-2.5 sm:px-3 py-3 text-[11px] sm:text-sm font-black transition shrink-0 ${
                  effectiveTab === tab.id ? "border-cric-accent text-cric-accent" : "border-transparent text-cric-muted hover:text-cric-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className={`match-tab-btn whitespace-nowrap border-b-2 px-2.5 sm:px-3 py-3 text-[11px] sm:text-sm font-black transition lg:hidden ${
                  isMoreTab || moreOpen ? "border-cric-accent text-cric-accent" : "border-transparent text-cric-muted"
                }`}
              >
                More {isMoreTab ? ` \u00b7 ${visibleMoreTabs.find((t) => t.id === effectiveTab)?.label}` : ""}
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full z-40 mt-0 min-w-[160px] rounded-xl border border-cric-border bg-cric-card py-1 shadow-lg lg:hidden">
                  {visibleMoreTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => { setActiveTab(tab.id); setMoreOpen(false); }}
                      className={`block w-full px-4 py-2.5 text-left text-xs font-bold ${effectiveTab === tab.id ? "bg-cric-accent/10 text-cric-accent" : "text-cric-text hover:bg-cric-bg"}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {visibleMoreTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`match-tab-btn hidden lg:inline-flex whitespace-nowrap border-b-2 px-2 sm:px-3 py-3 text-sm font-black transition shrink-0 ${
                  effectiveTab === tab.id ? "border-cric-accent text-cric-accent" : "border-transparent text-cric-muted hover:text-cric-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl w-full min-w-0 px-3 sm:px-6 lg:px-8 py-4 sm:py-5">
        {effectiveTab === "live" && (
          <div className="grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="space-y-3 sm:space-y-4 min-w-0">
              <div className="match-card">
              <ScoreSummary
                innings={currentInnings}
                battingTeam={battingTeam}
                bowlingTeam={bowlingTeam}
                crr={getCrr(currentInnings)}
                rrr={rrr}
                target={target}
                totalOvers={match.totalOvers}
                partnership={currentPartnership}
                striker={striker}
                nonStriker={nonStriker}
                bowler={bowler}
                strikerId={strikerId}
                players={players}
              />
              </div>
              <div className="match-card match-table-scroll">
              <CurrentPlayers
                striker={striker}
                nonStriker={nonStriker}
                bowler={bowler}
                strikerId={strikerId}
                players={players}
                innings={currentInnings}
              />
              </div>
              <div className="match-card">
              <RecentBalls overs={recentOvers} />
              </div>
              <div className="match-card">
              <CommentaryPreview overs={commentaryOvers} players={players} onSwitchTab={setActiveTab} />
              </div>
            </section>
            <aside className="space-y-3 sm:space-y-4 min-w-0">
              <div className="match-card"><MiniInfo match={match} /></div>
              <div className="match-card"><ScoreBreakdown match={match} /></div>
            </aside>
          </div>
        )}

        {effectiveTab === "scorecard" && (
          <ScorecardTab
            match={match}
            innings={selectedInningsData}
            selectedInnings={selectedInnings}
            setSelectedInnings={setSelectedInnings}
            battingTeam={selectedBattingTeam}
            players={players}
          />
        )}

        {effectiveTab === "commentary" && (
          <CommentaryTab
            overs={commentaryOvers}
            players={players}
            visibleOvers={visibleOvers}
            onLoadMore={() => setVisibleOvers((value) => value + 5)}
          />
        )}

        {effectiveTab === "playing-xi" && <PlayingXITab match={match} players={players} />}

        {effectiveTab === "overs" && <OversTab matchId={matchId || match?._id} />}

        {effectiveTab === "live-stats" && <LiveStatsTab matchId={matchId || match?._id} />}

        {effectiveTab === "summary" && <SummaryTab match={match} allPlayers={players} />}

        {effectiveTab === "partnerships" && (
          <PartnershipsTab match={match} innings={currentInnings} players={players} />
        )}

        {effectiveTab === "graphs" && (
          <GraphsTab match={match} matchId={matchId} innings={currentInnings} />
        )}

        {effectiveTab === "info" && <MatchInfoTab match={match} />}

        {effectiveTab === "stats" && <StatsTab match={match} players={players} />}

        {effectiveTab === "wagon" && <WagonWheelTab match={match} players={players} />}
      </div>
    </main>
  );
};

export default EnhancedMatchTabs;
