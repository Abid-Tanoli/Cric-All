# BQ-PLAY Live Cricket API Guide

This guide explains how BQ-PLAY connects to external cricket data for international matches, series, scorecards, and match-center pages.

## What The API Must Provide

For a full match-center experience, the provider should expose these feeds:

- Live matches
- Upcoming fixtures
- Recent results
- Series list
- Series fixtures/results by series ID
- Match info
- Scorecard
- Ball-by-ball commentary
- Live stats
- Overs
- Playing XI
- Photos
- News
- Videos

If a provider does not include one of these endpoints, BQ-PLAY shows a clear empty state instead of fake data.

## Backend Environment

```env
RAPIDAPI_KEY=your_key_here
RAPIDAPI_CRICKET_HOST=free-cricbuzz-cricket-api.p.rapidapi.com
ENABLE_FREE_CRICBUZZ=false
ENABLE_EXTERNAL_SYNC=false
ENABLE_DEMO_CRICKET_DATA=false
```

Optional endpoint overrides:

```env
RAPIDAPI_LIVE_MATCHES_PATHS=/cricket-matches-live,/cricket-livescores
RAPIDAPI_UPCOMING_MATCHES_PATHS=/cricket-schedule-international,/cricket-matches-upcoming
RAPIDAPI_RECENT_MATCHES_PATHS=/cricket-matches-recent
RAPIDAPI_MATCH_INFO_PATHS=/cricket-match-info?matchid={id},/cricket-match-scoreboard?matchid={id}
RAPIDAPI_SERIES_INTERNATIONAL_PATHS=/cricket-series-international
RAPIDAPI_SERIES_LEAGUE_PATHS=/cricket-series-leagues
RAPIDAPI_SERIES_DOMESTIC_PATHS=/cricket-series-domestic
RAPIDAPI_SERIES_MATCHES_PATHS=
```

## Validation

Check provider status:

```http
GET /api/international/status
```

Expected success state:

```json
{
  "success": true,
  "data": {
    "configured": true,
    "provider": "primary-live-provider",
    "lastError": ""
  }
}
```

## Important Limits

- Free plans often have small monthly quotas.
- Some APIs expose series metadata but not all completed matches in that series.
- A series page can only show all old fixtures/results if the provider has a real series-matches endpoint.
- BQ-PLAY no longer falls back to demo international results unless `ENABLE_DEMO_CRICKET_DATA=true`.
