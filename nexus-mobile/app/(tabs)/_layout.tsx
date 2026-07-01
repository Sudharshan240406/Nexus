import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../stores/authStore";
import { Colors } from "../../constants/theme";

export default function TabsLayout() {
  const token = useAuthStore((s) => s.token);

  // Redirect to auth if not logged in
  if (!token) {
    return <Redirect href="/(auth)/phone" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: Colors.dark[800],
          shadowColor: "transparent",
          elevation: 0,
        },
        headerTintColor: Colors.dark[50],
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 18,
        },
        tabBarStyle: {
          backgroundColor: Colors.dark[800],
          borderTopColor: "rgba(255,255,255,0.06)",
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 25,
          paddingTop: 8,
        },
        tabBarActiveTintColor: Colors.nexus[400],
        tabBarInactiveTintColor: Colors.dark[400],
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chats",
          headerTitle: "Nexus",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
