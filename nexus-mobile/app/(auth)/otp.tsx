import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { verifyOtp } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { setupPushNotifications } from "../../services/notifications";
import { Colors, FontSize, Spacing, BorderRadius } from "../../constants/theme";

const OTP_LENGTH = 6;

export default function OtpScreen() {
  const { phone, devOtp } = useLocalSearchParams<{
    phone: string;
    devOtp: string;
  }>();

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const setAuth = useAuthStore((s) => s.setAuth);

  const otp = digits.join("");

  // Auto-submit when all digits are entered
  useEffect(() => {
    if (otp.length === OTP_LENGTH && !loading) {
      handleVerify();
    }
  }, [otp]);

  const handleDigitChange = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean && value !== "") return;

    const newDigits = [...digits];

    if (clean.length > 1) {
      // Handle paste — distribute digits across inputs
      const chars = clean.split("").slice(0, OTP_LENGTH);
      chars.forEach((ch, i) => {
        if (index + i < OTP_LENGTH) newDigits[index + i] = ch;
      });
      setDigits(newDigits);
      const nextIndex = Math.min(index + chars.length, OTP_LENGTH - 1);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    newDigits[index] = clean;
    setDigits(newDigits);

    // Auto-advance to next input
    if (clean && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (otp.length !== OTP_LENGTH || !phone) return;

    setLoading(true);
    setError("");

    try {
      const res = await verifyOtp(phone, otp);
      setAuth(res.access_token, res.user_id);

      // Register push token after login
      setupPushNotifications();

      router.replace("/(tabs)");
    } catch (err: any) {
      setError(err.message || "Invalid OTP");
      setDigits(Array(OTP_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        {/* Header */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.dark[200]} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>Enter OTP</Text>
          <Text style={styles.subtitle}>
            We sent a verification code to{"\n"}
            <Text style={{ color: Colors.nexus[400], fontWeight: "600" }}>
              {phone}
            </Text>
          </Text>
        </View>

        {/* OTP Inputs */}
        <View style={styles.otpRow}>
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => (inputRefs.current[index] = ref)}
              style={[
                styles.otpInput,
                digit ? styles.otpInputFilled : null,
              ]}
              value={digit}
              onChangeText={(val) => handleDigitChange(index, val)}
              onKeyPress={({ nativeEvent }) =>
                handleKeyPress(index, nativeEvent.key)
              }
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              autoFocus={index === 0}
            />
          ))}
        </View>

        {/* Dev OTP hint */}
        {devOtp ? (
          <View style={styles.devHint}>
            <Text style={styles.devHintText}>
              🔑 Dev OTP: <Text style={{ fontWeight: "800", letterSpacing: 3 }}>{devOtp}</Text>
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Verify button */}
        <TouchableOpacity
          style={[
            styles.button,
            (otp.length < OTP_LENGTH || loading) && styles.buttonDisabled,
          ]}
          onPress={handleVerify}
          disabled={otp.length < OTP_LENGTH || loading}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.buttonText}>Verify & Sign In</Text>
          )}
        </TouchableOpacity>

        {/* Resend */}
        <TouchableOpacity
          style={styles.resendButton}
          onPress={() => router.back()}
        >
          <Text style={styles.resendText}>← Change phone number</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark[950],
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  backButton: {
    position: "absolute",
    top: 60,
    left: Spacing["2xl"],
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing["4xl"],
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: "800",
    color: Colors.dark[50],
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.dark[200],
    textAlign: "center",
    lineHeight: 20,
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing["2xl"],
  },
  otpInput: {
    width: 48,
    height: 56,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.dark[700],
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.06)",
    color: Colors.dark[50],
    fontSize: FontSize.xl,
    fontWeight: "700",
    textAlign: "center",
  },
  otpInputFilled: {
    borderColor: Colors.nexus[500] + "60",
    backgroundColor: Colors.dark[600],
  },
  devHint: {
    backgroundColor: "rgba(245,158,11,0.1)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.2)",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.lg,
    alignItems: "center",
  },
  devHintText: {
    color: "#fbbf24",
    fontSize: FontSize.xs,
  },
  errorBox: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  errorText: {
    color: Colors.red,
    fontSize: FontSize.xs,
    textAlign: "center",
  },
  button: {
    backgroundColor: Colors.nexus[500],
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: Colors.nexus[500],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: Colors.white,
    fontSize: FontSize.base,
    fontWeight: "700",
  },
  resendButton: {
    alignItems: "center",
    marginTop: Spacing.xl,
  },
  resendText: {
    color: Colors.dark[300],
    fontSize: FontSize.xs,
  },
});
