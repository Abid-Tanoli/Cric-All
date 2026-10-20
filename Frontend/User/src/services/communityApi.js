// Community content API, in one place.
//
// Paths and response shapes mirror docs/COMMUNITY_API.md (the source of truth).
// Error codes the UI reacts to are surfaced on `err.code` / `err.status` by the
// `withCode` wrapper so pages can branch on COMMUNITY_SUBJECT_DENIED,
// COMMUNITY_DISABLED, COMMUNITY_POSTER_BANNED, COMMUNITY_DAILY_LIMIT, etc.
//
// NOTE: this file never hardcodes a host. Everything goes through the shared
// axios instance (`../services/api`, base from Shared/config/env.js), and share
// links are built from the same env in `communityConfig.js`.

import { api } from "./api";

/**
 * Attach the backend's error `code`/`status` to the thrown Error.
 *
 * The axios interceptor already turns failures into Errors carrying the server
 * message; the code is what lets a caller distinguish "you are not allowed to
 * post as this team" from "the community is switched off" from "too many
 * requests", so it must survive.
 */
function withCode(promise) {
  return promise
    .then((res) => res.data)
    .catch((err) => {
      const data = err?.response?.data || {};
      err.code = data.code;
      err.status = err?.response?.status;
      err.errors = data.errors;
      err.retryAfter = err?.response?.headers?.["retry-after"];
      throw err;
    });
}

// --- runtime config (public) -------------------------------------------------
export const getCommunityConfig = () => withCode(api.get("/community/config"));

// --- public reads ------------------------------------------------------------
export const getFeed = ({ cursor, limit = 20, kind, subjectType, subjectId } = {}) =>
  withCode(
    api.get("/community/feed", {
      params: { cursor, limit, kind, subjectType, subjectId },
    })
  );

export const getPost = (id) => withCode(api.get(`/community/posts/${id}`));

export const getComments = (id, { cursor, limit = 20 } = {}) =>
  withCode(api.get(`/community/posts/${id}/comments`, { params: { cursor, limit } }));

export const getTeamPosts = (teamId, { cursor, limit = 10 } = {}) =>
  withCode(api.get(`/community/teams/${teamId}/posts`, { params: { cursor, limit } }));

export const getPlayerPosts = (playerId, { cursor, limit = 10 } = {}) =>
  withCode(api.get(`/community/players/${playerId}/posts`, { params: { cursor, limit } }));

// --- writes (auth + verified) ------------------------------------------------
export const createPost = (payload) => withCode(api.post("/community/posts", payload));

export const updatePost = (id, payload) => withCode(api.patch(`/community/posts/${id}`, payload));

export const deletePost = (id) => withCode(api.delete(`/community/posts/${id}`));

export const toggleLike = (id) => withCode(api.post(`/community/posts/${id}/like`));

export const createComment = (id, body) =>
  withCode(api.post(`/community/posts/${id}/comments`, { body }));

export const deleteComment = (id, commentId) =>
  withCode(api.delete(`/community/posts/${id}/comments/${commentId}`));

export const reportPost = (id, reason, note) =>
  withCode(api.post(`/community/posts/${id}/report`, { reason, note: note || undefined }));

/** No auth required; returns { shareCount, url, urls } and bumps the counter. */
export const sharePost = (id) => withCode(api.post(`/community/posts/${id}/share`));

export default {
  getCommunityConfig,
  getFeed,
  getPost,
  getComments,
  getTeamPosts,
  getPlayerPosts,
  createPost,
  updatePost,
  deletePost,
  toggleLike,
  createComment,
  deleteComment,
  reportPost,
  sharePost,
};
