import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import store from "./store/store";
import { ToastProvider } from "./components/Toast";
import { setupPwa } from "./pwa/registerPwa";
import "./index.css";

// Theme initialization — prevents flash before React mounts
(function initTheme() {
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
})();

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

// Registers the Admin service worker and wires the "Update" toast flow.
setupPwa();

ReactDOM.createRoot(document.getElementById("root")).render(
  <GoogleOAuthProvider clientId={googleClientId}>
    <Provider store={store}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </Provider>
  </GoogleOAuthProvider>
);
