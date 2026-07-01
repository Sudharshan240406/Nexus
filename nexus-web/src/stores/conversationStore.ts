import { create } from "zustand";
import type { Conversation, Message } from "../types";

interface ConversationState {
  /** All conversations the user participates in */
  conversations: Conversation[];

  /** Messages keyed by conversation ID */
  messagesByConversation: Record<string, Message[]>;

  /** Set of conversation IDs where someone is typing */
  typingIn: Record<string, string | null>; // convId → userId

  /** Unread counts keyed by conversation ID */
  unreadCounts: Record<string, number>;

  /** Currently active conversation ID (for determining unreads) */
  activeConversationId: string | null;

  /** Online user IDs tracked via WebSocket presence */
  onlineUsers: Set<string>;

  /** Pinned messages keyed by conversation ID */
  pinnedMessagesByConversation: Record<string, Message[]>;

  // ── Actions ─────────────────────────────────────────────────────────

  setConversations: (conversations: Conversation[]) => void;

  addConversation: (conversation: Conversation) => void;

  setMessages: (conversationId: string, messages: Message[]) => void;

  prependMessages: (conversationId: string, messages: Message[]) => void;

  addMessage: (conversationId: string, message: Message) => void;

  setTyping: (conversationId: string, userId: string | null) => void;

  setActiveConversation: (id: string | null) => void;

  clearUnread: (conversationId: string) => void;

  setOnlineUsers: (userIds: string[]) => void;

  addOnlineUser: (userId: string) => void;

  removeOnlineUser: (userId: string) => void;

  updateUserPresence: (userId: string, isOnline: boolean, lastSeen: string) => void;

  updateMessage: (conversationId: string, messageId: string, patch: Partial<Message>) => void;

  updateReadReceipt: (conversationId: string, userId: string, messageId: string) => void;

  setPinnedMessages: (conversationId: string, messages: Message[]) => void;
  addPinnedMessage: (conversationId: string, message: Message) => void;
  removePinnedMessage: (conversationId: string, messageId: string) => void;
}

export const useConversationStore = create<ConversationState>()((set, get) => ({
  conversations: [],
  messagesByConversation: {},
  typingIn: {},
  unreadCounts: {},
  activeConversationId: null,
  onlineUsers: new Set<string>(),
  pinnedMessagesByConversation: {},

  setConversations: (conversations) =>
    set((state) => {
      const online = new Set(state.onlineUsers);
      conversations.forEach((c) => {
        c.participants.forEach((p) => {
          if (p.is_online) online.add(p.user_id);
        });
      });
      return { conversations, onlineUsers: online };
    }),

  addConversation: (conversation) =>
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      if (exists) return state;
      const online = new Set(state.onlineUsers);
      conversation.participants.forEach((p) => {
        if (p.is_online) online.add(p.user_id);
      });
      return {
        conversations: [conversation, ...state.conversations],
        onlineUsers: online,
      };
    }),

  setMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: messages,
      },
    })),

  prependMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [
          ...messages,
          ...(state.messagesByConversation[conversationId] || []),
        ],
      },
    })),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] || [];
      // Prevent duplicates
      if (existing.some((m) => m.id === message.id)) return state;

      const newMessages = [...existing, message];

      // Update last_message on the conversation
      const updatedConversations = state.conversations.map((c) =>
        c.id === conversationId ? { ...c, last_message: message } : c
      );

      // Bump unread if this conversation is not active
      const unreadCounts = { ...state.unreadCounts };
      if (state.activeConversationId !== conversationId) {
        unreadCounts[conversationId] =
          (unreadCounts[conversationId] || 0) + 1;
      }

      // Re-sort: conversations with newest messages first
      updatedConversations.sort((a, b) => {
        const aTime = a.last_message?.created_at || a.created_at;
        const bTime = b.last_message?.created_at || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: newMessages,
        },
        conversations: updatedConversations,
        unreadCounts,
      };
    }),

  setTyping: (conversationId, userId) =>
    set((state) => ({
      typingIn: { ...state.typingIn, [conversationId]: userId },
    })),

  setActiveConversation: (id) =>
    set((state) => {
      const unreadCounts = { ...state.unreadCounts };
      if (id) unreadCounts[id] = 0;
      return { activeConversationId: id, unreadCounts };
    }),

  clearUnread: (conversationId) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [conversationId]: 0 },
    })),

  setOnlineUsers: (userIds) => set({ onlineUsers: new Set(userIds) }),

  addOnlineUser: (userId) =>
    set((state) => {
      const next = new Set(state.onlineUsers);
      next.add(userId);
      return { onlineUsers: next };
    }),

  removeOnlineUser: (userId) =>
    set((state) => {
      const next = new Set(state.onlineUsers);
      next.delete(userId);
      return { onlineUsers: next };
    }),

  updateUserPresence: (userId, isOnline, lastSeen) =>
    set((state) => {
      const online = new Set(state.onlineUsers);
      if (isOnline) {
        online.add(userId);
      } else {
        online.delete(userId);
      }

      const updatedConversations = state.conversations.map((c) => {
        const hasUser = c.participants.some((p) => p.user_id === userId);
        if (!hasUser) return c;
        return {
          ...c,
          participants: c.participants.map((p) =>
            p.user_id === userId
              ? { ...p, is_online: isOnline, last_seen: lastSeen }
              : p
          ),
        };
      });

      return {
        onlineUsers: online,
        conversations: updatedConversations,
      };
    }),

  updateMessage: (conversationId, messageId, patch) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] || [];
      const updated = existing.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m
      );

      // Also update last_message on conversation if it matches
      const updatedConversations = state.conversations.map((c) => {
        if (c.id === conversationId && c.last_message?.id === messageId) {
          return { ...c, last_message: { ...c.last_message, ...patch } };
        }
        return c;
      });

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: updated,
        },
        conversations: updatedConversations,
      };
    }),

  updateReadReceipt: (conversationId, userId, messageId) =>
    set((state) => {
      const updatedConversations = state.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        return {
          ...c,
          participants: c.participants.map((p) =>
            p.user_id === userId
              ? { ...p, last_read_message_id: messageId }
              : p
          ),
        };
      });
      return { conversations: updatedConversations };
    }),

  setPinnedMessages: (conversationId, messages) =>
    set((state) => ({
      pinnedMessagesByConversation: {
        ...state.pinnedMessagesByConversation,
        [conversationId]: messages,
      },
    })),

  addPinnedMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.pinnedMessagesByConversation[conversationId] || [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        pinnedMessagesByConversation: {
          ...state.pinnedMessagesByConversation,
          [conversationId]: [message, ...existing],
        },
      };
    }),

  removePinnedMessage: (conversationId, messageId) =>
    set((state) => {
      const existing = state.pinnedMessagesByConversation[conversationId] || [];
      return {
        pinnedMessagesByConversation: {
          ...state.pinnedMessagesByConversation,
          [conversationId]: existing.filter((m) => m.id !== messageId),
        },
      };
    }),
}));
