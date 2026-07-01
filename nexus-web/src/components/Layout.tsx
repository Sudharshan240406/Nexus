import { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { connectWebSocket, disconnectWebSocket } from "../services/ws";
import { registerPushToken, removePushToken } from "../services/api";
import { useNotificationStore } from "../stores/notificationStore";
import { useCryptoStore } from "../stores/cryptoStore";

function urlB64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Layout() {
  const { user, userId, logout } = useAuthStore();
  const navigate = useNavigate();

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Initialize E2EE device identity
  useEffect(() => {
    if (userId) {
      useCryptoStore.getState().initDeviceIdentity(navigator.userAgent || "Web Session");
    }
  }, [userId]);

  // Connect WebSocket on mount (StrictMode-safe via connection ID)
  useEffect(() => {
    const connId = connectWebSocket();
    return () => disconnectWebSocket(connId);
  }, [userId]);

  // Service Worker and Push Notification setup
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("Service Worker or Push Notifications are not supported by this browser.");
      return;
    }

    const VAPID_PUBLIC_KEY = "BDW-PIP6K0UvQotD8Hs4OMosI2nKR0XHyJxOWFLRj_dKU4BdkIP8EgHNqQpvRVEba2GoGxJ964Npxfy2HY1dZNw";

    async function initPush() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        console.log("Service Worker registered with scope:", registration.scope);

        const permission = await Notification.requestPermission();
        useNotificationStore.getState().setPermission(permission);

        if (permission === "granted") {
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
          });

          const tokenStr = JSON.stringify(subscription);
          await registerPushToken(tokenStr, "web");
          useNotificationStore.getState().setPushToken(tokenStr);
          console.log("Push notifications registered successfully.");
        }
      } catch (err) {
        console.error("Error setting up push notifications:", err);
      }
    }

    initPush();
  }, [userId]);

  const handleLogout = async () => {
    disconnectWebSocket();
    const pushToken = useNotificationStore.getState().pushToken;
    if (pushToken) {
      try {
        await removePushToken(pushToken);
      } catch (e) {
        console.error("Failed to unregister push token on logout", e);
      }
      useNotificationStore.getState().setPushToken(null);
    }
    logout();
    navigate("/login");
  };

  return (
    <div className="h-screen flex flex-col bg-dark-950">
      {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-14 glass border-t-0 border-x-0 flex items-center justify-between px-4 md:px-6 z-30">
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-nexus-400 to-nexus-600 flex items-center justify-center shadow-lg shadow-nexus-500/20 group-hover:shadow-nexus-500/40 transition-shadow">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-gradient hidden sm:inline">
            Nexus
          </span>
        </NavLink>

        {/* Nav Links */}
        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-nexus-500/15 text-nexus-400"
                  : "text-dark-200 hover:text-dark-50 hover:bg-white/5"
              }`
            }
          >
            <span className="hidden sm:inline">Chats</span>
            <svg className="w-5 h-5 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </NavLink>

          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-nexus-500/15 text-nexus-400"
                  : "text-dark-200 hover:text-dark-50 hover:bg-white/5"
              }`
            }
          >
            <span className="hidden sm:inline">Profile</span>
            <svg className="w-5 h-5 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </NavLink>

          <button
            onClick={toggleTheme}
            className="px-2.5 py-1.5 rounded-lg text-dark-200 hover:text-dark-50 hover:bg-white/5 transition-all"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <button
            onClick={handleLogout}
            className="ml-2 px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-all"
            title="Logout"
          >
            <span className="hidden sm:inline">Logout</span>
            <svg className="w-5 h-5 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </nav>
      </header>

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden page-enter">
        <Outlet />
      </main>
    </div>
  );
}
