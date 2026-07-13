import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { format } from "date-fns";
import { Colors, FontSize, Spacing, BorderRadius, API_URL } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import type { Message } from "../types";
import { downloadAndDecryptFile } from "../services/api";

interface ChatBubbleProps {
  message: Message;
}

function formatTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  try {
    return format(d, "h:mm a");
  } catch {
    return "";
  }
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const userId = useAuthStore((s) => s.userId);
  const isSent = message.sender_id === userId;
  const time = formatTime(message.created_at);

  const isAudio = message.message_type === "audio" || message.message_type === "enc_audio";
  const isImage = message.message_type === "image" || message.message_type === "enc_image";
  const isVideo = message.message_type === "video" || message.message_type === "enc_video";
  const isDocument = message.message_type === "document" || message.message_type === "enc_document";

  // Audio Playback states
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(
    message.duration ? message.duration * 1000 : 0
  );

  const progressLayoutWidth = useRef<number>(0);

  const [decryptedUrl, setDecryptedUrl] = useState<string>("");
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string>("");

  const isE2EEMedia = ["enc_image", "enc_audio", "enc_video", "enc_document"].includes(message.message_type);

  useEffect(() => {
    if (!isE2EEMedia || !message.media_url) return;

    if (!message.decrypted_key) {
      setMediaError("Missing session keys");
      return;
    }

    let active = true;
    setLoadingMedia(true);
    setMediaError("");

    const decrypt = async () => {
      try {
        const url = await downloadAndDecryptFile(
          message.media_url || "",
          message.decrypted_key || "",
          message.file_nonce || "",
          message.decrypted_algo || "AES-GCM-256",
          message.mime_type || "application/octet-stream"
        );
        if (active) {
          setDecryptedUrl(url);
        }
      } catch (err: any) {
        console.error("Failed to decrypt attachment on mobile:", err);
        if (active) {
          setMediaError("Failed to decrypt attachment");
        }
      } finally {
        if (active) {
          setLoadingMedia(false);
        }
      }
    };

    decrypt();

    return () => {
      active = false;
    };
  }, [message.id, message.media_url, message.decrypted_key]);

  // Status updates
  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDuration(
        status.durationMillis || (message.duration ? message.duration * 1000 : 0)
      );
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
        sound?.setPositionAsync(0).catch(() => {});
      }
    }
  };

  const loadAndPlaySound = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const audioUri = message.message_type === "enc_audio" ? decryptedUrl : `${API_URL}${message.media_url}`;
      if (!audioUri) {
        throw new Error("No audio source available");
      }
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true },
        onPlaybackStatusUpdate
      );
      setSound(newSound);
    } catch (err) {
      console.error("Failed to load sound", err);
    }
  };

  const handlePlayPause = async () => {
    if (!sound) {
      await loadAndPlaySound();
      return;
    }
    try {
      if (isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch (err) {
      console.error("Failed to toggle play/pause", err);
    }
  };

  const handleSeek = (event: GestureResponderEvent) => {
    if (!sound || !duration || progressLayoutWidth.current === 0) return;
    const { locationX } = event.nativeEvent;
    const ratio = Math.max(
      0,
      Math.min(1, locationX / progressLayoutWidth.current)
    );
    const seekPosition = ratio * duration;
    sound.setPositionAsync(seekPosition).catch(() => {});
  };

  // Cleanup on unmount or media_url change
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync().catch(() => {});
      }
    };
  }, [sound]);

  const formatTimeHelper = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const formatMs = (ms: number) => {
    return formatTimeHelper(Math.floor(ms / 1000));
  };

  const renderTicks = () => {
    if (message.status === "read") {
      return (
        <Text style={[styles.statusText, { color: Colors.nexus[400] }]}>
          ✓✓
        </Text>
      );
    }
    if (message.status === "delivered") {
      return (
        <Text
          style={[
            styles.statusText,
            { color: Colors.dark[200], opacity: 0.7 },
          ]}
        >
          ✓✓
        </Text>
      );
    }
    return (
      <Text
        style={[
          styles.statusText,
          { color: Colors.dark[200], opacity: 0.4 },
        ]}
      >
        ✓
      </Text>
    );
  };

  const renderImageContent = () => {
    if (loadingMedia) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.nexus[400]} />
        </View>
      );
    }
    if (mediaError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={14} color="#f87171" />
          <Text style={styles.errorText}>{mediaError}</Text>
        </View>
      );
    }
    const uri = message.message_type === "enc_image" ? decryptedUrl : `${API_URL}${message.media_url}`;
    return (
      <View style={styles.imageWrapper}>
        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        {message.content && <Text style={[styles.caption, isSent ? styles.captionSent : styles.captionReceived]}>{message.content}</Text>}
      </View>
    );
  };

  const renderVideoContent = () => {
    if (loadingMedia) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.nexus[400]} />
        </View>
      );
    }
    if (mediaError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={14} color="#f87171" />
          <Text style={styles.errorText}>{mediaError}</Text>
        </View>
      );
    }
    return (
      <View style={styles.videoCard}>
        <Ionicons name="videocam" size={24} color={isSent ? Colors.nexus[200] : Colors.nexus[400]} />
        <View style={styles.videoInfo}>
          <Text style={[styles.videoTitle, isSent ? styles.videoTitleSent : styles.videoTitleReceived]}>Encrypted Video</Text>
          <Text style={styles.videoDuration}>{message.duration ? `${message.duration.toFixed(1)}s` : ""}</Text>
        </View>
        <TouchableOpacity
          onPress={() => Alert.alert("Video Player", "Simulated play of decrypted video file.")}
          style={styles.videoPlayBtn}
        >
          <Ionicons name="play" size={16} color={Colors.white} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderDocumentContent = () => {
    if (loadingMedia) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.nexus[400]} />
        </View>
      );
    }
    if (mediaError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={14} color="#f87171" />
          <Text style={styles.errorText}>{mediaError}</Text>
        </View>
      );
    }
    return (
      <View style={styles.docCard}>
        <Ionicons name="document-text" size={24} color={Colors.nexus[400]} />
        <View style={styles.docInfo}>
          <Text style={styles.docName} numberOfLines={1}>
            {message.file_name || "Attachment"}
          </Text>
          <Text style={styles.docMeta}>
            {message.file_size ? `${(message.file_size / 1024).toFixed(1)} KB` : "Document"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => Alert.alert("Download Complete", `Saved: ${message.file_name || "attachment"}`)}
          style={styles.docDlBtn}
        >
          <Ionicons name="download-outline" size={16} color={Colors.dark[200]} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderAudioContent = () => {
    if (loadingMedia) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.nexus[400]} />
          <Text style={styles.loadingText}>Decrypting voice note...</Text>
        </View>
      );
    }
    if (mediaError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={14} color="#f87171" />
          <Text style={styles.errorText}>{mediaError}</Text>
        </View>
      );
    }

    const progressPercent = duration > 0 ? (position / duration) * 100 : 0;
    const displayDuration =
      duration || (message.duration ? message.duration * 1000 : 0);

    return (
      <View style={styles.audioContainer}>
        <View style={styles.audioHeader}>
          <Ionicons
            name="mic"
            size={14}
            color={isSent ? Colors.nexus[200] : Colors.nexus[400]}
          />
          <Text
            style={[
              styles.audioTitle,
              isSent ? styles.audioTitleSent : styles.audioTitleReceived,
            ]}
          >
            Voice Note
          </Text>
        </View>

        <View style={styles.audioPlayerRow}>
          <TouchableOpacity
            style={[
              styles.audioPlayBtn,
              isSent ? styles.audioPlayBtnSent : styles.audioPlayBtnReceived,
            ]}
            onPress={handlePlayPause}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={16}
              color={Colors.white}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.audioProgressBar}
            onLayout={(e) => {
              progressLayoutWidth.current = e.nativeEvent.layout.width;
            }}
            onPress={handleSeek}
            activeOpacity={1}
          >
            <View style={styles.audioProgressBackground}>
              <View
                style={[
                  styles.audioProgressFill,
                  {
                    width: `${progressPercent}%`,
                    backgroundColor: isSent
                      ? Colors.nexus[300]
                      : Colors.nexus[500],
                  },
                ]}
              />
            </View>
          </TouchableOpacity>

          <Text
            style={[
              styles.audioDurationText,
              isSent
                ? styles.audioDurationTextSent
                : styles.audioDurationTextReceived,
            ]}
          >
            {formatMs(position)} / {formatMs(displayDuration)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View
      style={[styles.row, isSent ? styles.rowSent : styles.rowReceived]}
    >
      <View
        style={[
          styles.bubble,
          isSent ? styles.bubbleSent : styles.bubbleReceived,
          isAudio && styles.bubbleAudio,
        ]}
      >
        {/* Sender Name */}
        {!isSent && message.sender_name && (
          <Text style={styles.senderName}>{message.sender_name}</Text>
        )}

        {/* Content */}
        {isAudio || message.message_type === "enc_audio" ? (
          renderAudioContent()
        ) : isImage ? (
          renderImageContent()
        ) : isVideo ? (
          renderVideoContent()
        ) : isDocument ? (
          renderDocumentContent()
        ) : (
          message.content && (
            <Text
              style={[
                styles.content,
                isSent ? styles.contentSent : styles.contentReceived,
              ]}
            >
              {message.content}
            </Text>
          )
        )}

        {/* Timestamp */}
        <View style={styles.meta}>
          <Text style={styles.time}>{time}</Text>
          {isSent && renderTicks()}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginVertical: 2,
    paddingHorizontal: Spacing.md,
  },
  rowSent: {
    alignItems: "flex-end",
  },
  rowReceived: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  bubbleAudio: {
    minWidth: "70%",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  bubbleSent: {
    backgroundColor: Colors.nexus[800],
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    backgroundColor: Colors.dark[600],
    borderBottomLeftRadius: 4,
  },
  content: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  contentSent: {
    color: Colors.nexus[50],
  },
  contentReceived: {
    color: Colors.dark[50],
  },
  audioContainer: {
    flexDirection: "column",
    gap: Spacing.xs,
  },
  audioHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.xs,
  },
  audioTitle: {
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  audioTitleSent: {
    color: Colors.nexus[200],
  },
  audioTitleReceived: {
    color: Colors.dark[200],
  },
  audioPlayerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  audioPlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  audioPlayBtnSent: {
    backgroundColor: Colors.nexus[600],
  },
  audioPlayBtnReceived: {
    backgroundColor: Colors.dark[500],
  },
  audioProgressBar: {
    flex: 1,
    height: 20,
    justifyContent: "center",
  },
  audioProgressBackground: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    width: "100%",
  },
  audioProgressFill: {
    height: "100%",
    borderRadius: 2,
  },
  audioDurationText: {
    fontSize: FontSize.xs - 1,
    fontVariant: ["tabular-nums"],
  },
  audioDurationTextSent: {
    color: Colors.nexus[200],
  },
  audioDurationTextReceived: {
    color: Colors.dark[300],
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 4,
    gap: 4,
  },
  time: {
    fontSize: FontSize.xs,
    color: Colors.dark[200],
    opacity: 0.7,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
  },
  senderName: {
    fontSize: FontSize.xs,
    fontWeight: "700",
    color: Colors.nexus[400],
    marginBottom: 4,
    paddingHorizontal: Spacing.xs,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: Spacing.sm,
  },
  loadingText: {
    fontSize: FontSize.xs,
    color: Colors.dark[300],
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: Spacing.sm,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  errorText: {
    fontSize: FontSize.xs,
    color: "#f87171",
  },
  imageWrapper: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    marginTop: 2,
  },
  image: {
    width: 200,
    height: 150,
    borderRadius: BorderRadius.md,
  },
  caption: {
    fontSize: FontSize.base,
    marginTop: 4,
    lineHeight: 20,
  },
  captionSent: {
    color: Colors.nexus[100],
  },
  captionReceived: {
    color: Colors.dark[100],
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    width: 220,
    gap: Spacing.sm,
    marginTop: 2,
  },
  docInfo: {
    flex: 1,
  },
  docName: {
    fontSize: FontSize.xs,
    fontWeight: "600",
    color: Colors.white,
  },
  docMeta: {
    fontSize: FontSize.xs - 2,
    color: Colors.dark[300],
    marginTop: 2,
  },
  docDlBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    width: 220,
    gap: Spacing.sm,
    marginTop: 2,
  },
  videoInfo: {
    flex: 1,
  },
  videoTitle: {
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  videoTitleSent: {
    color: Colors.nexus[100],
  },
  videoTitleReceived: {
    color: Colors.dark[100],
  },
  videoDuration: {
    fontSize: FontSize.xs - 2,
    color: Colors.dark[300],
    marginTop: 2,
  },
  videoPlayBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.nexus[600],
    alignItems: "center",
    justifyContent: "center",
  },
});
