import React from "react";
import BlogGallery from "../components/BlogGallery";
import { featureFlags } from "../config/features";

/** Public /blogs route: the blog feed already used by the home and news pages. */
export default function Blogs() {
  return (
    <div className="min-h-screen bg-cric-bg text-cric-text">
      <div className="bg-cric-accent px-4 pb-16 pt-32 text-center">
        <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white sm:text-6xl">
          CricAll Blogs
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm font-bold text-blue-100 sm:text-base">
          Stories, match reports and updates from local cricket.
        </p>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-16">
        {featureFlags().blogs ? (
          <BlogGallery category="General" />
        ) : (
          <p className="text-center text-sm font-bold text-cric-muted">
            Blogs are not available right now.
          </p>
        )}
      </div>
    </div>
  );
}
