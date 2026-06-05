import fetch from 'node-fetch';

const CRICBUZZ_HOST = process.env.RAPIDAPI_CRICKET_HOST || 'free-cricbuzz-cricket-api.p.rapidapi.com';
const CRICBUZZ_BASE = `https://${CRICBUZZ_HOST}`;
const HIGHLIGHT_HOST = 'cricket-highlights-api.p.rapidapi.com';
const HIGHLIGHT_BASE = `https://${HIGHLIGHT_HOST}`;

const PLACEHOLDER_KEYS = new Set([
  '',
  'paste_your_key_here',
  'your_key_here',
  'your_rapidapi_key_here',
]);

const cache = new Map();
const asArray = (value) => Array.isArray(value) ? value : [];
let rapidApiBlockedUntil = 0;
let lastRapidApiError = '';

const splitPathList = (value, fallback = []) =>
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .concat(fallback)
    .filter((item, index, list) => list.indexOf(item) === index);

const RAPID_PATHS = {
  live: splitPathList(process.env.RAPIDAPI_LIVE_MATCHES_PATHS, ['/cricket-matches-live', '/cricket-livescores']),
  upcoming: splitPathList(process.env.RAPIDAPI_UPCOMING_MATCHES_PATHS, ['/cricket-schedule-international', '/cricket-matches-upcoming']),
  recent: splitPathList(process.env.RAPIDAPI_RECENT_MATCHES_PATHS, ['/cricket-matches-recent']),
  matchInfo: splitPathList(process.env.RAPIDAPI_MATCH_INFO_PATHS, [
    '/cricket-match-info?matchid={id}',
    '/cricket-match-scoreboard?matchid={id}',
  ]),
  seriesInternational: splitPathList(process.env.RAPIDAPI_SERIES_INTERNATIONAL_PATHS, ['/cricket-series-international']),
  seriesLeague: splitPathList(process.env.RAPIDAPI_SERIES_LEAGUE_PATHS, ['/cricket-series-leagues']),
  seriesDomestic: splitPathList(process.env.RAPIDAPI_SERIES_DOMESTIC_PATHS, ['/cricket-series-domestic']),
  seriesMatches: splitPathList(process.env.RAPIDAPI_SERIES_MATCHES_PATHS, []),
};

export const getRapidApiKey = () => {
  const key = process.env.RAPIDAPI_KEY?.trim() || '';
  return PLACEHOLDER_KEYS.has(key) ? '' : key;
};

export const hasRapidApiKey = () => Boolean(getRapidApiKey());

export const getRapidApiStatus = () => ({
  configured: hasRapidApiKey(),
  host: CRICBUZZ_HOST,
  paths: RAPID_PATHS,
  blockedUntil: rapidApiBlockedUntil,
  lastError: lastRapidApiError,
});

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlSec) {
  cache.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}

function buildUrl(base, path, params = {}) {
  const url = new URL(`${base}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url;
}

async function rapidGet({ base, host, path, params = {}, ttl = 60, label }) {
  const apiKey = getRapidApiKey();
  if (!apiKey) return null;
  if (Date.now() < rapidApiBlockedUntil) return null;

  const cacheKey = `${host}:${path}:${JSON.stringify(params)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const url = buildUrl(base, path, params);
    const response = await fetch(url.toString(), {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': host,
        'User-Agent': 'curl/8.0.0',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.message || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    setCache(cacheKey, json, ttl);
    return json;
  } catch (error) {
    if (/not subscribed|forbidden|invalid api key|quota|exceeded/i.test(error.message)) {
      rapidApiBlockedUntil = Date.now() + 5 * 60 * 1000;
    }
    lastRapidApiError = error.message;
    console.error(`[${label}] ${path} error:`, error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function rapidGetFirst(paths, options = {}) {
  for (const path of paths) {
    const data = await rapidGet({ ...options, path });
    if (data) return data;
  }
  return null;
}

const cricbuzzGetFirst = (paths, ttl = 60) =>
  rapidGetFirst(paths, { base: CRICBUZZ_BASE, host: CRICBUZZ_HOST, ttl, label: 'Live Cricket Provider' });

const pathWithId = (path, id) =>
  String(path)
    .replaceAll('{id}', encodeURIComponent(id))
    .replaceAll('{matchId}', encodeURIComponent(id));

const highlightsGet = (path, params = {}, ttl = 3600) =>
  rapidGet({ base: HIGHLIGHT_BASE, host: HIGHLIGHT_HOST, path, params, ttl, label: 'Highlightly' });

function parseCricbuzzDate(value) {
  if (!value) return '';
  const raw = Number(value);
  if (!Number.isNaN(raw)) return new Date(raw).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function stateToMs(match = {}) {
  const marker = String(match.ms || match.state || match.status || match.note || '').toLowerCase();
  if (marker.includes('live') || marker.includes('progress') || marker.includes('stumps')) return 'live';
  if (marker.includes('complete') || marker.includes('finished') || marker.includes('result') || marker.includes('won')) return 'result';
  return 'preview';
}

function normalizeVenue(venue) {
  if (!venue) return '';
  if (typeof venue === 'string') return venue;
  return [venue.ground || venue.name, venue.city].filter(Boolean).join(', ');
}

function normalizeTeam(team = {}, fallback = 'Team') {
  if (typeof team === 'string') {
    return { id: '', name: team, shortname: team.slice(0, 3).toUpperCase(), img: '' };
  }
  return {
    id: team.teamId || team.id || '',
    name: team.teamName || team.name || fallback,
    shortname: team.teamSName || team.shortName || team.shortname || team.abbreviation || fallback.slice(0, 3).toUpperCase(),
    img: team.imageId ? `https://static.cricbuzz.com/a/img/v1/i1/c${team.imageId}/i.jpg` : (team.logo || team.img || ''),
  };
}

function normalizeScore(score = {}, team = {}) {
  if (!score || Object.keys(score).length === 0) return null;
  const innings = score.inngs1 || score.inngs2 || score;
  const code = team.shortname || team.shortName || team.abbreviation || team.name;
  return {
    inning: team.name || code || 'Innings',
    team: code,
    r: innings.runs ?? innings.r ?? 0,
    w: innings.wickets ?? innings.w ?? 0,
    o: innings.overs ?? innings.o ?? '',
  };
}

function scoreListFromCricbuzz(matchScore = {}, team1 = {}, team2 = {}) {
  return [
    normalizeScore(matchScore.team1Score, team1),
    normalizeScore(matchScore.team2Score, team2),
  ].filter(Boolean);
}

function normalizeCricbuzzMatch(raw = {}, fallbackSeries = {}) {
  const info = raw.matchInfo || raw.info || raw;
  const team1 = normalizeTeam(info.team1 || raw.team1, 'Team 1');
  const team2 = normalizeTeam(info.team2 || raw.team2, 'Team 2');
  const sourceState = fallbackSeries.sourceState || '';
  const ms = sourceState === 'live' || sourceState === 'upcoming' || sourceState === 'recent'
    ? (sourceState === 'recent' ? 'result' : sourceState)
    : stateToMs(info);
  const dateTimeGMT = parseCricbuzzDate(info.startDate || info.startTime || raw.startDate);
  const title = [team1.shortname, team2.shortname].filter(Boolean).join(' vs ');
  const matchName = [title || `${team1.name} vs ${team2.name}`, info.matchDesc].filter(Boolean).join(', ');
  const seriesName = info.seriesName || fallbackSeries.seriesName || fallbackSeries.name || '';
  const venue = normalizeVenue(info.venueInfo || info.venue);

  return {
    id: String(info.matchId || info.id || raw.id || ''),
    name: info.title || info.name || matchName,
    description: [info.matchDesc, venue, seriesName].filter(Boolean).join(', '),
    matchType: String(info.matchFormat || info.matchType || raw.matchType || '').toLowerCase() || 'match',
    status: info.status || raw.status || '',
    ms,
    venue,
    date: dateTimeGMT ? dateTimeGMT.slice(0, 10) : '',
    dateTimeGMT,
    matchStarted: ms === 'live' || ms === 'result',
    matchEnded: ms === 'result',
    teams: [team1.name, team2.name].filter(Boolean),
    teamInfo: [team1, team2],
    score: scoreListFromCricbuzz(raw.matchScore || raw.score || {}, team1, team2),
    series: {
      id: String(info.seriesId || fallbackSeries.seriesId || ''),
      name: seriesName,
      category: fallbackSeries.category || '',
    },
    startLabel: info.startDate ? '' : raw.startLabel,
  };
}

export function normalizeMatch(raw = {}) {
  if (raw.matchInfo || raw.matchScore) return normalizeCricbuzzMatch(raw);

  const match = raw.match || raw;
  const teamsObject = match.teams && !Array.isArray(match.teams) ? match.teams : {};
  const homeTeam = normalizeTeam(teamsObject.home || match.homeTeam || match.team1 || asArray(match.teams)[0], 'Home');
  const awayTeam = normalizeTeam(teamsObject.away || match.awayTeam || match.team2 || asArray(match.teams)[1], 'Away');
  const ms = match.ms || stateToMs(match);
  const homeScore = normalizeScore(match.score?.home || match.homeScore, homeTeam);
  const awayScore = normalizeScore(match.score?.away || match.awayScore, awayTeam);
  const score = asArray(match.score).length ? match.score : [awayScore, homeScore].filter(Boolean);

  return {
    id: String(match.id || match.matchId || ''),
    name: match.title || match.name || `${homeTeam.name} vs ${awayTeam.name}`,
    description: match.description || [match.title || match.name, normalizeVenue(match.venue)].filter(Boolean).join(', '),
    matchType: match.matchType || match.format || match.type || 'odi',
    status: match.status || match.state || '',
    ms,
    venue: normalizeVenue(match.venue),
    date: match.date || match.startDate || match.startTime?.slice(0, 10) || '',
    dateTimeGMT: match.dateTimeGMT || match.startTime || '',
    matchStarted: match.matchStarted ?? ms !== 'preview',
    matchEnded: match.matchEnded ?? ms === 'result',
    teams: [homeTeam.name, awayTeam.name].filter(Boolean),
    teamInfo: [homeTeam, awayTeam],
    score,
    series: match.series,
    toss: match.toss || '',
  };
}

function flattenCricbuzzMatches(raw = {}, category = '') {
  const matches = [];
  const response = raw.response || raw.data?.response || {};
  const wrappedMatchInfo = response.matchInfo || raw.matchInfo;

  asArray(wrappedMatchInfo).forEach(match => matches.push(normalizeMatch(match)));
  if (wrappedMatchInfo && !Array.isArray(wrappedMatchInfo)) {
    matches.push(normalizeMatch(wrappedMatchInfo));
  }

  for (const schedule of asArray(response.schedules || raw.schedules)) {
    const wrapper = schedule.scheduleAdWrapper || schedule;
    for (const seriesSchedule of asArray(wrapper.matchScheduleList)) {
      const seriesMeta = {
        seriesId: seriesSchedule.seriesId,
        seriesName: seriesSchedule.seriesName,
        category: seriesSchedule.seriesCategory || category,
        sourceState: category,
      };
      asArray(seriesSchedule.matchInfo).forEach(info => {
        matches.push(normalizeCricbuzzMatch({ matchInfo: info }, seriesMeta));
      });
    }
  }

  for (const typeMatch of asArray(raw.typeMatches)) {
    const typeName = typeMatch.matchType || category;
    for (const seriesMatch of asArray(typeMatch.seriesMatches)) {
      const wrapper = seriesMatch.seriesAdWrapper || seriesMatch.seriesWrapper || seriesMatch;
      const seriesMeta = {
        seriesId: wrapper.seriesId,
        seriesName: wrapper.seriesName,
        category: typeName,
        sourceState: category,
      };
      asArray(wrapper.matches).forEach(match => matches.push(normalizeCricbuzzMatch(match, seriesMeta)));
    }
  }

  for (const detail of asArray(raw.matchDetails)) {
    const map = detail.matchDetailsMap || detail;
    const seriesMeta = { seriesName: map.key || map.seriesName, category, sourceState: category };
    asArray(map.match || map.matches).forEach(match => matches.push(normalizeCricbuzzMatch(match, seriesMeta)));
  }

  asArray(raw.matches || raw.matchList || raw.data).forEach(match => matches.push(normalizeMatch(match)));
  asArray(response.matches || response.matchList || response.matchesList).forEach(match => matches.push(normalizeMatch(match)));

  const seen = new Set();
  return matches.filter(match => {
    if (!match.id || seen.has(match.id)) return false;
    seen.add(match.id);
    return true;
  });
}

function normalizeBatter(row = {}) {
  const batter = row.batsman || row;
  return {
    ...row,
    name: row.batName || batter.name || row.name || '-',
    r: row.runs ?? row.r ?? 0,
    b: row.balls ?? row.b ?? 0,
    fours: row.fours ?? row['4s'] ?? 0,
    sixes: row.sixes ?? row['6s'] ?? 0,
    sr: row.strikeRate ?? row.sr ?? '',
    dismissal: row.outDesc || row.dismissal || '',
  };
}

function normalizeBowler(row = {}) {
  const bowler = row.bowler || row;
  return {
    ...row,
    name: row.bowlName || bowler.name || row.name || '-',
    o: row.overs ?? row.o ?? 0,
    m: row.maidens ?? row.m ?? 0,
    r: row.runs ?? row.r ?? 0,
    w: row.wickets ?? row.w ?? 0,
    eco: row.economy ?? row.eco ?? '',
  };
}

function normalizeCricbuzzInnings(card = {}) {
  const bat = card.batTeamDetails || {};
  const score = card.scoreDetails || {};
  const batsmen = Object.values(bat.batsmenData || {}).map(normalizeBatter);
  const bowlers = Object.values(card.bowlTeamDetails?.bowlersData || {}).map(normalizeBowler);

  return {
    inning: bat.batTeamName || card.inningsName || 'Innings',
    title: bat.batTeamName || card.inningsName || 'Innings',
    team: bat.batTeamShortName || bat.batTeamName || '',
    r: score.runs ?? card.runs ?? 0,
    w: score.wickets ?? card.wickets ?? 0,
    o: score.overs ?? card.overs ?? '',
    batting: batsmen,
    batters: batsmen,
    bowling: bowlers,
    bowlers,
    fallOfWickets: Object.values(card.wicketsData || {}),
  };
}

function normalizeInnings(innings = {}) {
  const title = innings.title || innings.inning || 'Innings';
  const batting = asArray(innings.batters || innings.batting || innings.batsmen).map(normalizeBatter);
  const bowling = asArray(innings.bowlers || innings.bowling).map(normalizeBowler);

  return {
    ...innings,
    inning: title,
    title,
    r: innings.runs ?? innings.r ?? 0,
    w: innings.wickets ?? innings.w ?? 0,
    o: innings.overs ?? innings.o ?? '',
    batting,
    batters: batting,
    bowling,
    bowlers: bowling,
    fallOfWickets: asArray(innings.fallOfWickets),
  };
}

export function normalizeScorecard(raw = {}) {
  const wrapped = raw.response || raw.data?.response;
  if (wrapped?.matchInfo) {
    const match = normalizeMatch(wrapped.matchInfo);
    const scorecardRows = asArray(wrapped.scorecard || wrapped.scoreCard || wrapped.innings || wrapped.score);
    const innings = scorecardRows.map(normalizeInnings);
    const score = innings.length
      ? innings.map(item => ({ inning: item.inning, team: item.team || item.inning?.split(' ')[0], r: item.r, w: item.w, o: item.o }))
      : match.score;

    return {
      ...match,
      match: wrapped.matchInfo,
      score,
      scorecard: innings,
      innings,
      liveScore: wrapped.liveScore || wrapped.score || null,
      raw: wrapped,
    };
  }

  if (raw.scoreCard || raw.matchHeader) {
    const match = normalizeCricbuzzMatch({ matchInfo: raw.matchHeader || raw.matchInfo || raw });
    const innings = asArray(raw.scoreCard).map(normalizeCricbuzzInnings);
    return {
      ...match,
      match: raw.matchHeader || match,
      score: innings.map(item => ({ inning: item.inning, team: item.team, r: item.r, w: item.w, o: item.o })),
      scorecard: innings,
      innings,
      liveScore: raw.liveScore || null,
    };
  }

  const match = normalizeMatch(raw.match || raw);
  const innings = asArray(raw.scorecard || raw.innings || raw.score).map(normalizeInnings);
  const score = innings.length
    ? innings.map(item => ({ inning: item.inning, team: item.team || item.inning?.split(' ')[0], r: item.r, w: item.w, o: item.o }))
    : match.score;

  return {
    ...match,
    match: raw.match || match,
    score,
    scorecard: innings,
    innings,
    liveScore: raw.liveScore || null,
  };
}

function normalizeSeries(raw = {}, category = '') {
  const dateParts = String(raw.dates || '').split(/\s+-\s+/);
  const start = raw.startDt || raw.startDate || raw.startdate || raw.start_time || dateParts[0] || '';
  const end = raw.endDt || raw.endDate || raw.enddate || raw.end_time || dateParts[1] || '';
  const urlId = String(raw.url || '').match(/\/cricket-series\/([^/]+)/)?.[1] || '';
  return {
    ...raw,
    id: String(raw.id || raw.seriesId || raw.key || urlId || ''),
    name: raw.name || raw.series || raw.title || raw.seriesName || 'Cricket series',
    startDate: parseCricbuzzDate(start),
    endDate: parseCricbuzzDate(end),
    matches: raw.matches || raw.matchCount || raw.totalMatches || 0,
    category: category || raw.category || raw.type || '',
  };
}

function flattenCricbuzzSeries(raw = {}, category = '') {
  if (!raw) return [];
  const rows = [];
  const response = raw.response || raw.data?.response;
  asArray(response).forEach(series => rows.push(normalizeSeries(series, category)));
  for (const group of asArray(raw.seriesMapProto || raw.seriesMap || raw.data)) {
    asArray(group.series || group.list || group.items).forEach(series => rows.push(normalizeSeries(series, category || group.date)));
  }
  asArray(raw.series || raw.seriesList || raw.items).forEach(series => rows.push(normalizeSeries(series, category)));
  return rows.filter(series => series.id);
}

function normalizeSeriesPayload(raw = {}, id = '') {
  const info = normalizeSeries(raw.series || raw.info || raw, raw.category);
  const matchList = flattenCricbuzzMatches(raw, info.category);
  return {
    info: { ...info, id: info.id || String(id) },
    matchList: matchList.length ? matchList : asArray(raw.matches || raw.matchList || raw.data || raw.fixtures).map(normalizeMatch),
  };
}

function getMatchSeriesId(match = {}) {
  return String(
    match.series?.id
    || match.series?.seriesId
    || match.seriesId
    || match.info?.seriesId
    || match.matchInfo?.seriesId
    || ''
  );
}

function normalizeHighlight(raw = {}) {
  const match = raw.match || {};
  return {
    videoId: String(raw.id || raw.videoId || raw.url || ''),
    title: raw.title || 'Cricket highlights',
    description: raw.description || '',
    thumbnail: raw.imgUrl || raw.thumbnail || raw.thumbnailUrl || '',
    channelName: raw.channel || raw.channelName || raw.source || 'Highlightly',
    publishedAt: raw.date || raw.createdAt || '',
    embedUrl: raw.embedUrl || '',
    watchUrl: raw.url || raw.watchUrl || raw.embedUrl || '',
    matchId: match.id || raw.matchId || '',
    matchName: match.title || [match.homeTeam?.name, match.awayTeam?.name].filter(Boolean).join(' vs '),
    matchDate: match.date || raw.date || '',
    source: raw.source || 'highlightly',
  };
}

function normalizeHighlightList(raw = {}) {
  return asArray(raw.data || raw.highlights || raw.items || raw).map(normalizeHighlight);
}

function cleanText(value = '') {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function imageFromId(imageId, width = 420, height = 235) {
  return imageId ? `https://static.cricbuzz.com/a/img/v1/${width}x${height}/i1/c${imageId}/i.jpg` : '';
}

function extractList(raw = {}, keys = []) {
  if (Array.isArray(raw)) return raw;
  const roots = [raw, raw?.data, raw?.response, raw?.result, raw?.content];
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    for (const key of keys) {
      if (Array.isArray(root[key])) return root[key];
    }
  }
  return [];
}

function normalizeCommentaryItem(row = {}, index = 0) {
  const overValue = row.overNumber ?? row.ballNbr ?? row.over ?? row.overs ?? row.o ?? '';
  const text = cleanText(row.commText || row.commentary || row.text || row.comment || row.description || row.desc || '');
  return {
    id: String(row.id || row.timestamp || row.commentaryId || `${overValue}-${index}`),
    over: overValue === '' ? '' : String(overValue),
    ball: row.ballNbr ?? row.ball ?? '',
    text,
    event: row.event || row.eventType || row.wicketCode || '',
    score: row.score || row.batTeamScore || row.teamScore || '',
    timestamp: row.timestamp || row.time || row.createdAt || '',
  };
}

function normalizeCommentaryList(raw = {}) {
  const list = extractList(raw, ['commentaryList', 'commentary', 'commLines', 'comments', 'items', 'data']);
  return list
    .map((row, index) => normalizeCommentaryItem(row, index))
    .filter(item => item.text || item.score || item.event);
}

function normalizeOverItem(row = {}, index = 0) {
  const over = row.overNum ?? row.overNumber ?? row.over ?? row.o ?? index + 1;
  const summary = row.o_summary || row.overSummary || row.summary || row.balls || '';
  const balls = Array.isArray(summary)
    ? summary
    : String(summary || '').split(/\s+/).filter(Boolean).map((value, ballIndex) => ({
      id: `${over}-${ballIndex}`,
      value,
    }));

  return {
    id: String(row.id || row.timestamp || over),
    over: String(over),
    runs: row.runs ?? row.r ?? '',
    wickets: row.wickets ?? row.w ?? '',
    summary: typeof summary === 'string' ? cleanText(summary) : '',
    balls,
    batters: [row.batStrikerNames, row.batNonStrikerNames].filter(Boolean).join(', '),
    bowler: row.bowlerName || row.bowlName || row.bowler || '',
  };
}

function groupCommentaryToOvers(commentary = []) {
  const buckets = new Map();
  commentary.forEach(item => {
    const rawOver = String(item.over || item.ball || '').trim();
    const overKey = rawOver.includes('.') ? rawOver.split('.')[0] : rawOver || 'Live';
    if (!buckets.has(overKey)) {
      buckets.set(overKey, {
        id: overKey,
        over: overKey,
        runs: '',
        wickets: '',
        summary: '',
        balls: [],
        commentary: [],
      });
    }
    const bucket = buckets.get(overKey);
    bucket.commentary.push(item);
    if (item.ball || item.event || item.text) {
      bucket.balls.push({
        id: item.id,
        value: item.event && item.event !== 'NONE' ? item.event : (item.ball || item.over || ''),
        text: item.text,
      });
    }
  });
  return Array.from(buckets.values());
}

function normalizeOversList(raw = {}) {
  const list = extractList(raw, ['overSepList', 'overs', 'overList', 'items', 'data']);
  if (list.length) return list.map(normalizeOverItem);
  const commentary = normalizeCommentaryList(raw);
  return groupCommentaryToOvers(commentary);
}

function playerDisplayName(player = {}) {
  if (typeof player === 'string') return player;
  return player.name || player.fullName || player.playerName || player.nickName || player.batName || player.bowlName || '';
}

function normalizePlayer(player = {}) {
  if (typeof player === 'string') return { name: player, role: '' };
  return {
    id: String(player.id || player.playerId || player.pid || ''),
    name: playerDisplayName(player),
    role: player.role || player.playerRole || player.battingStyle || '',
    image: imageFromId(player.imageId, 120, 120) || player.image || player.img || '',
    captain: Boolean(player.captain || player.isCaptain),
    keeper: Boolean(player.keeper || player.isKeeper),
  };
}

function normalizeTeamPlayers(team = {}, fallbackName = 'Team') {
  const players = extractList(team, ['players', 'playerDetails', 'squad', 'playingXI', 'xi', 'teamPlayers'])
    .map(normalizePlayer)
    .filter(player => player.name);
  return {
    teamId: String(team.teamId || team.id || ''),
    teamName: team.teamName || team.name || fallbackName,
    shortName: team.teamSName || team.shortName || team.shortname || '',
    players,
  };
}

function derivePlayingXiFromScorecard(scorecard = {}) {
  const innings = asArray(scorecard?.innings || scorecard?.scorecard);
  const teams = asArray(scorecard?.teamInfo).length
    ? asArray(scorecard.teamInfo).map(team => team.name || team.shortname).filter(Boolean)
    : asArray(scorecard?.teams);
  const names = teams.length ? teams : innings.map(item => item.team || item.title || item.inning).filter(Boolean);
  const buckets = new Map(names.map(name => [String(name), new Map()]));

  innings.forEach((inningsData, index) => {
    const battingTeam = String(inningsData.team || inningsData.title || inningsData.inning || names[index] || `Team ${index + 1}`);
    const bowlingTeam = names.find(name => String(name) !== battingTeam) || names[(index + 1) % Math.max(names.length, 1)] || 'Opposition';
    if (!buckets.has(battingTeam)) buckets.set(battingTeam, new Map());
    if (!buckets.has(bowlingTeam)) buckets.set(bowlingTeam, new Map());

    asArray(inningsData.batting || inningsData.batters).forEach(player => {
      const name = playerDisplayName(player);
      if (name) buckets.get(battingTeam).set(name, normalizePlayer(player));
    });

    asArray(inningsData.bowling || inningsData.bowlers).forEach(player => {
      const name = playerDisplayName(player);
      if (name) buckets.get(bowlingTeam).set(name, normalizePlayer(player));
    });
  });

  return Array.from(buckets.entries())
    .map(([teamName, playerMap]) => ({ teamName, players: Array.from(playerMap.values()).slice(0, 15) }))
    .filter(team => team.players.length);
}

function normalizePlayingXI(raw = {}, scorecard = null) {
  const info = raw.matchInfo || raw.matchHeader || raw;
  const candidates = [
    normalizeTeamPlayers(info.team1 || raw.team1 || {}, 'Team 1'),
    normalizeTeamPlayers(info.team2 || raw.team2 || {}, 'Team 2'),
  ].filter(team => team.players.length);

  const matchTeamInfo = extractList(raw, ['matchTeamInfo', 'teams']);
  matchTeamInfo.forEach((team, index) => {
    const normalized = normalizeTeamPlayers(team, `Team ${index + 1}`);
    if (normalized.players.length) candidates.push(normalized);
  });

  if (candidates.length) return candidates;
  return derivePlayingXiFromScorecard(scorecard || raw);
}

function normalizeArticle(row = {}) {
  const article = row.story || row.news || row.article || row;
  const id = String(article.id || article.storyId || article.itemId || article.url || '');
  const title = cleanText(article.hline || article.headline || article.title || article.name || '');
  return {
    id,
    title,
    description: cleanText(article.intro || article.description || article.summary || ''),
    image: article.image || article.imageUrl || article.thumbnail || imageFromId(article.imageId),
    url: article.url || (id ? `https://www.cricbuzz.com/cricket-news/${id}` : ''),
    publishedAt: parseCricbuzzDate(article.pubTime || article.publishedAt || article.date || ''),
    source: article.source || 'BQ-PLAY Live Provider',
  };
}

function normalizeNewsList(raw = {}) {
  return extractList(raw, ['storyList', 'newsList', 'articles', 'items', 'data'])
    .map(normalizeArticle)
    .filter(article => article.title);
}

function normalizePhoto(row = {}) {
  const photo = row.photo || row.story || row.item || row;
  const id = String(photo.id || photo.photoId || photo.imageId || photo.url || '');
  const title = cleanText(photo.caption || photo.title || photo.hline || photo.headline || 'Cricket photo');
  return {
    id,
    title,
    description: cleanText(photo.description || photo.intro || ''),
    image: photo.image || photo.imageUrl || photo.thumbnail || imageFromId(photo.imageId || id, 420, 280),
    url: photo.url || '',
    publishedAt: parseCricbuzzDate(photo.pubTime || photo.publishedAt || photo.date || ''),
    source: photo.source || 'BQ-PLAY Live Provider',
  };
}

function normalizePhotoList(raw = {}) {
  return extractList(raw, ['photoList', 'photos', 'items', 'data'])
    .map(normalizePhoto)
    .filter(photo => photo.image || photo.title);
}

function normalizeCricbuzzVideo(row = {}) {
  const video = row.video || row.story || row.item || row;
  const id = String(video.id || video.videoId || video.itemId || video.url || '');
  const title = cleanText(video.title || video.hline || video.headline || video.caption || 'Cricket video');
  return {
    videoId: id,
    title,
    description: cleanText(video.description || video.intro || video.subtitle || ''),
    thumbnail: video.thumbnail || video.image || video.imageUrl || imageFromId(video.imageId),
    watchUrl: video.url || (id ? `https://www.cricbuzz.com/cricket-videos/${id}` : ''),
    publishedAt: parseCricbuzzDate(video.pubTime || video.publishedAt || video.date || ''),
    source: video.source || 'BQ-PLAY Live Provider',
  };
}

function normalizeVideoList(raw = {}) {
  return extractList(raw, ['videoList', 'videos', 'storyList', 'items', 'data'])
    .map(normalizeCricbuzzVideo)
    .filter(video => video.title);
}

function buildLiveStats(scorecard = {}, commentary = [], overs = []) {
  const innings = asArray(scorecard?.innings || scorecard?.scorecard);
  const topBatters = innings
    .flatMap(inningsData => asArray(inningsData.batting || inningsData.batters).map(player => ({
      name: playerDisplayName(player),
      team: inningsData.team || inningsData.title || inningsData.inning || '',
      runs: Number(player.r ?? player.runs ?? 0),
      balls: Number(player.b ?? player.balls ?? 0),
      sr: player.sr || player.strikeRate || '',
    })))
    .filter(player => player.name)
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 5);

  const topBowlers = innings
    .flatMap(inningsData => asArray(inningsData.bowling || inningsData.bowlers).map(player => ({
      name: playerDisplayName(player),
      wickets: Number(player.w ?? player.wickets ?? 0),
      runs: Number(player.r ?? player.runs ?? 0),
      overs: player.o || player.overs || '',
      eco: player.eco || player.economy || '',
    })))
    .filter(player => player.name)
    .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)
    .slice(0, 5);

  return {
    inningsSummary: innings.map(item => ({
      team: item.team || item.title || item.inning || 'Innings',
      runs: item.r ?? item.runs ?? 0,
      wickets: item.w ?? item.wickets ?? 0,
      overs: item.o ?? item.overs ?? '',
    })),
    topBatters,
    topBowlers,
    latestBall: commentary[0] || null,
    oversCount: overs.length,
    status: scorecard?.status || '',
  };
}

export async function getAllMatches() {
  const buckets = [];
  for (const [state, paths, ttl] of [
    ['live', RAPID_PATHS.live, 30],
    ['upcoming', RAPID_PATHS.upcoming, 300],
    ['recent', RAPID_PATHS.recent, 300],
  ]) {
    const bucket = await cricbuzzGetFirst(paths, ttl);
    buckets.push({ state, bucket });
    if (bucket) await new Promise(resolve => setTimeout(resolve, 350));
  }

  const matches = buckets.flatMap(({ state, bucket }) =>
    bucket ? flattenCricbuzzMatches(bucket, state) : []
  );
  if (matches.length) return matches;

  return null;
}

export async function getAllSeries() {
  const categories = [];
  for (const paths of [RAPID_PATHS.seriesInternational, RAPID_PATHS.seriesLeague, RAPID_PATHS.seriesDomestic]) {
    const category = await cricbuzzGetFirst(paths, 3600);
    categories.push(category);
    if (category) await new Promise(resolve => setTimeout(resolve, 350));
  }

  const series = [
    ...flattenCricbuzzSeries(categories[0], 'international'),
    ...flattenCricbuzzSeries(categories[1], 'league'),
    ...flattenCricbuzzSeries(categories[2], 'domestic'),
  ];

  const seen = new Set();
  return series.filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function getSeriesMatches(id) {
  const targetId = String(id || '').trim();
  if (!targetId) return null;

  const [seriesRows, matches] = await Promise.all([
    getAllSeries(),
    getAllMatches(),
  ]);

  const info = asArray(seriesRows).find(series =>
    String(series.id || series.seriesId || '').trim() === targetId
  );

  const matchList = asArray(matches).filter(match => getMatchSeriesId(match) === targetId);
  if (info || matchList.length) {
    return {
      info: info || {
        id: targetId,
        name: matchList[0]?.series?.name || 'Cricket series',
        category: matchList[0]?.series?.category || '',
      },
      matchList,
    };
  }

  const detailPaths = RAPID_PATHS.seriesMatches.map(path => pathWithId(path, targetId));
  if (!detailPaths.length) return null;

  const data = await cricbuzzGetFirst(detailPaths, 300);
  return data ? normalizeSeriesPayload(data, targetId) : null;
}

export async function getMatchScorecard(id) {
  const data = await cricbuzzGetFirst(RAPID_PATHS.matchInfo.map(path => pathWithId(path, id)), 30);
  return data ? normalizeScorecard(data) : null;
}

export async function getMatchCommentary(id) {
  const encoded = encodeURIComponent(id);
  const data = await cricbuzzGetFirst([`/mcenter/v1/${encoded}/comm`], 15);
  return data ? normalizeCommentaryList(data) : null;
}

export async function getMatchOvers(id) {
  const encoded = encodeURIComponent(id);
  const data = await cricbuzzGetFirst([`/mcenter/v1/${encoded}/overs`], 30);
  return data ? normalizeOversList(data) : null;
}

export async function getMatchPlayingXI(id, scorecard = null) {
  const derived = derivePlayingXiFromScorecard(scorecard || {});
  if (derived.some(team => team.players.length >= 6)) return derived;

  const encoded = encodeURIComponent(id);
  const data = await cricbuzzGetFirst([`/mcenter/v1/${encoded}`], 60);
  if (!data) return derived.length ? derived : null;

  const normalized = normalizePlayingXI(data, scorecard);
  return normalized.length ? normalized : (derived.length ? derived : null);
}

export async function getMatchPhotos() {
  const data = await cricbuzzGetFirst(['/photos/v1/index'], 1800);
  return data ? normalizePhotoList(data) : null;
}

export async function getMatchNews() {
  const data = await cricbuzzGetFirst(['/news/v1/index'], 300);
  return data ? normalizeNewsList(data) : null;
}

export async function getMatchVideos() {
  const data = await cricbuzzGetFirst(['/videos/v1/index'], 900);
  return data ? normalizeVideoList(data) : null;
}

export async function getMatchLiveStats(id) {
  const [scorecard, commentary, overs] = await Promise.all([
    getMatchScorecard(id),
    getMatchCommentary(id),
    getMatchOvers(id),
  ]);
  const commentaryList = commentary || [];
  const overList = overs?.length ? overs : groupCommentaryToOvers(commentaryList);
  return buildLiveStats(scorecard || {}, commentaryList, overList);
}

export async function getMatchCenter(id) {
  const [scorecard, commentary, overs, photos, news, videos] = await Promise.all([
    getMatchScorecard(id),
    getMatchCommentary(id),
    getMatchOvers(id),
    getMatchPhotos(id),
    getMatchNews(id),
    getMatchVideos(id),
  ]);
  const commentaryList = commentary || [];
  const overList = overs?.length ? overs : groupCommentaryToOvers(commentaryList);
  const playingXI = await getMatchPlayingXI(id, scorecard);

  return {
    match: scorecard?.match || scorecard || null,
    scorecard,
    commentary: commentaryList,
    overs: overList,
    playingXI: playingXI || [],
    photos: photos || [],
    news: news || [],
    videos: videos || [],
    stats: buildLiveStats(scorecard || {}, commentaryList, overList),
    apiStatus: getRapidApiStatus(),
  };
}

export async function getTeamSquad(id) {
  const encoded = encodeURIComponent(id);
  const data = await cricbuzzGetFirst([
    `/teams/v1/${encoded}/players`,
    `/teams/${encoded}/players`,
    `/teams/${encoded}`,
  ], 3600);
  if (!data) return null;
  return data.players || data.team?.players || data.squad || data.data || [];
}

export async function getPlayerInfo(id) {
  const encoded = encodeURIComponent(id);
  return cricbuzzGetFirst([`/stats/v1/player/${encoded}`, `/players/v1/${encoded}`, `/players/${encoded}`], 3600);
}

export async function getHighlightsByDate(date) {
  const data = await highlightsGet('/highlights', { date, limit: 10 }, 3600);
  return data ? normalizeHighlightList(data) : null;
}

export async function getMatchHighlights(matchId) {
  const data = await highlightsGet('/highlights', { matchId, limit: 6 }, 3600);
  return data ? normalizeHighlightList(data) : null;
}

export async function getTeamHighlights(teamName) {
  const data = await highlightsGet('/highlights', { homeTeamName: teamName, limit: 8 }, 3600);
  return data ? normalizeHighlightList(data) : null;
}

export async function getH2H(homeId, awayId) {
  return highlightsGet('/head-2-head', { homeTeamId: homeId, awayTeamId: awayId }, 86400);
}

export async function getLastFive(teamId) {
  return highlightsGet('/last-five-games', { teamId }, 3600);
}
