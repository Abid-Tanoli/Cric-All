import { API_BASE_URL } from "../config/env.js";

// Public location reads are anonymous and cached for a minute by the API, so
// they deliberately do not go through the app's axios instance (which attaches
// a token and redirects to /login on a 401).
const json = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Request failed (${response.status})`);
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
};

export async function fetchLocations({ type, parent, q, ids, limit = 200, signal } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (parent) params.set("parent", parent);
  if (q) params.set("q", q);
  if (ids?.length) params.set("ids", ids.join(","));
  if (limit) params.set("limit", String(limit));
  const response = await fetch(`${API_BASE_URL}/locations?${params.toString()}`, { signal });
  const body = await json(response);
  return body.locations || [];
}

export async function fetchLocationPath(id, { signal } = {}) {
  const response = await fetch(`${API_BASE_URL}/locations/${id}/path`, { signal });
  const body = await json(response);
  return body.path || [];
}

export async function suggestLocation({ name, type, parentId, nameUr = "" }, { signal } = {}) {
  const token =
    globalThis.localStorage?.getItem("bq_token") || globalThis.localStorage?.getItem("token") || "";
  const response = await fetch(`${API_BASE_URL}/locations/suggest`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name, type, parentId, nameUr }),
  });
  const body = await json(response);
  return body.location;
}
