import React, { useEffect, useState } from "react";
import { api } from "../../../services/api";

/** Small helper shared by the three media tabs: load-on-mount + three states. */
export function useMediaList(url, key) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api
      .get(url, { timeout: 10000 })
      .then((res) => {
        if (!cancelled) setState({ loading: false, error: null, items: res.data?.[key] || [] });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, error: error?.message || "Failed to load", items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [url, key]);
  return state;
}

function Panel({ children }) {
  return <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-8 text-center">{children}</div>;
}

export default function PhotosTab({ tournamentId }) {
  const { loading, error, items } = useMediaList(`/tournaments/${tournamentId}/photos`, "items");

  if (loading) return <Panel><p className="text-cric-muted font-bold">Loading photos…</p></Panel>;
  if (error) return <Panel><p className="text-red-600 font-bold">Could not load photos</p><p className="text-xs text-cric-muted mt-1">{error}</p></Panel>;
  if (!items.length) return <Panel><p className="text-cric-muted font-bold">No photos yet.</p></Panel>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((photo) => (
        <figure key={photo._id} className="bg-cric-card rounded-xl overflow-hidden border border-cric-border">
          <img src={photo.url} alt={photo.caption || "Tournament photo"} loading="lazy" className="w-full aspect-square object-cover" />
          {photo.caption && <figcaption className="p-2 text-xs text-cric-muted">{photo.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
