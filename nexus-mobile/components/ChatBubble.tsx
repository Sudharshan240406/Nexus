import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
} from "react-native";
import { format } from "date-fns";
import { Colors, FontSize, Spacing, BorderRadius } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { API_URL } from "../constants/theme";
import type { Message } from "../types";

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

  const isAudio = message.message_type === "audio";

  // Audio Playback states
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(
    message.duration ? message.duration * 1000 : 0
  );

  const progressLayoutWidth = useRef<number>(0);

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

      const audioUri = `${API_URL}${message.media_url}`;
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

  const renderAudioContent = () => {
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
        {isAudio ? (
          renderAudioContent()
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
});
