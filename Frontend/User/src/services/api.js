import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "/api/";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
};

// Reuse socket from socket.js to avoid duplicate connections
export { initSocket, getSocket, disconnectSocket } from "./socket.js";
