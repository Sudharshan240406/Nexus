/**
 * Nexus Mobile — Design Tokens
 */

export const Colors = {
  // Nexus brand
  nexus: {
    50: "#ecfdf5",
    100: "#d1fae5",
    200: "#a7f3d0",
    300: "#6ee7b7",
    400: "#34d399",
    500: "#10b981",
    600: "#059669",
    700: "#047857",
    800: "#065f46",
    900: "#064e3b",
  },

  // Dark palette
  dark: {
    50: "#f8fafc",
    100: "#cbd5e1",
    200: "#94a3b8",
    300: "#64748b",
    400: "#475569",
    500: "#334155",
    600: "#1e293b",
    700: "#151d2e",
    800: "#0f172a",
    900: "#0b1120",
    950: "#060a14",
  },

  // Semantic
  white: "#ffffff",
  black: "#000000",
  red: "#ef4444",
  blue: "#3b82f6",
  amber: "#f59e0b",
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  full: 9999,
} as const;

export const API_URL = "http://10.0.2.2:8000"; // Android emulator → host
export const WS_URL = "ws://10.0.2.2:8000";

// For physical device testing, replace with your machine's IP:
// export const API_URL = "http://192.168.x.x:8000";
// export const WS_URL = "ws://192.168.x.x:8000";
