import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import Dashboard from "./pages/Dashboard";
import LiveScores from "./pages/LiveScores";
import ManageEvents from "./pages/ManageEvents";
import ManagePlayers from "./pages/ManagePlayers";
import Teams from "./pages/Teams";
import ManageScore from "./pages/ManageScore";
import AdminLogin from "./pages/auth/AdminLogin";
import AdminRegister from "./pages/auth/AdminRegister";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import LiveMatchView from "./pages/Livematchview";
import BulkImport from "./pages/BulkImport";
import Rankings from "./pages/Rankings";
import PlayerProfile from "./pages/PlayerProfile";
import TeamProfile from "./pages/TeamProfile";
import Blogs from "./pages/Blogs";
import EventDetail from "./pages/EventDetail";

export default function App() {
  const { token } = useSelector((state) => state.auth);

  return (
    <Routes>
      <Route path="/admin/login" element={!token ? <AdminLogin /> : <Navigate to="/admin" />} />
      <Route path="/admin/register" element={!token ? <AdminRegister /> : <Navigate to="/admin" />} />
      <Route path="/admin" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
      <Route path="/admin/live" element={<ProtectedRoute><Layout><LiveScores /></Layout></ProtectedRoute>} />
      <Route path="/admin/events" element={<ProtectedRoute><Layout><ManageEvents /></Layout></ProtectedRoute>} />
      <Route path="/admin/teams" element={<ProtectedRoute><Layout><Teams /></Layout></ProtectedRoute>} />
      <Route path="/admin/players" element={<ProtectedRoute><Layout><ManagePlayers /></Layout></ProtectedRoute>} />
      <Route path="/admin/score" element={<ProtectedRoute><Layout><ManageScore /></Layout></ProtectedRoute>} />
      <Route path="/admin/score/:matchId" element={<ProtectedRoute><Layout><ManageScore /></Layout></ProtectedRoute>} />
      <Route path="/admin/score/:matchId/:tabId" element={<ProtectedRoute><Layout><ManageScore /></Layout></ProtectedRoute>} />
      <Route path="/admin/bulk-import" element={<ProtectedRoute><Layout><BulkImport /></Layout></ProtectedRoute>} />
      <Route path="/admin/blogs" element={<ProtectedRoute><Layout><Blogs /></Layout></ProtectedRoute>} />
      <Route path="/admin/rankings" element={<ProtectedRoute><Layout><Rankings /></Layout></ProtectedRoute>} />
      <Route path="/admin/live/:id" element={<ProtectedRoute><Layout><LiveMatchView /></Layout></ProtectedRoute>} />
      <Route path="/admin/players/:id" element={<ProtectedRoute><Layout><PlayerProfile /></Layout></ProtectedRoute>} />
      <Route path="/admin/teams/:id" element={<ProtectedRoute><Layout><TeamProfile /></Layout></ProtectedRoute>} />
      <Route path="/admin/events/:eventId" element={<ProtectedRoute><Layout><EventDetail /></Layout></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/admin" />} />
    </Routes>
  );
}
