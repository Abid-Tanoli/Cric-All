import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import { getSocket, initSocket } from '../services/socket';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function InternationalMatchDetail() {
  const { matchId } = useParams();
  const [activeTab, setActiveTab] = useState('score');
  const [match, setMatch] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    setupSocket();
  }, [matchId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [infoRes, scorecardRes, highlightsRes, summaryRes] = await Promise.all([
        api.get(`/international/match/${matchId}/info`).catch(() => ({ data: { data: null } })),
        api.get(`/international/match/${matchId}/scorecard`).catch(() => ({ data: { data: null } })),
        api.get(`/international/match/${matchId}/highlights`).catch(() => ({ data: { data: [] } })),
        api.get(`/international/match/${matchId}/summary`).catch(() => ({ data: { data: null } })),
      ]);
      setMatch(infoRes.data.data);
      setScorecard(scorecardRes.data.data);
      setHighlights(highlightsRes.data.data || []);
      setSummary(summaryRes.data.data?.summary);
    } catch (e) {
      console.error('Match detail error:', e);
    }
    setLoading(false);
  };

  const setupSocket = () => {
    const socket = getSocket() || initSocket(API_BASE.replace('/api', ''));
    socket.emit('JOIN_IMATCH', { matchId });
    socket.on('INTERNATIONAL_MATCH_UPDATE', ({ matchId: id, score, status, scorecard: sc }) => {
      if (id === matchId) {
        setMatch(prev => prev ? { ...prev, score, status } : null);
        if (sc) setScorecard(sc);
      }
    });
  };

  const tabs = [
    { id: 'score', label: '📊 Score' },
    { id: 'scorecard', label: '📋 Scorecard' },
    { id: 'info', label: 'ℹ️ Info' },
    { id: 'highlights', label: '🎬 Highlights' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-[#031d44] border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 mt-4 text-sm font-bold">Loading match...</p>
        </div>
      </div>
    );
  }

  if (!match && !scorecard) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">🏏</p>
          <p className="text-lg font-bold text-slate-500">Match not found</p>
          <Link to="/international" className="text-blue-600 text-sm font-bold mt-2 inline-block">Back to International</Link>
        </div>
      </div>
    );
  }

  const renderScore = () => (
    <div className="space-y-6">
      {match?.score?.map((inn, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-black text-[#031d44] dark:text-white mb-4">{inn.inning}</h3>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="text-4xl font-black text-[#031d44] dark:text-white">{inn.r}/{inn.w}</span>
            <span className="text-lg text-slate-500 font-bold">({inn.o} ov)</span>
          </div>
          {inn.batsman?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Batting</p>
              {inn.batsman.map((b, j) => (
                <div key={j} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {b.name}{b.isCaptain ? ' (c)' : ''}{b.isKeeper ? ' †' : ''}
                  </span>
                  <span className="text-sm font-black text-[#031d44] dark:text-white">{b.r}({b.b})</span>
                </div>
              ))}
            </div>
          )}
          {inn.bowler?.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Bowling</p>
              {inn.bowler.map((b, j) => (
                <div key={j} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{b.name}</span>
                  <span className="text-sm font-black text-[#031d44] dark:text-white">{b.o}-{b.m}-{b.r}-{b.w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {summary && (
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white">
          <p className="text-xs font-black uppercase tracking-widest text-blue-200 mb-2">BQ-Play AI Summary</p>
          <p className="text-base font-bold leading-relaxed">{summary}</p>
        </div>
      )}

      <p className="text-sm text-slate-500 font-medium text-center">{match?.status}</p>
    </div>
  );

  const renderScorecard = () => {
    if (!scorecard) return <p className="text-slate-500 text-center py-8">Scorecard not available</p>;
    return (
      <div className="space-y-6">
        {scorecard?.innings?.map((inn, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-black text-[#031d44] dark:text-white mb-4">{inn.inning}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Batter</th>
                    <th className="text-center py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">R</th>
                    <th className="text-center py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">B</th>
                    <th className="text-center py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">4s</th>
                    <th className="text-center py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">6s</th>
                    <th className="text-center py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">SR</th>
                  </tr>
                </thead>
                <tbody>
                  {inn.batsmen?.map((b, j) => (
                    <tr key={j} className="border-b border-slate-100 dark:border-slate-700">
                      <td className="py-2 font-bold text-slate-700 dark:text-slate-300">{b.name}</td>
                      <td className="text-center py-2 font-black text-[#031d44] dark:text-white">{b.r}</td>
                      <td className="text-center py-2 text-slate-500">{b.b}</td>
                      <td className="text-center py-2 text-slate-500">{b.fours}</td>
                      <td className="text-center py-2 text-slate-500">{b.sixes}</td>
                      <td className="text-center py-2 text-slate-500">{b.sr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderInfo = () => (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 p-6 space-y-4">
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Match</p>
        <p className="text-base font-bold text-[#031d44] dark:text-white">{match?.name}</p>
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Venue</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{match?.venue || 'TBD'}</p>
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Type</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{match?.matchType}</p>
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Date</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{match?.dateTimeGMT ? new Date(match.dateTimeGMT).toLocaleString() : 'TBD'}</p>
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Status</p>
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{match?.status}</p>
      </div>
    </div>
  );

  const renderHighlights = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {highlights.length === 0 ? (
        <div className="col-span-full text-center py-16 text-slate-500">
          <p className="text-4xl mb-4">🎬</p>
          <p className="text-lg font-bold">No highlights available yet</p>
          <p className="text-sm mt-1">Check back after the match</p>
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link to="/international" className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors">
            ← Back to International
          </Link>
          <h1 className="text-2xl lg:text-3xl font-black text-[#031d44] dark:text-white mt-2">{match?.name}</h1>
          <p className="text-sm text-slate-500 mt-1">{match?.matchType} • {match?.venue || 'TBD'}</p>
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

        {activeTab === 'score' && renderScore()}
        {activeTab === 'scorecard' && renderScorecard()}
        {activeTab === 'info' && renderInfo()}
        {activeTab === 'highlights' && renderHighlights()}
      </div>
    </div>
  );
}
