import { format, isToday, isYesterday } from "date-fns";
import type { Conversation } from "../types";
import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

export default function ConversationItem({
  conversation,
  isActive,
  onClick,
}: ConversationItemProps) {
  const userId = useAuthStore((s) => s.userId);
  const unreadCount = useConversationStore(
    (s) => s.unreadCounts[conversation.id] || 0
  );
  const onlineUsers = useConversationStore((s) => s.onlineUsers);

  // Find other participant for direct chats
  const otherParticipant = conversation.participants.find(
    (p) => p.user_id !== userId
  );

  // Derive display title
  const title = conversation.is_group
    ? conversation.title || "Group Chat"
    : otherParticipant?.display_name || "Direct Message";

  const isOnline =
    !conversation.is_group && otherParticipant
      ? onlineUsers.has(otherParticipant.user_id)
      : false;

  const lastMsg = conversation.last_message;
  const lastTime = lastMsg?.created_at || conversation.created_at;
  const preview = lastMsg?.content || "No messages yet";

  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left
        transition-all duration-200 group
        ${
          isActive
            ? "bg-nexus-500/10 border border-nexus-500/20"
            : "hover:bg-white/[0.03] border border-transparent"
        }
      `}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {!conversation.is_group && otherParticipant?.avatar_url ? (
          <img
            src={
              otherParticipant.avatar_url.startsWith("http")
                ? otherParticipant.avatar_url
                : `${import.meta.env.VITE_API_URL || "http://localhost:8000"}${otherParticipant.avatar_url}`
            }
            alt={title}
            className="w-12 h-12 rounded-full object-cover shadow-md"
          />
        ) : (
          <div
            className={`
              w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold
              ${
                isActive
                  ? "bg-gradient-to-br from-nexus-500 to-nexus-700 text-white shadow-lg shadow-nexus-500/20"
                  : "bg-dark-600 text-dark-100"
              }
            `}
          >
            {title.charAt(0).toUpperCase()}
          </div>
        )}
        {/* Online indicator */}
        {isOnline && (
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 border-2 border-dark-950 rounded-full animate-pulse-soft" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h3
            className={`text-sm font-semibold truncate ${
              isActive ? "text-nexus-300" : "text-dark-50"
            }`}
          >
            {title}
          </h3>
          <span className="text-[11px] text-dark-300 flex-shrink-0 ml-2">
            {formatTimestamp(lastTime)}
          </span>
        </div>

        <div className="flex items-center justify-between mt-0.5">
          <p className="text-xs text-dark-200 truncate max-w-[200px]">
            {preview}
          </p>

          {unreadCount > 0 && (
            <span className="flex-shrink-0 ml-2 min-w-[20px] h-5 px-1.5 rounded-full bg-nexus-500 text-white text-[11px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
