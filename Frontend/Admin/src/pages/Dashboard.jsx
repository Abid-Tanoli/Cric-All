import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchMatches } from "../store/slices/matchesSlice";
import { fetchPlayers } from "../store/slices/playersSlice";
import { fetchTeams } from "../store/slices/teamSlice";
import { Link } from "react-router-dom";
import GlobalSearch from "../components/GlobalSearch";

export default function Dashboard() {
    const dispatch = useDispatch();
    const { matches } = useSelector((state) => state.matches);
    const { players } = useSelector((state) => state.players);
    const { teams } = useSelector((state) => state.teams);
    const { user } = useSelector((state) => state.auth);

    const [stats, setStats] = useState({
        totalMatches: 0,
        liveMatches: 0,
        upcomingMatches: 0,
        completedMatches: 0,
    });

    useEffect(() => {
        dispatch(fetchMatches());
        dispatch(fetchPlayers());
        dispatch(fetchTeams());
    }, [dispatch]);

    useEffect(() => {
        if (matches.length > 0) {
            const live = matches.filter(
                (m) => m.status === "live" || m.status === "pending_tie_resolution"
            ).length;
            const upcoming = matches.filter((m) => m.status === "upcoming").length;
            const completed = matches.filter((m) => m.status === "completed").length;
            setStats({
                totalMatches: matches.length,
                liveMatches: live,
                upcomingMatches: upcoming,
                completedMatches: completed,
            });
        }
    }, [matches]);

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 p-6 lg:p-10">
            {/* Header */}
            <div className="mb-10">
                <h1 className="text-4xl lg:text-5xl font-black text-[#031d44] tracking-tight">
                    WELCOME BACK, {user?.name?.toUpperCase() || "ADMIN"}!
                </h1>
                <p className="text-slate-500 mt-2 font-medium">
                    Here's what's happening with your cricket management system today.
                </p>
            </div>

            {/* Global Search Bar */}
            <div className="mb-12">
                <GlobalSearch />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total Matches</p>
                    <p className="text-4xl font-black text-[#031d44] mt-2">{stats.totalMatches}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Live Matches</p>
                    <p className="text-4xl font-black text-green-600 mt-2">{stats.liveMatches}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total Teams</p>
                    <p className="text-4xl font-black text-blue-600 mt-2">{teams.length}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-100">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total Players</p>
                    <p className="text-4xl font-black text-purple-600 mt-2">{players.length}</p>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <Link
                    to="/admin/events"
                    className="p-6 bg-gradient-to-br from-[#031d44] to-slate-800 text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all active:scale-95"
                >
                    <h3 className="text-sm font-black uppercase tracking-widest">Create Match / Tournament</h3>
                    <p className="text-xs text-slate-300 mt-2">Schedule events across all categories</p>
                </Link>
                <Link
                    to="/admin/live"
                    className="p-6 bg-gradient-to-br from-green-600 to-green-800 text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all active:scale-95"
                >
                    <h3 className="text-sm font-black uppercase tracking-widest">Live Scores</h3>
                    <p className="text-xs text-green-100 mt-2">View ongoing matches</p>
                </Link>
                <Link
                    to="/admin/players"
                    className="p-6 bg-gradient-to-br from-blue-600 to-blue-800 text-white rounded-2xl shadow-xl hover:shadow-2xl transition-all active:scale-95"
                >
                    <h3 className="text-sm font-black uppercase tracking-widest">Manage Players</h3>
                    <p className="text-xs text-blue-100 mt-2">Add or edit players</p>
                </Link>
            </div>

            {/* Recent Matches */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest">
                        Recent Matches
                    </h2>
                    <Link to="/admin/events" className="text-xs font-bold text-blue-600 hover:underline">
                        View All →
                    </Link>
                </div>

                <div className="space-y-4">
                    {matches.slice(0, 5).map((match) => (
                        <div
                            key={match._id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100"
                        >
                            <div>
                                <p className="font-bold text-slate-800">
                                    {match.teams?.[0]?.name || "Team A"} vs{" "}
                                    {match.teams?.[1]?.name || "Team B"}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                    {new Date(match.startAt).toLocaleDateString()}
                                </p>
                            </div>
                            <div className="flex items-center gap-4 mt-2 sm:mt-0">
                                <p className="text-sm font-bold text-slate-600">
                                    {match.innings?.[0]?.runs || 0}/{match.innings?.[0]?.wickets || 0}
                                    {" | "}
                                    {match.innings?.[1]?.runs || 0}/{match.innings?.[1]?.wickets || 0}
                                </p>
                                <span
                                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${match.status === "live"
                                        ? "bg-green-100 text-green-700"
                                        : match.status === "completed"
                                            ? "bg-slate-200 text-slate-600"
                                            : "bg-blue-100 text-blue-700"
                                        }`}
                                >
                                    {match.status?.replace(/_/g, " ")}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {matches.length === 0 && (
                    <div className="text-center py-10">
                        <p className="text-sm font-black text-slate-300 uppercase tracking-widest">
                            No matches found
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
