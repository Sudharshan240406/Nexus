import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../types";

interface AuthState {
  token: string | null;
  userId: string | null;
  user: User | null;
  isUnlocked: boolean;

  setAuth: (token: string, userId: string) => void;
  setUser: (user: User) => void;
  setUnlocked: (unlocked: boolean) => void;
  updateUserHasPin: (hasPin: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      user: null,
      isUnlocked: false,

      setAuth: (token, userId) => set({ token, userId }),

      setUser: (user) => set({ user }),

      setUnlocked: (isUnlocked) => set({ isUnlocked }),

      updateUserHasPin: (hasPin) =>
        set((state) => ({
          user: state.user ? { ...state.user, has_pin: hasPin } : null,
        })),

      logout: () => set({ token: null, userId: null, user: null, isUnlocked: false }),
    }),
    {
      name: "nexus-auth",
      partialize: (state) => ({
        token: state.token,
        userId: state.userId,
        user: state.user,
      }),
    }
  )
);
