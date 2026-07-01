import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "../types";

interface AuthState {
  token: string | null;
  userId: string | null;
  user: User | null;
  pushToken: string | null;

  setAuth: (token: string, userId: string) => void;
  setUser: (user: User) => void;
  setPushToken: (pushToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      user: null,
      pushToken: null,

      setAuth: (token, userId) => set({ token, userId }),
      setUser: (user) => set({ user }),
      setPushToken: (pushToken) => set({ pushToken }),
      logout: () => set({ token: null, userId: null, user: null, pushToken: null }),
    }),
    {
      name: "nexus-auth",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        token: state.token,
        userId: state.userId,
        user: state.user,
      }),
    }
  )
);
