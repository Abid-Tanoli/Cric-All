import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { api } from '../services/api';

const asArray = (value) => Array.isArray(value) ? value : [];
const getSeriesInfo = (series = {}) => series.info || series.series || series;
const getSeriesMatches = (series = {}) => asArray(series.matchList || series.matches || series.matchInfo);
const getMatchId = (match = {}) => match.id || match._id || match.matchId;

const statsLinks = ['Most Runs', 'Most Wickets', 'High Scores', 'Best Bowling', 'High Team Totals', 'Most Catches'];

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

const seriesSummary = (matches = [], info = {}) => {
  const total = matches.length || Number(info.matches || info.totalMatches || 0);
  const results = matches.filter(isResult).length;
  const fixtures = matches.filter(isUpcoming).length;
  const format = info.matchType || info.format || '';
  const parts = [];
  if (total) parts.push(`${total} match${total === 1 ? '' : 'es'}`);
  if (format) parts.push(format);
  if (results) parts.push(`${results} result${results === 1 ? '' : 's'}`);
  if (fixtures) parts.push(`${fixtures} fixture${fixtures === 1 ? '' : 's'}`);
  if (info.dates) parts.push(info.dates);
  return parts.length ? parts.join(' - ') : 'Series details from BQ-PLAY live data provider';
};

const providerMessage = (status) => {
  const rawMessage = status?.lastError || status?.rapid?.lastError || status?.free?.lastError || '';
  const message = String(rawMessage);
  if (!message) return '';
  if (/quota|too many requests/i.test(message)) {
    return 'Live data limit reached for the current provider plan. Upgrade the plan or wait for quota reset to restore real-time series data.';
  }
  if (/not subscribed/i.test(message)) {
    return 'Live data provider is configured, but this account is not subscribed to the required cricket API.';
  }
  if (/payment required/i.test(message)) {
    return 'Live data provider requires an active paid plan for this endpoint.';
  }
  if (/endpoint .*does not exist|not found/i.test(message)) {
    return 'The current live provider does not expose this series endpoint.';
  }
  return message;
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

function EmptyPanelMessage({ children }) {
  return <div className="px-4 py-8 text-sm font-bold text-slate-500">{children}</div>;
}

function StatsPanel({ seriesName }) {
  return (
    <Panel title="Stats & Records" action="See All">
      <div className="px-4 py-4">
        <p className="text-[11px] font-black uppercase leading-5 tracking-widest text-slate-900">{seriesName || 'Series records'}</p>
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
        {rows.length ? rows.map((row, index) => (
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
        )) : <EmptyPanelMessage>No leaderboard data available from the live provider yet.</EmptyPanelMessage>}
      </div>
    </Panel>
  );
}

function FanRatingsPanel() {
  return (
    <Panel title="Tournament Fan Ratings">
      <div className="divide-y divide-slate-100">
        <EmptyPanelMessage>Fan ratings will appear after users rate this series.</EmptyPanelMessage>
      </div>
    </Panel>
  );
}

function HeroVideo({ highlights }) {
  const first = highlights[0];
  if (!first) {
    return (
      <Panel title="Videos">
        <EmptyPanelMessage>No videos available from the live provider yet.</EmptyPanelMessage>
      </Panel>
    );
  }
  const href = first.watchUrl || first.embedUrl || '#';
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg bg-slate-950 text-white shadow-sm">
      <div className="relative min-h-[260px] bg-gradient-to-br from-[#031d44] via-blue-900 to-slate-950 p-6">
        {first.thumbnail ? <img src={first.thumbnail} alt={first.title} className="absolute inset-0 h-full w-full object-cover opacity-70" /> : null}
        <div className="absolute bottom-5 left-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-xs font-black uppercase tracking-widest transition group-hover:scale-105">Play</div>
      </div>
      <div className="p-5">
        <h2 className="text-2xl font-black leading-tight">{first.title || 'Series video'}</h2>
        <p className="mt-2 text-sm font-semibold text-slate-200">{first.description || first.channelName || 'BQ-PLAY video'}</p>
      </div>
    </a>
  );
}

function StoryList({ highlights }) {
  const searchLinks = highlights.filter(item => item.watchUrl || item.isSearchLink);
  return (
    <div className="space-y-4">
      {searchLinks.length ? searchLinks.map(item => (
        <a key={item.watchUrl} href={item.watchUrl} target="_blank" rel="noreferrer" className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50">
          <div className="flex h-24 w-36 flex-shrink-0 items-center justify-center rounded bg-[#031d44] px-3 text-center text-xs font-black uppercase tracking-widest text-white">Highlights</div>
          <div>
            <h3 className="line-clamp-2 text-base font-black text-slate-900">{item.title}</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">{formatDate(item.matchDate || item.publishedAt)} - Open video</p>
          </div>
        </a>
      )) : (
        <Panel title="News and video links">
          <EmptyPanelMessage>No related stories or video links available from the live provider yet.</EmptyPanelMessage>
        </Panel>
      )}
    </div>
  );
}

export default function InternationalSeriesDetail() {
  const { seriesId } = useParams();
  const [seriesInfo, setSeriesInfo] = useState(null);
  const [points, setPoints] = useState([]);
  const [squad, setSquad] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [providerStatus, setProviderStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('Home');

  const info = useMemo(() => getSeriesInfo(seriesInfo || {}), [seriesInfo]);
  const matches = useMemo(() => getSeriesMatches(seriesInfo || {}), [seriesInfo]);
  const results = useMemo(() => matches.filter(isResult), [matches]);
  const fixtures = useMemo(() => matches.filter(isUpcoming), [matches]);
  const navItems = ['Home', 'Fixtures and Results', 'Videos', 'Stats', 'Squads', 'Teams', 'Photos', 'Fan Ratings'];
  const liveProviderMessage = providerMessage(providerStatus);

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
      setProviderStatus(infoRes.data.providerStatus || null);
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
      <StatsPanel seriesName={info.name} />
      <LeaderPanel title="Top Wicket Takers" rows={[]} />
      <LeaderPanel title="Top Run Scorers" rows={[]} />
    </div>
  );

  const renderSquads = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {squad.length ? squad.map(team => (
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
      )) : (
        <Panel title="Squads">
          <EmptyPanelMessage>No squad data available from the live provider yet.</EmptyPanelMessage>
        </Panel>
      )}
    </div>
  );

  const renderTeams = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {squad.length ? squad.map(team => (
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
      )) : (
        <Panel title="Teams">
          <EmptyPanelMessage>No team data available from the live provider yet.</EmptyPanelMessage>
        </Panel>
      )}
    </div>
  );

  const renderPhotos = () => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <Panel title="Photos">
        <EmptyPanelMessage>No photos available from the live provider yet.</EmptyPanelMessage>
      </Panel>
    </div>
  );

  const renderFanRatings = () => (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_0.9fr]">
      <FanRatingsPanel />
      <Panel title="Rate the series">
        <div className="px-4 py-8">
          <p className="text-sm font-semibold text-slate-500">Fan rating controls can be connected to user accounts later.</p>
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
    const title = liveProviderMessage ? 'Live data unavailable' : 'Series not found';
    const body = liveProviderMessage || 'BQ-PLAY could not find this series from the current live data source.';
    return (
      <div className="min-h-screen bg-slate-50">
        <Header />
        <div className="flex min-h-[70vh] items-center justify-center">
          <div className="mx-auto max-w-lg px-4 text-center">
            <p className="text-lg font-black text-slate-700">{title}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{body}</p>
            <Link to="/international" className="mt-4 inline-block rounded-md bg-[#031d44] px-4 py-2 text-xs font-black uppercase tracking-widest text-white">Back to International</Link>
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
          <span>{info.name || 'Series detail'}</span>
        </div>

        <div className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Series Status</p>
          <h1 className="mt-1 text-lg font-black text-slate-900">{info.name?.replace(' ODI Series', '') || 'Series detail'}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">{seriesSummary(matches, info)}</p>
        </div>

        {(liveProviderMessage || !matches.length) && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Live Data Notice</p>
            <p className="mt-1 text-sm font-bold leading-6 text-amber-900">
              {liveProviderMessage || 'Series metadata loaded, but the current live provider did not return fixtures or results for this series.'}
            </p>
          </div>
        )}

        {activeSection !== 'Home' ? renderActiveSection() : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[290px_1fr_320px]">
          <aside className="space-y-5">
            <Panel title="Fixtures">
              <div className="divide-y divide-slate-100">
                {fixtures.length ? fixtures.map(match => <FixtureCard key={getMatchId(match)} match={match} seriesName={info.name} />) : (
                  <EmptyPanelMessage>No fixtures available from the live provider yet.</EmptyPanelMessage>
                )}
              </div>
              <div className="px-4 py-3 text-center text-xs font-bold text-blue-700">View All Fixtures</div>
            </Panel>

            <Panel title="Results">
              <div className="divide-y divide-slate-100">
                {results.length ? results.map(match => <ResultCard key={getMatchId(match)} match={match} seriesName={info.name} />) : (
                  <EmptyPanelMessage>No results available from the live provider yet.</EmptyPanelMessage>
                )}
              </div>
              <div className="px-4 py-3 text-center text-xs font-bold text-blue-700">View All Results</div>
            </Panel>

            <StatsPanel seriesName={info.name} />
          </aside>

          <section className="space-y-4">
            <HeroVideo highlights={highlights} />
            <StoryList highlights={highlights} />
          </section>

          <aside className="space-y-5">
            <FanRatingsPanel />
            <LeaderPanel title="Top Wicket Takers" rows={[]} />
            <LeaderPanel title="Top Run Scorers" rows={[]} />

            <Panel title="Series Squads">
              <div className="space-y-4 px-4 py-4">
                {squad.length ? squad.map(team => (
                  <div key={team.teamName || team.name}>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{team.teamName || team.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {asArray(team.players || team.squad).slice(0, 8).map(player => (
                        <span key={player.name || player} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">{player.name || player}</span>
                      ))}
                    </div>
                  </div>
                )) : <EmptyPanelMessage>No squad data available from the live provider yet.</EmptyPanelMessage>}
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
