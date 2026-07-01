/* ─── User ────────────────────────────────────────────────────────────────── */

export interface User {
  id: string;
  phone: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
}

/* ─── Conversation ────────────────────────────────────────────────────────── */

export interface Participant {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

export interface Conversation {
  id: string;
  is_group: boolean;
  title: string | null;
  created_at: string;
  participants: Participant[];
  last_message: Message | null;
}

/* ─── Message ─────────────────────────────────────────────────────────────── */

export interface ReplyPreview {
  id: string;
  sender_name: string | null;
  content: string | null;
  message_type: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  message_type: string;
  is_deleted: boolean;
  created_at: string;
  status?: "sent" | "delivered" | "read" | null;
  media_url?: string | null;
  duration?: number | null;
  file_size?: number | null;
  mime_type?: string | null;
  sender_name?: string | null;
  sender_avatar?: string | null;
  reply_to_message_id?: string | null;
  reply_to_preview?: ReplyPreview | null;
  is_pinned?: boolean;
  is_forwarded?: boolean;
  forwarded_from?: string | null;
}

/* ─── WebSocket Events ────────────────────────────────────────────────────── */

export interface WSIncomingPayload {
  conversation_id: string;
  content?: string;
  message_type?: string;
  reply_to_message_id?: string | null;
  duration?: number | null;
  media_url?: string | null;
}

export interface WSNewMessageEvent {
  event: "new_message";
  message: Message;
}

export interface WSMessageSentEvent {
  event: "message_sent";
  message: Message;
}

export interface WSTypingEvent {
  event: "typing";
  conversation_id: string;
  user_id: string;
}

export interface WSMessageDeliveredEvent {
  event: "message_delivered";
  conversation_id: string;
  message_id: string;
  user_id: string;
}

export interface WSMessageReadEvent {
  event: "message_read";
  conversation_id: string;
  message_id: string;
  user_id: string;
}

export interface WSMessagePinnedEvent {
  event: "message_pinned";
  conversation_id: string;
  message: Message;
}

export interface WSMessageUnpinnedEvent {
  event: "message_unpinned";
  conversation_id: string;
  message_id: string;
}

export interface WSErrorEvent {
  event: "error";
  detail: string;
}

export type WSEvent =
  | WSNewMessageEvent
  | WSMessageSentEvent
  | WSTypingEvent
  | WSMessageDeliveredEvent
  | WSMessageReadEvent
  | WSMessagePinnedEvent
  | WSMessageUnpinnedEvent
  | WSErrorEvent;

/* ─── Auth ────────────────────────────────────────────────────────────────── */

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
}

export interface OTPRequestBody {
  phone: string;
}

export interface OTPVerifyBody {
  phone: string;
  otp: string;
}

/* ─── API ─────────────────────────────────────────────────────────────────── */

export interface ConversationCreateBody {
  is_group: boolean;
  title?: string;
  participant_ids: string[];
}

export interface ProfileUpdateBody {
  display_name?: string;
  avatar_url?: string;
}

export interface PaginatedMessages {
  messages: Message[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}
