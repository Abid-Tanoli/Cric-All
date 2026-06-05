import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function CricketNews() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    fetchNews();
  }, []);

  const fetchNews = async () => {
    setLoading(true);
    try {
      const res = await api.get('/international/news?limit=50');
      setArticles(res.data.data || []);
    } catch (e) {
      console.error('News fetch error:', e);
    }
    setLoading(false);
  };

  const getFilteredArticles = () => {
    if (activeFilter === 'all') return articles;
    return articles.filter(a => a.source.toLowerCase().includes(activeFilter.toLowerCase()));
  };

  const sources = ['all', ...new Set(articles.map(a => a.source))];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl lg:text-4xl font-black text-[#031d44] dark:text-white">Cricket News</h1>
            <p className="text-sm text-slate-500 mt-1">Latest cricket updates curated for BQ-PLAY.</p>
          </div>
          <button
            onClick={fetchNews}
            className="bg-[#031d44] hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl transition-all"
          >
            Refresh
          </button>
        </div>

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {sources.map(source => (
            <button
              key={source}
              onClick={() => setActiveFilter(source)}
              className={`px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                activeFilter === source
                  ? 'bg-[#031d44] text-white shadow-lg'
                  : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-[#031d44] border border-slate-200 dark:border-slate-700'
              }`}
            >
              {source === 'all' ? 'All' : source}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-[#031d44] border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 mt-4 text-sm font-bold">Loading news...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {getFilteredArticles().length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <p className="text-4xl mb-4">📰</p>
                <p className="text-lg font-bold">No news articles available</p>
              </div>
            ) : (
              getFilteredArticles().map((article, i) => (
                <a
                  key={i}
                  href={article.link}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-white dark:bg-slate-800 rounded-2xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-xl transition-all group"
                >
                  <div className="flex gap-5 p-6">
                    {article.image && (
                      <img
                        src={article.image}
                        alt=""
                        className="w-32 h-32 rounded-xl object-cover flex-shrink-0"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full">
                          {article.source}
                        </span>
                        {article.pubDate && (
                          <span className="text-[10px] text-slate-400">
                            {new Date(article.pubDate).toLocaleDateString()} - {new Date(article.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-[#031d44] dark:text-white group-hover:text-blue-600 transition-colors line-clamp-2">
                        {article.title}
                      </h3>
                      {article.description && (
                        <p className="text-sm text-slate-500 mt-2 line-clamp-3">{article.description}</p>
                      )}
                      <span className="text-xs font-bold text-blue-600 mt-3 inline-block group-hover:underline">Read full story</span>
                    </div>
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
