import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function AdminInternational() {
  const [activeTab, setActiveTab] = useState('live');
  const [liveMatches, setLiveMatches] = useState([]);
  const [series, setSeries] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [liveRes, seriesRes, highlightsRes, newsRes] = await Promise.all([
        axios.get(`${API_BASE}/international/live`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_BASE}/international/series`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_BASE}/international/highlights?q=cricket`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_BASE}/international/news?limit=5`).catch(() => ({ data: { data: [] } })),
      ]);
      setLiveMatches(liveRes.data.data || []);
      setSeries(seriesRes.data.data || []);
      setHighlights(highlightsRes.data.data || []);
      setNews(newsRes.data.data || []);
    } catch (e) {
      console.error('Admin International fetch error:', e);
    }
    setLoading(false);
  };

  const tabs = [
    { id: 'live', label: '🔴 Live Matches' },
    { id: 'series', label: '🏆 Series' },
    { id: 'highlights', label: '🎬 Highlights' },
    { id: 'news', label: '📰 News' },
  ];

  return (
    <div className="p-6 lg:p-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl lg:text-4xl font-black text-[#031d44]">🌍 International Cricket</h1>
          <p className="text-sm text-slate-500 mt-1">Live scores, series, highlights & news from external API</p>
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
                : 'bg-white text-slate-500 hover:text-[#031d44] border border-slate-200'
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
          {activeTab === 'live' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveMatches.length === 0 ? (
                <div className="col-span-full text-center py-16 text-slate-500">
                  <p className="text-4xl mb-4">🏏</p>
                  <p className="text-lg font-bold">No live international matches</p>
                </div>
              ) : (
                liveMatches.map(match => (
                  <div key={match.id} className="bg-white rounded-2xl shadow border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="bg-red-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full animate-pulse">
                        🔴 LIVE
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">{match.matchType}</span>
                    </div>
                    <h3 className="text-base font-black text-[#031d44] mb-3">{match.name}</h3>
                    {match.score?.map((inn, i) => (
                      <div key={i} className="flex justify-between py-1 border-b border-slate-100 last:border-0">
                        <span className="text-sm font-bold text-slate-700">{inn.inning?.split(' Inning')[0]}</span>
                        <span className="text-sm font-black text-[#031d44]">{inn.r}/{inn.w} ({inn.o})</span>
                      </div>
                    ))}
                    <p className="text-xs text-slate-500 mt-3">{match.status}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'series' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {series.length === 0 ? (
                <div className="col-span-full text-center py-16 text-slate-500">
                  <p className="text-4xl mb-4">🏆</p>
                  <p className="text-lg font-bold">No series data available</p>
                </div>
              ) : (
                series.slice(0, 12).map(s => (
                  <div key={s.id} className="bg-white rounded-2xl shadow border border-slate-200 p-5">
                    <h3 className="text-base font-black text-[#031d44]">{s.name}</h3>
                    <p className="text-xs text-slate-500 mt-2">
                      {s.startDate ? new Date(s.startDate).toLocaleDateString() : ''} — {s.endDate ? new Date(s.endDate).toLocaleDateString() : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{s.matchType || 'T20'}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'highlights' && (
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
                    className="bg-white rounded-2xl shadow border border-slate-200 overflow-hidden hover:shadow-lg transition-all group"
                  >
                    <div className="relative">
                      <img src={video.thumbnail} alt={video.title} className="w-full h-40 object-cover" />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-white text-4xl">▶</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <h4 className="text-sm font-bold text-[#031d44] line-clamp-2">{video.title}</h4>
                      <p className="text-xs text-slate-500 mt-1">{video.channelName}</p>
                    </div>
                  </a>
                ))
              )}
            </div>
          )}

          {activeTab === 'news' && (
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
                    className="block bg-white rounded-2xl shadow border border-slate-200 overflow-hidden hover:shadow-lg transition-all group"
                  >
                    <div className="flex gap-4 p-5">
                      {article.image && (
                        <img src={article.image} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">{article.source}</span>
                          <span className="text-[10px] text-slate-400">{article.pubDate ? new Date(article.pubDate).toLocaleDateString() : ''}</span>
                        </div>
                        <h4 className="text-sm font-bold text-[#031d44] group-hover:text-blue-600 transition-colors line-clamp-2">{article.title}</h4>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{article.description}</p>
                      </div>
                    </div>
                  </a>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
