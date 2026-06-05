import React, { useState } from 'react';
import Commentary from './Commentary';
import PlayingXI from './PlayingXI';

const TABS = [
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'commentary', label: 'Commentary' },
  { id: 'playing-xi', label: 'Playing XI' },
];

const BqScoreboard = ({ match }) => {
  const [activeTab, setActiveTab] = useState('scorecard');

  if (!match || !match.innings || match.innings.length === 0) {
    return null;
  }

  const formatOvers = (balls) => {
    const b = balls || 0;
    const overs = Math.floor(b / 6);
    const remaining = b % 6;
    return `${overs}.${remaining}`;
  };

  const getTeamName = (team) => {
    if (!team) return 'TBD';
    return team.name || team.shortName || 'Team';
  };

  const currentInnings = match.innings[match.currentInnings] || match.innings[0];
  const isLive = match.status === 'live';

  const totalOvers = (currentInnings.balls || 0) / 6;
  const runRate = totalOvers > 0 ? (currentInnings.runs / totalOvers).toFixed(2) : '0.00';
  const target = currentInnings.target;
  const requiredRunRate = target && match.totalOvers && totalOvers < match.totalOvers
    ? ((target - currentInnings.runs) / (match.totalOvers - totalOvers)).toFixed(2)
    : null;

  const computeSummary = () => {
    const summary = { inningsSummaries: [], highestScore: null, bestBowling: null };

    match.innings?.forEach((inn) => {
      const ppOversCount = Math.min(inn.powerplayOvers || 6, 6);
      let ppRuns = 0, ppWickets = 0;
      inn.oversHistory?.slice(0, ppOversCount).forEach(over => {
        ppRuns += over.runsScored || 0;
        ppWickets += over.wickets || 0;
      });
      if (ppRuns === 0) {
        inn.oversHistory?.slice(0, ppOversCount).forEach(over => {
          over.balls?.forEach(b => { ppRuns += b.runs || 0; if (b.isWicket) ppWickets++; });
        });
      }

      summary.inningsSummaries.push({
        team: getTeamName(inn.team),
        score: `${inn.runs}/${inn.wickets}`,
        overs: formatOvers(inn.balls),
        powerplay: `${ppRuns}/${ppWickets}`,
      });

      inn.batting?.forEach(bat => {
        const name = bat.player?.name || bat.player?.fullName || 'Unknown';
        if (!summary.highestScore || bat.runs > summary.highestScore.runs) {
          summary.highestScore = { name, runs: bat.runs, balls: bat.balls, fours: bat.fours || 0, sixes: bat.sixes || 0 };
        }
      });

      inn.bowling?.forEach(bowl => {
        const name = bowl.player?.name || bowl.player?.fullName || 'Unknown';
        if (!summary.bestBowling || bowl.wickets > summary.bestBowling.wickets ||
          (bowl.wickets === summary.bestBowling.wickets && bowl.runs < summary.bestBowling.runs)) {
          const o = Math.floor((bowl.balls || 0) / 6) + ((bowl.balls || 0) % 6) / 10;
          summary.bestBowling = { name, wickets: bowl.wickets, runs: bowl.runs, overs: o.toFixed(1) };
        }
      });
    });

    return summary;
  };

  const summary = computeSummary();

  const allRecentBalls = currentInnings.oversHistory?.slice(-2).reduce((acc, over) => {
    return [...acc, ...(over.balls || [])];
  }, []).slice(-6) || [];

  const currentPartnership = currentInnings.partnerships?.length > 0
    ? currentInnings.partnerships[currentInnings.partnerships.length - 1]
    : null;

  const renderScorecard = () => (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-[#031d44] to-slate-700 dark:from-slate-900 dark:to-slate-800 text-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {isLive && (
                <span className="inline-flex items-center gap-1.5 bg-red-600 px-2.5 py-1 rounded text-xs font-bold animate-pulse">
                  <span className="w-2 h-2 bg-white rounded-full" />
                  LIVE
                </span>
              )}
              <span className="text-sm text-blue-200">{match.matchType}</span>
              {match.matchCategory && (
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{match.matchCategory}</span>
              )}
            </div>
            <span className="text-xs text-blue-300">{match.venue}</span>
          </div>

          <div className="text-center">
            <h2 className="text-lg font-bold">
              {match.teams?.[0]?.name || 'Team 1'} vs {match.teams?.[1]?.name || 'Team 2'}
            </h2>
            {match.tossWinner && (
              <p className="text-xs text-blue-200 mt-1">
                Toss: {getTeamName(match.tossWinner)} elected to {match.tossDecision}
              </p>
            )}
          </div>
        </div>

        {match.innings.length > 1 && (
          <div className="px-4 pt-3 flex gap-3">
            {match.innings.map((inn, idx) => (
              <div key={idx} className={`flex-1 text-center py-2 rounded-lg ${idx === match.currentInnings
                ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
                : 'bg-slate-50 dark:bg-slate-700'
              }`}>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">{getTeamName(inn.team)}</p>
                <p className={`text-xl font-black ${idx === match.currentInnings ? 'text-[#031d44] dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                  {inn.runs}/{inn.wickets}
                </p>
                <p className="text-xs text-slate-400">({formatOvers(inn.balls)} ov)</p>
              </div>
            ))}
          </div>
        )}

        <div className="p-4 bg-gradient-to-b from-blue-50 to-white dark:from-slate-700 dark:to-slate-800">
          <div className="text-center mb-4">
            <div className="text-5xl font-black text-[#031d44] dark:text-white mb-1">
              {currentInnings.runs}/{currentInnings.wickets}
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              {getTeamName(currentInnings.team)} &bull; {formatOvers(currentInnings.balls)} ov
              {currentInnings.target && <span className="ml-2 font-semibold">&bull; Target: {currentInnings.target}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white dark:bg-slate-600 p-3 rounded-lg text-center shadow-sm">
              <p className="text-xs text-slate-500 dark:text-slate-400">Run Rate</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{runRate}</p>
            </div>
            {requiredRunRate && (
              <div className="bg-white dark:bg-slate-600 p-3 rounded-lg text-center shadow-sm">
                <p className="text-xs text-slate-500 dark:text-slate-400">Required RR</p>
                <p className="text-xl font-bold text-red-600 dark:text-red-400">{requiredRunRate}</p>
              </div>
            )}
          </div>

          {target && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3 rounded-lg text-center mb-4">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Target: {target} &bull; Need {target - currentInnings.runs} from {Math.max(0, Math.floor((match.totalOvers || 20) * 6 - currentInnings.balls) / 6)}.{Math.max(0, Math.floor((match.totalOvers || 20) * 6 - currentInnings.balls) % 6)} overs
              </p>
            </div>
          )}

          <div className="bg-white dark:bg-slate-600 rounded-lg p-4 mb-3">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full inline-block" />
              Batting
            </h4>
            <div className="space-y-2">
              {[currentInnings.currentBatsman1, currentInnings.currentBatsman2].map((batsman, idx) => {
                if (!batsman) return null;
                const batStats = currentInnings.batting?.find(b => (b.player?._id || b.player) === (batsman._id || batsman));
                const isOnStrike = (currentInnings.onStrikeBatsman?._id || currentInnings.onStrikeBatsman) === (batsman._id || batsman);
                const sr = batStats?.balls > 0 ? ((batStats.runs / batStats.balls) * 100).toFixed(1) : '&mdash;';

                return (
                  <div key={idx} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {isOnStrike && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                      <span className="font-semibold text-sm dark:text-white">
                        {batsman.name || 'Batsman'}
                        {isOnStrike && <span className="text-green-600 dark:text-green-400 ml-0.5">*</span>}
                        {batStats?.isOut && <span className="text-red-500 ml-1 text-xs">(out)</span>}
                      </span>
                    </div>
                    <div className="text-sm font-bold dark:text-white flex items-center gap-3">
                      <span>{batStats?.runs || 0} <span className="text-slate-400 font-normal">({batStats?.balls || 0})</span></span>
                      {batStats?.fours > 0 && <span className="text-blue-600 text-xs">4s:{batStats.fours}</span>}
                      {batStats?.sixes > 0 && <span className="text-purple-600 text-xs">6s:{batStats.sixes}</span>}
                      <span className="text-slate-400 text-xs">SR:{sr}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {currentInnings.currentBowler && (
            <div className="bg-white dark:bg-slate-600 rounded-lg p-4">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full inline-block" />
                Bowling
              </h4>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm dark:text-white">
                  {currentInnings.currentBowler.name || currentInnings.currentBowler}
                </span>
                {(() => {
                  const bowlStats = currentInnings.bowling?.find(b => (b.player?._id || b.player) === (currentInnings.currentBowler._id || currentInnings.currentBowler));
                  if (!bowlStats) return null;
                  const oversFormatted = `${Math.floor(bowlStats.balls / 6)}.${bowlStats.balls % 6}`;
                  const economy = bowlStats.balls > 0 ? (bowlStats.runs / (bowlStats.balls / 6)).toFixed(1) : '0.0';
                  return (
                    <div className="text-sm dark:text-white">
                      <span className="font-bold text-red-600 dark:text-red-400">{bowlStats.wickets}/{bowlStats.runs}</span>
                      <span className="text-slate-500 dark:text-slate-400 ml-2">
                        ({oversFormatted} ov, Econ: {economy})
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {allRecentBalls.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3">Recent Balls</h4>
            <div className="flex gap-2">
              {allRecentBalls.map((ball, idx) => {
                let bgColor = 'bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-300';
                let label = '\u2022';
                if (ball.isWicket) { bgColor = 'bg-red-500 text-white'; label = 'W'; }
                else if (ball.runs === 4) { bgColor = 'bg-green-500 text-white'; label = '4'; }
                else if (ball.runs === 6) { bgColor = 'bg-emerald-600 text-white'; label = '6'; }
                else if (ball.isWide) { bgColor = 'bg-orange-400 text-white'; label = `${1 + (ball.runs || 0)}wd`; }
                else if (ball.isNoBall) { bgColor = 'bg-orange-500 text-white'; label = 'nb'; }
                else if (ball.runs > 0) { bgColor = 'bg-blue-500 text-white'; label = `${ball.runs}`; }

                return (
                  <div key={idx} className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-sm ${bgColor}`}>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {currentPartnership && currentPartnership.runs > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-blue-50/50 dark:bg-blue-900/10">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300 font-semibold">Partnership</span>
              <span className="font-bold dark:text-white">
                {currentPartnership.runs} ({currentPartnership.balls} balls)
              </span>
            </div>
          </div>
        )}

        {match.result?.description && match.status === 'completed' && (
          <div className="border-t-2 border-green-500 p-4 bg-green-50 dark:bg-green-900/20">
            <p className="text-center font-bold text-green-700 dark:text-green-300 text-lg">
              {match.result.description}
            </p>
            {match.manOfMatch && (
              <p className="text-center text-sm text-green-600 dark:text-green-400 mt-2">
                Player of the Match: <span className="font-bold">{match.manOfMatch.name || match.manOfMatch}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {match.innings.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-slate-700 to-slate-800 dark:from-slate-800 dark:to-slate-900 text-white px-5 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wider">Match Stats</h3>
          </div>
          <div className="p-4">
            <div className="flex gap-3 mb-4">
              {summary.inningsSummaries.map((inn, idx) => (
                <div key={idx} className="flex-1 text-center py-3 rounded-lg bg-slate-50 dark:bg-slate-700">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase truncate">{inn.team}</p>
                  <p className="text-2xl font-black text-[#031d44] dark:text-white">{inn.score}</p>
                  <p className="text-xs text-slate-400">({inn.overs} ov)</p>
                  {inn.powerplay && (
                    <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5 font-semibold">PP: {inn.powerplay}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {summary.highestScore && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-100 dark:border-blue-800">
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase">Highest Score</p>
                  <p className="text-base font-black text-[#031d44] dark:text-white mt-0.5">
                    {summary.highestScore.name}
                  </p>
                  <p className="text-sm font-bold text-[#031d44] dark:text-white">
                    {summary.highestScore.runs} <span className="text-slate-400 font-normal text-xs">({summary.highestScore.balls}b, {summary.highestScore.fours}x4, {summary.highestScore.sixes}x6)</span>
                  </p>
                </div>
              )}
              {summary.bestBowling && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-100 dark:border-green-800">
                  <p className="text-[10px] text-green-600 dark:text-green-400 font-bold uppercase">Best Bowling</p>
                  <p className="text-base font-black text-[#031d44] dark:text-white mt-0.5">
                    {summary.bestBowling.name}
                  </p>
                  <p className="text-sm font-bold text-[#031d44] dark:text-white">
                    {summary.bestBowling.wickets}/{summary.bestBowling.runs} <span className="text-slate-400 font-normal text-xs">({summary.bestBowling.overs} ov)</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'commentary':
        return <Commentary matchId={match._id} />;
      case 'playing-xi':
        return <PlayingXI matchId={match._id} />;
      default:
        return renderScorecard();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white rounded-xl shadow-sm border border-slate-200 p-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[#ff6b35] text-white shadow'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {renderContent()}
    </div>
  );
};

export default BqScoreboard;
