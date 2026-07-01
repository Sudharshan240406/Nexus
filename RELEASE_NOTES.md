# Nexus v1.0-pre-e2ee Release Notes

Welcome to Nexus v1.0. This release serves as the stable pre-End-to-End Encryption milestone, capturing the full foundational feature set of our modern messaging ecosystem.

---

## Key Features

### 1. Authentication & Security
* **OTP Login**: Fully asynchronous phone authentication with dynamic OTP generation.
* **Security PIN Unlock**: Access gateway protected by bcrypt PIN hashing and verified client-side.

### 2. Messaging & Group Operations
* **Direct Messaging (DM)**: Real-time point-to-point text conversations with low latency.
* **Group Chats**: Fully collaborative group channels supporting custom titles, member lists, and shared message feeds.

### 3. Rich Media & Voice Notes
* **Attachment Uploads**: Seamless media uploads with type-safe metadata mapping.
* **Voice Notes**: Integrates client-side recording APIs, server metadata tracking (duration, size, mime-type), and interactive player bubbles.

### 4. Interactive Chat Features
* **Emoji Reactions**: Real-time message reaction overlays with instant WebSocket synchronization.
* **Reply Messages**: Target-scoped replies rendering contextual citation cards and click-to-scroll navigation.
* **Forward Messages**: Multi-destination forwarding with "Forwarded" annotations.
* **Pinned Messages**: Sticky pinned message pager banner supporting multiple pinned messages, slider transitions, and direct viewport alignment on click.

### 5. Chat Indicators & Search
* **Presence Tracking**: Real-time online/offline indicators for all users.
* **Typing Indicators**: Real-time "Typing..." animations matching peer activity.
* **Message Status**: Delivery and read receipt checkmarks synchronized via active WebSocket state.
* **Conversational Search**: Contact searching by phone numbers to instantly initiate chats.

### 6. Push Notifications
* **Device Token Registration**: Support for FCM / APNS token mapping across platforms.
* **Background Notification Delivery**: Triggers high-priority push events when recipient is offline.
