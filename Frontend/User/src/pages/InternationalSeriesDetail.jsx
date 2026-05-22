import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../services/api';

export default function InternationalSeriesDetail() {
  const { seriesId } = useParams();
  const [seriesInfo, setSeriesInfo] = useState(null);
  const [points, setPoints] = useState([]);
  const [squad, setSquad] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [activeTab, setActiveTab] = useState('matches');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [seriesId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [infoRes, pointsRes, squadRes, highlightsRes] = await Promise.all([
        api.get(`/international/series/${seriesId}`).catch(() => ({ data: { data: null } })),
        api.get(`/international/series/${seriesId}/points`).catch(() => ({ data: { data: [] } })),
        api.get(`/international/series/${seriesId}/squad`).catch(() => ({ data: { data: [] } })),
        api.get(`/international/highlights?q=series+${seriesId}`).catch(() => ({ data: { data: [] } })),
      ]);
      setSeriesInfo(infoRes.data.data);
      setPoints(pointsRes.data.data || []);
      setSquad(squadRes.data.data || []);
      setHighlights(highlightsRes.data.data || []);
    } catch (e) {
      console.error('Series detail error:', e);
    }
    setLoading(false);
  };

  const tabs = [
    { id: 'matches', label: '🏏 Matches' },
    { id: 'points', label: '📊 Points Table' },
    { id: 'squad', label: '👥 Squads' },
    { id: 'highlights', label: '🎬 Highlights' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-[#031d44] border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 mt-4 text-sm font-bold">Loading series...</p>
        </div>
      </div>
    );
  }

  if (!seriesInfo) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">🏆</p>
          <p className="text-lg font-bold text-slate-500">Series not found</p>
          <Link to="/international" className="text-blue-600 text-sm font-bold mt-2 inline-block">Back to International</Link>
        </div>
      </div>
    );
  }

  const renderMatches = () => {
    const matches = seriesInfo?.matches || [];
    if (matches.length === 0) {
      return <div className="text-center py-16 text-slate-500"><p className="text-lg font-bold">No matches data available</p></div>;
    }
    return (
      <div className="space-y-4">
        {matches.map((m, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#031d44] dark:text-white">{m.name || `Match ${i + 1}`}</h3>
                <p className="text-xs text-slate-500 mt-1">{m.venue || 'TBD'} • {m.dateTimeGMT ? new Date(m.dateTimeGMT).toLocaleDateString() : ''}</p>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${
                m.ms === 'live' ? 'bg-red-600 text-white' :
                m.matchStarted && !m.matchEnded ? 'bg-red-600 text-white' :
                m.matchEnded ? 'bg-green-600 text-white' :
                'bg-blue-100 text-blue-700'
              }`}>
                {m.ms === 'live' || (m.matchStarted && !m.matchEnded) ? 'LIVE' : m.matchEnded ? 'Completed' : 'Upcoming'}
              </span>
            </div>
            {m.score?.length > 0 && (
              <div className="mt-3 space-y-1">
                {m.score.map((inn, j) => (
                  <div key={j} className="flex justify-between text-sm">
                    <span className="font-bold text-slate-700 dark:text-slate-300">{inn.inning?.split(' Inning')[0]}</span>
                    <span className="font-black text-[#031d44] dark:text-white">{inn.r}/{inn.w} ({inn.o})</span>
                  </div>
                ))}
              </div>
            )}
            {m.status && <p className="text-xs text-slate-500 mt-2">{m.status}</p>}
          </div>
        ))}
      </div>
    );
  };

  const renderPoints = () => {
    if (points.length === 0) {
      return <div className="text-center py-16 text-slate-500"><p className="text-lg font-bold">No points table available</p></div>;
    }
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#031d44] text-white">
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Team</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">M</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">W</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">L</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">T</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">NRR</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Pts</th>
              </tr>
            </thead>
            <tbody>
              {points.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3 font-bold text-[#031d44] dark:text-white">{row.team}</td>
                  <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">{row.matchesPlayed || row.m || 0}</td>
                  <td className="px-4 py-3 text-center text-green-600 font-bold">{row.won || row.w || 0}</td>
                  <td className="px-4 py-3 text-center text-red-600 font-bold">{row.lost || row.l || 0}</td>
                  <td className="px-4 py-3 text-center text-slate-500">{row.tied || row.t || 0}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-600 dark:text-slate-300">{row.nrr?.toFixed(3) || '0.000'}</td>
                  <td className="px-4 py-3 text-center font-black text-[#031d44] dark:text-white">{row.points || row.pts || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderSquad = () => {
    if (squad.length === 0) {
      return <div className="text-center py-16 text-slate-500"><p className="text-lg font-bold">No squad data available</p></div>;
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {squad.map((teamSquad, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-5">
            <h3 className="text-base font-black text-[#031d44] dark:text-white mb-4">{teamSquad.name || `Team ${i + 1}`}</h3>
            <div className="space-y-2">
              {(teamSquad.squad || teamSquad.players || []).map((player, j) => (
                <div key={j} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{player.name || player}</span>
                  <span className="text-xs text-slate-400">{player.role || ''}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderHighlights = () => {
    if (highlights.length === 0) {
      return <div className="text-center py-16 text-slate-500"><p className="text-lg font-bold">No highlights available</p></div>;
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {highlights.map(video => (
          <a
            key={video.videoId}
            href={video.watchUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-all group"
          >
            <div className="relative">
              <img src={video.thumbnail} alt={video.title} className="w-full h-40 object-cover" />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white text-4xl">▶</span>
              </div>
            </div>
            <div className="p-4">
              <h4 className="text-sm font-bold text-[#031d44] dark:text-white line-clamp-2">{video.title}</h4>
              <p className="text-xs text-slate-500 mt-1">{video.channelName}</p>
            </div>
          </a>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link to="/international" className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors">
            ← Back to International
          </Link>
          <h1 className="text-2xl lg:text-3xl font-black text-[#031d44] dark:text-white mt-2">{seriesInfo?.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {seriesInfo?.startDate ? new Date(seriesInfo.startDate).toLocaleDateString() : ''} — {seriesInfo?.endDate ? new Date(seriesInfo.endDate).toLocaleDateString() : ''}
            {seriesInfo?.matchType ? ` • ${seriesInfo.matchType}` : ''}
          </p>
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

        {activeTab === 'matches' && renderMatches()}
        {activeTab === 'points' && renderPoints()}
        {activeTab === 'squad' && renderSquad()}
        {activeTab === 'highlights' && renderHighlights()}
      </div>
    </div>
  );
}
