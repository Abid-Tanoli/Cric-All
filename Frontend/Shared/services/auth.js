import { api, setAuthToken } from "./api";

export function persistAuth(token, user) {
  if (token) {
    localStorage.setItem("bq_token", token);
    localStorage.setItem("token", token);
    setAuthToken(token);
  }
  if (user) localStorage.setItem("bq_user", JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem("bq_token");
  localStorage.removeItem("token");
  localStorage.removeItem("bq_user");
  setAuthToken(null);
}

export async function register(name, email, password) {
  const res = await api.post("/auth/register", { name, email, password });
  const { token, user } = res.data;
  persistAuth(token, user);
  return user;
}

export async function login(email, password) {
  const res = await api.post("/auth/login", { email, password });
  const { token, user } = res.data;
  persistAuth(token, user);
  return user;
}

export function logout() {
  clearAuth();
}

export function getStoredUser() {
  const raw = localStorage.getItem("bq_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function initAuthFromStorage() {
  const token = localStorage.getItem("bq_token") || localStorage.getItem("token");
  if (token) setAuthToken(token);
  return getStoredUser();
}