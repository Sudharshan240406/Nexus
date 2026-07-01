/* ─── User ────────────────────────────────────────────────────────────────── */

export interface User {
  id: string;
  phone: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  has_pin?: boolean;
}

/* ─── Conversation ────────────────────────────────────────────────────────── */

export interface Participant {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  display_name?: string | null;
  avatar_url?: string | null;
  is_online?: boolean;
  last_seen?: string | null;
  last_read_message_id?: string | null;
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

export interface ReactionSummary {
  emoji: string;
  count: number;
  user_ids: string[];
}

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
  media_url?: string | null;
  is_deleted: boolean;
  is_edited?: boolean;
  edited_at?: string | null;
  reply_to_message_id?: string | null;
  reply_to_preview?: ReplyPreview | null;
  reactions?: ReactionSummary[];
  created_at: string;
  sender_name?: string | null;
  sender_avatar?: string | null;
  status?: "sent" | "delivered" | "read" | null;
  duration?: number | null;
  file_size?: number | null;
  mime_type?: string | null;
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

export interface WSUserPresenceEvent {
  event: "user_presence";
  user_id: string;
  is_online: boolean;
  last_seen: string;
}

export interface WSReadReceiptEvent {
  event: "read_receipt";
  conversation_id: string;
  user_id: string;
  message_id: string;
}

export interface WSReactionUpdatedEvent {
  event: "reaction_updated";
  message_id: string;
  conversation_id: string;
  reactions: ReactionSummary[];
}

export interface WSMessageEditedEvent {
  event: "message_edited";
  message: Message;
}

export interface WSMessageDeletedEvent {
  event: "message_deleted";
  message_id: string;
  conversation_id: string;
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

export interface WSErrorEvent {
  event: "error";
  detail: string;
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

export type WSEvent =
  | WSNewMessageEvent
  | WSMessageSentEvent
  | WSTypingEvent
  | WSUserPresenceEvent
  | WSReadReceiptEvent
  | WSReactionUpdatedEvent
  | WSMessageEditedEvent
  | WSMessageDeletedEvent
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
