// Player self-service calls, in one place.
//
// The endpoints are deliberately thin wrappers: the *authorization* rules (you
// may only edit a profile you created, or one in a team you manage) are decided
// on the server, so this file must not pretend to be able to decide anything. It
// only exists so the paths and the response shapes are described once.

import { api } from "./api";

const unwrap = (promise) => promise.then((res) => res.data);

/** Profiles this account created. */
export const listMyPlayers = () => unwrap(api.get("/players/mine"));

/**
 * A self-service profile is always a free agent. There is no `team` here on
 * purpose — squad membership is granted by somebody who manages that team, via
 * My Organizations → Teams, and the server rejects the key if we send it.
 */
export const createMyPlayer = (payload) => unwrap(api.post("/players", payload));

/**
 * A partial update. The server strips `stats`, `team` and the seed fields for
 * anyone who is not a platform admin and reports them back as `ignoredFields`,
 * so a silent drop is visible instead of looking like a save that worked.
 */
export const updateMyPlayer = (playerId, payload) => unwrap(api.put(`/players/${playerId}`, payload));

export const deleteMyPlayer = (playerId) => unwrap(api.delete(`/players/${playerId}`));

export const getPlayerProfile = (playerId) => unwrap(api.get(`/players/${playerId}`));
