import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import AdminLogin from "./pages/auth/AdminLogin";
import AdminRegister from "./pages/auth/AdminRegister";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import OfflineBanner from "./components/OfflineBanner";
import ErrorBoundary from "../../Shared/components/ErrorBoundary";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const LiveScores = lazy(() => import("./pages/LiveScores"));
const ManageEvents = lazy(() => import("./pages/ManageEvents"));
const ManagePlayers = lazy(() => import("./pages/ManagePlayers"));
const Teams = lazy(() => import("./pages/Teams"));
const ManageScore = lazy(() => import("./pages/ManageScore"));
const LiveMatchView = lazy(() => import("./pages/LiveMatchView"));
const BulkImport = lazy(() => import("./pages/BulkImport"));
const Rankings = lazy(() => import("./pages/Rankings"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const TeamDetail = lazy(() => import("./components/admin/teams/TeamDetail"));
const TeamEdit = lazy(() => import("./pages/TeamEdit"));
const Blogs = lazy(() => import("./pages/Blogs"));
const EventDetail = lazy(() => import("./pages/EventDetail"));
const SeriesDetail = lazy(() => import("./pages/SeriesDetail"));
const AdminInternational = lazy(() => import("./pages/AdminInternational"));
const SyncPanel = lazy(() => import("./pages/SyncPanel"));
const ManageAdmins = lazy(() => import("./pages/ManageAdmins"));

const PageLoader = () => (
  <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
    <div className="w-10 h-10 border-4 border-cric-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

function SuperAdminRoute({ children }) {
  const { token, user } = useSelector((state) => state.auth);
  if (!token) return <Navigate to="/admin/login" replace />;
  if (user?.role !== "superadmin") return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  const { token } = useSelector((state) => state.auth);

  return (
    <>
    <OfflineBanner />
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/admin/login" element={!token ? <AdminLogin /> : <Navigate to="/admin" />} />
      <Route path="/admin/register" element={!token ? <AdminRegister /> : <Navigate to="/admin" />} />
      <Route path="/admin/forgot-password" element={!token ? <ForgotPassword /> : <Navigate to="/admin" />} />
      <Route path="/admin/reset-password/:token" element={!token ? <ResetPassword /> : <Navigate to="/admin" />} />
      <Route path="/admin" element={<ProtectedRoute><ErrorBoundary><Layout><Dashboard /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/live" element={<ProtectedRoute><ErrorBoundary><Layout><LiveScores /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/events" element={<ProtectedRoute><ErrorBoundary><Layout><ManageEvents /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/teams" element={<ProtectedRoute><ErrorBoundary><Layout><Teams /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/players" element={<ProtectedRoute><ErrorBoundary><Layout><ManagePlayers /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/score" element={<ProtectedRoute><ErrorBoundary><Layout><ManageScore /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/score/:matchId" element={<ProtectedRoute><ErrorBoundary><Layout><ManageScore /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/score/:matchId/:tabId" element={<ProtectedRoute><ErrorBoundary><Layout><ManageScore /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/bulk-import" element={<ProtectedRoute><ErrorBoundary><Layout><BulkImport /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/blogs" element={<ProtectedRoute><ErrorBoundary><Layout><Blogs /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/rankings" element={<ProtectedRoute><ErrorBoundary><Layout><Rankings /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/live/:id" element={<ProtectedRoute><ErrorBoundary><Layout><LiveMatchView /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/players/:id" element={<ProtectedRoute><ErrorBoundary><Layout><PlayerProfile /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/teams/:id/edit" element={<ProtectedRoute><ErrorBoundary><Layout><TeamEdit /></Layout></ErrorBoundary></ProtectedRoute>} />
      <Route path="/admin/teams/:id" element={<ProtectedRoute><ErrorBoundary><Layout><TeamDetail /></Layout></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/events/:eventId" element={<ProtectedRoute><ErrorBoundary><Layout><EventDetail /></Layout></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/series/:id" element={<ProtectedRoute><ErrorBoundary><Layout><SeriesDetail /></Layout></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/international" element={<ProtectedRoute><ErrorBoundary><Layout><AdminInternational /></Layout></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/sync" element={<ProtectedRoute><ErrorBoundary><Layout><SyncPanel /></Layout></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/admins" element={<SuperAdminRoute><ErrorBoundary><Layout><ManageAdmins /></Layout></ErrorBoundary></SuperAdminRoute>} />
      <Route path="/" element={<Navigate to="/admin" />} />
    </Routes>
    </Suspense>
    </>
  );
}
