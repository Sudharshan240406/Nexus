import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { format, isToday, isYesterday } from "date-fns";
import { Colors, FontSize, Spacing, BorderRadius } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";
import type { Conversation } from "../types";

interface ConversationItemProps {
  conversation: Conversation;
  onPress: () => void;
}

function formatTimestamp(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  try {
    if (isToday(d)) return format(d, "h:mm a");
    if (isYesterday(d)) return "Yesterday";
    return format(d, "MMM d");
  } catch {
    return "";
  }
}

export default function ConversationItem({
  conversation,
  onPress,
}: ConversationItemProps) {
  const userId = useAuthStore((s) => s.userId);
  const unreadCount = useConversationStore(
    (s) => s.unreadCounts[conversation.id] || 0
  );
  const onlineUsers = useConversationStore((s) => s.onlineUsers);

  const title = conversation.title || "Direct Message";
  const otherParticipant = conversation.participants.find(
    (p) => p.user_id !== userId
  );
  const isOnline =
    !conversation.is_group && otherParticipant
      ? onlineUsers.has(otherParticipant.user_id)
      : false;

  const lastMsg = conversation.last_message;
  const lastTime = lastMsg?.created_at || conversation.created_at;
  const preview = lastMsg?.content || "No messages yet";

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.6}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {title.charAt(0).toUpperCase()}
          </Text>
        </View>
        {isOnline && <View style={styles.onlineDot} />}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.timestamp}>
            {formatTimestamp(lastTime)}
          </Text>
        </View>

        <View style={styles.bottomRow}>
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>

          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  avatarWrap: {
    position: "relative",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.dark[600],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: Colors.dark[100],
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.nexus[400],
    borderWidth: 2.5,
    borderColor: Colors.dark[950],
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: Colors.dark[50],
    fontSize: FontSize.base,
    fontWeight: "600",
    flex: 1,
    marginRight: Spacing.sm,
  },
  timestamp: {
    color: Colors.dark[300],
    fontSize: FontSize.xs,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  preview: {
    color: Colors.dark[200],
    fontSize: FontSize.sm,
    flex: 1,
    marginRight: Spacing.sm,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.nexus[500],
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: "700",
  },
});
