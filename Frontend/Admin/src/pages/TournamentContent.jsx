import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import { useToast } from '../components/Toast';

// ---------------------------------------------------------------------------
// Tournament hub content manager
// ---------------------------------------------------------------------------
//
// Per-tournament editor for the public hub's additive content: Overview copy,
// Photos, Videos, Articles and Settings (visibility + stats thresholds).
//
// Route: /admin/tournaments/:id/content (platform-admin only, enforced by the
// existing ProtectedRoute + backend requireAdmin/requireVerifiedEmail).
//
// Everything here talks to the additive admin endpoints under
// `/tournaments/admin/:id/...`; no existing tournament endpoint changes.

const SUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
  { key: 'articles', label: 'Articles' },
  { key: 'settings', label: 'Settings' },
];

const VISIBILITY_FIELDS = [
  { key: 'photos', label: 'Photos tab' },
  { key: 'videos', label: 'Videos tab' },
  { key: 'articles', label: 'Articles tab' },
  { key: 'stats', label: 'Stats tab' },
  { key: 'table', label: 'Table tab' },
  { key: 'teams', label: 'Teams tab' },
];

const inputCls =
  'border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44] w-full';
const btnPrimary =
  'bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2 disabled:opacity-50';
const btnGhost =
  'bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2';
const btnDanger =
  'bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2';

const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

/** Local uploads are served from the API origin, not the SPA origin. */
function assetUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function TournamentContent() {
  const { id } = useParams();
  const toast = useToast();
  const showToast = useCallback(
    (message, type) => {
      if (toast?.showToast) toast.showToast(message, type);
    },
    [toast],
  );

  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [media, setMedia] = useState([]);
  const [articles, setArticles] = useState([]);

  const [overview, setOverview] = useState({ bannerImage: '', shortDescription: '', city: '' });
  const [settings, setSettings] = useState({ visibility: {}, stats: { minBallsFaced: 30, minOvers: 5 } });
  const [saving, setSaving] = useState(false);

  // Per-tab form state
  const [photoForm, setPhotoForm] = useState({ file: null, caption: '' });
  const [videoForm, setVideoForm] = useState({ url: '', title: '' });
  const [articleForm, setArticleForm] = useState(null); // null = closed

  const load = useCallback(async () => {
    if (!id) return;
    setStatus('loading');
    setError(null);
    try {
      const res = await api.get(`/tournaments/admin/${id}/content`);
      const data = res.data || {};
      setTournament(data.tournament || null);
      setMedia(Array.isArray(data.media) ? data.media : []);
      setArticles(Array.isArray(data.articles) ? data.articles : []);
      setOverview({
        bannerImage: data.settings?.bannerImage || '',
        shortDescription: data.settings?.shortDescription || '',
        city: data.settings?.city || '',
      });
      setSettings({
        visibility: { ...(data.settings?.visibility || {}) },
        stats: {
          minBallsFaced: data.settings?.stats?.minBallsFaced ?? 30,
          minOvers: data.settings?.stats?.minOvers ?? 5,
        },
      });
      setStatus('ready');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load tournament content');
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const photos = useMemo(() => media.filter((m) => m.kind === 'photo'), [media]);
  const videos = useMemo(() => media.filter((m) => m.kind === 'video'), [media]);

  const saveOverview = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put(`/tournaments/admin/${id}/content`, {
        bannerImage: overview.bannerImage,
        shortDescription: overview.shortDescription,
        city: overview.city,
      });
      const saved = res.data?.settings;
      if (saved) {
        setOverview({
          bannerImage: saved.bannerImage || '',
          shortDescription: saved.shortDescription || '',
          city: saved.city || '',
        });
      }
      showToast('Overview saved', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save overview', 'error');
    }
    setSaving(false);
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put(`/tournaments/admin/${id}/content`, {
        visibility: settings.visibility,
        stats: settings.stats,
      });
      const saved = res.data?.settings;
      if (saved) {
        setSettings({
          visibility: { ...(saved.visibility || {}) },
          stats: {
            minBallsFaced: saved.stats?.minBallsFaced ?? 30,
            minOvers: saved.stats?.minOvers ?? 5,
          },
        });
      }
      showToast('Settings saved', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save settings', 'error');
    }
    setSaving(false);
  };

  const uploadPhoto = async (e) => {
    e.preventDefault();
    if (!photoForm.file) {
      showToast('Choose an image first', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('image', photoForm.file);
    if (photoForm.caption) formData.append('caption', photoForm.caption);
    try {
      const res = await api.post(`/tournaments/admin/${id}/photos`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMedia((prev) => [...prev, res.data.media]);
      setPhotoForm({ file: null, caption: '' });
      showToast('Photo added', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to upload photo', 'error');
    }
  };

  const addVideo = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post(`/tournaments/admin/${id}/videos`, {
        url: videoForm.url,
        title: videoForm.title,
      });
      setMedia((prev) => [...prev, res.data.media]);
      setVideoForm({ url: '', title: '' });
      showToast('Video added', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to add video', 'error');
    }
  };

  const toggleMedia = async (item) => {
    try {
      const res = await api.put(`/tournaments/admin/${id}/media/${item._id}`, {
        published: !item.published,
      });
      setMedia((prev) => prev.map((m) => (m._id === item._id ? { ...m, ...res.data.media } : m)));
      showToast(res.data.media?.published ? 'Published' : 'Unpublished', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update media', 'error');
    }
  };

  const editMediaCaption = async (item) => {
    const caption = window.prompt('Caption', item.caption || '');
    if (caption === null) return;
    try {
      const res = await api.put(`/tournaments/admin/${id}/media/${item._id}`, { caption });
      setMedia((prev) => prev.map((m) => (m._id === item._id ? { ...m, ...res.data.media } : m)));
      showToast('Media updated', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update media', 'error');
    }
  };

  const deleteMedia = async (item) => {
    if (!window.confirm('Delete this item? The public hub will stop showing it.')) return;
    try {
      await api.delete(`/tournaments/admin/${id}/media/${item._id}`);
      setMedia((prev) => prev.filter((m) => m._id !== item._id));
      showToast('Deleted', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete media', 'error');
    }
  };

  const openNewArticle = () =>
    setArticleForm({ _id: null, title: '', slug: '', coverImage: '', excerpt: '', body: '', published: false });

  const openEditArticle = (article) =>
    setArticleForm({
      _id: article._id,
      title: article.title || '',
      slug: article.slug || '',
      coverImage: article.coverImage || '',
      excerpt: article.excerpt || '',
      body: article.body || '',
      published: article.published === true,
    });

  const saveArticle = async (e) => {
    e.preventDefault();
    if (!articleForm) return;
    const payload = {
      title: articleForm.title,
      slug: articleForm.slug,
      coverImage: articleForm.coverImage,
      excerpt: articleForm.excerpt,
      body: articleForm.body,
      published: articleForm.published,
    };
    try {
      if (articleForm._id) {
        const res = await api.put(`/tournaments/admin/${id}/articles/${articleForm._id}`, payload);
        setArticles((prev) => prev.map((a) => (a._id === articleForm._id ? res.data.article : a)));
        showToast('Article updated', 'success');
      } else {
        const res = await api.post(`/tournaments/admin/${id}/articles`, payload);
        setArticles((prev) => [res.data.article, ...prev]);
        showToast('Article created', 'success');
      }
      setArticleForm(null);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save article', 'error');
    }
  };

  const deleteArticle = async (article) => {
    if (!window.confirm(`Delete "${article.title}"?`)) return;
    try {
      await api.delete(`/tournaments/admin/${id}/articles/${article._id}`);
      setArticles((prev) => prev.filter((a) => a._id !== article._id));
      showToast('Article deleted', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete article', 'error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
        <p className="text-slate-500">Loading content…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
        <Link to="/admin/tournaments" className="text-sm font-bold text-[#031d44] hover:underline">
          ← Back to tournaments
        </Link>
        <div className="mt-6 bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
          <p className="text-red-600 font-bold">{error}</p>
          <button type="button" className={`${btnGhost} mt-4`} onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
      <Link to="/admin/tournaments" className="text-sm font-bold text-[#031d44] hover:underline">
        ← Back to tournaments
      </Link>
      <h1 className="text-3xl lg:text-4xl font-black text-[#031d44] mt-2 mb-1" data-testid="content-title">
        {tournament?.name || 'Tournament'} — Content
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        Manage what the public tournament hub shows for this tournament only. Global site flags are untouched.
      </p>

      <div className="flex flex-wrap border-b border-slate-200 mb-6" role="tablist" data-testid="content-subtabs">
        {SUB_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`px-6 py-3 font-black text-xs uppercase tracking-widest ${
              tab === entry.key ? 'bg-[#031d44] text-white rounded-t-xl' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <form onSubmit={saveOverview} className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 space-y-4 max-w-3xl">
          <Field label="Banner image URL">
            <input
              aria-label="Banner image URL"
              className={inputCls}
              value={overview.bannerImage}
              onChange={(e) => setOverview({ ...overview, bannerImage: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          {overview.bannerImage && (
            <img
              src={assetUrl(overview.bannerImage)}
              alt="Banner preview"
              className="w-full max-h-52 object-cover rounded-xl border border-slate-200"
            />
          )}
          <Field label="Short description">
            <textarea
              aria-label="Short description"
              className={inputCls}
              rows={4}
              value={overview.shortDescription}
              onChange={(e) => setOverview({ ...overview, shortDescription: e.target.value })}
            />
          </Field>
          <Field label="City">
            <input
              aria-label="City"
              className={inputCls}
              value={overview.city}
              onChange={(e) => setOverview({ ...overview, city: e.target.value })}
            />
          </Field>
          <button type="submit" className={btnPrimary} disabled={saving}>
            Save overview
          </button>
        </form>
      )}

      {tab === 'photos' && (
        <div className="space-y-6">
          <form onSubmit={uploadPhoto} className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 space-y-4 max-w-3xl">
            <h2 className="text-xl font-bold text-[#031d44]">Add a photo</h2>
            <Field label="Image file">
              <input
                aria-label="Photo file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={inputCls}
                onChange={(e) => setPhotoForm({ ...photoForm, file: e.target.files?.[0] || null })}
              />
            </Field>
            <Field label="Caption">
              <input
                aria-label="Photo caption"
                className={inputCls}
                value={photoForm.caption}
                onChange={(e) => setPhotoForm({ ...photoForm, caption: e.target.value })}
              />
            </Field>
            <button type="submit" className={btnPrimary}>
              Upload photo
            </button>
          </form>

          {photos.length === 0 ? (
            <p className="text-slate-500">No photos yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {photos.map((photo) => (
                <div key={photo._id} className="bg-white rounded-xl border border-slate-200 overflow-hidden" data-testid="photo-card">
                  <img src={assetUrl(photo.url)} alt={photo.caption || 'Tournament photo'} className="w-full h-32 object-cover" />
                  <div className="p-3 space-y-2">
                    <p className="text-xs font-bold text-slate-700 truncate">{photo.caption || 'Untitled'}</p>
                    <span className={`inline-block text-[10px] font-black uppercase tracking-widest ${photo.published ? 'text-green-600' : 'text-amber-600'}`}>
                      {photo.published ? 'Published' : 'Draft'}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className={btnGhost} onClick={() => toggleMedia(photo)}>
                        {photo.published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button type="button" className={btnGhost} onClick={() => editMediaCaption(photo)}>
                        Caption
                      </button>
                      <button type="button" className={btnDanger} onClick={() => deleteMedia(photo)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'videos' && (
        <div className="space-y-6">
          <form onSubmit={addVideo} className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 space-y-4 max-w-3xl">
            <h2 className="text-xl font-bold text-[#031d44]">Add a video</h2>
            <p className="text-xs text-slate-500">YouTube or Facebook links only. Only the link is stored — the server never downloads remote media.</p>
            <Field label="Video URL">
              <input
                aria-label="Video URL"
                className={inputCls}
                value={videoForm.url}
                onChange={(e) => setVideoForm({ ...videoForm, url: e.target.value })}
                placeholder="https://www.youtube.com/watch?v=…"
              />
            </Field>
            <Field label="Title">
              <input
                aria-label="Video title"
                className={inputCls}
                value={videoForm.title}
                onChange={(e) => setVideoForm({ ...videoForm, title: e.target.value })}
              />
            </Field>
            <button type="submit" className={btnPrimary}>
              Add video
            </button>
          </form>

          {videos.length === 0 ? (
            <p className="text-slate-500">No videos yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videos.map((video) => (
                <div key={video._id} className="bg-white rounded-xl border border-slate-200 p-4" data-testid="video-card">
                  <p className="font-bold text-[#031d44] truncate">{video.caption || 'Untitled video'}</p>
                  <p className="text-xs text-slate-500 truncate">{video.provider} · {video.videoId}</p>
                  <span className={`inline-block mt-1 text-[10px] font-black uppercase tracking-widest ${video.published ? 'text-green-600' : 'text-amber-600'}`}>
                    {video.published ? 'Published' : 'Draft'}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-3">
                    <button type="button" className={btnGhost} onClick={() => toggleMedia(video)}>
                      {video.published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button type="button" className={btnDanger} onClick={() => deleteMedia(video)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'articles' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#031d44]">Articles</h2>
            <button type="button" className={btnPrimary} onClick={openNewArticle}>
              New article
            </button>
          </div>

          {articleForm && (
            <form onSubmit={saveArticle} className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 space-y-4 max-w-3xl">
              <h3 className="text-lg font-bold text-[#031d44]">{articleForm._id ? 'Edit article' : 'New article'}</h3>
              <Field label="Title">
                <input
                  aria-label="Article title"
                  className={inputCls}
                  value={articleForm.title}
                  onChange={(e) => setArticleForm({ ...articleForm, title: e.target.value })}
                  required
                />
              </Field>
              <Field label="Slug (optional)">
                <input
                  aria-label="Article slug"
                  className={inputCls}
                  value={articleForm.slug}
                  onChange={(e) => setArticleForm({ ...articleForm, slug: e.target.value })}
                />
              </Field>
              <Field label="Cover image URL">
                <input
                  aria-label="Article cover image URL"
                  className={inputCls}
                  value={articleForm.coverImage}
                  onChange={(e) => setArticleForm({ ...articleForm, coverImage: e.target.value })}
                />
              </Field>
              <Field label="Excerpt">
                <textarea
                  aria-label="Article excerpt"
                  className={inputCls}
                  rows={2}
                  value={articleForm.excerpt}
                  onChange={(e) => setArticleForm({ ...articleForm, excerpt: e.target.value })}
                />
              </Field>
              <Field label="Body">
                <textarea
                  aria-label="Article body"
                  className={inputCls}
                  rows={10}
                  value={articleForm.body}
                  onChange={(e) => setArticleForm({ ...articleForm, body: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  aria-label="Article published"
                  checked={articleForm.published}
                  onChange={(e) => setArticleForm({ ...articleForm, published: e.target.checked })}
                />
                Published
              </label>
              <div className="flex gap-2">
                <button type="submit" className={btnPrimary}>
                  Save article
                </button>
                <button type="button" className={btnGhost} onClick={() => setArticleForm(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {articles.length === 0 ? (
            <p className="text-slate-500">No articles yet.</p>
          ) : (
            <div className="space-y-3">
              {articles.map((article) => (
                <div key={article._id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3" data-testid="article-row">
                  <div className="min-w-0">
                    <p className="font-bold text-[#031d44] truncate">{article.title}</p>
                    <p className="text-xs text-slate-500">/{article.slug}</p>
                    <span className={`inline-block mt-1 text-[10px] font-black uppercase tracking-widest ${article.published ? 'text-green-600' : 'text-amber-600'}`}>
                      {article.published ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btnGhost} onClick={() => openEditArticle(article)}>
                      Edit
                    </button>
                    <button type="button" className={btnDanger} onClick={() => deleteArticle(article)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <form onSubmit={saveSettings} className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 space-y-6 max-w-3xl">
          <div>
            <h2 className="text-xl font-bold text-[#031d44] mb-1">Tab visibility</h2>
            <p className="text-xs text-slate-500 mb-3">
              Switch a tab off to hide it for this tournament only. Media tabs are also hidden automatically when empty.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {VISIBILITY_FIELDS.map((field) => (
                <label key={field.key} className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    aria-label={`Show ${field.label}`}
                    checked={settings.visibility[field.key] !== false}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        visibility: { ...settings.visibility, [field.key]: e.target.checked },
                      })
                    }
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#031d44] mb-1">Stats qualification</h2>
            <p className="text-xs text-slate-500 mb-3">
              Minimums before a player is ranked in best strike rate / best economy.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Minimum balls faced">
                <input
                  aria-label="Minimum balls faced"
                  type="number"
                  min="0"
                  className={inputCls}
                  value={settings.stats.minBallsFaced}
                  onChange={(e) =>
                    setSettings({ ...settings, stats: { ...settings.stats, minBallsFaced: Number(e.target.value) } })
                  }
                />
              </Field>
              <Field label="Minimum overs bowled">
                <input
                  aria-label="Minimum overs bowled"
                  type="number"
                  min="0"
                  className={inputCls}
                  value={settings.stats.minOvers}
                  onChange={(e) =>
                    setSettings({ ...settings, stats: { ...settings.stats, minOvers: Number(e.target.value) } })
                  }
                />
              </Field>
            </div>
          </div>

          <button type="submit" className={btnPrimary} disabled={saving}>
            Save settings
          </button>
        </form>
      )}
    </div>
  );
}
