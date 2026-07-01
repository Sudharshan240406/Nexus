/**
 * Nexus Mobile — Push Notification Service
 *
 * • Requests permission and registers Expo push token
 * • Sends token to backend for server-side push
 * • Handles notification taps → navigates to correct chat
 */

import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useNotificationStore } from "../stores/notificationStore";
import { registerPushToken } from "./api";

// Configure how notifications appear when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and send the token to the backend.
 * Call this after successful login.
 */
export async function setupPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("[Push] Must use physical device for push notifications");
    return null;
  }

  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[Push] Permission not granted");
    return null;
  }

  // Get Expo push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId,
  });
  const pushToken = tokenData.data;
  console.log("[Push] Token:", pushToken);

  // Store locally
  useNotificationStore.getState().setPushToken(pushToken);

  // Register with backend
  try {
    await registerPushToken(pushToken, Platform.OS);
    console.log("[Push] Token registered with backend");
  } catch (err) {
    console.error("[Push] Failed to register token:", err);
  }

  // Android-specific notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("messages", {
      name: "Messages",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#10b981",
      sound: "default",
    });
  }

  return pushToken;
}

/**
 * Listen for notification taps and navigate to the relevant chat.
 * Returns a cleanup function.
 */
export function setupNotificationListeners(): () => void {
  // When user taps a notification
  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const conversationId = data?.conversation_id as string | undefined;

      if (conversationId) {
        router.push(`/chat/${conversationId}`);
      }
    });

  // When notification is received while app is foregrounded
  const notificationSubscription =
    Notifications.addNotificationReceivedListener((notification) => {
      console.log("[Push] Received in foreground:", notification);
    });

  return () => {
    responseSubscription.remove();
    notificationSubscription.remove();
  };
}
