import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { getSocket, initSocket } from '../services/socket';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function International() {
  const [activeTab, setActiveTab] = useState('live');
  const [liveMatches, setLiveMatches] = useState([]);
  const [allMatches, setAllMatches] = useState([]);
  const [series, setSeries] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    setupSocket();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [liveRes, matchesRes, seriesRes, highlightsRes, newsRes] = await Promise.all([
        api.get('/international/live').catch(() => ({ data: { data: [] } })),
        api.get('/international/series').catch(() => ({ data: { data: [] } })),
        api.get('/international/series').catch(() => ({ data: { data: [] } })),
        api.get('/international/highlights?q=cricket').catch(() => ({ data: { data: [] } })),
        api.get('/international/news?limit=5').catch(() => ({ data: { data: [] } })),
      ]);
      setLiveMatches(liveRes.data.data || []);
      setAllMatches(matchesRes.data.data || []);
      setSeries(seriesRes.data.data || []);
      setHighlights(highlightsRes.data.data || []);
      setNews(newsRes.data.data || []);
    } catch (e) {
      console.error('International fetch error:', e);
    }
    setLoading(false);
  };

  const setupSocket = () => {
    const socket = getSocket() || initSocket(API_BASE.replace('/api', ''));
    socket.on('INTERNATIONAL_MATCHES_UPDATE', ({ matches }) => {
      setLiveMatches(matches.filter(m => m.ms === 'live' || m.matchStarted));
    });
  };

  const tabs = [
    { id: 'live', label: '🔴 Live' },
    { id: 'upcoming', label: '📅 Upcoming' },
    { id: 'series', label: '🏆 Series' },
    { id: 'highlights', label: '🎬 Highlights' },
    { id: 'news', label: '📰 News' },
  ];

  const renderLive = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {liveMatches.length === 0 ? (
        <div className="col-span-full text-center py-16 text-slate-500">
          <p className="text-4xl mb-4">🏏</p>
          <p className="text-lg font-bold">No live matches right now</p>
          <p className="text-sm">Check back later or browse upcoming matches</p>
        </div>
      ) : (
        liveMatches.map(match => (
          <Link
            key={match.id}
            to={`/international/match/${match.id}`}
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-5 hover:shadow-xl transition-all group"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="bg-red-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full animate-pulse">
                🔴 LIVE
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase">{match.matchType}</span>
            </div>
            <h3 className="text-lg font-black text-[#031d44] dark:text-white mb-3 group-hover:text-blue-600 transition-colors">
              {match.name}
            </h3>
            {match.score?.map((inn, i) => (
              <div key={i} className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-slate-700 last:border-0">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{inn.inning?.split(' Inning')[0]}</span>
                <span className="text-sm font-black text-[#031d44] dark:text-white">{inn.r}/{inn.w} ({inn.o})</span>
              </div>
            ))}
            <p className="text-xs text-slate-500 mt-3 font-medium">{match.status}</p>
          </Link>
        ))
      )}
    </div>
  );

  const renderUpcoming = () => {
    const upcoming = allMatches.filter(m => !m.matchStarted || m.ms === 'upcoming');
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {upcoming.length === 0 ? (
          <div className="col-span-full text-center py-16 text-slate-500">
            <p className="text-4xl mb-4">📅</p>
            <p className="text-lg font-bold">No upcoming matches</p>
          </div>
        ) : (
          upcoming.slice(0, 12).map(match => (
            <div key={match.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full">
                  Upcoming
                </span>
                <span className="text-[10px] text-slate-400 font-bold">{match.matchType}</span>
              </div>
              <h3 className="text-base font-black text-[#031d44] dark:text-white mb-2">{match.name}</h3>
              <p className="text-xs text-slate-500">{match.venue || 'TBD'}</p>
              <p className="text-xs text-slate-400 mt-1">{match.dateTimeGMT ? new Date(match.dateTimeGMT).toLocaleString() : 'Date TBD'}</p>
            </div>
          ))
        )}
      </div>
    );
  };

  const renderSeries = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {series.length === 0 ? (
        <div className="col-span-full text-center py-16 text-slate-500">
          <p className="text-4xl mb-4">🏆</p>
          <p className="text-lg font-bold">No series data available</p>
        </div>
      ) : (
        series.slice(0, 12).map(s => (
          <Link
            key={s.id}
            to={`/international/series/${s.id}`}
            className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-5 hover:shadow-lg transition-all group"
          >
            <h3 className="text-base font-black text-[#031d44] dark:text-white group-hover:text-blue-600 transition-colors">{s.name}</h3>
            <p className="text-xs text-slate-500 mt-2">{s.startDate ? new Date(s.startDate).toLocaleDateString() : ''} — {s.endDate ? new Date(s.endDate).toLocaleDateString() : ''}</p>
            <p className="text-xs text-slate-400 mt-1">{s.matchType || 'T20'}</p>
          </Link>
        ))
      )}
    </div>
  );

  const renderHighlights = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {highlights.length === 0 ? (
        <div className="col-span-full text-center py-16 text-slate-500">
          <p className="text-4xl mb-4">🎬</p>
          <p className="text-lg font-bold">No highlights available</p>
        </div>
      ) : (
        highlights.map(video => (
          <a
            key={video.videoId}
            href={video.watchUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-all group"
          >
            <div className="relative">
              <img src={video.thumbnail} alt={video.title} className="w-full h-44 object-cover" />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white text-4xl">▶</span>
              </div>
            </div>
            <div className="p-4">
              <h4 className="text-sm font-bold text-[#031d44] dark:text-white line-clamp-2">{video.title}</h4>
              <p className="text-xs text-slate-500 mt-1">{video.channelName}</p>
              <p className="text-[10px] text-slate-400">{new Date(video.publishedAt).toLocaleDateString()}</p>
            </div>
          </a>
        ))
      )}
    </div>
  );

  const renderNews = () => (
    <div className="space-y-4">
      {news.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-4">📰</p>
          <p className="text-lg font-bold">No news available</p>
        </div>
      ) : (
        news.map((article, i) => (
          <a
            key={i}
            href={article.link}
            target="_blank"
            rel="noreferrer"
            className="block bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-all group"
          >
            <div className="flex gap-4 p-5">
              {article.image && (
                <img src={article.image} alt="" className="w-24 h-24 rounded-xl object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">{article.source}</span>
                  <span className="text-[10px] text-slate-400">{article.pubDate ? new Date(article.pubDate).toLocaleDateString() : ''}</span>
                </div>
                <h4 className="text-base font-bold text-[#031d44] dark:text-white group-hover:text-blue-600 transition-colors line-clamp-2">
                  {article.title}
                </h4>
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{article.description}</p>
              </div>
            </div>
          </a>
        ))
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl lg:text-4xl font-black text-[#031d44] dark:text-white">
              🌍 International Cricket
            </h1>
            <p className="text-sm text-slate-500 mt-1">Live scores, series, highlights & news</p>
          </div>
          <button
            onClick={fetchData}
            className="bg-[#031d44] hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl transition-all"
          >
            Refresh
          </button>
        </div>

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-[#031d44] text-white shadow-lg'
                  : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-[#031d44] border border-slate-200 dark:border-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-[#031d44] border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 mt-4 text-sm font-bold">Loading...</p>
          </div>
        ) : (
          <>
            {activeTab === 'live' && renderLive()}
            {activeTab === 'upcoming' && renderUpcoming()}
            {activeTab === 'series' && renderSeries()}
            {activeTab === 'highlights' && renderHighlights()}
            {activeTab === 'news' && renderNews()}
          </>
        )}
      </div>
    </div>
  );
}
