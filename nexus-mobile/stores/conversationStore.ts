import { create } from "zustand";
import type { Conversation, Message } from "../types";

interface ConversationState {
  conversations: Conversation[];
  messagesByConversation: Record<string, Message[]>;
  typingIn: Record<string, string | null>;
  unreadCounts: Record<string, number>;
  activeConversationId: string | null;
  onlineUsers: Set<string>;
  pinnedMessagesByConversation: Record<string, Message[]>;

  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  prependMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setTyping: (conversationId: string, userId: string | null) => void;
  setActiveConversation: (id: string | null) => void;
  clearUnread: (conversationId: string) => void;
  addOnlineUser: (userId: string) => void;
  removeOnlineUser: (userId: string) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<Message>) => void;
  setPinnedMessages: (conversationId: string, messages: Message[]) => void;
  addPinnedMessage: (conversationId: string, message: Message) => void;
  removePinnedMessage: (conversationId: string, messageId: string) => void;
}

export const useConversationStore = create<ConversationState>()((set) => ({
  conversations: [],
  messagesByConversation: {},
  typingIn: {},
  unreadCounts: {},
  activeConversationId: null,
  onlineUsers: new Set<string>(),
  pinnedMessagesByConversation: {},

  setConversations: (conversations) => set({ conversations }),

  addConversation: (conversation) =>
    set((state) => {
      if (state.conversations.some((c) => c.id === conversation.id)) return state;
      return { conversations: [conversation, ...state.conversations] };
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
      if (existing.some((m) => m.id === message.id)) return state;

      const newMessages = [...existing, message];
      const updatedConversations = state.conversations
        .map((c) =>
          c.id === conversationId ? { ...c, last_message: message } : c
        )
        .sort((a, b) => {
          const aTime = a.last_message?.created_at || a.created_at;
          const bTime = b.last_message?.created_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });

      const unreadCounts = { ...state.unreadCounts };
      if (state.activeConversationId !== conversationId) {
        unreadCounts[conversationId] = (unreadCounts[conversationId] || 0) + 1;
      }

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

  updateMessage: (conversationId, messageId, patch) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] || [];
      const updated = existing.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m
      );

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
