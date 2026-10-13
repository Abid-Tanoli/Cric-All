import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { initSocket } from "../../services/socket";

// ---------------------------------------------------------------------------
// useTournamentHub
// ---------------------------------------------------------------------------
//
// Loads everything the public tournament hub needs. The route is
// `/series/:seriesId`, which historically accepted a tournament id (or, for
// Series/Event records, a slug). This hook resolves the entity first:
//
//   1. an ObjectId is looked up directly at `GET /tournaments/:id`;
//   2. anything else is treated as a slug and resolved through
//      `GET /tournaments/:slug/content`, which echoes the real id.
//
// If neither resolves, the caller falls back to the legacy <Series /> page so
// that existing `/series/<id>` links for other entity types keep working.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
export const isObjectId = (value) => OBJECT_ID.test(String(value || ""));

/** Shape returned when the entity is not a tournament, or on a hard failure. */
const baseState = {
  status: "loading",
  error: null,
  id: null,
  tournament: null,
  content: null,
  visibility: {},
  counts: { matches: 0, photos: 0, videos: 0, articles: 0 },
  matches: [],
  standings: [],
  stats: { empty: true },
  squads: [],
  teams: [],
};

export default function useTournamentHub(seriesId) {
  const [state, setState] = useState(baseState);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!seriesId || seriesId === "undefined" || seriesId === "null") {
      setState({ ...baseState, status: "notFound" });
      return;
    }

    const ticket = ++requestId.current;
    const stillCurrent = () => ticket === requestId.current;

    const get = (url) => api.get(url, { timeout: 10000 }).then((r) => r.data);

    try {
      // ---- Resolve the id (id or slug) --------------------------------
      let id = isObjectId(seriesId) ? seriesId : null;
      let content = null;

      if (!id) {
        try {
          content = await get(`/tournaments/${seriesId}/content`);
          id = content?.tournamentId || null;
        } catch {
          if (stillCurrent()) setState({ ...baseState, status: "notFound" });
          return;
        }
      }
      if (!id) {
        if (stillCurrent()) setState({ ...baseState, status: "notFound" });
        return;
      }

      // ---- Load the rest in parallel ----------------------------------
      const [docResult, contentResult, standingsResult, statsResult, squadResult] = await Promise.allSettled([
        get(`/tournaments/${id}`),
        content ? Promise.resolve(content) : get(`/tournaments/${id}/content`),
        get(`/tournaments/${id}/standings`),
        get(`/tournaments/${id}/stats`),
        get(`/tournaments/${id}/squad`),
      ]);

      const tournament = docResult.status === "fulfilled" ? docResult.value : null;
      if (!tournament) {
        if (stillCurrent()) setState({ ...baseState, status: "notFound" });
        return;
      }

      const resolvedContent = contentResult.status === "fulfilled" ? contentResult.value : null;
      const standings = standingsResult.status === "fulfilled" ? standingsResult.value?.rows || [] : [];
      const stats = statsResult.status === "fulfilled" ? statsResult.value : { empty: true };
      const squads = squadResult.status === "fulfilled" ? squadResult.value || [] : [];

      // Prefer the tournament document's own populated matches: the backend
      // already stripped hidden/test teams out of them. Only when the document
      // carries no matches (older rows that never linked them) do we fall back
      // to the dedicated fixtures endpoint.
      let matches = Array.isArray(tournament.matches) ? tournament.matches.filter(Boolean) : [];
      if (matches.length === 0) {
        try {
          const fixtures = await get(`/tournaments/${id}/fixtures`);
          if (Array.isArray(fixtures)) matches = fixtures;
        } catch {
          // fixtures are optional; an empty tab is a valid state
        }
      }

      if (!stillCurrent()) return;

      setState({
        status: "ready",
        error: null,
        id,
        tournament,
        content: resolvedContent,
        visibility: resolvedContent?.visibility || {},
        counts: {
          matches: matches.length,
          photos: resolvedContent?.counts?.photos || 0,
          videos: resolvedContent?.counts?.videos || 0,
          articles: resolvedContent?.counts?.articles || 0,
        },
        matches,
        standings,
        stats: stats && typeof stats === "object" ? stats : { empty: true },
        squads: Array.isArray(squads) ? squads : [],
        teams: Array.isArray(tournament.teams) ? tournament.teams : [],
      });
    } catch (error) {
      if (stillCurrent()) {
        setState({ ...baseState, status: "error", error: error?.message || "Failed to load tournament" });
      }
    }
  }, [seriesId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live scoring: a ball or a score update invalidates the stats/standings.
  useEffect(() => {
    const socket = initSocket();
    const refresh = () => load();
    socket.on("match:updated", refresh);
    socket.on("match:scoreUpdate", refresh);
    socket.on("match:ballUpdate", refresh);
    socket.on("tournament:pointsTableUpdated", refresh);
    return () => {
      socket.off("match:updated", refresh);
      socket.off("match:scoreUpdate", refresh);
      socket.off("match:ballUpdate", refresh);
      socket.off("tournament:pointsTableUpdated", refresh);
    };
  }, [load]);

  return { ...state, reload: load };
}

export { baseState };
