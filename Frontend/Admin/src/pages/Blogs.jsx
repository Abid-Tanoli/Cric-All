import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useToast } from '../components/Toast';

const categories = ['General', 'Match News', 'Player Spotlight', 'Tournament'];

const Blogs = () => {
    const [blogs, setBlogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [currentBlog, setCurrentBlog] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
    const { showToast } = useToast();
    const [tournaments, setTournaments] = useState([]);
    const [formData, setFormData] = useState({
        title: '',
        content: '',
        category: 'General',
        tags: '',
        imageUrl: '',
        videoUrl: '',
        isLive: false,
        matchId: '',
    });

    const fetchBlogs = async () => {
        setLoading(true);
        try {
            const res = await api.get('/blogs');
            setBlogs(res.data.data || res.data);
        } catch (err) {
            console.error('Failed to fetch blogs:', err);
        }
        setLoading(false);
    };

    const fetchTournaments = async () => {
        try {
            const res = await api.get('/tournaments');
            setTournaments(res.data.data || res.data);
        } catch (err) {
            console.error('Failed to fetch tournaments:', err);
        }
    };

    useEffect(() => {
        fetchBlogs();
        fetchTournaments();
    }, []);

    const openCreateModal = () => {
        setEditMode(false);
        setCurrentBlog(null);
        setFormData({
            title: '',
            content: '',
            category: 'General',
            tags: '',
            imageUrl: '',
            videoUrl: '',
            isLive: false,
            matchId: '',
        });
        setShowModal(true);
    };

    const openEditModal = (blog) => {
        setEditMode(true);
        setCurrentBlog(blog);
        setFormData({
            title: blog.title || '',
            content: blog.content || '',
            category: blog.category || 'General',
            tags: blog.tags?.join(', ') || '',
            imageUrl: blog.imageUrl || '',
            videoUrl: blog.videoUrl || '',
            isLive: blog.isLive || false,
            matchId: blog.matchId || '',
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = {
            ...formData,
            tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        };
        try {
            if (editMode) {
                await api.put(`/blogs/${currentBlog._id}`, payload);
            } else {
                await api.post('/blogs', payload);
            }
            setShowModal(false);
            fetchBlogs();
        } catch (err) {
            console.error('Failed to save blog:', err);
            showToast('Failed to save blog', 'error');
        }
    };

    const handleDelete = async (id) => {
        try {
            await api.delete(`/blogs/${id}`);
            setShowDeleteConfirm(null);
            fetchBlogs();
        } catch (err) {
            console.error('Failed to delete blog:', err);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-4xl lg:text-5xl font-black text-[#031d44]">Blog Management</h1>
                <button
                    onClick={openCreateModal}
                    className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                >
                    Create Blog
                </button>
            </div>

            {/* Blog List */}
            {loading ? (
                <div className="text-center py-10 text-slate-500">Loading blogs...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {blogs.map((blog) => (
                        <div
                            key={blog._id}
                            className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden hover:shadow-2xl transition-shadow"
                        >
                            {blog.imageUrl && (
                                <div className="h-40 bg-slate-200 overflow-hidden">
                                    <img src={blog.imageUrl} alt={blog.title} className="w-full h-full object-cover" />
                                </div>
                            )}
                            <div className="p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="bg-[#031d44] text-white text-xs font-black uppercase tracking-widest px-2 py-1 rounded-lg">
                                        {blog.category}
                                    </span>
                                    {blog.isLive && (
                                        <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-lg animate-pulse">
                                            LIVE
                                        </span>
                                    )}
                                </div>
                                <h3 className="text-lg font-bold text-[#031d44] mb-2 line-clamp-2">{blog.title}</h3>
                                <p className="text-slate-500 text-sm line-clamp-3 mb-3">{blog.content}</p>
                                {blog.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-3">
                                        {blog.tags.map((tag, idx) => (
                                            <span key={idx} className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => openEditModal(blog)}
                                        className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2 flex-1"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(blog._id)}
                                        className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-4 py-2"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                        <div className="bg-[#031d44] text-white p-4 flex justify-between items-center">
                            <h2 className="text-xl font-bold">{editMode ? 'Edit Blog' : 'Create Blog'}</h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="text-2xl hover:text-slate-300"
                            >
                                &times;
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[70vh] p-6 space-y-4">
                            <input
                                name="title"
                                value={formData.title}
                                onChange={handleChange}
                                placeholder="Blog Title"
                                required
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <textarea
                                name="content"
                                value={formData.content}
                                onChange={handleChange}
                                placeholder="Blog Content"
                                rows={6}
                                required
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <select
                                name="category"
                                value={formData.category}
                                onChange={handleChange}
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            >
                                {categories.map((cat) => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                            <input
                                name="tags"
                                value={formData.tags}
                                onChange={handleChange}
                                placeholder="Tags (comma separated)"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <input
                                name="imageUrl"
                                value={formData.imageUrl}
                                onChange={handleChange}
                                placeholder="Image URL"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            <input
                                name="videoUrl"
                                value={formData.videoUrl}
                                onChange={handleChange}
                                placeholder="Video URL (optional)"
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                            />
                            {tournaments.length > 0 && (
                                <select
                                    name="matchId"
                                    value={formData.matchId}
                                    onChange={handleChange}
                                    className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#031d44]"
                                >
                                    <option value="">Associate with Tournament/Match (optional)</option>
                                    {tournaments.map((t) => (
                                        <option key={t._id} value={t._id}>{t.name}</option>
                                    ))}
                                </select>
                            )}
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="isLive"
                                    checked={formData.isLive}
                                    onChange={handleChange}
                                    className="w-5 h-5 text-[#031d44]"
                                />
                                <span className="font-bold text-[#031d44]">Mark as Live Blog</span>
                            </label>
                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    className="bg-[#031d44] hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 flex-1"
                                >
                                    {editMode ? 'Update Blog' : 'Create Blog'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center">
                        <h2 className="text-2xl font-black text-[#031d44] mb-4">Delete Blog?</h2>
                        <p className="text-slate-500 mb-6">
                            Are you sure you want to delete this blog? This action cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => handleDelete(showDeleteConfirm)}
                                className="bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 flex-1"
                            >
                                Delete
                            </button>
                            <button
                                onClick={() => setShowDeleteConfirm(null)}
                                className="bg-slate-200 hover:bg-slate-300 text-[#031d44] font-black text-xs uppercase tracking-widest rounded-xl px-6 py-3 flex-1"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Blogs;
