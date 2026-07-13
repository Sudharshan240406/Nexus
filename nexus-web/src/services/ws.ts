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
      handleEvent(data).catch(err => console.error("[Nexus WS] Event handling failed:", err));
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

// ── Decrypt Message In Place ──────────────────────────────────────────────────

export async function decryptMessageInPlace(msg: any): Promise<void> {
  const isE2EEMedia = ["enc_image", "enc_audio", "enc_video", "enc_document"].includes(msg.message_type);
  if (msg.message_type !== "enc_text" && !isE2EEMedia) return;
  if (!msg.content) return;

  try {
    const payload = JSON.parse(msg.content);
    const myDeviceIdStr = localStorage.getItem("nexus_device_id_str") || "";
    const keyEntry = payload.keys?.[myDeviceIdStr];
    if (!keyEntry) {
      msg.content = "🔒 Decryption failed: Message not encrypted for this device";
      return;
    }

    // Replay attack protection
    if (msg.sender_device_id && msg.message_counter !== undefined) {
      const counterKey = `nexus_peer_counter_${msg.sender_device_id}`;
      const lastCounter = parseInt(localStorage.getItem(counterKey) || "-1", 10);
      if (msg.message_counter <= lastCounter) {
        msg.content = "🔒 Decryption failed: Replayed message detected";
        return;
      }
      localStorage.setItem(counterKey, msg.message_counter.toString());
    }

    if (!msg.sender_id || !msg.sender_device_id) {
      throw new Error("Missing sender identity");
    }

    const { fetchUserKeys } = await import("./api");
    const bundle = await fetchUserKeys(msg.sender_id);
    const senderDevice = bundle.devices.find(d => d.device_id_str === msg.sender_device_id);
    if (!senderDevice) {
      throw new Error("Sender device not found in active bundles");
    }

    const { getOrCreateSession, decryptMessageAESGCM } = await import("./crypto");
    const session = await getOrCreateSession(msg.sender_id, msg.sender_device_id, senderDevice.device_id);
    if (!session) {
      throw new Error("No secure session established");
    }

    const decryptedKey = await decryptMessageAESGCM(
      keyEntry.enc_key,
      keyEntry.nonce,
      session.sharedSecret,
      keyEntry.algo
    );

    if (isE2EEMedia) {
      if (!payload.encrypted_metadata || !payload.metadata_nonce) {
        throw new Error("Missing encrypted metadata payload");
      }
      const metadataPlain = await decryptMessageAESGCM(
        payload.encrypted_metadata,
        payload.metadata_nonce,
        decryptedKey,
        msg.algorithm
      );
      const metadata = JSON.parse(metadataPlain);

      msg.content = metadata.caption || null;
      msg.file_name = metadata.file_name;
      msg.mime_type = metadata.mime_type;
      msg.file_size = metadata.file_size;
      msg.duration = metadata.duration;
      msg.waveform = metadata.waveform;

      msg.decrypted_key = decryptedKey;
      msg.file_nonce = payload.file_nonce;
      msg.decrypted_algo = msg.algorithm;
    } else {
      if (!payload.ciphertext) {
        throw new Error("Missing text ciphertext");
      }
      const plaintext = await decryptMessageAESGCM(
        payload.ciphertext,
        msg.nonce,
        decryptedKey,
        msg.algorithm
      );
      msg.content = plaintext;
    }
  } catch (err: any) {
    console.error("[Nexus WS] Decryption failed:", err);
    msg.content = `🔒 Decryption failed: ${err.message || err}`;
  }
}

// ── Event dispatcher ────────────────────────────────────────────────────────

async function handleEvent(data: WSEvent): Promise<void> {
  const store = useConversationStore.getState();

  switch (data.event) {
    case "new_message":
    case "message_sent":
      await decryptMessageInPlace(data.message);
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
      await decryptMessageInPlace(data.message);
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
      await decryptMessageInPlace(data.message);
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

export async function sendMessage(
  conversationId: string,
  content: string,
  messageType: string = "text",
  replyToMessageId?: string | null,
  mediaUrl?: string | null,
  fileNonce?: string | null,
  version?: string | null,
  algo?: string | null
): Promise<void> {
  console.log("sendMessage called, socket:", socket, "readyState:", socket?.readyState);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("[Nexus WS] Not connected");
    return;
  }

  const isE2EEMedia = ["enc_image", "enc_audio", "enc_video", "enc_document"].includes(messageType);
  if (isE2EEMedia) {
    const myDeviceIdStr = localStorage.getItem("nexus_device_id_str") || "";
    socket.send(
      JSON.stringify({
        conversation_id: conversationId,
        content,
        message_type: messageType,
        reply_to_message_id: replyToMessageId || null,
        media_url: mediaUrl || null,
        encryption_version: version || "1",
        nonce: fileNonce || "",
        message_counter: Math.floor(Date.now() / 1000),
        algorithm: algo || "AES-GCM-256",
        sender_device_id: myDeviceIdStr
      })
    );
    return;
  }

  if (messageType === "text") {
    try {
      const store = useConversationStore.getState();
      const conversation = store.conversations.find(c => c.id === conversationId);
      const myDeviceIdStr = localStorage.getItem("nexus_device_id_str") || "";

      if (conversation && myDeviceIdStr) {
        const K_msg_bytes = new Uint8Array(32);
        if (window.crypto?.getRandomValues) {
          window.crypto.getRandomValues(K_msg_bytes);
        } else {
          for (let i = 0; i < 32; i++) K_msg_bytes[i] = Math.floor(Math.random() * 256);
        }
        const { arrayBufferToBase64 } = await import("./crypto");
        const K_msg = arrayBufferToBase64(K_msg_bytes);

        const { encryptMessageAESGCM, getOrCreateSession } = await import("./crypto");
        const msgEncResult = await encryptMessageAESGCM(content, K_msg);

        const keysMap: Record<string, any> = {};

        for (const p of conversation.participants) {
          const { fetchUserKeys } = await import("./api");
          const bundle = await fetchUserKeys(p.user_id);
          
          for (const d of bundle.devices) {
            const session = await getOrCreateSession(p.user_id, d.device_id_str, d.device_id);
            if (session) {
              const encKeyResult = await encryptMessageAESGCM(K_msg, session.sharedSecret);
              
              session.lastSentCounter += 1;
              localStorage.setItem(`nexus_session_${d.device_id_str}`, JSON.stringify(session));

              keysMap[d.device_id_str] = {
                enc_key: encKeyResult.ciphertext,
                nonce: encKeyResult.nonce,
                algo: encKeyResult.algorithm
              };
            }
          }
        }

        const currentCounter = Math.floor(Date.now() / 1000);

        const encryptedPayload = {
          ciphertext: msgEncResult.ciphertext,
          keys: keysMap
        };

        socket.send(
          JSON.stringify({
            conversation_id: conversationId,
            content: JSON.stringify(encryptedPayload),
            message_type: "enc_text",
            reply_to_message_id: replyToMessageId || null,
            media_url: mediaUrl || null,
            encryption_version: msgEncResult.version,
            nonce: msgEncResult.nonce,
            message_counter: currentCounter,
            algorithm: msgEncResult.algorithm,
            sender_device_id: myDeviceIdStr
          })
        );
        return;
      }
    } catch (err) {
      console.error("[Nexus WS] E2EE encryption failed, falling back to plaintext:", err);
    }
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
