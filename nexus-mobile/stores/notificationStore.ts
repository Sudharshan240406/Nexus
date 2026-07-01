import { create } from "zustand";

interface NotificationState {
  pushToken: string | null;
  setPushToken: (token: string | null) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  pushToken: null,
  setPushToken: (pushToken) => set({ pushToken }),
}));
