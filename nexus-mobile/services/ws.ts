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
      handleEvent(data).catch(err => console.error("[Nexus WS] Event handling failed:", err));
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

import {
  decryptMessageAESGCM,
  getOrCreateSession,
  encryptMessageAESGCM,
  arrayBufferToBase64,
  mobileLocalStorage as localStorage
} from "./crypto";
import { fetchUserKeys } from "./api";

export async function decryptMessageInPlace(msg: any): Promise<void> {
  const isE2EEMedia = ["enc_image", "enc_audio", "enc_video", "enc_document"].includes(msg.message_type);
  if (msg.message_type !== "enc_text" && !isE2EEMedia) return;
  if (!msg.content) return;

  try {
    const payload = JSON.parse(msg.content);
    if (isE2EEMedia) {
      if (!payload.encrypted_metadata || !payload.keys) {
        throw new Error("Invalid E2EE format");
      }
    } else {
      if (!payload.ciphertext || !payload.keys) {
        throw new Error("Invalid E2EE format");
      }
    }

    const myDeviceIdStr = localStorage.getItem("nexus_device_id_str") || "";
    const keyEntry = payload.keys[myDeviceIdStr];
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

    const bundle = await fetchUserKeys(msg.sender_id);
    const senderDevice = bundle.devices.find(d => d.device_id_str === msg.sender_device_id);
    if (!senderDevice) {
      throw new Error("Sender device not found in active bundles");
    }

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
  }
}

// ── Send Helpers ────────────────────────────────────────────────────────────

export async function sendMessage(
  conversationId: string,
  content: string,
  messageType: string = "text",
  replyToMessageId?: string | null,
  mediaUrl?: string | null,
  duration?: number | null,
  fileNonce?: string | null,
  version?: string | null,
  algo?: string | null
): Promise<void> {
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
        duration: duration || null,
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
        for (let i = 0; i < 32; i++) K_msg_bytes[i] = Math.floor(Math.random() * 256);
        const K_msg = arrayBufferToBase64(K_msg_bytes);

        const msgEncResult = await encryptMessageAESGCM(content, K_msg);

        const keysMap: Record<string, any> = {};

        for (const p of conversation.participants) {
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
            duration: duration || null,
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
      console.error("[Nexus WS] Mobile E2EE encryption failed, falling back to plaintext:", err);
    }
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
