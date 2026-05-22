import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function Highlights() {
  const [search, setSearch] = useState('Pakistan highlights');
  const [videos, setVideos] = useState([]);
  const [iccVideos, setIccVideos] = useState([]);
  const [pcbVideos, setPcbVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [searchRes, iccRes, pcbRes] = await Promise.all([
        api.get('/international/highlights?q=Pakistan').catch(() => ({ data: { data: [] } })),
        api.get('/international/highlights/icc').catch(() => ({ data: { data: [] } })),
        api.get('/international/highlights/pcb').catch(() => ({ data: { data: [] } })),
      ]);
      setVideos(searchRes.data.data || []);
      setIccVideos(iccRes.data.data || []);
      setPcbVideos(pcbRes.data.data || []);
    } catch (e) {
      console.error('Highlights fetch error:', e);
    }
    setLoading(false);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    setLoading(true);
    try {
      const res = await api.get(`/international/highlights?q=${encodeURIComponent(search)}`);
      setVideos(res.data.data || []);
    } catch (e) {
      console.error('Search error:', e);
    }
    setLoading(false);
  };

  const getFilteredVideos = () => {
    switch (activeFilter) {
      case 'icc': return iccVideos;
      case 'pcb': return pcbVideos;
      case 'search': return videos;
      default: return [...videos, ...iccVideos, ...pcbVideos].slice(0, 20);
    }
  };

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'search', label: '🔍 Search Results' },
    { id: 'icc', label: '🏆 ICC' },
    { id: 'pcb', label: '🇵🇰 PCB' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl lg:text-4xl font-black text-[#031d44] dark:text-white mb-8">
          🎬 Cricket Highlights
        </h1>

        <form onSubmit={handleSearch} className="flex gap-3 mb-8">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search highlights... (e.g., Pakistan vs Australia)"
            className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-5 py-3 text-sm font-bold text-[#031d44] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
          />
          <button
            type="submit"
            className="bg-[#031d44] hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest px-6 py-3 rounded-xl transition-all"
          >
            Search
          </button>
        </form>

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                activeFilter === f.id
                  ? 'bg-[#031d44] text-white shadow-lg'
                  : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-[#031d44] border border-slate-200 dark:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-[#031d44] border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 mt-4 text-sm font-bold">Loading highlights...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {getFilteredVideos().length === 0 ? (
              <div className="col-span-full text-center py-16 text-slate-500">
                <p className="text-4xl mb-4">🎬</p>
                <p className="text-lg font-bold">No highlights found</p>
                <p className="text-sm mt-1">Try a different search term</p>
              </div>
            ) : (
              getFilteredVideos().map(video => (
                <a
                  key={video.videoId}
                  href={video.watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-xl transition-all group"
                >
                  <div className="relative">
                    <img src={video.thumbnail} alt={video.title} className="w-full h-48 object-cover" />
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-white text-5xl drop-shadow-lg">▶</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h4 className="text-sm font-bold text-[#031d44] dark:text-white line-clamp-2">{video.title}</h4>
                    <p className="text-xs text-slate-500 mt-2">{video.channelName}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{new Date(video.publishedAt).toLocaleDateString()}</p>
                  </div>
                </a>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
