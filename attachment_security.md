# Attachment Security Architecture

This document describes the security model, threat vector protections, and validation constraints for file attachments in Nexus v2.0.

## Zero-Knowledge Storage

The Nexus backend operates as a zero-knowledge store:
- **No Decryption Keys**: The server never possesses private key material or file-specific symmetric keys.
- **Encrypted Metadata**: Filename, mime-type, and size are encrypted client-side. The backend only sees a generic uploaded filename (`file.webm` or `file.bin`) and opaque binary ciphertext.
- **Privacy Preservation**: Search and indexing are performed client-side on the decrypted message index.

## Attack Mitigation

### 1. Replay Attacks
E2EE media uploads are attached to standard messages with unique counters. When a client decrypts an envelope, it performs a counter verification step:
```typescript
if (msg.message_counter <= lastCounter) {
  throw new Error("🔒 Decryption failed: Replayed message detected");
}
```
If a malicious interceptor attempts to replay an uploaded media message envelope, the client detects it and refuses to decrypt or load it.

### 2. Forward Secrecy
Because the symmetric file keys are encrypted using X3DH-negotiated session keys (which rotate or regenerate per session), compromising a future session key does not compromise past uploaded file attachments (provided past session keys have been deleted from client memory).

## Size & Format Constraints

To protect against denial of service (DoS) and excessive storage consumption, the server enforces size limits depending on the file category:

| Category | Extensions | Maximum Size |
|---|---|---|
| Images | `png, jpg, jpeg, gif` | 10 MB |
| Audio (Voice Notes) | `mp3, wav, m4a, ogg, webm` | 10 MB |
| General Files | `pdf, docx, mp4, etc.` | 50 MB |

Any file exceeding these limits is rejected at the backend boundary before storage is allocated.
