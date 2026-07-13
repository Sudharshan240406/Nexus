import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getMessages, getConversations, getPinnedMessages, pinMessage, unpinMessage, forwardMessage } from "../services/api";
import {
  sendMessage,
  sendReaction,
  sendEditMessage,
  sendDeleteMessage,
  sendMarkRead,
  sendEnterConversation,
  sendLeaveConversation,
} from "../services/ws";
import { useConversationStore } from "../stores/conversationStore";
import { useAuthStore } from "../stores/authStore";
import ChatBubble from "../components/ChatBubble";
import MessageInput from "../components/MessageInput";
import TypingIndicator from "../components/TypingIndicator";
import GroupInfoModal from "../components/GroupInfoModal";
import type { Message } from "../types";

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "offline";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 10) return "just now";
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function ChatRoomPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();

  const userId = useAuthStore((s) => s.userId);
  const conversations = useConversationStore((s) => s.conversations);
  const messages = useConversationStore(
    (s) => s.messagesByConversation[conversationId || ""] || []
  );
  const typingUserId = useConversationStore(
    (s) => s.typingIn[conversationId || ""]
  );
  const onlineUsers = useConversationStore((s) => s.onlineUsers);
  const setMessages = useConversationStore((s) => s.setMessages);
  const prependMessages = useConversationStore((s) => s.prependMessages);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);

  // Search & Reply States
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // Pinned & Forward States
  const [currentPinIndex, setCurrentPinIndex] = useState(0);
  const [forwardMessageTarget, setForwardMessageTarget] = useState<Message | null>(null);
  const [forwardSelectedConvs, setForwardSelectedConvs] = useState<string[]>([]);
  const [forwardSearchQuery, setForwardSearchQuery] = useState("");

  const pinnedMessages = useConversationStore(
    (s) => s.pinnedMessagesByConversation[conversationId || ""] || []
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  // Find the conversation object
  const conversation = conversations.find((c) => c.id === conversationId);
  const otherParticipant = conversation?.participants.find(
    (p) => p.user_id !== userId
  );
  const isOnline = otherParticipant
    ? onlineUsers.has(otherParticipant.user_id)
    : false;

  const onlineParticipantsCount = conversation?.participants.filter(
    (p) => p.user_id !== userId && onlineUsers.has(p.user_id)
  ).length || 0;

  const title = conversation
    ? conversation.is_group
      ? conversation.title || "Group Chat"
      : otherParticipant?.display_name || "Direct Message"
    : "Chat";

  // Mark active + load messages
  useEffect(() => {
    if (!conversationId) return;
    setActiveConversation(conversationId);
    sendEnterConversation(conversationId);
    setCurrentPinIndex(0);

    if (!conversations.some((c) => c.id === conversationId)) {
      getConversations()
        .then((data) => useConversationStore.getState().setConversations(data))
        .catch((err) => console.error("Failed to load conversations:", err));
    }

    loadMessages(1);
    getPinnedMessages(conversationId)
      .then((data) => useConversationStore.getState().setPinnedMessages(conversationId, data))
      .catch((err) => console.error("Failed to load pinned messages:", err));

    return () => {
      setActiveConversation(null);
      sendLeaveConversation();
    };
  }, [conversationId, conversations.length]);

  // Read receipts marker trigger
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.sender_id !== userId) {
      sendMarkRead(conversationId, lastMessage.id);
    }
  }, [conversationId, messages.length, userId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!loadingMore) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  async function loadMessages(pg: number) {
    if (!conversationId) return;
    try {
      const data = await getMessages(conversationId, pg);
      if (pg === 1) {
        setMessages(conversationId, [...data.messages].reverse());
      } else {
        prependMessages(conversationId, [...data.messages].reverse());
      }
      setPage(pg);
      setHasMore(data.has_more);
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    loadMessages(page + 1);
  }

  function handleSend(
    content: string,
    type: string = "text",
    replyToMessageId?: string | null,
    mediaUrl?: string | null,
    fileNonce?: string | null,
    version?: string | null,
    algo?: string | null
  ) {
    if (!conversationId) return;
    sendMessage(conversationId, content, type, replyToMessageId, mediaUrl, fileNonce, version, algo);
  }

  const scrollToMessage = (msgId: string) => {
    const element = document.getElementById(`msg-${msgId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("bg-nexus-500/20", "rounded-2xl");
      setTimeout(() => {
        element.classList.remove("bg-nexus-500/20", "rounded-2xl");
      }, 1200);
    }
  };

  const handlePinToggle = async (msg: Message) => {
    if (!conversationId) return;
    try {
      if (msg.is_pinned) {
        await unpinMessage(msg.id);
        useConversationStore.getState().removePinnedMessage(conversationId, msg.id);
        useConversationStore.getState().updateMessage(conversationId, msg.id, { is_pinned: false });
      } else {
        await pinMessage(msg.id);
        useConversationStore.getState().addPinnedMessage(conversationId, { ...msg, is_pinned: true });
        useConversationStore.getState().updateMessage(conversationId, msg.id, { is_pinned: true });
      }
    } catch (err: any) {
      console.error("Failed to pin/unpin message:", err);
    }
  };

  const handleForwardSubmit = async () => {
    if (!forwardMessageTarget || forwardSelectedConvs.length === 0) return;
    try {
      const results = await forwardMessage(forwardMessageTarget.id, forwardSelectedConvs);
      results.forEach((newMsg) => {
        useConversationStore.getState().addMessage(newMsg.conversation_id, newMsg);
      });
      setForwardMessageTarget(null);
      setForwardSelectedConvs([]);
      setForwardSearchQuery("");
    } catch (err: any) {
      alert(err.message || "Failed to forward message");
    }
  };

  // Filter messages based on search query
  const filteredMessages = searchQuery.trim()
    ? messages.filter((m) =>
        m.content?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  return (
    <div className="h-full flex flex-col">
      {/* ── Chat Header ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 md:px-6 py-3 glass border-t-0 border-x-0 flex items-center justify-between gap-3">
        {/* Left Side: Back & Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Back button (mobile) */}
          <button
            onClick={() => navigate("/")}
            className="md:hidden flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Avatar & Info (clickable if group) */}
          <div
            onClick={() => {
              if (conversation?.is_group) {
                setShowGroupInfo(true);
              }
            }}
            className={`flex items-center gap-3 min-w-0 ${
              conversation?.is_group
                ? "cursor-pointer hover:opacity-85 transition-opacity"
                : ""
            }`}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              {!conversation?.is_group && otherParticipant?.avatar_url ? (
                <img
                  src={
                    otherParticipant.avatar_url.startsWith("http")
                      ? otherParticipant.avatar_url
                      : `${BASE_URL}${otherParticipant.avatar_url}`
                  }
                  alt={title}
                  className="w-10 h-10 rounded-full object-cover shadow-lg shadow-nexus-500/15"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-nexus-500 to-nexus-700 flex items-center justify-center text-white font-semibold shadow-lg shadow-nexus-500/15 select-none">
                  {title.charAt(0).toUpperCase()}
                </div>
              )}
              <span
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-dark-800 ${
                  conversation?.is_group
                    ? onlineParticipantsCount > 0
                      ? "bg-emerald-400 animate-pulse-soft"
                      : "bg-dark-400"
                    : isOnline
                    ? "bg-emerald-400 animate-pulse-soft"
                    : "bg-dark-400"
                }`}
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-dark-50 truncate">
                {title}
              </h3>
              <p className="text-[11px] text-dark-300">
                {!conversation?.is_group
                  ? isOnline
                    ? "Online"
                    : `last seen ${formatRelativeTime(otherParticipant?.last_seen)}`
                  : onlineParticipantsCount > 0
                  ? `${onlineParticipantsCount} online`
                  : `${conversation?.participants.length || 0} participants`}
              </p>
            </div>
          </div>
        </div>

        {/* Right Side: Action Icons */}
        <div className="flex items-center gap-2">
          {/* Search Toggle Button */}
          <button
            onClick={() => {
              setShowSearch(!showSearch);
              if (showSearch) setSearchQuery("");
            }}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors active:scale-95 ${
              showSearch
                ? "bg-nexus-500/20 text-nexus-400 border border-nexus-500/35"
                : "bg-dark-800/60 text-dark-300 hover:text-white hover:bg-white/[0.04]"
            }`}
            title="Search messages"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Pinned Message Banner ── */}
      {pinnedMessages.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2.5 bg-nexus-500/10 border-b border-nexus-500/20 backdrop-blur-md flex items-center justify-between gap-3 text-xs animate-fade-in relative z-20">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer" onClick={() => scrollToMessage(pinnedMessages[currentPinIndex].id)}>
            <span className="text-nexus-400 text-base">📌</span>
            <div className="min-w-0">
              <div className="font-semibold text-nexus-300 text-[10px] tracking-wide uppercase">
                Pinned Message {pinnedMessages.length > 1 && `#${currentPinIndex + 1}`}
              </div>
              <div className="text-dark-200 truncate font-medium text-[12px] leading-snug">
                {pinnedMessages[currentPinIndex].content || (pinnedMessages[currentPinIndex].message_type === "image" ? "📷 Photo" : "🎵 Voice Message")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pinnedMessages.length > 1 && (
              <div className="flex items-center gap-1 bg-dark-800/40 rounded-lg p-0.5 border border-white/[0.04]">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentPinIndex((prev) => (prev > 0 ? prev - 1 : pinnedMessages.length - 1));
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded text-dark-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  ◀
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentPinIndex((prev) => (prev < pinnedMessages.length - 1 ? prev + 1 : 0));
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded text-dark-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  ▶
                </button>
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePinToggle(pinnedMessages[currentPinIndex]);
              }}
              className="px-2 py-1 rounded-lg border border-white/[0.08] hover:bg-white/5 text-dark-300 hover:text-white transition-colors text-[10px] font-semibold"
            >
              Unpin
            </button>
          </div>
        </div>
      )}

      {/* ── Search Bar Input ── */}
      {showSearch && (
        <div className="flex-shrink-0 px-4 py-2 bg-dark-800/40 border-b border-white/[0.04] flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages in this chat…"
            className="flex-1 bg-dark-900/60 text-dark-50 placeholder-dark-400 px-3.5 py-1.5 rounded-xl border border-white/[0.05] focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20 text-xs transition-all"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-xs text-dark-300 hover:text-white px-2 py-1 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Messages Area ────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 md:px-6 py-4"
      >
        {/* Load more button */}
        {hasMore && !searchQuery.trim() && (
          <div className="text-center mb-4">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="text-xs text-nexus-400 hover:text-nexus-300 bg-nexus-500/10 px-4 py-1.5 rounded-full transition-colors"
            >
              {loadingMore ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-nexus-400/30 border-t-nexus-400 rounded-full animate-spin" />
                  Loading…
                </span>
              ) : (
                "Load older messages"
              )}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="w-6 h-6 border-2 border-nexus-500/30 border-t-nexus-500 rounded-full animate-spin" />
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="w-14 h-14 rounded-2xl bg-dark-700/50 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-dark-400">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-dark-300 text-sm">
              {searchQuery.trim() ? "No matching messages found" : "No messages yet"}
            </p>
            {!searchQuery.trim() && <p className="text-dark-400 text-xs">Say hello! 👋</p>}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-0.5">
            {filteredMessages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                isGroup={conversation?.is_group}
                onReply={(m) => setReplyTo(m)}
                onReact={(emoji) => sendReaction(conversationId!, msg.id, emoji)}
                onEdit={(content) => sendEditMessage(conversationId!, msg.id, content)}
                onDelete={() => sendDeleteMessage(conversationId!, msg.id)}
                onForward={(m) => setForwardMessageTarget(m)}
                onPin={handlePinToggle}
              />
            ))}
          </div>
        )}

        {/* Typing indicator */}
        {typingUserId && (
          <div className="max-w-4xl mx-auto">
            <TypingIndicator />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Message Input ────────────────────────────────────────────── */}
      {conversationId && (
        <MessageInput
          conversationId={conversationId}
          onSend={handleSend}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      )}

      {showGroupInfo && conversation && (
        <GroupInfoModal
          conversation={conversation}
          onClose={() => setShowGroupInfo(false)}
        />
      )}

      {/* ── Forward Message Modal ── */}
      {forwardMessageTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setForwardMessageTarget(null)} />
          
          <div className="relative z-10 w-full max-w-md bg-dark-800 border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-scale-in">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Forward Message</h3>
              <button
                onClick={() => setForwardMessageTarget(null)}
                className="text-dark-300 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-3 border-b border-white/[0.06]">
              <input
                type="text"
                value={forwardSearchQuery}
                onChange={(e) => setForwardSearchQuery(e.target.value)}
                placeholder="Search chats…"
                className="w-full bg-dark-900/60 text-dark-50 placeholder-dark-400 px-3.5 py-2 rounded-xl border border-white/[0.05] focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20 text-xs transition-all"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
              {conversations
                .filter((c) => {
                  const targetTitle = c.is_group
                    ? c.title || ""
                    : c.participants.find((p) => p.user_id !== userId)?.display_name || "";
                  return targetTitle.toLowerCase().includes(forwardSearchQuery.toLowerCase());
                })
                .map((c) => {
                  const cTitle = c.is_group
                    ? c.title || "Group Chat"
                    : c.participants.find((p) => p.user_id !== userId)?.display_name || "Direct Message";
                  const otherP = c.participants.find((p) => p.user_id !== userId);
                  const isSelected = forwardSelectedConvs.includes(c.id);

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setForwardSelectedConvs((prev) =>
                          prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                        );
                      }}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        isSelected ? "bg-nexus-500/10" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        isSelected ? "bg-nexus-500 border-nexus-400 text-white" : "border-white/20 bg-dark-900"
                      }`}>
                        {isSelected && <span className="text-[10px]">✓</span>}
                      </div>

                      <div className="relative flex-shrink-0">
                        {!c.is_group && otherP?.avatar_url ? (
                          <img
                            src={otherP.avatar_url.startsWith("http") ? otherP.avatar_url : `${BASE_URL}${otherP.avatar_url}`}
                            alt={cTitle}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-nexus-500 to-nexus-700 flex items-center justify-center text-white font-semibold text-xs select-none">
                            {cTitle.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-dark-50 truncate">{cTitle}</div>
                        <div className="text-[10px] text-dark-400 truncate">
                          {c.is_group ? `${c.participants.length} members` : "Direct Message"}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
              <button
                onClick={() => setForwardMessageTarget(null)}
                className="px-4 py-2 rounded-xl border border-white/[0.08] bg-dark-700/50 hover:bg-dark-600 text-dark-100 hover:text-white text-xs font-semibold transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleForwardSubmit}
                disabled={forwardSelectedConvs.length === 0}
                className="px-4 py-2 rounded-xl bg-nexus-500 hover:bg-nexus-400 text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-nexus-500/20"
              >
                Forward
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
