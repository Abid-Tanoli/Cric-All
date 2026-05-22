import axios from "axios";

const API_BASE_URL = import.meta.env?.VITE_API_URL || "http://localhost:5000/api";

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
      window.location.href = "/login";
    }
    const message = error.response?.data?.message || error.message || "An error occurred";
    return Promise.reject(new Error(message));
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

export default api;