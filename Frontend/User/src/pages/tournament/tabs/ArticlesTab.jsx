import React from "react";
import { Link } from "react-router-dom";
import { useMediaList } from "./PhotosTab";

function Panel({ children }) {
  return <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-8 text-center">{children}</div>;
}

export default function ArticlesTab({ tournamentId, basePath }) {
  const { loading, error, items } = useMediaList(`/tournaments/${tournamentId}/articles`, "items");

  if (loading) return <Panel><p className="text-cric-muted font-bold">Loading articles…</p></Panel>;
  if (error) return <Panel><p className="text-red-600 font-bold">Could not load articles</p><p className="text-xs text-cric-muted mt-1">{error}</p></Panel>;
  if (!items.length) return <Panel><p className="text-cric-muted font-bold">No articles yet.</p></Panel>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {items.map((article) => (
        <Link
          key={article._id}
          to={`${basePath}/articles/${article.slug}`}
          className="bg-cric-card rounded-xl overflow-hidden border border-cric-border hover:shadow-md transition-all flex flex-col"
        >
          {article.coverImage && (
            <img src={article.coverImage} alt="" loading="lazy" className="w-full h-40 object-cover" />
          )}
          <div className="p-4 flex-1">
            <h3 className="font-black text-cric-text leading-tight">{article.title}</h3>
            {article.excerpt && <p className="mt-2 text-sm text-cric-muted line-clamp-3">{article.excerpt}</p>}
            <p className="mt-3 text-[10px] font-bold text-cric-muted uppercase tracking-widest">
              {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
