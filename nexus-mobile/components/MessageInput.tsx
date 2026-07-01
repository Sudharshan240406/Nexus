import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Text,
  ActivityIndicator,
  Alert,
  GestureResponderEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors, Spacing, BorderRadius, FontSize } from "../constants/theme";
import { sendTypingEvent } from "../services/ws";
import { Audio } from "expo-av";
import { uploadMedia } from "../services/api";

interface MessageInputProps {
  conversationId: string;
  onSend: (content: string) => void;
}

export default function MessageInput({
  conversationId,
  onSend,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [uploading, setUploading] = useState(false);

  // Animation and layout refs
  const [barHeights, setBarHeights] = useState([12, 18, 8, 22, 14, 10, 16, 8]);
  const progressLayoutWidth = useRef<number>(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Timer loop for recording
  useEffect(() => {
    let timerInterval: any;
    if (isRecording) {
      timerInterval = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [isRecording]);

  // Waveform animation loop
  useEffect(() => {
    let animInterval: any;
    if (isRecording) {
      animInterval = setInterval(() => {
        setBarHeights(
          Array.from({ length: 12 }, () => Math.floor(Math.random() * 22) + 4)
        );
      }, 100);
    }
    return () => {
      if (animInterval) clearInterval(animInterval);
    };
  }, [isRecording]);

  // Cleanup sound resources on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setText(value);

      // Throttled typing indicator
      if (!typingTimeout.current) {
        sendTypingEvent(conversationId);
        typingTimeout.current = setTimeout(() => {
          typingTimeout.current = null;
        }, 2000);
      }
    },
    [conversationId]
  );

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(trimmed);
    setText("");
  };

  // Recording Controls
  const startRecording = async () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Microphone access is required to record voice notes."
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
    } catch (err) {
      console.error("Failed to start recording", err);
      Alert.alert("Error", "Could not start recording.");
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        setRecordingUri(uri);
        setIsPreviewing(true);
        // Load sound for preview
        await loadPreviewSound(uri);
      }
    } catch (err) {
      console.error("Failed to stop recording", err);
      Alert.alert("Error", "Failed to stop recording.");
    }
  };

  const cancelRecording = async () => {
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch (e) {}
      recordingRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // Preview Playback Controls
  const loadPreviewSound = async (uri: string) => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );
      soundRef.current = sound;
    } catch (err) {
      console.error("Failed to load preview sound", err);
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPreviewPosition(status.positionMillis);
      setPreviewDuration(status.durationMillis || 0);
      setIsPlayingPreview(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlayingPreview(false);
        soundRef.current?.setPositionAsync(0);
      }
    }
  };

  const handlePlayPausePreview = async () => {
    if (!soundRef.current) return;
    try {
      if (isPlayingPreview) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch (err) {
      console.error("Failed to toggle preview play/pause", err);
    }
  };

  const handleProgressBarPress = (event: GestureResponderEvent) => {
    if (!soundRef.current || !previewDuration || progressLayoutWidth.current === 0)
      return;
    const { locationX } = event.nativeEvent;
    const ratio = Math.max(
      0,
      Math.min(1, locationX / progressLayoutWidth.current)
    );
    const seekPosition = ratio * previewDuration;
    soundRef.current.setPositionAsync(seekPosition);
  };

  const deletePreview = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {}
      soundRef.current = null;
    }
    setRecordingUri(null);
    setIsPreviewing(false);
    setIsPlayingPreview(false);
    setPreviewPosition(0);
    setPreviewDuration(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSendVoiceNote = async () => {
    if (!recordingUri) return;
    setUploading(true);
    // Unload preview player first so file handles are released
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {}
      soundRef.current = null;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const durationSec = previewDuration
        ? Math.round(previewDuration / 1000)
        : recordingDuration;
      await uploadMedia(recordingUri, conversationId, durationSec);

      // Reset states
      setRecordingUri(null);
      setIsPreviewing(false);
      setIsPlayingPreview(false);
      setPreviewPosition(0);
      setPreviewDuration(0);
    } catch (err: any) {
      console.error("Failed to upload audio message:", err);
      Alert.alert("Upload Failed", err.message || "Could not upload voice note.");
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const formatMs = (ms: number) => {
    return formatTime(Math.floor(ms / 1000));
  };

  const hasContent = text.trim().length > 0;
  const progressPercent =
    previewDuration > 0 ? (previewPosition / previewDuration) * 100 : 0;

  if (uploading) {
    return (
      <View style={styles.container}>
        <View style={[styles.inputWrap, styles.centerRow]}>
          <ActivityIndicator color={Colors.nexus[500]} size="small" />
          <Text style={styles.uploadingText}>Sending voice note…</Text>
        </View>
      </View>
    );
  }

  if (isRecording) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={cancelRecording}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={22} color={Colors.red} />
        </TouchableOpacity>

        <View style={[styles.inputWrap, styles.recordingContainer]}>
          <View style={styles.recordingIndicator}>
            <View style={styles.redDot} />
            <Text style={styles.recordingLabel}>
              {formatTime(recordingDuration)}
            </Text>
          </View>

          <View style={styles.waveformContainer}>
            {barHeights.map((h, i) => (
              <View
                key={i}
                style={[
                  styles.waveBar,
                  { height: h, backgroundColor: Colors.nexus[400] },
                ]}
              />
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.sendButton, styles.stopButton]}
          onPress={stopRecording}
          activeOpacity={0.7}
        >
          <Ionicons name="square" size={16} color={Colors.white} />
        </TouchableOpacity>
      </View>
    );
  }

  if (isPreviewing) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={deletePreview}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={22} color={Colors.red} />
        </TouchableOpacity>

        <View style={[styles.inputWrap, styles.previewContainer]}>
          <TouchableOpacity
            style={styles.playPauseBtn}
            onPress={handlePlayPausePreview}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isPlayingPreview ? "pause" : "play"}
              size={20}
              color={Colors.nexus[400]}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.progressBar}
            onLayout={(e) => {
              progressLayoutWidth.current = e.nativeEvent.layout.width;
            }}
            onPress={handleProgressBarPress}
            activeOpacity={1}
          >
            <View style={styles.progressBackground}>
              <View
                style={[styles.progressFill, { width: `${progressPercent}%` }]}
              />
            </View>
          </TouchableOpacity>

          <Text style={styles.durationLabel}>
            {formatMs(previewPosition)} / {formatMs(previewDuration)}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.sendButton, styles.sendButtonActive]}
          onPress={handleSendVoiceNote}
          activeOpacity={0.7}
        >
          <Ionicons name="send" size={18} color={Colors.white} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.inputWrap}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={handleChange}
          placeholder="Type a message…"
          placeholderTextColor={Colors.dark[400]}
          multiline
          maxLength={2000}
          returnKeyType="default"
        />
      </View>

      {hasContent ? (
        <TouchableOpacity
          style={[styles.sendButton, styles.sendButtonActive]}
          onPress={handleSend}
          activeOpacity={0.7}
        >
          <Ionicons name="send" size={18} color={Colors.white} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.sendButton, styles.micButton]}
          onPress={startRecording}
          activeOpacity={0.7}
        >
          <Ionicons name="mic" size={20} color={Colors.white} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingBottom: Platform.OS === "ios" ? Spacing.lg : Spacing.sm,
    backgroundColor: Colors.dark[800],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
    gap: Spacing.sm,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: Colors.dark[700],
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Platform.OS === "ios" ? Spacing.sm : 2,
    minHeight: 42,
    maxHeight: 120,
    justifyContent: "center",
  },
  input: {
    color: Colors.dark[50],
    fontSize: FontSize.base,
    lineHeight: 22,
    maxHeight: 100,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  uploadingText: {
    color: Colors.dark[300],
    fontSize: FontSize.base,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonActive: {
    backgroundColor: Colors.nexus[500],
    shadowColor: Colors.nexus[500],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  micButton: {
    backgroundColor: Colors.nexus[600],
    shadowColor: Colors.nexus[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  stopButton: {
    backgroundColor: Colors.red,
  },
  cancelBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  recordingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.red,
  },
  recordingLabel: {
    color: Colors.red,
    fontWeight: "600",
    fontSize: FontSize.base,
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
  },
  previewContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  playPauseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  progressBar: {
    flex: 1,
    height: 20,
    justifyContent: "center",
  },
  progressBackground: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark[500],
    width: "100%",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: Colors.nexus[400],
  },
  durationLabel: {
    color: Colors.dark[300],
    fontSize: FontSize.xs,
    fontVariant: ["tabular-nums"],
  },
});
