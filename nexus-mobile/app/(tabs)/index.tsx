import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getConversations, createConversation } from "../../services/api";
import { useConversationStore } from "../../stores/conversationStore";
import ConversationItem from "../../components/ConversationItem";
import { Colors, FontSize, Spacing, BorderRadius } from "../../constants/theme";

export default function ChatListScreen() {
  const conversations = useConversationStore((s) => s.conversations);
  const setConversations = useConversationStore((s) => s.setConversations);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchPhone, setSearchPhone] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    loadConversations();
    setActiveConversation(null);
  }, []);

  const loadConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartChat = async () => {
    if (!searchPhone.trim()) return;
    setSearchLoading(true);

    try {
      const conv = await createConversation({
        is_group: false,
        participant_ids: [searchPhone.trim()],
      });
      useConversationStore.getState().addConversation(conv);
      setShowSearch(false);
      setSearchPhone("");
      router.push(`/chat/${conv.id}`);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not start chat");
    } finally {
      setSearchLoading(false);
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: typeof conversations[0] }) => (
      <ConversationItem
        conversation={item}
        onPress={() => router.push(`/chat/${item.id}`)}
      />
    ),
    []
  );

  return (
    <View style={styles.container}>
      {/* Search bar */}
      {showSearch && (
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchPhone}
            onChangeText={setSearchPhone}
            placeholder="Enter phone number"
            placeholderTextColor={Colors.dark[400]}
            keyboardType="phone-pad"
            autoFocus
          />
          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleStartChat}
            disabled={searchLoading}
          >
            {searchLoading ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.searchButtonText}>Chat</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* New chat FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowSearch(!showSearch)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={showSearch ? "close" : "add"}
          size={26}
          color={Colors.white}
        />
      </TouchableOpacity>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.nexus[500]} size="large" />
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name="chatbubbles-outline"
            size={48}
            color={Colors.dark[400]}
          />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap the + button to start a new chat
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark[950],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  emptyTitle: {
    color: Colors.dark[300],
    fontSize: FontSize.base,
    fontWeight: "500",
  },
  emptySubtitle: {
    color: Colors.dark[400],
    fontSize: FontSize.sm,
  },
  searchBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: Colors.dark[800],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  searchInput: {
    flex: 1,
    backgroundColor: Colors.dark[700],
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    color: Colors.dark[50],
    fontSize: FontSize.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  searchButton: {
    backgroundColor: Colors.nexus[500],
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  searchButtonText: {
    color: Colors.white,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  fab: {
    position: "absolute",
    bottom: 100,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.nexus[500],
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    shadowColor: Colors.nexus[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
});
