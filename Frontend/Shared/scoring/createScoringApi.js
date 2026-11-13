import axios from "axios";

export function createScoringApi({ apiBaseUrl, getToken }) {
  const client = axios.create({ baseURL: apiBaseUrl });
  client.interceptors.request.use((config) => {
    const token = getToken?.();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  return client;
}
