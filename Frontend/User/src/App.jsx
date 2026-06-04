import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { Home } from "./pages/Home";
import Match from "./pages/Match";
import Summary from "./pages/Summary";
import Players from "./pages/Players";
import PlayerProfile from "./pages/PlayerProfile";
import Teams from "./pages/Teams";
import InternationalTeams from "./pages/InternationalTeams";
import LeagueTeams from "./pages/LeagueTeams";
import LeagueDetails from "./pages/LeagueDetails";
import IncubationTeams from "./pages/IncubationTeams";
import TeamProfile from "./pages/TeamProfile";
import Rankings from "./pages/Rankings";
import PointsTable from "./pages/PointsTable";
import Live from "./pages/Live";
import News from "./pages/News";
import Videos from "./pages/Videos";
import Series from "./pages/Series";
import SeriesList from "./pages/SeriesList";
import CricSeriesDetails from "./pages/CricSeriesDetails";
import CricMatchDetails from "./pages/CricMatchDetails";
import International from "./pages/International";
import InternationalMatchDetail from "./pages/InternationalMatchDetail";
import InternationalSeriesDetail from "./pages/InternationalSeriesDetail";
import Highlights from "./pages/Highlights";
import CricketNews from "./pages/CricketNews";

function App() {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/live" element={<Live />} />
          <Route path="/series" element={<SeriesList />} />
          <Route path="/series/:seriesId" element={<Series />} />
          <Route path="/cricket/series/:seriesId" element={<CricSeriesDetails />} />
          <Route path="/cricket/match/:matchId" element={<CricMatchDetails />} />
          <Route path="/match/:matchId" element={<Match />} />
          <Route path="/matches/:matchId" element={<Match />} />
          <Route path="/summary/:matchId" element={<Summary />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:playerId" element={<PlayerProfile />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/international" element={<InternationalTeams />} />
          <Route path="/teams/leagues" element={<LeagueTeams />} />
          <Route path="/teams/leagues/:leagueId" element={<LeagueDetails />} />
          <Route path="/teams/incubation" element={<IncubationTeams />} />
          <Route path="/teams/:id" element={<TeamProfile />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/points-table" element={<PointsTable />} />
          <Route path="/news" element={<News />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/intl" element={<International />} />
          <Route path="/international" element={<International />} />
          <Route path="/international/:matchId" element={<InternationalMatchDetail />} />
          <Route path="/international/match/:matchId" element={<InternationalMatchDetail />} />
          <Route path="/international/series/:seriesId" element={<InternationalSeriesDetail />} />
          <Route path="/highlights" element={<Highlights />} />
          <Route path="/cricket-news" element={<CricketNews />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
