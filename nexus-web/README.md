# Nexus Web

> **A real-time messaging client built with React, TypeScript, Vite, and Tailwind CSS.**

Nexus Web is the frontend for the [Nexus Backend](../nexus-backend/README.md). It delivers a premium dark-mode messaging experience with WebSocket-powered real-time communication, OTP authentication, and a responsive layout.

---

## ⚡ Tech Stack

| Layer              | Technology                           |
| ------------------ | ------------------------------------ |
| **Framework**      | React 18 · TypeScript                |
| **Build Tool**     | Vite 5                               |
| **Styling**        | Tailwind CSS 3                       |
| **State**          | Zustand 4                            |
| **Routing**        | React Router v6                      |
| **Dates**          | date-fns 3                           |
| **Real-time**      | Native WebSocket with auto-reconnect |

---

## 📁 Project Structure

```
nexus-web/
├── index.html                          # Entry HTML with Inter font
├── vite.config.ts                      # Vite config with dev proxy
├── tailwind.config.js                  # Custom colors & animations
├── tsconfig.json                       # TypeScript configuration
├── package.json                        # Dependencies & scripts
├── .env.example                        # Environment variables
├── src/
│   ├── main.tsx                        # React entry point
│   ├── App.tsx                         # Root routes & auth guard
│   ├── index.css                       # Tailwind directives + custom styles
│   ├── vite-env.d.ts                   # Vite env type declarations
│   ├── types/
│   │   └── index.ts                    # All TypeScript interfaces
│   ├── stores/
│   │   ├── authStore.ts                # JWT + user state (persisted)
│   │   └── conversationStore.ts        # Conversations + messages + presence
│   ├── services/
│   │   ├── api.ts                      # REST API client with auto-auth
│   │   └── ws.ts                       # WebSocket client with reconnect
│   ├── pages/
│   │   ├── LoginPage.tsx               # OTP login (phone → OTP → JWT)
│   │   ├── ChatListPage.tsx            # Conversation list + search
│   │   ├── ChatRoomPage.tsx            # Message view + input
│   │   └── ProfilePage.tsx             # Edit name & avatar
│   └── components/
│       ├── Layout.tsx                  # App shell with nav bar
│       ├── ChatBubble.tsx              # Message bubble with status ✓✓
│       ├── ConversationItem.tsx        # Conversation list entry
│       ├── MessageInput.tsx            # Auto-resize input + send
│       ├── TypingIndicator.tsx         # Animated typing dots
│       └── SearchContacts.tsx          # New chat by phone number
└── README.md                           # ← You are here
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Nexus Backend running on `http://localhost:8000`

### 1 · Install dependencies

```bash
cd nexus-web
npm install
```

### 2 · Configure environment

```bash
cp .env.example .env
```

### 3 · Start dev server

```bash
npm run dev
```

App runs at **http://localhost:5173**

---

## 🎨 Design System

### Color Palette

| Token           | Hex       | Usage                            |
| --------------- | --------- | -------------------------------- |
| `nexus-500`     | `#10b981` | Primary accent, buttons, links   |
| `nexus-800`     | `#065f46` | Sent message bubbles             |
| `dark-600`      | `#1e293b` | Received message bubbles         |
| `dark-950`      | `#060a14` | Page background                  |
| `dark-50`       | `#f8fafc` | Primary text                     |

### Effects

- **Glassmorphism**: `bg-white/4 backdrop-blur-xl border border-white/6`
- **Gradient text**: `bg-clip-text text-transparent bg-gradient-to-r`
- **Pulse indicator**: Green dot with `animate-pulse-soft`
- **Slide-up entrance**: Messages use `animate-slide-up`

---

## 📡 WebSocket Protocol

### Connection

```
ws://localhost:8000/ws/{user_id}?token={jwt}
```

### Client → Server

```json
{
  "conversation_id": "uuid",
  "content": "Hello!",
  "type": "text"
}
```

### Server → Client

| Event           | Description                        |
| --------------- | ---------------------------------- |
| `new_message`   | Incoming message from another user |
| `message_sent`  | Acknowledgement of sent message    |
| `typing`        | Someone is typing in a conversation|
| `error`         | Server-side error                  |

### Auto-Reconnect

Exponential backoff: `1s → 2s → 4s → 8s → … → 30s max`

---

## 🔧 Environment Variables

| Variable        | Default                    | Description               |
| --------------- | -------------------------- | ------------------------- |
| `VITE_API_URL`  | `http://localhost:8000`    | Backend REST API base URL |
| `VITE_WS_URL`   | `ws://localhost:8000`      | Backend WebSocket URL     |

---

## 📜 License

Proprietary — **Qudra Minds**. All rights reserved.
