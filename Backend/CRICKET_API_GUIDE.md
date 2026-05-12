# BQ-PLAY Cricket API Guide

This guide will help you set up and use external Cricket APIs for live match data.

## 1. Supported Providers

Currently, BQ-PLAY supports the following providers:

### A. CricketData.org (formerly CricAPI)
- **Status**: Recommended (Free tier available)
- **Website**: [https://cricketdata.org/](https://cricketdata.org/)
- **Pricing**: Free plan includes 100 requests per day.
- **Setup**:
  1. Register for an account.
  2. Copy your API Key.
  3. Update `.env`:
     ```env
     CRICKET_API_PROVIDER=cricapi
     CRICKET_API_KEY=your_api_key_here
     ```

### B. RapidAPI (Cricbuzz)
- **Status**: Advanced (Free tier available)
- **Website**: [RapidAPI Cricbuzz](https://rapidapi.com/cricket-api-cricket-api-default/api/cricbuzz-cricket)
- **Pricing**: Free tier usually includes a limited number of requests.
- **Setup**:
  1. Register on RapidAPI.
  2. Subscribe to the Cricbuzz Cricket API (Free tier).
  3. Copy your `X-RapidAPI-Key`.
  4. Update `.env`:
     ```env
     CRICKET_API_PROVIDER=rapidapi-cricket
     CRICKET_API_KEY=your_rapidapi_key_here
     ```

## 2. Using the APIs in BQ-PLAY

The system automatically uses the provider specified in `CRICKET_API_PROVIDER`.

### Endpoints:
- `GET /api/cricket-api/live`: Get all live matches from the provider.
- `GET /api/cricket-api/upcoming`: Get upcoming matches.
- `GET /api/cricket-api/match/:id`: Get detailed info for a specific match.

## 3. Graceful Fallback

If no API key is provided, the system will return an empty list or cached data if available. You can always use the internal scoring system for matches you manage yourself.

## 4. Tips for Free Usage
- **Caching**: The system has a built-in 8-second cache to prevent over-usage of your daily limit.
- **Local Matches**: Use the **Internal Match** feature in the Admin panel for matches that don't need external data. This saves your API quota.
