# End-to-End Encrypted Media Attachments

This document outlines the architecture, cryptographic protocol, and serialization formats for sending and receiving E2EE media attachments (Images, Videos, Documents) in Nexus v2.0.

## Overview

Unlike standard messages which are encrypted directly using a device session's DH shared key, media attachments are encrypted using a **symmetric key generated per-file**. This allows large files to be encrypted once, while the smaller file key is encrypted individually for each recipient device.

```
                  ┌───────────────────────────────┐
                  │  1. Generate File Key (AES)   │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │  2. Encrypt File Bytes (AES)  │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
       ┌──────────────────────────┴──────────────────────────┐
       ▼                                                     ▼
┌───────────────┐                                     ┌───────────────┐
│3. Encrypt Key │                                     │3. Encrypt Key │
│  for Peer A   │                                     │  for Peer B   │
│ (AES-GCM-256) │                                     │ (AES-GCM-256) │
└───────────────┘                                     └───────────────┘
```

## Cryptographic Protocol

1. **Symmetric Key Generation**: The sender generates a random 256-bit symmetric key ($K_{file}$) and a 96-bit initialization vector ($IV_{file}$).
2. **File Encryption**: The file data is encrypted using AES-GCM-256 with $K_{file}$ and $IV_{file}$ to produce the ciphertext ($C_{file}$).
3. **Metadata Encryption**: The file metadata (original filename, mime type, size, etc.) is packed into a JSON object and encrypted with $K_{file}$ and a metadata nonce ($IV_{meta}$) to produce $C_{meta}$.
4. **Key Delivery**: For each active recipient device (including the sender's own other devices), the sender retrieves the session shared key ($K_{session}$) and encrypts $K_{file}$ using AES-GCM-256 to produce $C_{key, device}$.
5. **Envelope Assembly**: The sender compiles the E2EE envelope payload:
   ```json
   {
     "encrypted_metadata": "base64_ciphertext",
     "metadata_nonce": "base64_nonce",
     "file_nonce": "base64_file_nonce",
     "keys": {
       "peer_device_id_1": {
         "enc_key": "base64_encrypted_key",
         "nonce": "base64_nonce",
         "algo": "AES-GCM-256"
       },
       "peer_device_id_2": {
         "enc_key": "base64_encrypted_key",
         "nonce": "base64_nonce",
         "algo": "AES-GCM-256"
       }
     }
   }
   ```
6. **Payload Transmission**:
   - The ciphertext $C_{file}$ is uploaded via multipart/form-data POST `/upload/media` along with the E2EE envelope inside the form data.
   - The backend stores the ciphertext and publishes the message (with E2EE fields and envelope in `content`) to WebSocket subscribers.
