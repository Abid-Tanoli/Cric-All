// Admin-side community API, mirroring docs/COMMUNITY_API.md.
//
// Uses the shared admin axios instance (`./api`), whose request interceptor
// attaches the admin bearer token. Endpoints are admin/superadmin only; the base
// client already redirects to /admin/login on 401 and keeps 403 messages.
import api from "./api";

const unwrap = (promise) => promise.then((res) => res.data);

/** Moderation queue. `status` ∈ published|pending|hidden|removed (default published). */
export const getQueue = ({ status = "published", cursor, limit = 20 } = {}) =>
  unwrap(api.get("/community/admin/queue", { params: { status, cursor, limit } }));

export const approvePost = (id) => unwrap(api.post(`/community/admin/posts/${id}/approve`));
export const hidePost = (id) => unwrap(api.post(`/community/admin/posts/${id}/hide`));
export const removePost = (id) => unwrap(api.post(`/community/admin/posts/${id}/remove`));
export const restorePost = (id) => unwrap(api.post(`/community/admin/posts/${id}/restore`));

export const banPoster = (userId, banned) =>
  unwrap(api.post(`/community/admin/users/${userId}/ban-poster`, { banned }));

export const getSettings = () => unwrap(api.get("/community/admin/settings"));
export const updateSettings = (patch) => unwrap(api.patch("/community/admin/settings", patch));

export default {
  getQueue,
  approvePost,
  hidePost,
  removePost,
  restorePost,
  banPoster,
  getSettings,
  updateSettings,
};
