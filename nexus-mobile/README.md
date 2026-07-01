# Nexus Mobile

> **Native messaging app built with Expo, React Native, and TypeScript.**

Nexus Mobile is the companion mobile client for the [Nexus Backend](../nexus-backend/README.md). It delivers real-time messaging with push notifications, WebSocket communication, and a premium dark-mode UI designed for both iOS and Android.

---

## ⚡ Tech Stack

| Layer              | Technology                                |
| ------------------ | ----------------------------------------- |
| **Framework**      | React Native 0.74 · Expo SDK 51           |
| **Language**       | TypeScript 5                              |
| **Navigation**     | Expo Router (file-based)                  |
| **State**          | Zustand 4 + AsyncStorage persistence      |
| **Push**           | expo-notifications (Expo Push Service)     |
| **Media**          | expo-image-picker                          |
| **Dates**          | date-fns 3                                 |
| **Haptics**        | expo-haptics                               |
| **Build**          | EAS Build (APK + IPA)                      |

---

## 📁 Project Structure

```
nexus-mobile/
├── app/
│   ├── _layout.tsx                 # Root layout — WS + push lifecycle
│   ├── (auth)/
│   │   ├── _layout.tsx             # Auth guard (redirect if logged in)
│   │   ├── phone.tsx               # Phone input + country code picker
│   │   └── otp.tsx                 # 6-digit OTP with auto-submit
│   ├── (tabs)/
│   │   ├── _layout.tsx             # Tab navigator (Chats + Profile)
│   │   ├── index.tsx               # Conversation list + FAB + search
│   │   └── profile.tsx             # Edit name, avatar, logout
│   └── chat/
│       └── [id].tsx                # Full chat screen with FlatList
├── components/
│   ├── ChatBubble.tsx              # Sent (green) / received (gray) bubbles
│   ├── ConversationItem.tsx        # List item with unread badge
│   └── MessageInput.tsx            # Auto-resize input + haptic send
├── services/
│   ├── api.ts                      # REST client with auto-auth
│   ├── ws.ts                       # WebSocket with foreground reconnect
│   └── notifications.ts           # Push token registration + nav handler
├── stores/
│   ├── authStore.ts                # JWT + user (AsyncStorage-persisted)
│   └── conversationStore.ts        # Conversations, messages, presence
├── types/
│   └── index.ts                    # TypeScript interfaces
├── constants/
│   └── theme.ts                    # Colors, spacing, typography tokens
├── assets/                         # Icons, splash, etc.
├── app.json                        # Expo config (name: "Nexus")
├── eas.json                        # EAS Build profiles
├── babel.config.js                 # Babel + Reanimated plugin
├── tsconfig.json                   # TypeScript configuration
├── package.json                    # Dependencies
└── README.md                       # ← You are here
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- Nexus Backend running (see `../nexus-backend/`)
- For device testing: Expo Go app on your phone

### 1 · Install dependencies

```bash
cd nexus-mobile
npm install
```

### 2 · Configure API URL

Edit `constants/theme.ts` and set the correct IP for your machine:

```ts
// For Android emulator:
export const API_URL = "http://10.0.2.2:8000";

// For physical device (replace with your machine's IP):
export const API_URL = "http://192.168.x.x:8000";
```

### 3 · Start the dev server

```bash
npx expo start
```

Scan the QR code with Expo Go, or press `a` for Android emulator / `i` for iOS simulator.

---

## 📱 Screens

| Screen            | Route              | Description                               |
| ----------------- | ------------------ | ----------------------------------------- |
| Phone Input       | `(auth)/phone`     | Nexus logo, phone + country code picker   |
| OTP Verification  | `(auth)/otp`       | 6-digit input with auto-submit            |
| Chat List         | `(tabs)/index`     | Conversations with last msg, unread badge |
| Profile           | `(tabs)/profile`   | Edit name, avatar (image picker), logout  |
| Chat Room         | `chat/[id]`        | Messages, online status, long-press copy  |

---

## 🔔 Push Notifications

1. On login, the app registers an Expo Push Token
2. Token is sent to the backend via `POST /push-token`
3. Backend sends push via Expo Push Service when user is offline
4. Tapping a notification navigates directly to the chat

---

## 🏗 Building with EAS

### Android APK (preview)

```bash
eas build --platform android --profile preview
```

### iOS Simulator (preview)

```bash
eas build --platform ios --profile preview
```

### Production (App Store / Play Store)

```bash
eas build --platform all --profile production
```

---

## 🔧 Configuration

| File              | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `app.json`        | App name "Nexus", slug, permissions      |
| `eas.json`        | Build profiles (dev, preview, prod)      |
| `constants/theme` | API_URL, WS_URL, color palette           |

---

## 📜 License

Proprietary — **Qudra Minds**. All rights reserved.
