import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../services/api";
import ShareButton from "../../../components/ShareButton";

function Panel({ children }) {
  return <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-8 text-center">{children}</div>;
}

export default function ArticleDetail({ tournamentId, slug, basePath }) {
  const [state, setState] = useState({ loading: true, error: null, article: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, article: null });
    api
      .get(`/tournaments/${tournamentId}/articles/${slug}`, { timeout: 10000 })
      .then((res) => {
        if (!cancelled) setState({ loading: false, error: null, article: res.data?.article || null });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, error: error?.message || "Article not found", article: null });
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, slug]);

  if (state.loading) return <Panel><p className="text-cric-muted font-bold">Loading article…</p></Panel>;
  if (state.error || !state.article) {
    return (
      <Panel>
        <p className="text-red-600 font-bold">Article not found</p>
        <Link to={basePath} className="mt-3 inline-block text-sm font-bold text-cric-accent hover:underline">
          Back to the tournament
        </Link>
      </Panel>
    );
  }

  const article = state.article;
  return (
    <article className="bg-cric-card rounded-2xl shadow-sm border border-cric-border overflow-hidden">
      {article.coverImage && <img src={article.coverImage} alt="" className="w-full max-h-80 object-cover" />}
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-black text-cric-text leading-tight">{article.title}</h1>
          <ShareButton title={article.title} />
        </div>
        <p className="mt-2 text-[10px] font-bold text-cric-muted uppercase tracking-widest">
          {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""}
        </p>
        {/* The backend sanitizes the body; render it as text, never as HTML. */}
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-cric-text">{article.body}</div>
        <Link to={basePath} className="mt-8 inline-block text-sm font-bold text-cric-accent hover:underline">
          ← Back to the tournament
        </Link>
      </div>
    </article>
  );
}
