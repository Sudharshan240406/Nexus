# Voice Note Encryption Architecture

This document describes the end-to-end encryption design, recording/encryption workflow, and playback pipeline for Voice Notes in Nexus v2.0.

## Recording & Encryption Pipeline

When a user records a voice note:
1. **Audio Capture**: The audio is recorded locally using high-quality formats (WebM/Opus on Web, M4A/AAC on Mobile).
2. **Local Buffering**: The recorded bytes are loaded into an in-memory buffer (ArrayBuffer).
3. **Key Generation**: A unique AES-256 key is generated for this specific voice note.
4. **Encryption**: The raw audio bytes are encrypted client-side using AES-GCM-256 before uploading to the server.
5. **Metadata & Waveform**: The audio duration and waveform data are appended to the metadata payload, which is encrypted with the same symmetric key.
6. **Key Wrapping**: The symmetric key is encrypted for each of the recipient's devices.

## Playback Pipeline

When a voice note is received:
1. **Key Extraction**: The client parses the E2EE envelope and extracts the encrypted key for its own device.
2. **Key Decryption**: The wrapped key is decrypted using the peer session's shared secret.
3. **Ciphertext Fetching**: The client downloads the encrypted audio file bytes from the server.
4. **Local Decryption**: The client decrypts the audio file using the voice note's key.
5. **Dynamic Playback**:
   - **Web**: The decrypted bytes are wrapped in a `Blob` and played using `URL.createObjectURL(blob)`.
   - **Mobile (React Native)**: The decrypted bytes are converted to a Base64 string and played using a data URI (`data:audio/m4a;base64,...`) via the custom audio service.
