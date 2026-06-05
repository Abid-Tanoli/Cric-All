import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { api } from '../services/api';
import { getSocket, initSocket } from '../services/socket';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const asArray = (value) => Array.isArray(value) ? value : [];

const getMatchId = (match = {}) => match.id || match._id || match.matchId;

const getMatchState = (match = {}) => {
  const marker = String(match.ms || match.status || '').toLowerCase();
  if (marker === 'live' || marker.includes('live') || (match.matchStarted && !match.matchEnded)) return 'live';
  if (marker === 'result' || marker === 'completed' || marker.includes('won') || match.matchEnded) return 'result';
  if (marker === 'preview' || marker === 'fixture' || marker === 'upcoming' || !match.matchStarted) return 'upcoming';
  return 'upcoming';
};

const formatDate = (value) => {
  if (!value) return 'Date TBD';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const formatSeriesDate = (series, key) =>
  series?.[key] || series?.[key.toLowerCase()] || series?.[key.replace('Date', 'date')] || '';

const scoreTeam = (score = {}) => score.inning?.split(' Inning')[0] || score.team || score.teamName || 'Innings';
const scoreRuns = (score = {}) => score.r ?? score.runs ?? '';
const scoreWickets = (score = {}) => score.w ?? score.wickets ?? '';
const scoreOvers = (score = {}) => score.o ?? score.overs ?? '';
const scoreLine = (score = {}) => {
  if (score.chaseText || score.display) return score.chaseText || score.display;
  const runs = scoreRuns(score);
  const wickets = scoreWickets(score);
  const overs = scoreOvers(score);
  if (runs === '' && wickets === '' && overs === '') return 'Yet to bat';
  return `${runs}${wickets !== '' ? `/${wickets}` : ''}${overs ? ` (${overs})` : ''}`;
};

export default function International() {
  const [activeTab, setActiveTab] = useState('live');
  const [matches, setMatches] = useState([]);
  const [series, setSeries] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [news, setNews] = useState([]);
  const [apiStatus, setApiStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const groupedMatches = useMemo(() => ({
    live: matches.filter(match => getMatchState(match) === 'live'),
    upcoming: matches.filter(match => getMatchState(match) === 'upcoming'),
    results: matches.filter(match => getMatchState(match) === 'result'),
  }), [matches]);

  useEffect(() => {
    fetchData();
    const cleanupSocket = setupSocket();
    return cleanupSocket;
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [matchesRes, seriesRes, newsRes, statusRes] = await Promise.all([
        api.get('/international/matches').catch(() => ({ data: { data: [] } })),
        api.get('/international/series').catch(() => ({ data: { data: [] } })),
        api.get('/international/news?limit=5').catch(() => ({ data: { data: [] } })),
        api.get('/international/status').catch(() => ({ data: { data: null } })),
      ]);

      const nextMatches = asArray(matchesRes.data.data);
      const nextSeries = asArray(seriesRes.data.data);
      const seriesId = nextSeries[0]?.id;
      const highlightsRes = await api
        .get(seriesId ? `/international/highlights?seriesId=${encodeURIComponent(seriesId)}` : '/international/highlights?q=cricket')
        .catch(() => ({ data: { data: [] } }));

      setMatches(nextMatches);
      setSeries(nextSeries);
      setHighlights(asArray(highlightsRes.data.data));
      setNews(asArray(newsRes.data.data));
      setApiStatus(matchesRes.data.providerStatus || statusRes.data.data || null);
    } catch (error) {
      console.error('International fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupSocket = () => {
    const socket = getSocket() || initSocket(API_BASE.replace('/api', ''));
    const handleMatchesUpdate = ({ matches: nextMatches = [] }) => {
      setMatches(asArray(nextMatches));
    };
    socket.on('INTERNATIONAL_MATCHES_UPDATE', handleMatchesUpdate);
    return () => socket.off('INTERNATIONAL_MATCHES_UPDATE', handleMatchesUpdate);
  };

  const tabs = [
    { id: 'live', label: `Live (${groupedMatches.live.length})` },
    { id: 'upcoming', label: `Upcoming (${groupedMatches.upcoming.length})` },
    { id: 'results', label: `Results (${groupedMatches.results.length})` },
    { id: 'series', label: `Series/Tournaments (${series.length})` },
    { id: 'highlights', label: 'Highlights' },
    { id: 'news', label: 'News' },
  ];

  const providerLabel = apiStatus?.configured ? 'BQ-PLAY live data provider' : 'Live data provider';
  const apiWarning = apiStatus?.lastError
    ? apiStatus.lastError
    : (!loading && matches.length === 0 && series.length === 0 ? `${providerLabel} returned no cricket data.` : '');

  const renderApiOverview = () => {
    const topMatch = groupedMatches.live[0] || groupedMatches.upcoming[0] || groupedMatches.results[0];
    return (
      <section className="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="bg-[#031d44] px-5 py-4 text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-200">{providerLabel}</p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-tight">Real cricket data</h2>
        </div>
        <div className="grid gap-0 lg:grid-cols-[1fr_1.2fr]">
          <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-5 dark:border-slate-700 lg:border-b-0 lg:border-r">
            {[
              ['Matches', matches.length],
              ['Live', groupedMatches.live.length],
              ['Upcoming', groupedMatches.upcoming.length],
              ['Results', groupedMatches.results.length],
              ['Series/Tournaments', series.length],
              ['Highlights', highlights.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-700">
                <p className="text-2xl font-black text-[#031d44] dark:text-white">{value}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
              </div>
            ))}
          </div>
          <div className="p-5">
            {topMatch ? (
              <Link to={`/international/match/${getMatchId(topMatch)}`} className="block rounded-xl border border-slate-100 p-4 transition hover:border-blue-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{getMatchState(topMatch)} match</p>
                <h3 className="mt-2 text-xl font-black text-[#031d44] dark:text-white">{topMatch.name}</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">{topMatch.series?.name || topMatch.description || providerLabel}</p>
                <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{topMatch.status}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">{formatDate(topMatch.dateTimeGMT || topMatch.date)}{topMatch.venue ? ` - ${topMatch.venue}` : ''}</p>
              </Link>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-500">
                Waiting for cricket data from the configured provider.
              </div>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderMatchGrid = (matchList, emptyTitle, emptySubtitle) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {matchList.length === 0 ? (
        <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-lg font-black">{emptyTitle}</p>
          {apiWarning ? (
            <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="text-xs font-black uppercase tracking-widest">{providerLabel} issue</p>
              <p className="mt-2 text-sm font-bold">{apiWarning}</p>
              <p className="mt-1 text-xs font-semibold">Data tabhi ayega jab API source reachable ho ya working base URL set ho.</p>
            </div>
          ) : emptySubtitle && <p className="mt-1 text-sm">{emptySubtitle}</p>}
        </div>
      ) : (
        matchList.slice(0, 18).map(match => (
          <Link
            key={getMatchId(match)}
            to={`/international/match/${getMatchId(match)}`}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                getMatchState(match) === 'live'
                  ? 'bg-red-600 text-white'
                  : getMatchState(match) === 'result'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
              }`}>
                {getMatchState(match)}
              </span>
              <span className="text-[10px] font-bold uppercase text-slate-400">{match.matchType || match.type || 'Match'}</span>
            </div>
            <h3 className="mb-3 line-clamp-2 text-lg font-black text-[#031d44] transition-colors group-hover:text-blue-600 dark:text-white">
              {match.name}
            </h3>
            {asArray(match.score).map((score, index) => (
              <div key={`${scoreTeam(score)}-${index}`} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0 dark:border-slate-700">
                <span className="font-bold text-slate-700 dark:text-slate-300">{scoreTeam(score)}</span>
                <span className="font-black text-[#031d44] dark:text-white">{scoreLine(score)}</span>
              </div>
            ))}
            <p className="mt-3 text-xs font-semibold text-slate-500">{formatDate(match.dateTimeGMT || match.date)}</p>
            {match.status && <p className="mt-1 text-xs font-bold text-slate-500">{match.status}</p>}
            {match.venue && <p className="mt-1 text-xs text-slate-400">{match.venue}</p>}
          </Link>
        ))
      )}
    </div>
  );

  const renderSeries = () => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {series.length === 0 ? (
        <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-lg font-black">No series data available</p>
          <p className="mt-1 text-sm">Add a supported live cricket API key to load live series.</p>
        </div>
      ) : (
        series.slice(0, 18).map(item => {
          const matchCount = Number(item.odi || 0) + Number(item.t20 || 0) + Number(item.test || 0) || item.matches || item.matchCount || 0;
          return (
            <Link
              key={item.id}
              to={`/international/series/${item.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-700 dark:bg-slate-800"
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Series/Tournament</p>
              <h3 className="mt-2 line-clamp-2 text-lg font-black text-[#031d44] transition-colors group-hover:text-blue-600 dark:text-white">{item.name}</h3>
              <p className="mt-3 text-xs font-semibold text-slate-500">
                {formatSeriesDate(item, 'startDate')} - {formatSeriesDate(item, 'endDate')}
              </p>
              <p className="mt-1 text-xs font-bold text-slate-400">{[item.category, `${matchCount} matches`].filter(Boolean).join(' - ')}</p>
            </Link>
          );
        })
      )}
    </div>
  );

  const renderHighlights = () => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {highlights.length === 0 ? (
        <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-lg font-black">No highlights available</p>
        </div>
      ) : (
        highlights.map(video => (
          <a
            key={video.videoId || video.watchUrl}
            href={video.watchUrl}
            target="_blank"
            rel="noreferrer"
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-700 dark:bg-slate-800"
          >
            {video.thumbnail ? (
              <img src={video.thumbnail} alt={video.title} className="h-44 w-full object-cover" />
            ) : (
              <div className="flex h-44 items-center justify-center bg-[#031d44] px-5 text-center text-white">
                <span className="text-sm font-black uppercase tracking-widest">Open highlights</span>
              </div>
            )}
            <div className="p-4">
              <h4 className="line-clamp-2 text-sm font-black text-[#031d44] group-hover:text-blue-600 dark:text-white">{video.title}</h4>
              <p className="mt-1 text-xs font-semibold text-slate-500">{video.matchName || video.channelName}</p>
              {video.matchDate && <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{formatDate(video.matchDate)}</p>}
            </div>
          </a>
        ))
      )}
    </div>
  );

  const renderNews = () => (
    <div className="space-y-4">
      {news.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-lg font-black">No news available</p>
        </div>
      ) : (
        news.map((article, index) => (
          <a
            key={article.link || index}
            href={article.link}
            target="_blank"
            rel="noreferrer"
            className="flex gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {article.image && <img src={article.image} alt="" className="h-24 w-24 flex-shrink-0 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{article.source}</p>
              <h4 className="mt-1 line-clamp-2 text-base font-black text-[#031d44] dark:text-white">{article.title}</h4>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{article.description}</p>
            </div>
          </a>
        ))
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[#031d44] dark:text-white lg:text-4xl">International Cricket</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">Live scores, ODI fixtures, series, highlights and cricket news.</p>
          </div>
          <button
            onClick={fetchData}
            className="rounded-xl bg-[#031d44] px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        {renderApiOverview()}

        {apiWarning && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
            <p className="text-xs font-black uppercase tracking-widest">{providerLabel} unavailable</p>
            <p className="mt-2 text-sm font-bold">{apiWarning}</p>
            <p className="mt-1 text-xs font-semibold">BQ-PLAY is not showing fallback/demo cricket data here.</p>
          </div>
        )}

        <div className="mb-8 flex gap-2 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-xl px-5 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'bg-[#031d44] text-white shadow-lg'
                  : 'border border-slate-200 bg-white text-slate-500 hover:text-[#031d44] dark:border-slate-700 dark:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-20 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#031d44] border-t-transparent" />
            <p className="mt-4 text-sm font-bold text-slate-500">Loading...</p>
          </div>
        ) : (
          <>
            {activeTab === 'live' && renderMatchGrid(groupedMatches.live, 'No live matches right now', 'Check upcoming fixtures or refresh shortly.')}
            {activeTab === 'upcoming' && renderMatchGrid(groupedMatches.upcoming, 'No upcoming matches', 'Fixtures will appear here from the live data provider.')}
            {activeTab === 'results' && renderMatchGrid(groupedMatches.results, 'No recent results', 'Completed international matches will appear here.')}
            {activeTab === 'series' && renderSeries()}
            {activeTab === 'highlights' && renderHighlights()}
            {activeTab === 'news' && renderNews()}
          </>
        )}
      </main>
    </div>
  );
}
