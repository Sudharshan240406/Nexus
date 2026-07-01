import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "../../stores/authStore";
import { Colors } from "../../constants/theme";

export default function AuthLayout() {
  const token = useAuthStore((s) => s.token);

  // If already logged in, redirect to main tabs
  if (token) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark[950] },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="phone" />
      <Stack.Screen name="otp" />
    </Stack>
  );
}
