import React from "react";
import BlogGallery from "../components/BlogGallery";
import { featureFlags } from "../config/features";

export default function News() {
  return (
    <div className="bg-cric-bg min-h-screen">
      <div className="bg-cric-accent pt-32 pb-20 px-4 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-0 left-0 w-64 h-64 bg-blue-400 rounded-full -ml-32 -mt-32 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-red-600 rounded-full -mr-48 -mb-48 blur-3xl" />
        </div>
        
        <div className="max-w-4xl mx-auto relative z-10">
          <h1 className="text-5xl md:text-7xl font-black text-white italic uppercase tracking-tighter leading-none mb-6">
            Latest <span className="text-blue-500">Stories</span>
          </h1>
          <p className="text-blue-200/60 text-lg md:text-xl font-bold uppercase tracking-widest max-w-2xl mx-auto italic">
            Official reports, press releases, and behind-the-scenes insights from the league.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-20">
         <div className="space-y-16">
            {featureFlags().blogs && (
              <>
                <section>
                   <div className="flex items-center gap-4 mb-12">
                      <div className="h-0.5 flex-1 bg-cric-border" />
                      <h2 className="text-2xl font-black text-cric-accent uppercase tracking-tighter italic">Top Headlines</h2>
                      <div className="h-0.5 flex-1 bg-cric-border" />
                   </div>
                   <BlogGallery category="General" />
                </section>

                <section>
                   <div className="flex items-center gap-4 mb-12">
                      <div className="h-0.5 flex-1 bg-cric-border" />
                      <h2 className="text-2xl font-black text-cric-accent uppercase tracking-tighter italic">Match Analysis</h2>
                      <div className="h-0.5 flex-1 bg-cric-border" />
                   </div>
                   <BlogGallery category="Match" />
                </section>
              </>
            )}
         </div>
      </div>
    </div>
  );
}
