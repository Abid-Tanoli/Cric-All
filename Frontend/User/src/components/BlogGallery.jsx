import React, { useEffect, useState } from "react";
import { api } from "../services/api";

export default function BlogGallery({ category, relatedId }) {
  const [blogs, setBlogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [category, relatedId]);

  useEffect(() => {
    const fetchBlogs = async () => {
      setLoading(true);
      try {
        let url = `/blogs?category=${category}`;
        if (relatedId) url += `&relatedId=${relatedId}`;
        
        const res = await api.get(url, { params: { limit: 8 }, timeout: 6000 });
        // Ensure we handle arrays correctly depending on API response
        const data = Array.isArray(res.data) ? res.data : (res.data.blogs || []);
        setBlogs(data);
      } catch (err) {
        setBlogs([]);
      } finally {
        setLoading(false);
      }
    };
    fetchBlogs();
  }, [category, relatedId]);

  if (loading) {
    return (
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-4">
              <div className="aspect-video bg-cric-border rounded-2xl" />
              <div className="h-4 bg-cric-border rounded w-3/4" />
              <div className="h-3 bg-cric-border rounded w-1/2" />
            </div>
          ))}
        </div>
        {slow && (
          <p role="status" className="mt-6 text-center text-sm font-semibold text-cric-muted">
            Stories are taking longer than expected. Please try again soon.
          </p>
        )}
      </div>
    );
  }

  if (blogs.length === 0) {
    return (
      <p role="status" className="text-center text-sm font-bold text-cric-muted">
        {slow ? "Stories are taking longer than expected. Please try again soon." : "No stories yet."}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      {blogs.map(blog => (
        <div key={blog._id} className="group cursor-pointer">
          <div className="aspect-video rounded-[1.5rem] overflow-hidden mb-5 relative shadow-lg group-hover:shadow-2xl transition-all duration-500 bg-cric-bg">
            {blog.imageUrl ? (
              <img 
                src={blog.imageUrl} 
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                alt={blog.title} 
              />
            ) : (
                <div className="w-full h-full bg-cric-accent flex items-center justify-center text-white font-black text-2xl italic">
                   BQ NEWS
                </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            
            {blog.videoUrl && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 bg-red-600 text-white rounded-full flex items-center justify-center shadow-2xl transform group-hover:scale-110 transition-transform">
                   <svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
            )}
            
            {blog.isLive && (
              <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest animate-pulse border border-white/20">
                LIVE NOW
              </div>
            )}
            
            <div className="absolute bottom-4 left-4 right-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
               <span className="text-[9px] font-black text-white uppercase tracking-widest bg-white/20 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                  Read Article →
               </span>
            </div>
          </div>
          
          <div className="px-1">
             <h3 className="font-black text-cric-text leading-tight line-clamp-2 group-hover:text-blue-600 transition-colors text-lg uppercase tracking-tighter italic">
               {blog.title}
             </h3>
             <div className="flex items-center gap-3 mt-3">
                <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">
                   {blog.category || "General"}
                </p>
                <span className="w-1 h-1 bg-cric-border rounded-full" />
                <p className="text-[9px] text-cric-muted font-bold uppercase tracking-widest">
                   {new Date(blog.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
             </div>
          </div>
        </div>
      ))}
    </div>
  );
}
