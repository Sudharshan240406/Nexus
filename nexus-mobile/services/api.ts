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

export async function uploadMedia(
  fileUri: string,
  conversationId?: string,
  duration?: number
) {
  const formData = new FormData();
  const filename = fileUri.split("/").pop() || "audio.m4a";
  let ext = filename.split(".").pop()?.toLowerCase() || "m4a";
  if (!["mp3", "wav", "m4a", "ogg", "webm"].includes(ext)) {
    ext = "m4a";
  }
  const name = `audio.${ext}`;
  const type = `audio/${ext === "mp3" ? "mpeg" : ext}`;

  formData.append("file", {
    uri: fileUri,
    name: name,
    type: type,
  } as any);

  if (conversationId) {
    formData.append("conversation_id", conversationId);
  }
  if (duration !== undefined) {
    formData.append("duration", String(duration));
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
  }>;
}
