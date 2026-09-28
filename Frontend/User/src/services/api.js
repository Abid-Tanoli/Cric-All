import axios from "axios";
import { API_BASE_URL } from "../../../Shared/config/env.js";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("bq_token") || localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("bq_token");
      localStorage.removeItem("token");
      localStorage.removeItem("bq_user");
      window.dispatchEvent(new CustomEvent("bq-auth-expired"));
    }
    const message = error.response?.data?.message || error.message || "An error occurred";
    // Keep the original response on the wrapped error so callers can keep
    // using error.response?.data?.message / ?.code.
    const wrapped = new Error(message);
    wrapped.response = error.response;
    wrapped.code = error.response?.data?.code;
    return Promise.reject(wrapped);
  }
);

export const setAuthToken = (token) => {
  if (token) {
    localStorage.setItem("bq_token", token);
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    localStorage.removeItem("bq_token");
    delete api.defaults.headers.common["Authorization"];
  }
};

// Reuse socket from socket.js to avoid duplicate connections
export { initSocket, getSocket, disconnectSocket } from "./socket.js";
export { API_BASE_URL };
