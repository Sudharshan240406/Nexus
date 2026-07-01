import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuthStore } from "../../stores/authStore";
import { updateProfile } from "../../services/api";
import { disconnectWebSocket } from "../../services/ws";
import { Colors, FontSize, Spacing, BorderRadius } from "../../constants/theme";

export default function ProfileScreen() {
  const { user, setUser, logout } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const initial = (displayName || user?.display_name || "N").charAt(0).toUpperCase();

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatarUrl(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      const updated = await updateProfile({
        display_name: displayName.trim() || undefined,
        avatar_url: avatarUrl.trim() || undefined,
      });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          disconnectWebSocket();
          logout();
          router.replace("/(auth)/phone");
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Avatar */}
      <TouchableOpacity
        style={styles.avatarContainer}
        onPress={handlePickImage}
        activeOpacity={0.7}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        )}
        <View style={styles.cameraBadge}>
          <Ionicons name="camera" size={14} color={Colors.white} />
        </View>
      </TouchableOpacity>

      <Text style={styles.phoneLabel}>{user?.phone || "Unknown"}</Text>

      {/* Form */}
      <View style={styles.card}>
        <Text style={styles.label}>Display Name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor={Colors.dark[400]}
        />

        <Text style={[styles.label, { marginTop: Spacing.xl }]}>
          Avatar URL
        </Text>
        <TextInput
          style={styles.input}
          value={avatarUrl}
          onChangeText={setAvatarUrl}
          placeholder="https://example.com/avatar.jpg"
          placeholderTextColor={Colors.dark[400]}
          autoCapitalize="none"
          keyboardType="url"
        />
        <Text style={styles.hint}>
          Or tap the avatar above to pick from gallery
        </Text>

        {saved && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.nexus[400]} />
            <Text style={styles.successText}>Profile updated!</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Account info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Account Info</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>User ID</Text>
          <Text style={styles.infoValue}>
            {user?.id?.slice(0, 8)}…
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status</Text>
          <Text style={styles.infoValue}>
            {user?.is_active ? "Active" : "Inactive"}
          </Text>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Ionicons name="log-out-outline" size={20} color={Colors.red} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark[950],
  },
  content: {
    paddingHorizontal: Spacing["2xl"],
    paddingTop: Spacing["2xl"],
    paddingBottom: 120,
  },
  avatarContainer: {
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: Colors.nexus[500] + "40",
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.nexus[700],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: Colors.white,
    fontSize: 36,
    fontWeight: "700",
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.nexus[500],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: Colors.dark[950],
  },
  phoneLabel: {
    color: Colors.dark[200],
    fontSize: FontSize.sm,
    textAlign: "center",
    marginBottom: Spacing["3xl"],
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: BorderRadius["2xl"],
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: Spacing["2xl"],
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: "500",
    color: Colors.dark[200],
    marginBottom: Spacing.sm,
    marginLeft: 4,
  },
  input: {
    backgroundColor: Colors.dark[700],
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.dark[50],
    fontSize: FontSize.base,
  },
  hint: {
    color: Colors.dark[400],
    fontSize: FontSize.xs,
    marginTop: Spacing.xs,
    marginLeft: 4,
  },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.nexus[500] + "15",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.lg,
  },
  successText: {
    color: Colors.nexus[400],
    fontSize: FontSize.xs,
  },
  saveButton: {
    backgroundColor: Colors.nexus[500],
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: Spacing.xl,
    shadowColor: Colors.nexus[500],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: FontSize.base,
    fontWeight: "700",
  },
  infoCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: BorderRadius["2xl"],
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  infoTitle: {
    color: Colors.dark[100],
    fontSize: FontSize.sm,
    fontWeight: "600",
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  infoLabel: {
    color: Colors.dark[300],
    fontSize: FontSize.xs,
  },
  infoValue: {
    color: Colors.dark[100],
    fontSize: FontSize.xs,
    fontFamily: "monospace",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
    backgroundColor: "rgba(239,68,68,0.06)",
  },
  logoutText: {
    color: Colors.red,
    fontSize: FontSize.base,
    fontWeight: "600",
  },
});
