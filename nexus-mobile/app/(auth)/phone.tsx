import React, { useState } from "react";
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
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { requestOtp } from "../../services/api";
import { Colors, FontSize, Spacing, BorderRadius } from "../../constants/theme";

const COUNTRY_CODES = [
  { code: "+91", country: "IN" },
  { code: "+1", country: "US" },
  { code: "+44", country: "UK" },
  { code: "+61", country: "AU" },
  { code: "+81", country: "JP" },
];

export default function PhoneScreen() {
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState(COUNTRY_CODES[0]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fullPhone = `${countryCode.code}-${phone}`;

  const handleSubmit = async () => {
    if (!phone.trim() || phone.length < 10) return;

    setLoading(true);
    setError("");

    try {
      const res = await requestOtp(fullPhone);
      router.push({
        pathname: "/(auth)/otp",
        params: {
          phone: fullPhone,
          devOtp: res.otp_dev_only,
        },
      });
    } catch (err: any) {
      setError(err.message || "Failed to send OTP");
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
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoIcon}>
            <Ionicons name="chatbubbles" size={32} color={Colors.white} />
          </View>
          <Text style={styles.logoText}>Nexus</Text>
          <Text style={styles.subtitle}>Sign in with your phone number</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.label}>Phone Number</Text>

          <View style={styles.phoneRow}>
            {/* Country code picker */}
            <TouchableOpacity
              style={styles.countryButton}
              onPress={() => setShowPicker(!showPicker)}
              activeOpacity={0.7}
            >
              <Text style={styles.countryCode}>{countryCode.code}</Text>
              <Ionicons
                name="chevron-down"
                size={14}
                color={Colors.dark[300]}
              />
            </TouchableOpacity>

            {/* Phone input */}
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={(val) => setPhone(val.replace(/\D/g, ""))}
              placeholder="9999999901"
              placeholderTextColor={Colors.dark[400]}
              keyboardType="phone-pad"
              maxLength={15}
              autoFocus
            />
          </View>

          {/* Country code dropdown */}
          {showPicker && (
            <View style={styles.dropdown}>
              {COUNTRY_CODES.map((item) => (
                <TouchableOpacity
                  key={item.code}
                  style={[
                    styles.dropdownItem,
                    item.code === countryCode.code && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    setCountryCode(item);
                    setShowPicker(false);
                  }}
                >
                  <Text style={styles.dropdownText}>
                    {item.country} {item.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.button,
              (!phone.trim() || loading) && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!phone.trim() || loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.buttonText}>Request OTP</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          Powered by <Text style={{ color: Colors.nexus[500] }}>Qudra Minds</Text>
        </Text>
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
  logoContainer: {
    alignItems: "center",
    marginBottom: Spacing["4xl"],
  },
  logoIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.nexus[500],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
    shadowColor: Colors.nexus[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  logoText: {
    fontSize: FontSize["3xl"],
    fontWeight: "800",
    color: Colors.nexus[400],
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.dark[200],
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: BorderRadius["2xl"],
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: Spacing["2xl"],
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: "500",
    color: Colors.dark[200],
    marginBottom: Spacing.sm,
    marginLeft: 4,
  },
  phoneRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  countryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dark[700],
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  countryCode: {
    color: Colors.dark[50],
    fontSize: FontSize.base,
    fontWeight: "500",
  },
  phoneInput: {
    flex: 1,
    backgroundColor: Colors.dark[700],
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.dark[50],
    fontSize: FontSize.base,
  },
  dropdown: {
    backgroundColor: Colors.dark[700],
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginBottom: Spacing.lg,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  dropdownItemActive: {
    backgroundColor: Colors.nexus[500] + "20",
  },
  dropdownText: {
    color: Colors.dark[50],
    fontSize: FontSize.sm,
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
  footer: {
    textAlign: "center",
    color: Colors.dark[400],
    fontSize: FontSize.xs,
    marginTop: Spacing["3xl"],
  },
});
