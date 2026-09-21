import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  FaChartLine,
  FaImages,
  FaListUl,
  FaNewspaper,
  FaPlay,
  FaRegClock,
  FaTable,
  FaUsers,
} from 'react-icons/fa';
import { api } from '../services/api';
import { getSocket, initSocket } from '../services/socket';

const asArray = (value) => Array.isArray(value) ? value : [];

const scoreTeam = (score = {}) => score.inning?.split(' Inning')[0] || score.team || score.teamName || 'Innings';
const scoreRuns = (score = {}) => score.r ?? score.runs ?? '';
const scoreWickets = (score = {}) => score.w ?? score.wickets ?? '';
const scoreOvers = (score = {}) => score.o ?? score.overs ?? '';

const playerName = (entry = {}, key) =>
  entry[key]?.name || entry[key]?.fullName || entry.name || entry.player?.name || entry.batName || entry.bowlName || '-';

const getInnings = (scorecard = {}) =>
  asArray(scorecard.innings || scorecard.scorecard || scorecard.score);

const getBatting = (innings = {}) =>
  asArray(innings.batting || innings.batters || innings.batsmen || innings.batsman);

const getBowling = (innings = {}) =>
  asArray(innings.bowling || innings.bowlers || innings.bowler);

const getScoreLine = (score = {}) => {
  if (score.chaseText) return score.chaseText;
  const runs = scoreRuns(score);
  const wickets = scoreWickets(score);
  const overs = scoreOvers(score);
  if (runs === '' && wickets === '' && overs === '') return 'Yet to bat';
  const wicketText = wickets === '' || wickets === null || wickets === undefined ? '' : `/${wickets}`;
  const overText = overs ? ` (${overs} ov)` : '';
  return `${runs}${wicketText}${overText}`;
};

const formatDate = (value) => {
  if (!value) return 'Date TBD';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const stateLabel = (match = {}) => {
  const state = String(match.ms || match.state || '').toLowerCase();
  if (state === 'live') return 'LIVE';
  if (state === 'result') return 'RESULT';
  return 'UPCOMING';
};

const stateClass = (match = {}) => {
  const state = String(match.ms || match.state || '').toLowerCase();
  if (state === 'live') return 'bg-red-600 text-white';
  if (state === 'result') return 'bg-emerald-100 text-emerald-800';
  return 'bg-blue-100 text-blue-800';
};

const normalizeImage = (value) => value || '';

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-lg border border-dashed border-cric-border bg-cric-card px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-base font-black text-cric-accent dark:text-white">{title}</p>
      {detail && <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-6 text-cric-muted">{detail}</p>}
    </div>
  );
}

function ApiWarning({ status }) {
  if (!status?.lastError && status?.configured !== false) return null;

  const provider = status?.configured ? 'CricAll live data provider' : 'Live data provider';
  const detail = status?.lastError
    || 'Cricket API is not configured. Real live data will appear after adding a working provider.';

  return (
    <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
      {provider} issue: {detail}
    </div>
  );
}

function ScoreStrip({ scores, teams }) {
  const scoreRows = scores.length
    ? scores
    : asArray(teams).map(team => ({ inning: team.name || team, team: team.shortname || team.shortName || team, empty: true }));

  if (!scoreRows.length) {
    return <EmptyState title="No score from original API yet" detail="The screen is ready, but the provider did not return score data for this match." />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {scoreRows.map((score, index) => (
        <div key={`${scoreTeam(score)}-${index}`} className="rounded-lg border border-cric-border bg-cric-card p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-cric-muted">Team</p>
              <h3 className="mt-1 text-lg font-black text-cric-accent dark:text-white">{scoreTeam(score)}</h3>
            </div>
            <p className="text-right text-2xl font-black text-cric-accent dark:text-white">{getScoreLine(score)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function InternationalMatchDetail() {
  const { matchId } = useParams();
  const [activeTab, setActiveTab] = useState('live');
  const [center, setCenter] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const matchData = center?.match || center?.scorecard || {};
  const scorecard = center?.scorecard || {};
  const commentary = asArray(center?.commentary);
  const overs = asArray(center?.overs);
  const playingXI = asArray(center?.playingXI);
  const photos = asArray(center?.photos);
  const news = asArray(center?.news);
  const videos = asArray(center?.videos);
  const stats = center?.stats || {};
  const liveScore = center?.liveScore || scorecard.liveScore || {};
  const scores = asArray(scorecard.score || matchData.score);
  const innings = useMemo(() => getInnings(scorecard), [scorecard]);
  const teams = asArray(matchData.teamInfo).length ? asArray(matchData.teamInfo) : asArray(matchData.teams);
  const latestComment = commentary[0];

  useEffect(() => {
    fetchData();
    const cleanupSocket = setupSocket();
    return cleanupSocket;
  }, [matchId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [centerRes, statusRes] = await Promise.all([
        api.get(`/international/match/${matchId}/center`).catch(() => ({ data: { data: null } })),
        api.get('/international/status').catch(() => ({ data: { data: null } })),
      ]);
      const nextCenter = centerRes.data.data || null;
      setCenter(nextCenter);
      setApiStatus(nextCenter?.apiStatus || statusRes.data.data || null);
    } catch (error) {
      console.error('Match centre error:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupSocket = () => {
    const socket = getSocket() || initSocket();
    const handleUpdate = ({ matchId: updatedId, score, status, scorecard: nextScorecard }) => {
      if (String(updatedId) !== String(matchId)) return;
      setCenter(previous => ({
        ...(previous || {}),
        match: { ...((previous || {}).match || {}), score, status },
        scorecard: nextScorecard || (previous || {}).scorecard,
      }));
    };

    socket.emit("join-match", matchId);
    socket.on('INTERNATIONAL_MATCH_UPDATE', handleUpdate);
    return () => {
      socket.emit("leave-match", matchId);
      socket.off('INTERNATIONAL_MATCH_UPDATE', handleUpdate);
    };
  };

  const tabs = [
    { id: 'live', label: 'Live', icon: FaRegClock },
    { id: 'scorecard', label: 'Scorecard', icon: FaTable },
    { id: 'commentary', label: 'Commentary', icon: FaListUl },
    { id: 'stats', label: 'Live Stats', icon: FaChartLine },
    { id: 'overs', label: 'Overs', icon: FaListUl },
    { id: 'playing-xi', label: 'Playing XI', icon: FaUsers },
    { id: 'photos', label: 'Photos', icon: FaImages },
    { id: 'news', label: 'News', icon: FaNewspaper },
    { id: 'videos', label: 'Videos', icon: FaPlay },
  ];

  const renderLive = () => (
    <div className="space-y-5">
      <ScoreStrip scores={scores} teams={teams} />

      <section className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="text-[11px] font-black uppercase tracking-widest text-cric-muted">Match Status</p>
        <h2 className="mt-2 text-xl font-black text-cric-accent dark:text-white">
          {matchData.status || stats.status || liveScore.status || 'Live status will appear from the original API'}
        </h2>
        {liveScore.runRate && <p className="mt-2 text-sm font-black text-cric-accent">Run Rate: {liveScore.runRate}</p>}
        <p className="mt-2 text-sm font-semibold text-cric-muted">
          {matchData.venue || 'Venue TBD'} {matchData.dateTimeGMT || matchData.date ? `- ${formatDate(matchData.dateTimeGMT || matchData.date)}` : ''}
        </p>
      </section>

      {(asArray(liveScore.batsmen).length > 0 || asArray(liveScore.bowlers).length > 0) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {asArray(liveScore.batsmen).length > 0 && (
            <section className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="mb-4 text-lg font-black text-cric-accent dark:text-white">Current Batting</h2>
              {asArray(liveScore.batsmen).map((batter, index) => (
                <div key={`${batter.name}-${index}`} className="flex items-center justify-between border-b border-cric-border py-3 last:border-0 dark:border-slate-800">
                  <div>
                    <p className="font-black text-cric-text dark:text-slate-100">{batter.name}{batter.isStriker ? ' *' : ''}</p>
                    <p className="text-xs font-bold text-cric-muted">SR {batter.sr || '-'}</p>
                  </div>
                  <p className="text-xl font-black text-cric-accent dark:text-white">{batter.runs}<span className="text-sm text-cric-muted"> ({batter.balls})</span></p>
                </div>
              ))}
            </section>
          )}

          {asArray(liveScore.bowlers).length > 0 && (
            <section className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="mb-4 text-lg font-black text-cric-accent dark:text-white">Current Bowling</h2>
              {asArray(liveScore.bowlers).map((bowler, index) => (
                <div key={`${bowler.name}-${index}`} className="flex items-center justify-between border-b border-cric-border py-3 last:border-0 dark:border-slate-800">
                  <div>
                    <p className="font-black text-cric-text dark:text-slate-100">{bowler.name}</p>
                    <p className="text-xs font-bold text-cric-muted">{bowler.overs} ov, eco {bowler.economy || '-'}</p>
                  </div>
                  <p className="text-xl font-black text-cric-accent dark:text-white">{bowler.wickets}<span className="text-sm text-cric-muted">/{bowler.runs}</span></p>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {latestComment ? (
        <section className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-cric-muted">Latest Ball</p>
            {latestComment.over && <span className="rounded-full bg-cric-accent px-3 py-1 text-xs font-black text-white">{latestComment.over}</span>}
          </div>
          <p className="text-base font-bold leading-7 text-cric-text dark:text-slate-200">{latestComment.text}</p>
        </section>
      ) : (
        <EmptyState title="Ball-by-ball live feed not available yet" detail="The current live provider gives score updates when available. Full commentary needs a richer live-data plan." />
      )}
    </div>
  );

  const renderScorecard = () => {
    if (innings.length === 0) {
      return <EmptyState title="Scorecard not available from original API" detail={apiStatus?.lastError || 'The match may not have started, or your current plan does not include scorecard access.'} />;
    }

    return (
      <div className="space-y-5">
        {innings.map((inningsData, index) => {
          const batting = getBatting(inningsData);
          const bowling = getBowling(inningsData);
          return (
            <section key={`${inningsData.inning || index}`} className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-cric-muted">Innings</p>
                  <h2 className="mt-1 text-xl font-black text-cric-accent dark:text-white">{inningsData.inning || scoreTeam(inningsData)}</h2>
                </div>
                {(inningsData.r !== undefined || inningsData.runs !== undefined) && (
                  <p className="text-lg font-black text-cric-accent dark:text-white">
                    {inningsData.r ?? inningsData.runs}/{inningsData.w ?? inningsData.wickets} ({inningsData.o ?? inningsData.overs} ov)
                  </p>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b-2 border-cric-border dark:border-slate-700">
                      <th className="py-2 pr-3 text-left text-[10px] font-black uppercase tracking-widest text-cric-muted">Batter</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">R</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">B</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">4s</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">6s</th>
                      <th className="py-2 pl-3 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">SR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batting.map((batter, batterIndex) => (
                      <tr key={`${playerName(batter, 'batsman')}-${batterIndex}`} className="border-b border-cric-border last:border-0 dark:border-slate-800">
                        <td className="py-3 pr-3">
                          <div className="font-black text-cric-text dark:text-slate-100">{playerName(batter, 'batsman')}</div>
                          <div className="text-xs font-semibold text-cric-muted">{batter.dismissal || batter.outDesc || 'not out'}</div>
                        </td>
                        <td className="px-3 py-3 text-right font-black text-cric-accent dark:text-white">{batter.r ?? batter.runs ?? 0}</td>
                        <td className="px-3 py-3 text-right font-semibold text-cric-muted">{batter.b ?? batter.balls ?? 0}</td>
                        <td className="px-3 py-3 text-right font-semibold text-cric-muted">{batter.fours ?? batter['4s'] ?? 0}</td>
                        <td className="px-3 py-3 text-right font-semibold text-cric-muted">{batter.sixes ?? batter['6s'] ?? 0}</td>
                        <td className="py-3 pl-3 text-right font-semibold text-cric-muted">{batter.sr ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {bowling.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b-2 border-cric-border dark:border-slate-700">
                        <th className="py-2 pr-3 text-left text-[10px] font-black uppercase tracking-widest text-cric-muted">Bowler</th>
                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">O</th>
                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">M</th>
                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">R</th>
                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">W</th>
                        <th className="py-2 pl-3 text-right text-[10px] font-black uppercase tracking-widest text-cric-muted">Eco</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bowling.map((bowler, bowlerIndex) => (
                        <tr key={`${playerName(bowler, 'bowler')}-${bowlerIndex}`} className="border-b border-cric-border last:border-0 dark:border-slate-800">
                          <td className="py-3 pr-3 font-black text-cric-text dark:text-slate-100">{playerName(bowler, 'bowler')}</td>
                          <td className="px-3 py-3 text-right font-semibold text-cric-muted">{bowler.o ?? bowler.overs ?? 0}</td>
                          <td className="px-3 py-3 text-right font-semibold text-cric-muted">{bowler.m ?? bowler.maidens ?? 0}</td>
                          <td className="px-3 py-3 text-right font-semibold text-cric-muted">{bowler.r ?? bowler.runs ?? 0}</td>
                          <td className="px-3 py-3 text-right font-black text-cric-accent dark:text-white">{bowler.w ?? bowler.wickets ?? 0}</td>
                          <td className="py-3 pl-3 text-right font-semibold text-cric-muted">{bowler.eco ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  };

  const renderCommentary = () => (
    commentary.length ? (
      <div className="space-y-3">
        {commentary.map((item, index) => (
          <article key={item.id || index} className="rounded-lg border border-cric-border bg-cric-card p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex gap-4">
              <div className="w-16 shrink-0 text-sm font-black text-cric-accent dark:text-white">{item.over || item.ball || '-'}</div>
              <div>
                {item.event && item.event !== 'NONE' && <p className="mb-1 text-xs font-black uppercase tracking-widest text-cric-accent">{item.event}</p>}
                <p className="text-sm font-semibold leading-6 text-cric-text dark:text-slate-200">{item.text}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <EmptyState title="Commentary not available from original API" detail={apiStatus?.lastError || 'Ball-by-ball commentary requires a live score provider plan that includes commentary endpoints.'} />
    )
  );

  const renderStats = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {asArray(stats.inningsSummary).map((item, index) => (
          <div key={`${item.team}-${index}`} className="rounded-lg border border-cric-border bg-cric-card p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[11px] font-black uppercase tracking-widest text-cric-muted">{item.team}</p>
            <p className="mt-2 text-2xl font-black text-cric-accent dark:text-white">{item.runs}/{item.wickets}</p>
            <p className="text-sm font-bold text-cric-muted">{item.overs} overs</p>
          </div>
        ))}
        <div className="rounded-lg border border-cric-border bg-cric-card p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-[11px] font-black uppercase tracking-widest text-cric-muted">Overs Tracked</p>
          <p className="mt-2 text-2xl font-black text-cric-accent dark:text-white">{stats.oversCount || 0}</p>
          <p className="text-sm font-bold text-cric-muted">from original feed</p>
        </div>
      </div>

      {asArray(stats.topBatters).length || asArray(stats.topBowlers).length ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-4 text-lg font-black text-cric-accent dark:text-white">Top Batters</h2>
            {asArray(stats.topBatters).map(player => (
              <div key={`${player.name}-${player.team}`} className="flex items-center justify-between border-b border-cric-border py-3 last:border-0 dark:border-slate-800">
                <div>
                  <p className="font-black text-cric-text dark:text-slate-100">{player.name}</p>
                  <p className="text-xs font-bold text-cric-muted">{player.team}</p>
                </div>
                <p className="text-lg font-black text-cric-accent dark:text-white">{player.runs} <span className="text-xs text-cric-muted">({player.balls})</span></p>
              </div>
            ))}
          </section>
          <section className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-4 text-lg font-black text-cric-accent dark:text-white">Top Bowlers</h2>
            {asArray(stats.topBowlers).map(player => (
              <div key={`${player.name}-${player.overs}`} className="flex items-center justify-between border-b border-cric-border py-3 last:border-0 dark:border-slate-800">
                <div>
                  <p className="font-black text-cric-text dark:text-slate-100">{player.name}</p>
                  <p className="text-xs font-bold text-cric-muted">{player.overs} ov, eco {player.eco || '-'}</p>
                </div>
                <p className="text-lg font-black text-cric-accent dark:text-white">{player.wickets}/{player.runs}</p>
              </div>
            ))}
          </section>
        </div>
      ) : (
        <EmptyState title="Live stats need scorecard data" detail="Once the original API returns innings and player rows, this tab calculates top batters, bowlers and innings summaries." />
      )}
    </div>
  );

  const renderOvers = () => (
    overs.length ? (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {overs.map((over, index) => (
          <article key={over.id || index} className="rounded-lg border border-cric-border bg-cric-card p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-cric-accent dark:text-white">Over {over.over}</h2>
              {(over.runs !== '' || over.wickets !== '') && <p className="text-sm font-black text-cric-muted">{over.runs} runs {over.wickets !== '' ? `${over.wickets} wkts` : ''}</p>}
            </div>
            {over.bowler && <p className="mb-3 text-xs font-bold text-cric-muted">Bowler: {over.bowler}</p>}
            <div className="flex flex-wrap gap-2">
              {asArray(over.balls).length ? asArray(over.balls).map((ball, ballIndex) => (
                <span key={ball.id || ballIndex} className="grid h-9 min-w-9 place-items-center rounded-full bg-cric-bg px-3 text-xs font-black text-cric-accent dark:bg-slate-800 dark:text-white">
                  {ball.value || ball}
                </span>
              )) : <p className="text-sm font-semibold text-cric-muted">{over.summary || 'Over details from API'}</p>}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <EmptyState title="Over-by-over feed not available" detail={apiStatus?.lastError || 'The original provider has not returned over summaries for this match yet.'} />
    )
  );

  const renderPlayingXI = () => (
    playingXI.length ? (
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {playingXI.map(team => (
          <section key={team.teamName} className="rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-4 text-lg font-black text-cric-accent dark:text-white">{team.teamName}</h2>
            <div className="space-y-2">
              {asArray(team.players).map((player, index) => (
                <div key={`${team.teamName}-${player.id || player.name}-${index}`} className="flex items-center gap-3 border-b border-cric-border py-2 last:border-0 dark:border-slate-800">
                  {normalizeImage(player.image) ? (
                    <img src={player.image} alt={player.name} className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-cric-bg text-xs font-black text-cric-muted dark:bg-slate-800">{player.name?.[0] || 'P'}</div>
                  )}
                  <div>
                    <p className="font-black text-cric-text dark:text-slate-100">{player.name}</p>
                    {(player.role || player.captain || player.keeper) && (
                      <p className="text-xs font-bold text-cric-muted">
                        {[player.role, player.captain ? 'C' : '', player.keeper ? 'WK' : ''].filter(Boolean).join(' - ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    ) : (
      <EmptyState title="Playing XI not available from original API" detail="This tab will populate from the provider squad/scorecard response when available." />
    )
  );

  const renderPhotos = () => (
    photos.length ? (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {photos.map((photo, index) => (
          <a key={photo.id || index} href={photo.url || '#'} target={photo.url ? '_blank' : undefined} rel="noreferrer" className="overflow-hidden rounded-lg border border-cric-border bg-cric-card shadow-sm transition hover:shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {photo.image && <img src={photo.image} alt={photo.title} className="h-44 w-full object-cover" />}
            <div className="p-4">
              <h2 className="line-clamp-2 text-sm font-black text-cric-accent dark:text-white">{photo.title}</h2>
              {photo.publishedAt && <p className="mt-2 text-xs font-bold text-cric-muted">{formatDate(photo.publishedAt)}</p>}
            </div>
          </a>
        ))}
      </div>
    ) : (
      <EmptyState title="Photos not available from original API" detail="Photos need a provider endpoint that includes media/image access." />
    )
  );

  const renderNews = () => (
    news.length ? (
      <div className="space-y-4">
        {news.map((article, index) => (
          <a key={article.id || index} href={article.url || '#'} target={article.url ? '_blank' : undefined} rel="noreferrer" className="grid gap-4 rounded-lg border border-cric-border bg-cric-card p-4 shadow-sm transition hover:shadow-lg dark:border-slate-700 dark:bg-slate-900 md:grid-cols-[160px_1fr]">
            {article.image && <img src={article.image} alt={article.title} className="h-28 w-full rounded-md object-cover" />}
            <div>
              <h2 className="text-base font-black text-cric-accent dark:text-white">{article.title}</h2>
              {article.description && <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-cric-muted">{article.description}</p>}
              <p className="mt-2 text-xs font-black uppercase tracking-widest text-cric-muted">{article.source || 'Original API'}</p>
            </div>
          </a>
        ))}
      </div>
    ) : (
      <EmptyState title="News not available from original API" detail="Latest news will show here when the selected provider returns articles." />
    )
  );

  const renderVideos = () => (
    videos.length ? (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {videos.map((video, index) => (
          <a key={video.videoId || index} href={video.watchUrl || '#'} target={video.watchUrl ? '_blank' : undefined} rel="noreferrer" className="overflow-hidden rounded-lg border border-cric-border bg-cric-card shadow-sm transition hover:shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {video.thumbnail && <img src={video.thumbnail} alt={video.title} className="h-48 w-full object-cover" />}
            <div className="p-4">
              <h2 className="line-clamp-2 text-base font-black text-cric-accent dark:text-white">{video.title}</h2>
              {video.description && <p className="mt-2 line-clamp-2 text-sm font-semibold text-cric-muted">{video.description}</p>}
              <p className="mt-3 text-xs font-black uppercase tracking-widest text-cric-muted">{video.source || 'Original API'}</p>
            </div>
          </a>
        ))}
      </div>
    ) : (
      <EmptyState title="Videos not available from original API" detail="Most live-score APIs separate video rights from score data. Add a provider/video plan and this tab will show original API videos." />
    )
  );

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'scorecard':
        return renderScorecard();
      case 'commentary':
        return renderCommentary();
      case 'stats':
        return renderStats();
      case 'overs':
        return renderOvers();
      case 'playing-xi':
        return renderPlayingXI();
      case 'photos':
        return renderPhotos();
      case 'news':
        return renderNews();
      case 'videos':
        return renderVideos();
      default:
        return renderLive();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cric-bg dark:bg-slate-950">
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-cric-accent border-t-transparent" />
            <p className="mt-4 text-sm font-bold text-cric-muted">Loading original match centre...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cric-bg dark:bg-slate-950">
      <main className="mx-auto max-w-6xl px-4 py-7">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link to="/international" className="text-xs font-black uppercase tracking-widest text-cric-accent hover:text-cric-accent">
            Back to International
          </Link>
          <button
            type="button"
            onClick={fetchData}
            className="rounded-lg bg-cric-accent px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-cric-accent"
          >
            Refresh
          </button>
        </div>

        <ApiWarning status={apiStatus} />

        <section className="mb-5 rounded-lg border border-cric-border bg-cric-card p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${stateClass(matchData)}`}>
              {stateLabel(matchData)}
            </span>
            {matchData.matchType && <span className="text-xs font-black uppercase tracking-widest text-cric-muted">{matchData.matchType}</span>}
          </div>
          <h1 className="text-2xl font-black text-cric-accent dark:text-white lg:text-3xl">
            {matchData.name || 'International match centre'}
          </h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-cric-muted">
            {[matchData.venue, matchData.series?.name, formatDate(matchData.dateTimeGMT || matchData.date)].filter(Boolean).join(' - ')}
          </p>
          {matchData.status && <p className="mt-3 text-base font-black text-cric-text dark:text-slate-200">{matchData.status}</p>}
        </section>

        <div className="mb-6 overflow-x-auto">
          <div className="flex min-w-max gap-2">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex h-11 items-center gap-2 rounded-lg px-4 text-[11px] font-black uppercase tracking-widest transition-all ${
                    activeTab === tab.id
                      ? 'bg-cric-accent text-white shadow-lg'
                      : 'border border-cric-border bg-cric-card text-cric-muted hover:text-cric-accent dark:border-slate-700 dark:bg-slate-900'
                  }`}
                  type="button"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {renderActiveTab()}
      </main>
    </div>
  );
}
