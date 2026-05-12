import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";

import Header from "../components/Header";
import MatchList from "../components/MatchList";
import Login from "../components/Login";
import Register from "../components/Register";
import { fetchMatches } from "../store/slices/matchesSlice";
import { initAuthFromStorage, logout as doLogout, getStoredUser } from "../pages/auth/auth";
import BlogGallery from "../components/BlogGallery";
import { api } from "../services/api";
import GlobalSearch from "../components/GlobalSearch";

export function Home() {
   const dispatch = useDispatch();
   const navigate = useNavigate();

   const matches = useSelector((state) => Array.isArray(state.matches.list) ? state.matches.list : []);
   const matchesStatus = useSelector((state) => state.matches.status);
   const liveMatches = matches.filter(m => m.status === "live");
   const upcomingMatches = matches.filter(m => m.status === "upcoming" || m.status === "scheduled");
   const completedMatches = matches.filter(m => m.status === "completed");

   const [series, setSeries] = useState([]);
   const [authUser, setAuthUser] = useState(null);
   const [showLogin, setShowLogin] = useState(false);
   const [showRegister, setShowRegister] = useState(false);

   useEffect(() => {
      const user = initAuthFromStorage && getStoredUser();
      setAuthUser(user);
      dispatch(fetchMatches());
      loadSeries();
   }, [dispatch]);

   const loadSeries = async () => {
      try {
         const res = await api.get("/events");
         setSeries(res.data);
      } catch (err) { console.error(err); }
   };

   const handleLoginSuccess = (user) => { setAuthUser(user); setShowLogin(false); dispatch(fetchMatches()); };
   const handleRegisterSuccess = (user) => { setAuthUser(user); setShowRegister(false); dispatch(fetchMatches()); };
   const handleLogout = () => { doLogout(); setAuthUser(null); dispatch(fetchMatches()); };
   const handleMatchSelect = (match) => { navigate(`/match/${match._id}`); };

   return (
      <div className="min-h-screen bg-[#f0f2f5] text-slate-900 font-sans">
         <Header
            user={authUser}
            onShowLogin={() => { setShowLogin(true); setShowRegister(false); }}
            onShowRegister={() => { setShowRegister(true); setShowLogin(false); }}
            onLogout={handleLogout}
         />

         {/* Series/Events Section */}
         {series.length > 0 && (
            <div className="bg-gradient-to-r from-[#031d44] via-[#0a2d5e] to-[#031d44] border-b border-white/10">
               <div className="max-w-7xl mx-auto px-4 py-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                     <h2 className="text-white font-black uppercase tracking-widest text-sm flex items-center gap-2">
                        <span className="text-2xl">🏆</span> Series & Tournaments
                     </h2>
                     <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                        {["All", "School", "College", "University", "Organization", "Business", "Industry"].map(cat => (
                           <button key={cat} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] font-black text-blue-300 uppercase whitespace-nowrap transition-all">
                              {cat}
                           </button>
                        ))}
                     </div>
                     <Link to="/series" className="text-blue-300 text-xs font-black uppercase hover:text-white transition-colors">View All →</Link>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                     {series.slice(0, 6).map(ev => (
                        <Link key={ev._id} to={`/series/${ev.slug || ev._id}`} className="group bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl overflow-hidden transition-all backdrop-blur-sm">
                           <div className="aspect-square bg-white/10 flex items-center justify-center p-4">
                              {ev.logo ? (
                                 <img src={ev.logo} alt={ev.name} className="w-full h-full object-contain" />
                              ) : (
                                 <span className="text-4xl font-black text-white/80">{ev.name?.charAt(0)}</span>
                              )}
                           </div>
                           <div className="p-3">
                              <p className="text-[9px] font-bold text-blue-300/60 uppercase truncate">{ev.eventType?.replace('-', ' ')}</p>
                              <p className="text-xs font-black text-white uppercase tracking-tight truncate group-hover:text-blue-300 transition-colors">{ev.shortName || ev.name}</p>
                              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${ev.status === "live" ? "bg-red-600 text-white animate-pulse" : ev.status === "completed" ? "bg-green-600 text-white" : "bg-blue-500/20 text-blue-300"}`}>{ev.status}</span>
                           </div>
                        </Link>
                     ))}
                  </div>
               </div>
            </div>
         )}

         {/* Hero Live Section - Premium */}
         <div className="bg-[#031d44] border-b border-white/10 shadow-2xl">
            <div className="max-w-7xl mx-auto px-4 py-8">
               <div className="flex items-center justify-between mb-6">
                  <h2 className="text-white font-black uppercase tracking-widest text-sm flex items-center gap-2">
                     <div className="w-2 h-4 bg-red-600 rounded-full animate-pulse" />
                     Live & Upcoming Matches
                  </h2>
                  <div className="flex-1 max-w-xl mx-8 hidden md:block">
                     <GlobalSearch />
                  </div>
                  <button className="text-blue-300 text-xs font-black uppercase hover:text-white transition-colors">
                     View All Matches →
                  </button>
               </div>
               <div className="md:hidden mb-6">
                  <GlobalSearch />
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {liveMatches.length > 0 ? liveMatches.slice(0, 3).map(m => (
                     <div key={m._id} onClick={() => handleMatchSelect(m)} className="group cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-6 transition-all backdrop-blur-sm">
                        <div className="flex justify-between items-start mb-4">
                           <span className="text-[10px] font-black text-blue-300/60 uppercase tracking-widest">{m.tournament?.name || m.matchType}</span>
                           <span className="bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded uppercase animate-pulse">Live</span>
                        </div>
                        <div className="space-y-4">
                           {m.innings?.map((inn, idx) => (
                              <div key={idx} className="flex items-center justify-between">
                                 <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold border border-white/10">
                                       {m.teams[idx]?.name?.charAt(0)}
                                    </div>
                                    <span className="font-bold text-white uppercase tracking-tight">{m.teams[idx]?.shortName || m.teams[idx]?.name}</span>
                                 </div>
                                 <span className="font-black text-white text-lg">{inn.runs || 0}/{inn.wickets || 0} <span className="text-xs text-blue-300/40 ml-1">({inn.overs || 0}.{(inn.balls || 0) % 6})</span></span>
                              </div>
                           ))}
                        </div>
                        <div className="mt-6 pt-4 border-t border-white/10 text-xs font-bold text-blue-300 italic">
                           {m.result?.description || m.status.replace(/_/g, " ").toUpperCase()}
                        </div>
                     </div>
                  )) : (
                     upcomingMatches.slice(0, 3).map(m => (
                        <div key={m._id} onClick={() => handleMatchSelect(m)} className="group cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-6 transition-all backdrop-blur-sm">
                           <span className="text-[10px] font-black text-blue-300/60 uppercase tracking-widest block mb-4">{m.tournament?.name || "Scheduled"}</span>
                           <div className="flex items-center justify-center gap-4 mb-4">
                              <div className="text-center flex-1">
                                 <div className="w-12 h-12 mx-auto rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-xl font-bold text-white mb-2">{m.teams?.[0]?.name?.charAt(0)}</div>
                                 <p className="text-xs font-black text-white uppercase tracking-tighter truncate">{m.teams?.[0]?.name}</p>
                              </div>
                              <div className="text-white/20 font-black text-sm italic">VS</div>
                              <div className="text-center flex-1">
                                 <div className="w-12 h-12 mx-auto rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-xl font-bold text-white mb-2">{m.teams?.[1]?.name?.charAt(0)}</div>
                                 <p className="text-xs font-black text-white uppercase tracking-tighter truncate">{m.teams?.[1]?.name}</p>
                              </div>
                           </div>
                           <p className="text-center text-[10px] font-black text-blue-300 uppercase tracking-widest bg-blue-500/10 py-1.5 rounded-lg">
                              Today, {new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                           </p>
                        </div>
                     ))
                  )}
               </div>
            </div>
         </div>

         <div className="max-w-7xl mx-auto px-4 py-12">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
               {/* Main news portal section */}
               <div className="lg:col-span-3 space-y-12">
                  <div className="flex items-center justify-between">
                     <h1 className="text-3xl font-black text-[#031d44] uppercase tracking-tighter italic">Top Stories</h1>
                     <div className="h-0.5 flex-1 bg-slate-200 mx-8" />
                  </div>

                  {/* Large centerpiece blog/news */}
                  <BlogGallery category="General" />

                  {showLogin && <Login onSuccess={handleLoginSuccess} onCancel={() => setShowLogin(false)} />}
                  {showRegister && <Register onSuccess={handleRegisterSuccess} onCancel={() => setShowRegister(false)} />}
               </div>

               {/* Sidebars */}
               <div className="space-y-8">
                  <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
                     <div className="bg-[#031d44] text-white px-6 py-4">
                        <h3 className="font-black uppercase tracking-widest text-xs">Recent Results</h3>
                     </div>
                     <div className="divide-y divide-slate-100">
                        {completedMatches.slice(0, 5).map(m => (
                           <div key={m._id} onClick={() => handleMatchSelect(m)} className="p-4 hover:bg-slate-50 cursor-pointer transition-colors">
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">{m.tournament?.name || "Tournament Result"}</p>
                              <div className="space-y-1 mb-2">
                                 <div className="flex justify-between items-center text-xs">
                                    <span className="font-bold uppercase tracking-tight">{m.teams[0]?.shortName || m.teams[0]?.name}</span>
                                    <span className="font-black">{m.innings[0]?.runs}/{m.innings[0]?.wickets}</span>
                                 </div>
                                 <div className="flex justify-between items-center text-xs">
                                    <span className="font-bold uppercase tracking-tight">{m.teams[1]?.shortName || m.teams[1]?.name}</span>
                                    <span className="font-black">{m.innings[1]?.runs}/{m.innings[1]?.wickets}</span>
                                 </div>
                              </div>
                              <p className="text-[10px] font-bold text-blue-600 italic line-clamp-1">{m.result?.description}</p>
                           </div>
                        ))}
                     </div>
                  </div>

                  <div className="bg-white rounded-2xl shadow-xl p-6 border border-slate-200">
                     <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 px-1">Trending Topics</h3>
                     <div className="space-y-4">
                        {["#CricketWorldCup", "#BCL2025", "#LiveScores", "#MatchHighlights"].map(tag => (
                           <div key={tag} className="flex items-center gap-3 cursor-pointer group">
                              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all">
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg>
                              </div>
                              <span className="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{tag}</span>
                           </div>
                        ))}
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
}
