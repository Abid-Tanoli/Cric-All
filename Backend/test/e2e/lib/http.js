/**
 * Minimal HTTP client for the E2E suite.
 *
 * Two behaviours the scenarios depend on:
 *  - every response is recorded (method, path, status) so a failure can be
 *    explained without re-running;
 *  - writes are paced. `POST /matches/:id/score` is behind a 12-per-second
 *    limiter, and a single T20 innings is ~130 deliveries, so an unpaced loop
 *    gets 429s and silently under-tests the innings.
 */

import { sleep } from "./guard.js";

const MAX_PER_SECOND = Number(process.env.E2E_MAX_RPS || 9);

let windowStart = Date.now();
let inWindow = 0;

async function pace() {
  const now = Date.now();
  if (now - windowStart >= 1000) {
    windowStart = now;
    inWindow = 0;
  }
  if (inWindow >= MAX_PER_SECOND) {
    const wait = 1000 - (now - windowStart) + 15;
    await sleep(Math.max(wait, 15));
    windowStart = Date.now();
    inWindow = 0;
  }
  inWindow += 1;
}

export class HttpError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status}`);
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
  }
}

export function createClient({ apiBase, token = null, log = null }) {
  const state = { token, calls: 0, failures: [] };

  async function request(method, path, body = undefined, opts = {}) {
    const { expect = null, retryOn429 = true, auth = true } = opts;
    if (method !== "GET" && method !== "HEAD") await pace();

    const url = new URL(String(path).replace(/^\//, ""), `${apiBase}/`).toString();
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }

    state.calls += 1;
    if (log) log(method, path, res.status);

    if (res.status === 429 && retryOn429) {
      const retryAfter = Number(res.headers.get("retry-after") || 1);
      await sleep(Math.min(retryAfter, 5) * 1000 + 200);
      return request(method, path, body, { ...opts, retryOn429: false });
    }

    if (expect !== null) {
      const ok = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
      if (!ok) {
        state.failures.push({ method, path, status: res.status, body: parsed });
        throw new HttpError(method, path, res.status, parsed);
      }
    } else if (res.status >= 500) {
      state.failures.push({ method, path, status: res.status, body: parsed });
    }

    return { status: res.status, body: parsed, ok: res.ok };
  }

  return {
    get state() {
      return state;
    },
    setToken(t) {
      state.token = t;
    },
    clearToken() {
      state.token = null;
    },
    get: (p, o) => request("GET", p, undefined, o),
    post: (p, b, o) => request("POST", p, b, o),
    put: (p, b, o) => request("PUT", p, b, o),
    patch: (p, b, o) => request("PATCH", p, b, o),
    del: (p, b, o) => request("DELETE", p, b, o),
  };
}
