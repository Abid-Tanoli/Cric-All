import React, { useMemo, useState, Fragment } from 'react';
import WagonWheel from './WagonWheel';

// BQ-PLAY detailed scorecard
// Full batting/bowling tables, extras, fall of wickets, yet to bat, match summary

const DetailedScorecard = ({ match }) => {
  const [selectedPlayerForWheel, setSelectedPlayerForWheel] = useState(null);

  if (!match || !match.innings || match.innings.length === 0) {
    return <div className="text-center py-10 text-slate-500">No innings data available.</div>;
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

  // Compute match summary stats
  const matchSummary = useMemo(() => {
    const summary = {
      inningsSummaries: [],
      highestScore: null,
      bestBowling: null,
    };

    match.innings?.forEach((inn, idx) => {
      // Powerplay info
      const ppRuns = inn.oversHistory?.slice(0, Math.floor((inn.powerplayOvers || 6) * 6))
        .reduce((sum, over) => sum + (over.runsScored || over.balls?.reduce((bSum, b) => bSum + (b.runs || 0), 0) || 0), 0) || null;
      const ppWickets = inn.oversHistory?.slice(0, Math.floor((inn.powerplayOvers || 6) * 6))
        .reduce((sum, over) => sum + (over.wickets || over.balls?.filter(b => b.isWicket).length || 0), 0) || null;

      summary.inningsSummaries.push({
        team: getTeamName(inn.team),
        score: `${inn.runs}/${inn.wickets}`,
        overs: formatOvers(inn.balls),
        powerplay: (ppRuns !== null && ppWickets !== null) ? `${ppRuns}/${ppWickets}` : null,
      });

      // Highest batting score
      inn.batting?.forEach((bat) => {
        const name = bat.player?.name || bat.player?.fullName || 'Unknown';
        if (!summary.highestScore || bat.runs > summary.highestScore.runs) {
          summary.highestScore = { name, runs: bat.runs, balls: bat.balls, fours: bat.fours, sixes: bat.sixes };
        }
      });

      // Best bowling figures
      inn.bowling?.forEach((bowl) => {
        const name = bowl.player?.name || bowl.player?.fullName || 'Unknown';
        if (!summary.bestBowling || bowl.wickets > summary.bestBowling.wickets || (bowl.wickets === summary.bestBowling.wickets && bowl.runs < summary.bestBowling.runs)) {
          summary.bestBowling = { name, wickets: bowl.wickets, runs: bowl.runs, overs: formatOvers(bowl.balls) };
        }
      });
    });

    return summary;
  }, [match]);

  // Get playing XI players who haven't batted yet
  const getYetToBat = (innings, inningsIdx) => {
    const teamId = innings.team?._id || innings.team;
    const playingXIEntry = match.playingXI?.find(px => {
      const pxTeam = px.team?._id || px.team;
      return pxTeam === teamId;
    });

    if (!playingXIEntry || !playingXIEntry.players) return [];

    const battedPlayerIds = new Set((innings.batting || []).map(b => {
      const p = b.player;
      return p?._id || p;
    }));

    return playingXIEntry.players.filter(pId => {
      const id = pId?._id || pId;
      return !battedPlayerIds.has(id);
    }).map(pId => {
      if (typeof pId === 'object') return pId;
      // Try to find player name from team
      const team = match.teams?.find(t => (t._id || t) === teamId);
      return team?.players?.find(p => (p._id || p) === pId) || { _id: pId, name: 'Player' };
    });
  };

  // Get did not bat players
  const getDidNotBat = (innings) => {
    if (innings.wickets < 10 && !(innings.declared || innings.status === 'completed')) return [];
    return getYetToBat(innings);
  };

  const getDismissalText = (bat) => {
    if (!bat.isOut && bat.status !== 'out') return null;

    const dismissalType = bat.dismissalType || bat.wicketType || '';
    const bowler = bat.dismissedBy?.name || bat.bowler?.name || '';
    const fielder = bat.fielder?.name || '';

    if (!dismissalType) return 'not out';

    switch (dismissalType.toLowerCase()) {
      case 'bowled':
        return `b ${bowler}`;
      case 'caught':
        return fielder ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`;
      case 'lbw':
        return `lbw b ${bowler}`;
      case 'run out':
        return fielder ? `run out (${fielder})` : 'run out';
      case 'stumped':
        return fielder ? `st ${fielder} b ${bowler}` : `st † b ${bowler}`;
      case 'hit wicket':
        return `hit wicket b ${bowler}`;
      default:
        if (bowler) return `${dismissalType} b ${bowler}`;
        return dismissalType;
    }
  };

  const getBattingStatus = (bat) => {
    if (bat.isOut || bat.status === 'out') return 'out';
    if (bat.status === 'not_out') return 'not_out';
    if (bat.status === 'yet_to_bat') return 'yet_to_bat';
    if (bat.status === 'did_not_bat') return 'did_not_bat';
    // Default: if not marked as out, treat as not out or yet to bat
    return !bat.isOut ? 'not_out' : 'out';
  };

  return (
    <div className="space-y-6">
      {/* Match Summary Card */}
      {match.summary && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-[#031d44] to-slate-800 text-white px-6 py-4">
            <h3 className="text-lg font-bold">Match Summary</h3>
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            {matchSummary.inningsSummaries.map((inn, idx) => (
              <div key={idx} className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">{inn.team}</p>
                <p className="text-2xl font-black text-[#031d44] dark:text-white">{inn.score}</p>
                <p className="text-xs text-slate-400">({inn.overs} ov)</p>
                {inn.powerplay && (
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 font-semibold">PP: {inn.powerplay}</p>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 px-4 pb-4">
            {matchSummary.highestScore && (
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-100 dark:border-blue-800">
                <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase">Highest Score</p>
                <p className="text-lg font-black text-[#031d44] dark:text-white">
                  {matchSummary.highestScore.name} {matchSummary.highestScore.runs}
                </p>
                <p className="text-xs text-slate-400">
                  ({matchSummary.highestScore.balls}b, {matchSummary.highestScore.fours || 0}x4, {matchSummary.highestScore.sixes || 0}x6)
                </p>
              </div>
            )}
            {matchSummary.bestBowling && (
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-100 dark:border-green-800">
                <p className="text-xs text-green-600 dark:text-green-400 font-semibold uppercase">Best Bowling</p>
                <p className="text-lg font-black text-[#031d44] dark:text-white">
                  {matchSummary.bestBowling.name} {matchSummary.bestBowling.wickets}/{matchSummary.bestBowling.runs}
                </p>
                <p className="text-xs text-slate-400">({matchSummary.bestBowling.overs} ov)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Innings */}
      {match.innings.map((innings, inningsIdx) => {
        if (!innings.team) return null;

        const runRate = innings.balls > 0 ? ((innings.runs / innings.balls) * 6).toFixed(2) : '0.00';
        const yetToBat = getYetToBat(innings, inningsIdx);
        const didNotBat = getDidNotBat(innings);
        const isAllOut = innings.wickets >= 10 || innings.declared;

        return (
          <div key={inningsIdx} className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
            {/* Innings Header */}
            <div className="bg-gradient-to-r from-[#031d44] to-slate-700 dark:from-slate-900 dark:to-slate-800 text-white px-6 py-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h3 className="text-lg font-bold">
                    {getTeamName(innings.team)} Innings
                  </h3>
                  <p className="text-sm text-blue-200">
                    {inningsIdx === 0 ? '1st' : inningsIdx === 1 ? '2nd' : inningsIdx === 2 ? '3rd' : `${inningsIdx + 1}th`} Innings
                    {innings.declared && ' (Declared)'}
                    {innings.status === 'innings-break' && ' • Innings Break'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black">{innings.runs}/{innings.wickets}</div>
                  <div className="text-sm text-blue-200">
                    ({formatOvers(innings.balls)} ov, RR: {runRate})
                    {innings.target && ` • Target: ${innings.target}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Batting Table */}
            {innings.batting && innings.batting.length > 0 && (
              <div className="px-4 py-5">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="w-3 h-3 bg-blue-600 rounded-full inline-block"></span>
                  Batting
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                        <th className="text-left py-2.5 pr-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Batter</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">R</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">B</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">4s</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">6s</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">Chart</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-14">SR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {innings.batting.map((bat, idx) => {
                        const playerName = bat.player?.name || bat.player?.fullName || 'Unknown';
                        const playerId = bat.player?._id || bat.player;
                        const status = getBattingStatus(bat);
                        const dismissal = getDismissalText(bat);
                        const sr = bat.balls > 0 ? ((bat.runs / bat.balls) * 100).toFixed(1) : bat.runs > 0 ? '—' : '0.0';
                        const isNotOut = status === 'not_out';

                        return (
                          <Fragment key={idx}>
                            <tr className="hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors">
                              <td className="py-2.5 pr-3">
                                <div className="flex items-center gap-1.5">
                                  {isNotOut && (
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0 animate-pulse"></span>
                                  )}
                                  <a
                                    href={`/players/${playerId}`}
                                    className={`font-semibold hover:text-blue-600 hover:underline transition-colors ${isNotOut ? 'text-[#031d44] dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}
                                    onClick={(e) => e.preventDefault()}
                                  >
                                    {playerName}
                                    {isNotOut && <span className="text-green-600 dark:text-green-400 ml-0.5 font-bold">*</span>}
                                  </a>
                                </div>
                                {dismissal && status === 'out' && (
                                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 ml-3">
                                    {dismissal}
                                  </div>
                                )}
                                {status === 'yet_to_bat' && (
                                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 ml-3 italic">yet to bat</div>
                                )}
                              </td>
                              <td className="text-center py-2.5 px-2 font-bold text-slate-900 dark:text-white">{bat.runs}</td>
                              <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{bat.balls || '—'}</td>
                              <td className="text-center py-2.5 px-2 text-blue-600 dark:text-blue-400 font-medium">{bat.fours || 0}</td>
                              <td className="text-center py-2.5 px-2 text-purple-600 dark:text-purple-400 font-medium">{bat.sixes || 0}</td>
                              <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">
                                <button 
                                  onClick={() => setSelectedPlayerForWheel(selectedPlayerForWheel === playerId ? null : playerId)}
                                  className={`p-1.5 rounded-lg transition-all ${selectedPlayerForWheel === playerId ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-blue-50 hover:text-blue-600'}`}
                                  title="View Wagon Wheel"
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/>
                                  </svg>
                                </button>
                              </td>
                              <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{sr}</td>
                            </tr>
                            {selectedPlayerForWheel === playerId && (
                              <tr className="bg-slate-50/50 dark:bg-slate-900/20">
                                <td colSpan="8" className="p-4 sm:p-8 animate-in fade-in slide-in-from-top-4 duration-500">
                                  <div className="max-w-4xl mx-auto">
                                    <WagonWheel 
                                      shots={bat.shots || []} 
                                      playerName={playerName} 
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Extras */}
                {innings.extras && (innings.extras.total > 0 || innings.extras.wides > 0 || innings.extras.noBalls > 0 || innings.extras.byes > 0 || innings.extras.legByes > 0) && (
                  <div className="mt-4 bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Extras</span>
                      <span className="font-bold text-[#031d44] dark:text-white text-lg">{innings.extras.total || 0}</span>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                        {innings.extras.byes > 0 && <span>Byes <b className="text-slate-700 dark:text-slate-300">{innings.extras.byes}</b></span>}
                        {innings.extras.legByes > 0 && <span>Leg Byes <b className="text-slate-700 dark:text-slate-300">{innings.extras.legByes}</b></span>}
                        {innings.extras.noBalls > 0 && <span>No Balls <b className="text-slate-700 dark:text-slate-300">{innings.extras.noBalls}</b></span>}
                        {innings.extras.wides > 0 && <span>Wides <b className="text-slate-700 dark:text-slate-300">{innings.extras.wides}</b></span>}
                        {innings.extras.penalties > 0 && <span>Penalties <b className="text-slate-700 dark:text-slate-300">{innings.extras.penalties}</b></span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Total */}
                <div className="mt-3 text-sm font-bold text-slate-800 dark:text-white border-t border-slate-200 dark:border-slate-700 pt-3">
                  Total: {innings.runs}/{innings.wickets} ({formatOvers(innings.balls)} ov{innings.wickets === 10 ? ', all out' : innings.declared ? ', declared' : ''})
                </div>
              </div>
            )}

            {/* Fall of Wickets */}
            {innings.fallOfWickets && innings.fallOfWickets.length > 0 && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-4 bg-slate-50/70 dark:bg-slate-700/50">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Fall of Wickets</h4>
                <div className="flex flex-wrap gap-2">
                  {innings.fallOfWickets.map((fow, idx) => {
                    const playerName = fow.player?.name || fow.playerName || '';
                    const oversStr = fow.overs ? formatOvers(fow.overs * 6 || 0) : '';
                    return (
                      <div key={idx} className="bg-white dark:bg-slate-600 px-3 py-2 rounded-lg text-xs shadow-sm border border-slate-100 dark:border-slate-500">
                        <span className="font-bold text-[#031d44] dark:text-white">{fow.wickets}/{fow.runs}</span>
                        {playerName && (
                          <span className="text-slate-500 dark:text-slate-400 ml-1">
                            ({playerName}{oversStr ? `, ${oversStr} ov` : ''})
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bowling Table */}
            {innings.bowling && innings.bowling.length > 0 && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-5">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="w-3 h-3 bg-red-500 rounded-full inline-block"></span>
                  Bowling
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                        <th className="text-left py-2.5 pr-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Bowler</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-12">O</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">M</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">R</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">W</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">0s</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">WD</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10">NB</th>
                        <th className="text-center py-2.5 px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-14">ECON</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {innings.bowling.map((bowl, idx) => {
                        const bowlerName = bowl.player?.name || bowl.player?.fullName || 'Unknown';
                        const bowlerId = bowl.player?._id || bowl.player;
                        const oversWhole = Math.floor((bowl.balls || 0) / 6);
                        const oversFraction = (bowl.balls || 0) % 6;
                        const oversStr = `${oversWhole}.${oversFraction}`;
                        const actualOvers = (bowl.balls || 0) / 6;
                        const economy = actualOvers > 0 ? (bowl.runs / actualOvers).toFixed(2) : '0.00';

                        return (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors">
                            <td className="py-2.5 pr-3">
                              <a
                                href={`/players/${bowlerId}`}
                                className="font-semibold text-slate-800 dark:text-white hover:text-blue-600 hover:underline transition-colors"
                                onClick={(e) => e.preventDefault()}
                              >
                                {bowlerName}
                              </a>
                            </td>
                            <td className="text-center py-2.5 px-2 text-slate-600 dark:text-slate-300">{oversStr}</td>
                            <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{bowl.maidens || 0}</td>
                            <td className="text-center py-2.5 px-2 text-slate-600 dark:text-slate-300">{bowl.runs}</td>
                            <td className="text-center py-2.5 px-2 font-bold text-red-600 dark:text-red-400">{bowl.wickets}</td>
                            <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{bowl.dotBalls || 0}</td>
                            <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{bowl.wides || 0}</td>
                            <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{bowl.noBalls || 0}</td>
                            <td className="text-center py-2.5 px-2 text-slate-500 dark:text-slate-400">{economy}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Yet to Bat */}
            {yetToBat && yetToBat.length > 0 && !isAllOut && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-4 bg-slate-50/70 dark:bg-slate-700/50">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="text-base">🚫</span>
                  Yet to Bat
                </h4>
                <div className="flex flex-wrap gap-2">
                  {yetToBat.map((player, idx) => {
                    const name = player?.name || player?.fullName || 'Player';
                    const playerId = player?._id || player;
                    return (
                      <a
                        key={idx}
                        href={`/players/${playerId}`}
                        className="bg-white dark:bg-slate-600 px-3 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-500 hover:border-blue-300 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        onClick={(e) => e.preventDefault()}
                      >
                        {name}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Did Not Bat */}
            {didNotBat && didNotBat.length > 0 && isAllOut && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-4 bg-slate-50/70 dark:bg-slate-700/50">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Did Not Bat</h4>
                <div className="flex flex-wrap gap-2">
                  {didNotBat.map((player, idx) => (
                    <span key={idx} className="bg-white dark:bg-slate-600 px-3 py-1.5 rounded-lg text-xs text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-500">
                      {player?.name || player?.fullName || 'Player'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Partnership (for live innings) */}
            {innings.partnerships && innings.partnerships.length > 0 && match.status === 'live' && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-4 bg-blue-50/50 dark:bg-blue-900/10">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Current Partnership</h4>
                {(() => {
                  const current = innings.partnerships[innings.partnerships.length - 1];
                  const b1 = innings.batting?.find(b => (b.player?._id || b.player) === (current.batsman1?._id || current.batsman1));
                  const b2 = innings.batting?.find(b => (b.player?._id || b.player) === (current.batsman2?._id || current.batsman2));
                  return (
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="font-bold text-[#031d44] dark:text-white">
                        {current.runs} runs ({current.balls} balls)
                      </span>
                      {b1 && <span className="text-slate-500 dark:text-slate-400">{b1.player?.name}: {b1.runs} ({b1.balls}b)</span>}
                      {b2 && <span className="text-slate-500 dark:text-slate-400">{b2.player?.name}: {b2.runs} ({b2.balls}b)</span>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      {/* Match Result */}
      {match.result?.description && match.status === 'completed' && (
        <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-700 rounded-xl p-6 text-center">
          <p className="text-xs text-green-600 dark:text-green-400 font-semibold uppercase tracking-widest mb-2">Result</p>
          <p className="text-xl font-black text-green-700 dark:text-green-300">
            {match.result.description}
          </p>
          {match.manOfMatch && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-3">
              Player of the Match: <span className="font-bold">{match.manOfMatch.name || match.manOfMatch}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default DetailedScorecard;
