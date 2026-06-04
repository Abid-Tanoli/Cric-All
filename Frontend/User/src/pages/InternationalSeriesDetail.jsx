import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { api } from '../services/api';

const asArray = (value) => Array.isArray(value) ? value : [];
const getSeriesInfo = (series = {}) => series.info || series.series || series;
const getSeriesMatches = (series = {}) => asArray(series.matchList || series.matches || series.matchInfo);
const getMatchId = (match = {}) => match.id || match._id || match.matchId;

const statsLinks = ['Most Runs', 'Most Wickets', 'High Scores', 'Best Bowling', 'High Team Totals', 'Most Catches'];

const fanRatings = [
  { rank: 1, name: 'Arafat Minhas', team: 'PAK', detail: 'Runs: 51   Wkts: 7', rating: '8.9' },
  { rank: 2, name: 'Ghazi Ghori', team: 'PAK', detail: 'Runs: 102   Wkts: 0', rating: '7.6' },
  { rank: 3, name: 'Babar Azam', team: 'PAK', detail: 'Runs: 85   Wkts: 0', rating: '7.5' },
];

const wicketLeaders = [
  { name: 'Arafat Minhas', team: 'PAK', value: '7', detail: 'Innings: 2   Average: 8.42' },
  { name: 'Nathan Ellis', team: 'AUS', value: '6', detail: 'Innings: 2   Average: 13.00' },
  { name: 'Shaheen Shah Afridi', team: 'PAK', value: '4', detail: 'Innings: 2   Average: 13.75' },
];

const runLeaders = [
  { name: 'Matt Renshaw', team: 'AUS', value: '104', detail: 'Innings: 2   Average: 52.00' },
  { name: 'Ghazi Ghori', team: 'PAK', value: '102', detail: 'Innings: 2   Average: 51.00' },
  { name: 'Babar Azam', team: 'PAK', value: '85', detail: 'Innings: 2   Average: 42.50' },
];

const storyCards = [
  {
    title: 'Battling Australia force series decider as questions grow for Pakistan',
    text: 'Tricky pitches have forced batters to adapt and led to a major role for spin and changes of pace',
  },
  {
    title: "'Batting allrounder' Shadab proves his value despite lean bowling returns",
    text: 'Shadab nearly helped Pakistan steal the second ODI, showing why he remains central to the side.',
  },
  {
    title: 'Ellis, Short share seven wickets as Australia dig deep to level series',
    text: 'Josh Inglis, Cameron Green and Matt Renshaw made important runs before Australia defended their total.',
  },
  {
    title: "Hesson debunks pitches 'myth', says there will be variety at ODI World Cup",
    text: 'Pakistan ODI coach defended the surfaces and pointed to preparation for future tournaments.',
  },
];

const formatDate = (value, options = {}) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'long', day: '2-digit', year: 'numeric', ...options });
};

const isResult = (match = {}) => {
  const marker = String(match.ms || match.status || '').toLowerCase();
  return match.matchEnded || marker === 'result' || marker === 'completed' || marker.includes('won');
};

const isUpcoming = (match = {}) => !isResult(match);

const scoreLine = (score = {}) => {
  if (score.chaseText) return score.chaseText;
  const runs = score.r ?? score.runs ?? 0;
  const wickets = score.w ?? score.wickets;
  if (wickets === undefined || wickets === null || Number(wickets) >= 10) return String(runs);
  return `${runs}/${wickets}`;
};

const teamCode = (score = {}, match = {}, index = 0) =>
  score.team || score.shortName || match.teamInfo?.[index]?.shortname || match.teams?.[index] || 'TBD';

const matchDescription = (match = {}, seriesName = '') => {
  if (match.description) return match.description;
  const number = match.name?.split(',')?.[1]?.trim() || match.name || 'ODI';
  const date = formatDate(match.dateTimeGMT || match.date);
  return [number, match.venue, date, seriesName.replace(' ODI Series', '')].filter(Boolean).join(', ');
};

function FlagBox({ code }) {
  const isPak = String(code).toUpperCase().includes('PAK');
  return (
    <span className={`inline-flex h-5 w-7 items-center justify-center rounded-sm text-[9px] font-black text-white ${isPak ? 'bg-emerald-700' : 'bg-blue-700'}`}>
      {String(code).slice(0, 3).toUpperCase()}
    </span>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
        {action && <span className="text-[11px] font-bold text-blue-700">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function ResultCard({ match, seriesName }) {
  return (
    <Link to={`/international/match/${getMatchId(match)}`} className="block border-b border-slate-100 px-4 py-4 last:border-0 hover:bg-slate-50">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Result</p>
      <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{matchDescription(match, seriesName)}</p>
      <div className="mt-4 space-y-3">
        {asArray(match.score).map((score, index) => {
          const code = teamCode(score, match, index);
          return (
            <div key={`${code}-${index}`} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <FlagBox code={code} />
                <span className="text-sm font-black text-slate-900">{String(code).toUpperCase()}</span>
              </div>
              <span className="text-right text-base font-black text-slate-900">{scoreLine(score)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm font-bold text-slate-800">{match.status}</p>
    </Link>
  );
}

function FixtureCard({ match, seriesName }) {
  const teams = asArray(match.teamInfo).length ? match.teamInfo : asArray(match.teams).map(team => ({ shortname: team, name: team }));
  return (
    <Link to={`/international/match/${getMatchId(match)}`} className="block border-b border-slate-100 px-4 py-4 last:border-0 hover:bg-slate-50">
      <p className="text-xs font-black text-slate-700">{match.startLabel || formatDate(match.dateTimeGMT || match.date, { hour: undefined })}</p>
      <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">{matchDescription(match, seriesName)}</p>
      <div className="mt-4 space-y-3">
        {teams.map((team, index) => {
          const code = team.shortname || team.name || team;
          return (
            <div key={`${code}-${index}`} className="flex items-center gap-2">
              <FlagBox code={code} />
              <span className="text-sm font-black text-slate-900">{String(code).slice(0, 3).toUpperCase()}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm font-bold text-slate-800">Match yet to begin</p>
    </Link>
  );
}

function StatsPanel() {
  return (
    <Panel title="Stats & Records" action="See All">
      <div className="px-4 py-4">
        <p className="text-[11px] font-black uppercase leading-5 tracking-widest text-slate-900">Australia in Pakistan ODIs</p>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {statsLinks.map(item => (
            <button key={item} className="text-left text-xs font-bold text-slate-700 hover:text-blue-700">
              <span className="mr-2 text-blue-700">&gt;</span>{item}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function LeaderPanel({ title, rows }) {
  return (
    <Panel title={title} action="View full list">
      <div className="divide-y divide-slate-100">
        {rows.map((row, index) => (
          <div key={`${row.name}-${index}`} className="flex items-center gap-3 px-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-500">
              {row.name.split(' ').map(part => part[0]).join('').slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-900">{row.name} <span className="text-xs font-semibold text-slate-500">{row.team}</span></p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">{row.detail}</p>
            </div>
            <span className="text-2xl font-black text-slate-900">{row.value || row.rating}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FanRatingsPanel() {
  return (
    <Panel title="Tournament Fan Ratings">
      <div className="divide-y divide-slate-100">
        {fanRatings.map(row => (
          <div key={row.rank} className="flex items-center gap-3 px-4 py-4">
            <span className="w-4 text-sm font-black text-slate-900">{row.rank}.</span>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-500">
              {row.name.split(' ').map(part => part[0]).join('').slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-900">{row.name} <span className="text-xs font-semibold text-slate-500">{row.team}</span></p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">{row.detail}</p>
            </div>
            <span className="rounded-full bg-green-400 px-2 py-2 text-xs font-black text-white">{row.rating}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 px-4 py-3 text-center text-xs font-bold text-blue-700">View full list</div>
    </Panel>
  );
}

function HeroVideo({ highlights }) {
  const first = highlights[0];
  const href = first?.watchUrl || 'https://www.youtube.com/results?search_query=Australia+Pakistan+2026+ODI+highlights';
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg bg-slate-950 text-white shadow-sm">
      <div className="relative min-h-[260px] bg-gradient-to-br from-indigo-950 via-blue-900 to-slate-950 p-6">
        <div className="absolute right-6 top-6 rounded-full bg-black/60 px-2 py-1 text-xs font-black">1:02</div>
        <div className="max-w-xs rounded border-4 border-blue-300/70 p-5">
          <p className="text-2xl font-black uppercase leading-tight text-emerald-300">I haven't got Babar worked out</p>
          <p className="mt-4 text-xs font-black uppercase tracking-widest text-blue-200">Nathan Ellis</p>
          <p className="text-xs font-bold uppercase text-blue-200">Australia bowler</p>
        </div>
        <div className="absolute bottom-5 left-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-xs font-black uppercase tracking-widest transition group-hover:scale-105">Play</div>
      </div>
      <div className="p-5">
        <h2 className="text-2xl font-black leading-tight">Ellis on Babar wicket: Good to get Pakistan's lynchpin out</h2>
        <p className="mt-2 text-sm font-semibold text-slate-200">Nathan Ellis reflects on Australia's win vs Pakistan in the 2nd ODI</p>
      </div>
    </a>
  );
}

function StoryList({ highlights }) {
  const searchLinks = highlights.filter(item => item.isSearchLink);
  return (
    <div className="space-y-4">
      {searchLinks.map(item => (
        <a key={item.watchUrl} href={item.watchUrl} target="_blank" rel="noreferrer" className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50">
          <div className="flex h-24 w-36 flex-shrink-0 items-center justify-center rounded bg-[#031d44] px-3 text-center text-xs font-black uppercase tracking-widest text-white">Highlights</div>
          <div>
            <h3 className="line-clamp-2 text-base font-black text-slate-900">{item.title}</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">{formatDate(item.matchDate)} - Open match highlights search</p>
          </div>
        </a>
      ))}
      {storyCards.map((story, index) => (
        <article key={story.title} className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className={`h-24 w-36 flex-shrink-0 rounded ${index % 2 === 0 ? 'bg-amber-100' : 'bg-emerald-100'}`} />
          <div>
            <h3 className="line-clamp-2 text-base font-black text-slate-900">{story.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-500">{story.text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function InternationalSeriesDetail() {
  const { seriesId } = useParams();
  const [seriesInfo, setSeriesInfo] = useState(null);
  const [points, setPoints] = useState([]);
  const [squad, setSquad] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('Home');

  const info = useMemo(() => getSeriesInfo(seriesInfo || {}), [seriesInfo]);
  const matches = useMemo(() => getSeriesMatches(seriesInfo || {}), [seriesInfo]);
  const results = useMemo(() => matches.filter(isResult), [matches]);
  const fixtures = useMemo(() => matches.filter(isUpcoming), [matches]);
  const navItems = ['Home', 'Fixtures and Results', 'Videos', 'Stats', 'Squads', 'Teams', 'Photos', 'Fan Ratings'];

  useEffect(() => {
    fetchData();
  }, [seriesId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [infoRes, pointsRes, squadRes, highlightsRes] = await Promise.all([
        api.get(`/international/series/${seriesId}`).catch(() => ({ data: { data: null } })),
        api.get(`/international/series/${seriesId}/points`).catch(() => ({ data: { data: [] } })),
        api.get(`/international/series/${seriesId}/squad`).catch(() => ({ data: { data: [] } })),
        api.get(`/international/highlights?seriesId=${encodeURIComponent(seriesId)}`).catch(() => ({ data: { data: [] } })),
      ]);

      setSeriesInfo(infoRes.data.data);
      setPoints(asArray(pointsRes.data.data));
      setSquad(asArray(squadRes.data.data));
      setHighlights(asArray(highlightsRes.data.data));
    } catch (error) {
      console.error('Series detail error:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderFixturesAndResults = () => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Fixtures" action="View All Fixtures">
        <div className="divide-y divide-slate-100">
          {fixtures.length ? fixtures.map(match => <FixtureCard key={getMatchId(match)} match={match} seriesName={info.name} />) : (
            <div className="px-4 py-8 text-sm font-bold text-slate-500">No upcoming fixtures.</div>
          )}
        </div>
      </Panel>
      <Panel title="Results" action="View All Results">
        <div className="divide-y divide-slate-100">
          {results.length ? results.map(match => <ResultCard key={getMatchId(match)} match={match} seriesName={info.name} />) : (
            <div className="px-4 py-8 text-sm font-bold text-slate-500">No results yet.</div>
          )}
        </div>
      </Panel>
    </div>
  );

  const renderVideos = () => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <HeroVideo highlights={highlights} />
      <StoryList highlights={highlights} />
    </div>
  );

  const renderStats = () => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <StatsPanel />
      <LeaderPanel title="PAK vs AUS 2026 Top Wicket Takers" rows={wicketLeaders} />
      <LeaderPanel title="PAK vs AUS 2026 Top Run Scorers" rows={runLeaders} />
    </div>
  );

  const renderSquads = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {squad.map(team => (
        <Panel key={team.teamName || team.name} title={team.teamName || team.name || 'Squad'}>
          <div className="grid grid-cols-1 gap-2 px-4 py-4 sm:grid-cols-2">
            {asArray(team.players || team.squad).map(player => (
              <div key={player.name || player} className="rounded bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
                {player.name || player}
                {player.role && <span className="ml-2 text-xs font-semibold text-slate-400">{player.role}</span>}
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );

  const renderTeams = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {squad.map(team => (
        <Panel key={team.teamName || team.name} title={team.teamName || team.name || 'Team'}>
          <div className="px-4 py-5">
            <div className="flex items-center gap-3">
              <FlagBox code={team.teamName || team.name} />
              <div>
                <h2 className="text-xl font-black text-slate-900">{team.teamName || team.name}</h2>
                <p className="text-sm font-semibold text-slate-500">{asArray(team.players || team.squad).length} players in squad</p>
              </div>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );

  const renderPhotos = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      {['Rawalpindi 1st ODI', 'Lahore 2nd ODI', 'Lahore 3rd ODI'].map((title, index) => (
        <Panel key={title} title={title}>
          <div className={`h-48 ${index === 0 ? 'bg-emerald-100' : index === 1 ? 'bg-amber-100' : 'bg-blue-100'}`} />
          <p className="px-4 py-3 text-sm font-bold text-slate-600">Series photo gallery placeholder</p>
        </Panel>
      ))}
    </div>
  );

  const renderFanRatings = () => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_0.9fr]">
      <FanRatingsPanel />
      <Panel title="Rate the series">
        <div className="px-4 py-8">
          <p className="text-sm font-semibold text-slate-500">Fan rating controls can be connected to user accounts later. Current rankings are shown from the series fallback data.</p>
        </div>
      </Panel>
    </div>
  );

  const renderActiveSection = () => {
    if (activeSection === 'Fixtures and Results') return renderFixturesAndResults();
    if (activeSection === 'Videos') return renderVideos();
    if (activeSection === 'Stats') return renderStats();
    if (activeSection === 'Squads') return renderSquads();
    if (activeSection === 'Teams') return renderTeams();
    if (activeSection === 'Photos') return renderPhotos();
    if (activeSection === 'Fan Ratings') return renderFanRatings();
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header />
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#031d44] border-t-transparent" />
            <p className="mt-4 text-sm font-bold text-slate-500">Loading series...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!seriesInfo) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header />
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-bold text-slate-500">Series not found</p>
            <Link to="/international" className="mt-2 inline-block text-sm font-bold text-blue-600">Back to International</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <Header />

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-3">
          {navItems.map(item => (
            <button
              key={item}
              onClick={() => setActiveSection(item)}
              className={`whitespace-nowrap text-xs font-bold ${activeSection === item ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 text-xs font-semibold text-slate-500">
          <Link to="/international" className="hover:text-blue-700">International</Link>
          <span className="px-2">&gt;</span>
          <span>{info.name || 'Australia tour of Pakistan 2026'}</span>
        </div>

        <div className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Series Status</p>
          <h1 className="mt-1 text-lg font-black text-slate-900">{info.name?.replace(' ODI Series', '') || 'Australia tour of Pakistan 2026'}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">3-match ODI series level 1-1</p>
        </div>

        {activeSection !== 'Home' ? renderActiveSection() : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_1fr_320px]">
          <aside className="space-y-5">
            <Panel title="Fixtures">
              <div className="divide-y divide-slate-100">
                {fixtures.map(match => <FixtureCard key={getMatchId(match)} match={match} seriesName={info.name} />)}
              </div>
              <div className="px-4 py-3 text-center text-xs font-bold text-blue-700">View All Fixtures</div>
            </Panel>

            <Panel title="Results">
              <div className="divide-y divide-slate-100">
                {results.map(match => <ResultCard key={getMatchId(match)} match={match} seriesName={info.name} />)}
              </div>
              <div className="px-4 py-3 text-center text-xs font-bold text-blue-700">View All Results</div>
            </Panel>

            <StatsPanel />
          </aside>

          <section className="space-y-4">
            <HeroVideo highlights={highlights} />
            <StoryList highlights={highlights} />
          </section>

          <aside className="space-y-5">
            <FanRatingsPanel />
            <LeaderPanel title="PAK vs AUS 2026 Top Wicket Takers" rows={wicketLeaders} />
            <LeaderPanel title="PAK vs AUS 2026 Top Run Scorers" rows={runLeaders} />

            <Panel title="Series Squads">
              <div className="space-y-4 px-4 py-4">
                {squad.map(team => (
                  <div key={team.teamName || team.name}>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{team.teamName || team.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {asArray(team.players || team.squad).slice(0, 8).map(player => (
                        <span key={player.name || player} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">{player.name || player}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {points.length > 0 && (
              <Panel title="Series Table">
                <div className="divide-y divide-slate-100">
                  {points.map(row => (
                    <div key={row.teamName || row.team} className="flex justify-between px-4 py-3 text-sm">
                      <span className="font-black">{row.teamName || row.team}</span>
                      <span className="font-bold text-slate-500">{row.wins || row.won || 0}-{row.losses || row.lost || 0}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </aside>
        </div>
        )}
      </main>
    </div>
  );
}
