import React from "react";
import { useMediaList } from "./PhotosTab";

function embedUrl(media) {
  if (media.provider === "youtube" && media.videoId) {
    return `https://www.youtube-nocookie.com/embed/${media.videoId}`;
  }
  if (media.provider === "facebook") {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(media.url)}`;
  }
  return "";
}

function Panel({ children }) {
  return <div className="bg-cric-card rounded-2xl shadow-sm border border-cric-border p-8 text-center">{children}</div>;
}

export default function VideosTab({ tournamentId }) {
  const { loading, error, items } = useMediaList(`/tournaments/${tournamentId}/videos`, "items");

  if (loading) return <Panel><p className="text-cric-muted font-bold">Loading videos…</p></Panel>;
  if (error) return <Panel><p className="text-red-600 font-bold">Could not load videos</p><p className="text-xs text-cric-muted mt-1">{error}</p></Panel>;
  if (!items.length) return <Panel><p className="text-cric-muted font-bold">No videos yet.</p></Panel>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((video) => (
        <div key={video._id} className="bg-cric-card rounded-xl overflow-hidden border border-cric-border">
          <div className="aspect-video bg-black">
            <iframe
              src={embedUrl(video)}
              title={video.caption || "Tournament video"}
              className="w-full h-full"
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {video.caption && <p className="p-3 text-sm font-bold text-cric-text">{video.caption}</p>}
        </div>
      ))}
    </div>
  );
}
