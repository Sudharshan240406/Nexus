/**
 * Nexus — API Service
 *
 * Wraps all fetch calls with:
 *   • Base URL from VITE_API_URL env var
 *   • Automatic Authorization: Bearer header
 *   • JSON request/response handling
 */

import { useAuthStore } from "../stores/authStore";
import type {
  Conversation,
  ConversationCreateBody,
  OTPRequestBody,
  OTPVerifyBody,
  PaginatedMessages,
  ProfileUpdateBody,
  TokenResponse,
  User,
  Message,
} from "../types";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Internal helpers ────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error: ${res.status}`);
  }

  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════════

export async function requestOtp(body: OTPRequestBody) {
  return request<{ message: string; phone: string; otp_dev_only: string }>(
    "/auth/request-otp",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function verifyOtp(body: OTPVerifyBody) {
  return request<TokenResponse>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify(body),
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
  const data = await request<PaginatedMessages>(
    `/conversations/${conversationId}/messages?page=${page}&page_size=50`
  );
  try {
    const { decryptMessageInPlace } = await import("./ws");
    for (const msg of data.messages) {
      await decryptMessageInPlace(msg);
    }
  } catch (err) {
    console.error("Failed to decrypt history messages:", err);
  }
  return data;
}

export async function getPinnedMessages(conversationId: string) {
  const data = await request<Message[]>(`/conversations/${conversationId}/pins`);
  try {
    const { decryptMessageInPlace } = await import("./ws");
    for (const msg of data) {
      await decryptMessageInPlace(msg);
    }
  } catch (err) {
    console.error("Failed to decrypt pinned messages:", err);
  }
  return data;
}

export async function pinMessage(messageId: string) {
  return request<Message>(`/messages/${messageId}/pin`, { method: "POST" });
}

export async function unpinMessage(messageId: string) {
  return request<Message>(`/messages/${messageId}/unpin`, { method: "POST" });
}

export async function forwardMessage(messageId: string, conversationIds: string[]) {
  return request<Message[]>(`/messages/${messageId}/forward`, {
    method: "POST",
    body: JSON.stringify({ conversation_ids: conversationIds }),
  });
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

export async function searchUserByPhone(phone: string) {
  return request<User>(`/users/search?phone=${encodeURIComponent(phone)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECURITY & MEDIA & PARTICIPANTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getCurrentUser() {
  return request<User>("/auth/me");
}

export async function setPin(pin: string) {
  return request<{ message: string }>("/auth/set-pin", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export async function verifyPin(pin: string) {
  return request<{ message: string }>("/auth/verify-pin", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export async function uploadMedia(
  file: File,
  conversationId?: string,
  duration?: number,
  replyToMessageId?: string | null
) {
  const formData = new FormData();
  formData.append("file", file);
  if (conversationId) {
    formData.append("conversation_id", conversationId);
  }
  if (duration !== undefined) {
    formData.append("duration", String(duration));
  }
  if (replyToMessageId) {
    formData.append("reply_to_message_id", replyToMessageId);
  }

  const token = useAuthStore.getState().token;
  const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}/upload/media`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload error: ${res.status}`);
  }

  return res.json() as Promise<{ id: string; media_url: string; duration: number; message_type: string }>;
}

export async function addGroupMember(conversationId: string, userId: string) {
  return request<{ message: string }>(`/conversations/${conversationId}/participants`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function removeGroupMember(conversationId: string, userId: string) {
  return request<{ message: string }>(`/conversations/${conversationId}/participants/${userId}`, {
    method: "DELETE",
  });
}

export async function updateMemberRole(conversationId: string, userId: string, role: string) {
  return request<{ message: string }>(`/conversations/${conversationId}/participants/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GIPHY PROXY
// ═══════════════════════════════════════════════════════════════════════════════

export async function getTrendingGifs() {
  return request<{ data: any[] }>("/gifs/trending");
}

export async function searchGifs(q: string) {
  return request<{ data: any[] }>(`/gifs/search?q=${encodeURIComponent(q)}`);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PushTokenOut {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  created_at: string;
  updated_at: string;
}

export async function registerPushToken(pushToken: string, platform?: string) {
  return request<PushTokenOut>("/push-token", {
    method: "POST",
    body: JSON.stringify({ push_token: pushToken, platform }),
  });
}

export async function removePushToken(pushToken: string) {
  return request<{ message: string }>(`/push-token?token=${encodeURIComponent(pushToken)}`, {
    method: "DELETE",
  });
}

export async function listPushTokens() {
  return request<PushTokenOut[]>("/push-token");
}


// ═══════════════════════════════════════════════════════════════════════════════
//  E2EE IDENTITY
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

export async function registerDevice(body: {
  device_id_str: string;
  display_name: string;
  identity_key: string;
  signed_prekey: { public_key: string; signature: string; key_id: number };
  one_time_prekeys: { public_key: string; key_id: number }[];
}) {
  return request<Device>("/devices/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchUserKeys(userId: string) {
  return request<PrekeyBundle>(`/keys/${userId}`);
}

export async function rotateKeys(body: {
  signed_prekey?: { public_key: string; signature: string; key_id: number };
  one_time_prekeys?: { public_key: string; key_id: number }[];
}, deviceIdStr?: string) {
  const query = deviceIdStr ? `?device_id_str=${encodeURIComponent(deviceIdStr)}` : "";
  return request<{ message: string }>(`/keys/rotate${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listDevices() {
  return request<Device[]>("/devices");
}

export async function deleteDevice(deviceId: string) {
  return request<{ message: string }>(`/devices/${deviceId}`, {
    method: "DELETE",
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
//  E2EE SESSIONS (v2.0 Phase 2)
// ═══════════════════════════════════════════════════════════════════════════════

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

export async function deleteSession(sessionId: string) {
  return request<{ message: string }>(`/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function fetchSessionStatus(deviceIdStr?: string) {
  const query = deviceIdStr ? `?device_id_str=${encodeURIComponent(deviceIdStr)}` : "";
  return request<DeviceSessionStatus[]>(`/sessions/status${query}`);
}


