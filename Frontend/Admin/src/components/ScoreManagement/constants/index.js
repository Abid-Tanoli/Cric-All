export const TAB_ROUTE_BY_ID = {
  live: '',
  scorecard: 'scorecard',
  commentary: 'commentary',
  stats: 'live-stats',
  overs: 'overs',
  xi: 'playing-xi',
  table: 'table',
  photos: 'photos',
  videos: 'videos',
  blogs: 'blogs'
};

export const TAB_ID_BY_ROUTE = Object.entries(TAB_ROUTE_BY_ID).reduce((acc, [id, route]) => {
  if (route) acc[route] = id;
  return acc;
}, {});

export const getScoreTabPath = (matchId, tabId) => {
  const route = TAB_ROUTE_BY_ID[tabId] || '';
  return `/admin/score/${matchId}${route ? `/${route}` : ''}`;
};

export const getTabIdFromRoute = (tabId) => {
  if (!tabId) return 'live';
  if (TAB_ROUTE_BY_ID[tabId] !== undefined) return tabId;
  return TAB_ID_BY_ROUTE[tabId] || 'live';
};

export const FIELD_POSITIONS = [
  { id: 'wicket_keeper', name: 'Wicket Keeper', x: 200, y: 235 },
  { id: 'slip_1', name: '1st Slip', x: 170, y: 240 },
  { id: 'slip_2', name: '2nd Slip', x: 155, y: 245 },
  { id: 'gully', name: 'Gully', x: 140, y: 230 },
  { id: 'leg_slip', name: 'Leg Slip', x: 228, y: 240 },
  { id: 'leg_gully', name: 'Leg Gully', x: 242, y: 228 },
  { id: 'silly_point', name: 'Silly Point', x: 148, y: 205 },
  { id: 'silly_mid_on', name: 'Silly Mid On', x: 222, y: 195 },
  { id: 'silly_mid_off', name: 'Silly Mid Off', x: 178, y: 195 },
  { id: 'short_leg', name: 'Short Leg', x: 235, y: 210 },
  { id: 'bat_pad', name: 'Bat Pad (Leg)', x: 215, y: 200 },
  { id: 'point', name: 'Point', x: 110, y: 200 },
  { id: 'backward_point', name: 'Backward Point', x: 115, y: 225 },
  { id: 'cover_point', name: 'Cover Point', x: 120, y: 185 },
  { id: 'cover', name: 'Cover', x: 128, y: 165 },
  { id: 'extra_cover', name: 'Extra Cover', x: 145, y: 148 },
  { id: 'mid_off', name: 'Mid Off', x: 170, y: 138 },
  { id: 'mid_on', name: 'Mid On', x: 230, y: 138 },
  { id: 'mid_wicket', name: 'Mid Wicket', x: 268, y: 155 },
  { id: 'square_leg', name: 'Square Leg', x: 288, y: 200 },
  { id: 'backward_square_leg', name: 'Backward Square Leg', x: 282, y: 222 },
  { id: 'short_fine_leg', name: 'Short Fine Leg', x: 252, y: 252 },
  { id: 'forward_short_leg', name: 'Forward Short Leg', x: 245, y: 185 },
  { id: 'third_man', name: 'Third Man', x: 122, y: 338 },
  { id: 'fine_leg', name: 'Fine Leg', x: 272, y: 345 },
  { id: 'deep_fine_leg', name: 'Deep Fine Leg', x: 258, y: 368 },
  { id: 'deep_backward_sq', name: 'Deep Backward Sq Leg', x: 348, y: 272 },
  { id: 'deep_square_leg', name: 'Deep Square Leg', x: 365, y: 205 },
  { id: 'deep_mid_wicket', name: 'Deep Mid Wicket', x: 355, y: 138 },
  { id: 'cow_corner', name: 'Cow Corner', x: 328, y: 92 },
  { id: 'long_on', name: 'Long On', x: 260, y: 52 },
  { id: 'straight_hit', name: 'Straight Hit', x: 200, y: 35 },
  { id: 'long_off', name: 'Long Off', x: 138, y: 52 },
  { id: 'deep_extra_cover', name: 'Deep Extra Cover', x: 70, y: 92 },
  { id: 'sweeper_cover', name: 'Sweeper Cover', x: 48, y: 138 },
  { id: 'deep_cover', name: 'Deep Cover', x: 42, y: 175 },
  { id: 'deep_point', name: 'Deep Point', x: 38, y: 205 },
  { id: 'deep_backward_point', name: 'Deep Backward Point', x: 48, y: 245 },
  { id: 'long_stop', name: 'Long Stop', x: 200, y: 375 },
  { id: 'wide_off', name: 'Wide (Off Side)', x: 15, y: 200 },
  { id: 'wide_leg', name: 'Wide (Leg Side)', x: 385, y: 200 },
];

export const WICKET_TYPES = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket'];

export const formatOvers = (balls) => {
  if (!balls) return "0.0";
  const overs = Math.floor(balls / 6);
  const rem = balls % 6;
  return `${overs}.${rem}`;
};

export const zoneToHyphen = (id) => id.replace(/_/g, '-');
export const zoneToUnderscore = (id) => id.replace(/-/g, '_');

export const TABS = [
  { id: 'live', label: 'LIVE', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'scorecard', label: 'SCORECARD', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { id: 'commentary', label: 'COMMENTARY', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { id: 'stats', label: 'LIVE STATS', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  { id: 'overs', label: 'OVERS', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'xi', label: 'PLAYING XI', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'table', label: 'TABLE', icon: 'M9 19V5h6v14H9z' },
  { id: 'photos', label: 'PHOTOS', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'videos', label: 'VIDEOS', icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'blogs', label: 'BLOGS', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' }
];