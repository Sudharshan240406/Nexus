# Nexus Release Notes

---

## Nexus v2.0 Phase 2
*Release Date: July 8, 2026*

This milestone delivers Phase 2 of the Cryptographic Identity Infrastructure, introducing Secure Session Establishment (X3DH handshake) and session lifecycle management.

### Completed Features

✅ **Cryptographic Session Handshake**: Established secure, bi-directional peer sessions with initial handshake envelopes leveraging X3DH.
✅ **Replay Protection**: Integrated replay detection to reject identical or stale handshake payloads (HTTP 400 Bad Request).
✅ **Session Lifecycle Management**: Endpoints to register/update, fetch, delete, and check status for all peer sessions.
✅ **Session Expiration & Renewal**: Automatic 30-day session expiration check returning HTTP 410 Gone on expired sessions to trigger renewal.
✅ **Robust Timezone Handling**: Fixed timezone-naive vs timezone-aware datetime comparison issues when computing session expiration (converting SQLite naive timestamps to UTC).
✅ **CORS Preflight Order Fix**: Adjusted backend middleware stack registration order so that early-exit responses (like 401 Unauthorized) include correct CORS headers.
✅ **Full Verification**: 16/16 backend tests passed, and client-side builds successfully verified.

---

## Nexus v2.0 Phase 1
*Release Date: July 1, 2026*

Welcome to the Nexus v2.0 Phase 1 milestone, completing the core Cryptographic Identity Infrastructure to lay the foundation for End-to-End Encryption (E2EE).

### Completed Features

✅ **Device Registry**: Async device registration and multi-device identity binding.
✅ **Identity Keys**: Long-term asymmetric key pair management client-side.
✅ **Signed Pre-Keys**: Medium-term signature prekeys verifying identity authentication.
✅ **One-Time Pre-Keys**: Managed pool of ephemeral session initiation prekeys.
✅ **Device APIs**: Full REST route suite to register, fetch, list, and revoke device bundles.
✅ **Key Rotation**: Dynamic route to rotate medium-term prekeys and top up ephemeral pools.
✅ **Client Crypto Services**: High-performance client-side X25519/Ed25519 key derivation with resilient environment fallbacks.
✅ **Database Migration**: Schema tables created and migrated to support device identity sessions.
✅ **Backend Tests**: 13/13 unit tests passed covering all registration and consumption scenarios.
✅ **Frontend Build**: Type-safe and bundled with 0 build warnings.
✅ **Mobile Type Checks**: Full React Native client compile checks passing.

### Architecture Primitives
* **Asymmetric Key Exchange**: Curve25519 (X25519)
* **Digital Signatures**: Ed25519
* **Key Derivation**: HKDF (SHA-256)
* **Secure Device Identity**: Decentralized client key management (Zero-Knowledge Server)

*Ready for: Phase 2 - Secure Session Establishment*

---

## Nexus v1.0-pre-e2ee
*Release Date: June 30, 2026*

This release serves as the stable pre-End-to-End Encryption milestone, capturing the full foundational feature set of our modern messaging ecosystem.

### Key Features
* **Authentication & Security**: OTP phone authentication and Security PIN unlock gateway.
* **Messaging & Group Operations**: Real-time DMs and collaborative group chats.
* **Rich Media & Voice Notes**: File attachments and inline voice note recording/player.
* **Interactive Chat Features**: Emoji reactions, target-scoped replies, message forwarding, and sticky pinned message banners.
* **Chat Indicators & Search**: Online presence, typing indicators, read receipts, and contact search.
* **Push Notifications**: Device token mapping and offline push delivery via VAPID webpush.
