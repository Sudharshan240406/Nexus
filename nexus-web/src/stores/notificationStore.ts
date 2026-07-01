import { create } from "zustand";

interface NotificationState {
  permission: NotificationPermission;
  pushToken: string | null;
  setPermission: (permission: NotificationPermission) => void;
  setPushToken: (pushToken: string | null) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  permission: typeof Notification !== "undefined" ? Notification.permission : "default",
  pushToken: null,
  setPermission: (permission) => set({ permission }),
  setPushToken: (pushToken) => set({ pushToken }),
}));
