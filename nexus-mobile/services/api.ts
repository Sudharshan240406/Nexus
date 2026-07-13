/**
 * Nexus Mobile — API Service
 *
 * Wraps fetch with automatic Authorization header from AsyncStorage-backed store.
 */

import { useAuthStore } from "../stores/authStore";
import { API_URL } from "../constants/theme";
import type {
  Conversation,
  ConversationCreateBody,
  PaginatedMessages,
  ProfileUpdateBody,
  TokenResponse,
  User,
} from "../types";

// ── Internal helpers ────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error: ${res.status}`);
  }

  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════════

export async function requestOtp(phone: string) {
  return request<{ message: string; phone: string; otp_dev_only: string }>(
    "/auth/request-otp",
    { method: "POST", body: JSON.stringify({ phone }) }
  );
}

export async function verifyOtp(phone: string, otp: string) {
  return request<TokenResponse>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phone, otp }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getConversations() {
  return request<Conversation[]>("/conversations");
}

export async function createConversation(body: ConversationCreateBody) {
  return request<Conversation>("/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getMessages(conversationId: string, page = 1) {
  return request<PaginatedMessages>(
    `/conversations/${conversationId}/messages?page=${page}&page_size=50`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

export async function updateProfile(body: ProfileUpdateBody) {
  return request<User>("/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PUSH TOKEN
// ═══════════════════════════════════════════════════════════════════════════════

export async function registerPushToken(pushToken: string, platform: string) {
  return request<{ status: string }>("/push-token", {
    method: "POST",
    body: JSON.stringify({ push_token: pushToken, platform }),
  });
}

export async function removePushToken(pushToken: string) {
  return request<{ message: string }>(`/push-token?token=${encodeURIComponent(pushToken)}`, {
    method: "DELETE",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MEDIA UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

import {
  mobileLocalStorage as localStorage,
  encryptFile,
  decryptFile,
  encryptMessageAESGCM,
  getOrCreateSession,
  arrayBufferToBase64
} from "./crypto";

export async function uploadMedia(
  fileUri: string,
  conversationId?: string,
  duration?: number
) {
  const filename = fileUri.split("/").pop() || "audio.m4a";
  let ext = filename.split(".").pop()?.toLowerCase() || "m4a";
  if (!["mp3", "wav", "m4a", "ogg", "webm", "png", "jpg", "jpeg", "gif", "pdf", "docx", "mp4"].includes(ext)) {
    ext = "m4a";
  }
  const name = `file.${ext}`;
  const isImage = ["png", "jpg", "jpeg", "gif"].includes(ext);
  const isAudio = ["mp3", "wav", "m4a", "ogg", "webm"].includes(ext);
  const isVideo = ["mp4"].includes(ext);
  const type = isImage ? `image/${ext === "jpg" ? "jpeg" : ext}` :
               isAudio ? `audio/${ext === "mp3" ? "mpeg" : ext}` :
               isVideo ? "video/mp4" : "application/octet-stream";

  const myDeviceIdStr = localStorage.getItem("nexus_device_id_str") || "";
  const isE2EE = !!myDeviceIdStr && !!conversationId;

  let fileToUpload: Blob | { uri: string; name: string; type: string } = {
    uri: fileUri,
    name: name,
    type: type,
  };
  let envelopeJson: string | null = null;
  let fileNonce: string | null = null;
  let algo: string | null = null;
  let version: string | null = null;

  if (isE2EE && conversationId) {
    // Fetch conversation participants
    const conversation = await request<Conversation>(`/conversations/${conversationId}`);
    const participants = conversation.participants || [];

    // Fetch original file bytes from uri
    const fileRes = await fetch(fileUri);
    const fileBlob = await fileRes.blob();
    const fileData = await fileBlob.arrayBuffer();

    const encResult = await encryptFile(fileData);
    fileNonce = encResult.ivB64;
    algo = encResult.algo;
    version = "1";

    const fileToUploadBlob = new Blob([encResult.ciphertext], { type: "application/octet-stream" });

    // Prepare E2EE keys map
    const keysMap: Record<string, { enc_key: string; nonce: string; algo: string }> = {};

    for (const p of participants) {
      const peerId = p.user_id;
      const bundle = await fetchUserKeys(peerId);
      for (const dev of bundle.devices) {
        const session = await getOrCreateSession(peerId, dev.device_id_str, dev.device_id);
        if (!session) continue;

        const keyEncBytes = await encryptMessageAESGCM(encResult.keyB64, session.sharedSecret);
        keysMap[dev.device_id_str] = {
          enc_key: keyEncBytes.ciphertext,
          nonce: keyEncBytes.nonce,
          algo: "AES-GCM-256",
        };
      }
    }

    // Encrypt the file metadata
    const metadataPlain = {
      file_name: filename,
      mime_type: type,
      file_size: fileBlob.size,
      duration,
    };
    const metaEncBytes = await encryptMessageAESGCM(JSON.stringify(metadataPlain), encResult.keyB64);

    const envelope = {
      encrypted_metadata: metaEncBytes.ciphertext,
      metadata_nonce: metaEncBytes.nonce,
      file_nonce: fileNonce,
      keys: keysMap,
    };

    envelopeJson = JSON.stringify(envelope);

    if (typeof document !== "undefined") {
      fileToUpload = fileToUploadBlob;
    } else {
      const base64Cipher = arrayBufferToBase64(encResult.ciphertext);
      fileToUpload = {
        uri: `data:application/octet-stream;base64,${base64Cipher}`,
        name: name,
        type: "application/octet-stream",
      } as any;
    }
  }

  const formData = new FormData();
  formData.append("file", fileToUpload as any, name);

  if (conversationId) {
    formData.append("conversation_id", conversationId);
  }
  if (duration !== undefined) {
    formData.append("duration", String(duration));
  }

  // Append E2EE form fields
  if (envelopeJson) {
    formData.append("encryption_version", version || "1");
    formData.append("nonce", fileNonce || "");
    formData.append("message_counter", String(Math.floor(Date.now() / 1000)));
    formData.append("algorithm", algo || "AES-GCM-256");
    formData.append("sender_device_id", myDeviceIdStr);
    formData.append("content", envelopeJson);
  }

  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}/upload/media`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload error: ${res.status}`);
  }

  return res.json() as Promise<{
    id: string;
    media_url: string;
    duration: number;
    message_type: string;
    file_nonce?: string | null;
    encryption_version?: string | null;
    algorithm?: string | null;
  }>;
}

export async function downloadAndDecryptFile(
  mediaUrl: string,
  keyB64: string,
  ivB64: string,
  algo: string,
  mimeType: string
): Promise<string> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${mediaUrl}`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download attachment: ${res.status}`);
  }

  const ciphertext = await res.arrayBuffer();
  const decrypted = await decryptFile(ciphertext, keyB64, ivB64, algo);

  if (typeof URL !== "undefined" && URL.createObjectURL) {
    const blob = new Blob([decrypted], { type: mimeType });
    return URL.createObjectURL(blob);
  } else {
    const base64 = arrayBufferToBase64(decrypted);
    return `data:${mimeType};base64,${base64}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  E2EE IDENTITY & SESSIONS (v2.0 Phase 2/3)
// ═══════════════════════════════════════════════════════════════════════════════

export interface Device {
  id: string;
  user_id: string;
  device_id_str: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PrekeyBundleDevice {
  device_id: string;
  device_id_str: string;
  display_name: string;
  identity_key: string;
  signed_prekey: {
    public_key: string;
    signature: string;
    key_id: number;
  };
  one_time_prekey?: {
    public_key: string;
    key_id: number;
  } | null;
}

export interface PrekeyBundle {
  user_id: string;
  devices: PrekeyBundleDevice[];
}

export interface DeviceSession {
  id: string;
  user_id: string;
  device_id: string;
  peer_user_id: string;
  peer_device_id: string;
  session_data: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceSessionStatus {
  id: string;
  peer_user_id: string;
  peer_device_id: string;
  is_expired: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchUserKeys(userId: string) {
  return request<PrekeyBundle>(`/keys/${userId}`);
}

export async function createSession(body: {
  peer_user_id: string;
  peer_device_id: string;
  session_data: string;
  peer_session_data?: string;
}, deviceIdStr?: string) {
  const query = deviceIdStr ? `?device_id_str=${encodeURIComponent(deviceIdStr)}` : "";
  return request<DeviceSession>(`/sessions${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchSession(device: string, deviceIdStr?: string) {
  const query = deviceIdStr ? `?device_id_str=${encodeURIComponent(deviceIdStr)}` : "";
  return request<DeviceSession>(`/sessions/${device}${query}`);
}

export async function fetchSessionStatus(deviceIdStr?: string) {
  const query = deviceIdStr ? `?device_id_str=${encodeURIComponent(deviceIdStr)}` : "";
  return request<DeviceSessionStatus[]>(`/sessions/status${query}`);
}
