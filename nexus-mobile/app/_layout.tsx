import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useAuthStore } from "../stores/authStore";
import { connectWebSocket, disconnectWebSocket } from "../services/ws";
import { setupPushNotifications, setupNotificationListeners } from "../services/notifications";
import { Colors } from "../constants/theme";

export default function RootLayout() {
  const token = useAuthStore((s) => s.token);

  // WebSocket lifecycle
  useEffect(() => {
    if (token) {
      connectWebSocket();
      setupPushNotifications();
      const cleanup = setupNotificationListeners();
      return () => {
        disconnectWebSocket();
        cleanup();
      };
    }
  }, [token]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.dark[950] },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
          }}
        />
      </Stack>
    </>
  );
}
