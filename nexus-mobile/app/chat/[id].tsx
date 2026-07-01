import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { getMessages } from "../../services/api";
import { sendMessage, sendEnterConversation, sendLeaveConversation } from "../../services/ws";
import { useConversationStore } from "../../stores/conversationStore";
import { useAuthStore } from "../../stores/authStore";
import ChatBubble from "../../components/ChatBubble";
import MessageInput from "../../components/MessageInput";
import { Colors, FontSize, Spacing, BorderRadius } from "../../constants/theme";
import type { Message } from "../../types";

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();

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
  const setActiveConversation = useConversationStore(
    (s) => s.setActiveConversation
  );

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  const conversation = conversations.find((c) => c.id === conversationId);
  const otherParticipant = conversation?.participants.find(
    (p) => p.user_id !== userId
  );
  const isOnline = otherParticipant
    ? onlineUsers.has(otherParticipant.user_id)
    : false;
  const title = conversation?.title || "Chat";

  useEffect(() => {
    if (!conversationId) return;
    setActiveConversation(conversationId);
    sendEnterConversation(conversationId);
    loadMessages(1);
    return () => {
      setActiveConversation(null);
      sendLeaveConversation();
    };
  }, [conversationId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!loadingMore && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  async function loadMessages(pg: number) {
    if (!conversationId) return;
    try {
      const data = await getMessages(conversationId, pg);
      const reversed = [...data.messages].reverse();
      if (pg === 1) {
        setMessages(conversationId, reversed);
      } else {
        prependMessages(conversationId, reversed);
      }
      setPage(pg);
      setHasMore(data.has_more);
    } catch (err: any) {
      console.error("Failed to load messages:", err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    loadMessages(page + 1);
  };

  const handleSend = (content: string) => {
    if (!conversationId) return;
    sendMessage(conversationId, content);
  };

  const handleLongPress = useCallback((message: Message) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const options = ["Copy Message", "Cancel"];
    const cancelIndex = options.length - 1;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: undefined,
        },
        (buttonIndex) => {
          if (buttonIndex === 0 && message.content) {
            Clipboard.setStringAsync(message.content);
          }
        }
      );
    } else {
      Alert.alert("Message Options", undefined, [
        {
          text: "Copy Message",
          onPress: () => {
            if (message.content) {
              Clipboard.setStringAsync(message.content);
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <TouchableOpacity
        activeOpacity={0.8}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={400}
      >
        <ChatBubble message={item} />
      </TouchableOpacity>
    ),
    [handleLongPress]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.dark[100]} />
        </TouchableOpacity>

        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>
            {title.charAt(0).toUpperCase()}
          </Text>
          {!conversation?.is_group && (
            <View
              style={[
                styles.headerDot,
                {
                  backgroundColor: isOnline
                    ? Colors.nexus[400]
                    : Colors.dark[400],
                },
              ]}
            />
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle}>
            {!conversation?.is_group
              ? isOnline
                ? "Online"
                : "Offline"
              : `${conversation?.participants.length || 0} members`}
          </Text>
        </View>
      </View>

      {/* ── Messages ──────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.nexus[500]} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onStartReached={handleLoadMore}
          onStartReachedThreshold={0.5}
          ListHeaderComponent={
            hasMore ? (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                onPress={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color={Colors.nexus[400]} size="small" />
                ) : (
                  <Text style={styles.loadMoreText}>Load older messages</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons
                name="chatbubble-outline"
                size={40}
                color={Colors.dark[400]}
              />
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>Say hello! 👋</Text>
            </View>
          }
          ListFooterComponent={
            typingUserId ? (
              <View style={styles.typingContainer}>
                <View style={styles.typingBubble}>
                  <View style={styles.typingDot} />
                  <View style={[styles.typingDot, { animationDelay: "0.2s" } as any]} />
                  <View style={[styles.typingDot, { animationDelay: "0.4s" } as any]} />
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* ── Input ─────────────────────────────────────────────────────── */}
      {conversationId && (
        <MessageInput conversationId={conversationId} onSend={handleSend} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark[950],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.dark[800],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
    gap: Spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.nexus[700],
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
  headerDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.dark[800],
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: Colors.dark[50],
    fontSize: FontSize.base,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: Colors.dark[300],
    fontSize: FontSize.xs,
    marginTop: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  messageList: {
    paddingVertical: Spacing.md,
    flexGrow: 1,
  },
  loadMoreBtn: {
    alignSelf: "center",
    backgroundColor: Colors.nexus[500] + "15",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.md,
  },
  loadMoreText: {
    color: Colors.nexus[400],
    fontSize: FontSize.xs,
    fontWeight: "500",
  },
  emptyChat: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
    gap: Spacing.sm,
  },
  emptyText: {
    color: Colors.dark[300],
    fontSize: FontSize.base,
  },
  emptySubtext: {
    color: Colors.dark[400],
    fontSize: FontSize.sm,
  },
  typingContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dark[600],
    borderRadius: BorderRadius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignSelf: "flex-start",
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.dark[200],
    opacity: 0.6,
  },
});
