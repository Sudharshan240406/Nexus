/**
 * Nexus — WebSocket Service
 *
 * • Connects to  ws://<host>/ws/{user_id}?token={jwt}
 * • Auto-reconnects with exponential backoff (1s → 2s → 4s → … → 30s)
 * • Dispatches incoming events to the Zustand conversation store
 * • Exposes send helpers for messages and typing indicators
 *
 * StrictMode-safe: uses a monotonic connection ID so that the cleanup
 * from a stale React effect invocation never tears down the current
 * connection (React 18 StrictMode mounts → unmounts → remounts in dev).
 */

import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";
import type { WSEvent } from "../types";

const WS_BASE = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30_000;
let intentionalClose = false;

/**
 * Monotonically increasing connection ID.
 * Each call to connectWebSocket() bumps this.  disconnectWebSocket()
 * receives the ID that was current when the matching effect mounted;
 * if it doesn't match the latest ID we skip the teardown.
 */
let connectionId = 0;

// ── Connect ─────────────────────────────────────────────────────────────────

/**
 * Open a WebSocket connection.
 * Returns the connection ID so the caller (useEffect cleanup) can
 * pass it back to disconnectWebSocket() for StrictMode safety.
 */
export function connectWebSocket(): number {
  const { token, userId } = useAuthStore.getState();
  const myId = ++connectionId;

  if (!token || !userId) return myId;

  // Tear down any existing connection
  if (socket) {
    intentionalClose = true;
    socket.close();
    socket = null;
  }

  intentionalClose = false;
  const url = `${WS_BASE}/ws/${userId}?token=${token}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    // Guard: if a newer connection was started, ignore this one
    if (connectionId !== myId) return;
    console.log("[Nexus WS] Connected");
    reconnectDelay = 1000; // reset backoff

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
      console.error("[Nexus WS] Failed to parse message:", err);
    }
  };

  socket.onclose = () => {
    // Guard: only reconnect if this is still the active connection
    if (connectionId !== myId) return;
    console.log("[Nexus WS] Disconnected");
    socket = null;
    if (!intentionalClose) {
      scheduleReconnect();
    }
  };

  socket.onerror = (err) => {
    console.error("[Nexus WS] Error:", err);
    socket?.close();
  };

  return myId;
}

// ── Reconnect with exponential backoff ──────────────────────────────────────

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(() => {
    console.log(`[Nexus WS] Reconnecting in ${reconnectDelay}ms…`);
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  }, reconnectDelay);
}

// ── Disconnect ──────────────────────────────────────────────────────────────

/**
 * Tear down the WebSocket connection.
 *
 * @param forConnectionId  If provided, only disconnect if this ID matches
 *   the current connectionId.  This prevents React StrictMode's stale
 *   cleanup from killing a connection that was just (re-)established.
 *   Pass `undefined` for an unconditional disconnect (e.g. logout).
 */
export function disconnectWebSocket(forConnectionId?: number): void {
  // StrictMode guard: if the caller's ID is stale, skip teardown
  if (forConnectionId !== undefined && forConnectionId !== connectionId) {
    return;
  }

  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

// ── Event dispatcher ────────────────────────────────────────────────────────

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
      // Auto-clear after 3 seconds
      setTimeout(() => {
        store.setTyping(data.conversation_id, null);
      }, 3000);
      break;

    case "user_presence":
      store.updateUserPresence(data.user_id, data.is_online, data.last_seen);
      break;

    case "read_receipt":
      store.updateReadReceipt(data.conversation_id, data.user_id, data.message_id);
      break;

    case "reaction_updated":
      store.updateMessage(data.conversation_id, data.message_id, {
        reactions: data.reactions,
      });
      break;

    case "message_edited":
      store.updateMessage(data.message.conversation_id, data.message.id, data.message);
      break;

    case "message_deleted":
      store.updateMessage(data.conversation_id, data.message_id, {
        is_deleted: true,
        content: null,
        media_url: null,
      });
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

    default:
      console.warn("[Nexus WS] Unknown event:", data);
  }
}

// ── Send helpers ────────────────────────────────────────────────────────────

export function sendMessage(
  conversationId: string,
  content: string,
  messageType: string = "text",
  replyToMessageId?: string | null,
  mediaUrl?: string | null
): void {
  console.log("sendMessage called, socket:", socket, "readyState:", socket?.readyState);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("[Nexus WS] Not connected");
    return;
  }

  socket.send(
    JSON.stringify({
      conversation_id: conversationId,
      content,
      message_type: messageType,
      reply_to_message_id: replyToMessageId || null,
      media_url: mediaUrl || null,
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

export function sendMarkRead(conversationId: string, messageId: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "mark_read",
      conversation_id: conversationId,
      message_id: messageId,
    })
  );
}

export function sendReaction(conversationId: string, messageId: string, emoji: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "add_reaction",
      conversation_id: conversationId,
      message_id: messageId,
      emoji,
    })
  );
}

export function sendEditMessage(conversationId: string, messageId: string, content: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "edit_message",
      conversation_id: conversationId,
      message_id: messageId,
      content,
    })
  );
}

export function sendDeleteMessage(conversationId: string, messageId: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      event: "delete_message",
      conversation_id: conversationId,
      message_id: messageId,
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
