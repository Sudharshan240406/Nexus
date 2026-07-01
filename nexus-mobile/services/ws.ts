/**
 * Nexus Mobile — WebSocket Service
 *
 * • Uses AsyncStorage-backed Zustand store for JWT
 * • Auto-reconnects with exponential backoff
 * • Reconnects when app returns to foreground
 * • Dispatches events to the conversation store
 */

import { AppState, AppStateStatus } from "react-native";
import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";
import { WS_URL } from "../constants/theme";
import type { WSEvent } from "../types";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30_000;
let intentionalClose = false;
let appStateSubscription: { remove: () => void } | null = null;

// ── Connect ─────────────────────────────────────────────────────────────────

export function connectWebSocket(): void {
  const { token, userId } = useAuthStore.getState();
  if (!token || !userId) return;

  // Tear down existing
  if (socket) {
    intentionalClose = true;
    socket.close();
  }

  intentionalClose = false;
  const url = `${WS_URL}/ws/${userId}?token=${token}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("[Nexus WS] Connected");
    reconnectDelay = 1000;

    // Auto-enter active conversation if one is selected
    const activeId = useConversationStore.getState().activeConversationId;
    if (activeId) {
      sendEnterConversation(activeId);
    }
  };

  socket.onmessage = (event) => {
    try {
      const data: WSEvent = JSON.parse(event.data);
      handleEvent(data);
    } catch (err) {
      console.error("[Nexus WS] Parse error:", err);
    }
  };

  socket.onclose = () => {
    console.log("[Nexus WS] Disconnected");
    socket = null;
    if (!intentionalClose) scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.error("[Nexus WS] Error:", err);
    socket?.close();
  };

  // Listen for app state changes (foreground/background)
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );
  }
}

// ── App State Handler ───────────────────────────────────────────────────────

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === "active") {
    // App returned to foreground — reconnect if needed
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log("[Nexus WS] App foregrounded — reconnecting");
      connectWebSocket();
    }
  }
}

// ── Reconnect ───────────────────────────────────────────────────────────────

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(() => {
    console.log(`[Nexus WS] Reconnecting (delay: ${reconnectDelay}ms)`);
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  }, reconnectDelay);
}

// ── Disconnect ──────────────────────────────────────────────────────────────

export function disconnectWebSocket(): void {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

// ── Event Dispatcher ────────────────────────────────────────────────────────

function handleEvent(data: WSEvent): void {
  const store = useConversationStore.getState();

  switch (data.event) {
    case "new_message":
      store.addMessage(data.message.conversation_id, data.message);
      break;

    case "message_sent":
      store.addMessage(data.message.conversation_id, data.message);
      break;

    case "typing":
      store.setTyping(data.conversation_id, data.user_id);
      setTimeout(() => {
        store.setTyping(data.conversation_id, null);
      }, 3000);
      break;

    case "message_delivered":
      store.updateMessage(data.conversation_id, data.message_id, {
        status: "delivered",
      });
      break;

    case "message_read":
      store.updateMessage(data.conversation_id, data.message_id, {
        status: "read",
      });
      break;

    case "message_pinned":
      store.updateMessage(data.conversation_id, data.message.id, {
        is_pinned: true,
      });
      store.addPinnedMessage(data.conversation_id, data.message);
      break;

    case "message_unpinned":
      store.updateMessage(data.conversation_id, data.message_id, {
        is_pinned: false,
      });
      store.removePinnedMessage(data.conversation_id, data.message_id);
      break;

    case "error":
      console.error("[Nexus WS] Server error:", data.detail);
      break;
  }
}

// ── Send Helpers ────────────────────────────────────────────────────────────

export function sendMessage(
  conversationId: string,
  content: string,
  messageType: string = "text",
  replyToMessageId?: string | null,
  mediaUrl?: string | null,
  duration?: number | null
): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("[Nexus WS] Not connected");
    return;
  }

  socket.send(
    JSON.stringify({
      conversation_id: conversationId,
      content,
      message_type: messageType,
      reply_to_message_id: replyToMessageId,
      media_url: mediaUrl,
      duration,
    })
  );
}

export function sendTypingEvent(conversationId: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "typing",
      conversation_id: conversationId,
    })
  );
}

export function isConnected(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

export function sendEnterConversation(conversationId: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "enter_conversation",
      conversation_id: conversationId,
    })
  );
}

export function sendLeaveConversation(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "leave_conversation",
    })
  );
}
