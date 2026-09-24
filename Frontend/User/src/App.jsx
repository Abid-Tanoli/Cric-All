import React, { Suspense, lazy, useState } from "react";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import Header from "./components/Header";
import Footer from "./components/Footer";
import OfflineBanner from "./components/OfflineBanner";
import ErrorBoundary from "../../Shared/components/ErrorBoundary";
import SocketStatusIndicator from "../../Shared/components/SocketStatusIndicator";
import { getSocket } from "./services/socket";
import { getStoredUser, logout as clearStoredUser } from "./pages/auth/auth";

const Home = lazy(() => import("./pages/Home").then(m => ({ default: m.Home })));
const Match = lazy(() => import("./pages/Match"));
const Summary = lazy(() => import("./pages/Summary"));
const Players = lazy(() => import("./pages/Players"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const Teams = lazy(() => import("./pages/Teams"));
const InternationalTeams = lazy(() => import("./pages/InternationalTeams"));
const LeagueTeams = lazy(() => import("./pages/LeagueTeams"));
const LeagueDetails = lazy(() => import("./pages/LeagueDetails"));
const IncubationTeams = lazy(() => import("./pages/IncubationTeams"));
const TeamProfile = lazy(() => import("./pages/TeamProfile"));
const Rankings = lazy(() => import("./pages/Rankings"));
const PointsTable = lazy(() => import("./pages/PointsTable"));
const Live = lazy(() => import("./pages/Live"));
const News = lazy(() => import("./pages/News"));
const Videos = lazy(() => import("./pages/Videos"));
const Series = lazy(() => import("./pages/Series"));
const SeriesList = lazy(() => import("./pages/SeriesList"));
const CricSeriesDetails = lazy(() => import("./pages/CricSeriesDetails"));
const CricMatchDetails = lazy(() => import("./pages/CricMatchDetails"));
const International = lazy(() => import("./pages/International"));
const InternationalMatchDetail = lazy(() => import("./pages/InternationalMatchDetail"));
const InternationalSeriesDetail = lazy(() => import("./pages/InternationalSeriesDetail"));
const Highlights = lazy(() => import("./pages/Highlights"));
const CricketNews = lazy(() => import("./pages/CricketNews"));
const AuthPage = lazy(() => import("./pages/auth/AuthPage"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PlayerComparison = lazy(() => import("./pages/PlayerComparison"));
const HandlerDashboard = lazy(() => import("./pages/HandlerDashboard"));

// Single shared layout header. Previously the Header was rendered separately
// on each page, which left several routes (News, Videos, Highlights, Match,
// Summary, NotFound, auth pages) without any navbar and caused the "navbar
// disappears" symptom when navigating between routes.
function AppHeader() {
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser());

  // Re-read the stored session whenever the route changes or an auth event fires
  // (login/register/logout write localStorage only), so the logged-in nav — and the
  // handler "My Dashboard" link — appears without requiring a manual page refresh.
  React.useEffect(() => {
    const syncUser = () => setUser(getStoredUser());
    syncUser();
    window.addEventListener("bq-auth-changed", syncUser);
    return () => window.removeEventListener("bq-auth-changed", syncUser);
  }, [location.pathname]);

  const handleLogout = () => {
    clearStoredUser();
    setUser(null);
  };

  return <Header user={user} onLogout={handleLogout} />;
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="flex flex-col min-h-screen">
        <OfflineBanner />
        <SocketStatusIndicator getSocket={getSocket} />
        <AppHeader />
        <main className="flex-1">
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-cric-bg"><div className="w-10 h-10 border-4 border-cric-accent border-t-transparent rounded-full animate-spin" /></div>}>
        <Routes>
          <Route path="/" element={<ErrorBoundary><Home /></ErrorBoundary>} />
          <Route path="/login" element={<ErrorBoundary><AuthPage initialMode="login" /></ErrorBoundary>} />
          <Route path="/register" element={<ErrorBoundary><AuthPage initialMode="register" /></ErrorBoundary>} />
          <Route path="/auth" element={<ErrorBoundary><AuthPage initialMode="login" /></ErrorBoundary>} />
          <Route path="/forgot-password" element={<ErrorBoundary><ForgotPassword /></ErrorBoundary>} />
          <Route path="/reset-password/:token" element={<ErrorBoundary><ResetPassword /></ErrorBoundary>} />
          <Route path="/reset-password" element={<ErrorBoundary><NotFound /></ErrorBoundary>} />
          <Route path="/live" element={<ErrorBoundary><Live /></ErrorBoundary>} />
          <Route path="/series" element={<ErrorBoundary><SeriesList /></ErrorBoundary>} />
          <Route path="/series/:seriesId" element={<ErrorBoundary><Series /></ErrorBoundary>} />
          <Route path="/cricket/series/:seriesId" element={<ErrorBoundary><CricSeriesDetails /></ErrorBoundary>} />
          <Route path="/cricket/match/:matchId" element={<ErrorBoundary><CricMatchDetails /></ErrorBoundary>} />
          <Route path="/match/:matchId" element={<ErrorBoundary><Match /></ErrorBoundary>} />
          <Route path="/matches/:matchId" element={<ErrorBoundary><Match /></ErrorBoundary>} />
          <Route path="/summary/:matchId" element={<ErrorBoundary><Summary /></ErrorBoundary>} />
          <Route path="/players" element={<ErrorBoundary><Players /></ErrorBoundary>} />
          <Route path="/players/:playerId" element={<ErrorBoundary><PlayerProfile /></ErrorBoundary>} />
          <Route path="/teams" element={<ErrorBoundary><Teams /></ErrorBoundary>} />
          <Route path="/teams/international" element={<ErrorBoundary><InternationalTeams /></ErrorBoundary>} />
          <Route path="/teams/leagues" element={<ErrorBoundary><LeagueTeams /></ErrorBoundary>} />
          <Route path="/teams/leagues/:leagueId" element={<ErrorBoundary><LeagueDetails /></ErrorBoundary>} />
          <Route path="/teams/incubation" element={<ErrorBoundary><IncubationTeams /></ErrorBoundary>} />
          <Route path="/teams/:id" element={<ErrorBoundary><TeamProfile /></ErrorBoundary>} />
          <Route path="/rankings" element={<ErrorBoundary><Rankings /></ErrorBoundary>} />
          <Route path="/points-table" element={<ErrorBoundary><PointsTable /></ErrorBoundary>} />
          <Route path="/news" element={<ErrorBoundary><News /></ErrorBoundary>} />
          <Route path="/videos" element={<ErrorBoundary><Videos /></ErrorBoundary>} />
          <Route path="/intl" element={<ErrorBoundary><International /></ErrorBoundary>} />
          <Route path="/international" element={<ErrorBoundary><International /></ErrorBoundary>} />
          <Route path="/international/:matchId" element={<ErrorBoundary><InternationalMatchDetail /></ErrorBoundary>} />
          <Route path="/international/match/:matchId" element={<ErrorBoundary><InternationalMatchDetail /></ErrorBoundary>} />
          <Route path="/international/series/:seriesId" element={<ErrorBoundary><InternationalSeriesDetail /></ErrorBoundary>} />
          <Route path="/highlights" element={<ErrorBoundary><Highlights /></ErrorBoundary>} />
          <Route path="/cricket-news" element={<ErrorBoundary><CricketNews /></ErrorBoundary>} />
          <Route path="/compare" element={<ErrorBoundary><PlayerComparison /></ErrorBoundary>} />
          <Route path="/compare/:player1Id/:player2Id?" element={<ErrorBoundary><PlayerComparison /></ErrorBoundary>} />
          <Route path="/dashboard" element={<ErrorBoundary><HandlerDashboard /></ErrorBoundary>} />
          <Route path="*" element={<ErrorBoundary><NotFound /></ErrorBoundary>} />
        </Routes>
        </Suspense>
        </main>
        <Footer />
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;
