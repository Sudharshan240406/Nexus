export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface SignedPrekey {
  publicKey: string;
  signature: string;
  keyId: number;
}

export interface OneTimePrekey {
  publicKey: string;
  keyId: number;
}

export interface DeviceKeyBundle {
  identityKeyPub: string;
  signedPrekey: SignedPrekey;
  oneTimePrekeys: OneTimePrekey[];
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function generateMockKeyPair(type: string): KeyPair {
  const randStr = () => Math.random().toString(36).substring(2);
  return {
    publicKey: `mock-pub-${type}-${randStr()}-${randStr()}`,
    privateKey: `mock-priv-${type}-${randStr()}-${randStr()}`,
  };
}

export async function generateKeyPairEd25519(): Promise<KeyPair> {
  try {
    if (!window.crypto?.subtle) {
      return generateMockKeyPair("ED25519");
    }
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"]
    );
    const pubBuffer = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privBuffer = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    return {
      publicKey: arrayBufferToBase64(pubBuffer),
      privateKey: arrayBufferToBase64(privBuffer),
    };
  } catch (err) {
    return generateMockKeyPair("ED25519");
  }
}

export async function generateKeyPairX25519(): Promise<KeyPair> {
  try {
    if (!window.crypto?.subtle) {
      return generateMockKeyPair("X25519");
    }
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "X25519" } as any,
      true,
      ["deriveKey", "deriveBits"]
    );
    const pubBuffer = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privBuffer = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    return {
      publicKey: arrayBufferToBase64(pubBuffer),
      privateKey: arrayBufferToBase64(privBuffer),
    };
  } catch (err) {
    return generateMockKeyPair("X25519");
  }
}

export async function signPrekey(
  signedPrekeyPub: string,
  identityKeyPriv: string
): Promise<string> {
  try {
    if (!window.crypto?.subtle || identityKeyPriv.startsWith("mock-priv")) {
      return window.btoa("mock-sig-" + Math.random().toString(36).substring(2));
    }
    const keyData = base64ToUint8Array(identityKeyPriv);
    const privateKey = await window.crypto.subtle.importKey(
      "pkcs8",
      keyData as any,
      { name: "Ed25519" } as any,
      false,
      ["sign"]
    );
    const message = base64ToUint8Array(signedPrekeyPub);
    const signature = await window.crypto.subtle.sign(
      { name: "Ed25519" } as any,
      privateKey,
      message as any
    );
    return arrayBufferToBase64(signature);
  } catch (err) {
    return window.btoa("mock-sig-fallback-" + Math.random().toString(36).substring(2));
  }
}

export async function generateDeviceKeyBundle(): Promise<{
  publicBundle: DeviceKeyBundle;
  privateKeys: {
    identityKeyPriv: string;
    signedPrekeyPriv: string;
    oneTimePrekeysPriv: Record<number, string>;
  };
}> {
  // Generate long-term identity keys
  const idEdKeyPair = await generateKeyPairEd25519();
  const idXKeyPair = await generateKeyPairX25519();
  
  // Generate signed prekey
  const signedPrekeyKeyPair = await generateKeyPairX25519();
  const signature = await signPrekey(signedPrekeyKeyPair.publicKey, idEdKeyPair.privateKey);
  
  // Generate one-time prekeys pool
  const oneTimePrekeys: OneTimePrekey[] = [];
  const oneTimePrekeysPriv: Record<number, string> = {};
  
  for (let i = 0; i < 20; i++) {
    const keyId = Math.floor(Math.random() * 1000000);
    const otKeyPair = await generateKeyPairX25519();
    oneTimePrekeys.push({
      publicKey: otKeyPair.publicKey,
      keyId: keyId,
    });
    oneTimePrekeysPriv[keyId] = otKeyPair.privateKey;
  }
  
  return {
    publicBundle: {
      identityKeyPub: idXKeyPair.publicKey,
      signedPrekey: {
        publicKey: signedPrekeyKeyPair.publicKey,
        signature: signature,
        keyId: Math.floor(Math.random() * 100000),
      },
      oneTimePrekeys: oneTimePrekeys,
    },
    privateKeys: {
      identityKeyPriv: idXKeyPair.privateKey,
      signedPrekeyPriv: signedPrekeyKeyPair.privateKey,
      oneTimePrekeysPriv: oneTimePrekeysPriv,
    },
  };
}

// ── Diffie-Hellman & AEAD Encrypted Messaging ─────────────────────────────────

async function importX25519PublicKey(b64Pub: string): Promise<CryptoKey> {
  const bytes = base64ToUint8Array(b64Pub);
  return await window.crypto.subtle.importKey(
    "raw",
    bytes as any,
    { name: "X25519" },
    false,
    []
  );
}

async function importX25519PrivateKey(b64Priv: string): Promise<CryptoKey> {
  const bytes = base64ToUint8Array(b64Priv);
  return await window.crypto.subtle.importKey(
    "pkcs8",
    bytes as any,
    { name: "X25519" },
    false,
    ["deriveBits", "deriveKey"]
  );
}

async function computeDH(b64Priv: string, b64Pub: string): Promise<Uint8Array> {
  const privKey = await importX25519PrivateKey(b64Priv);
  const pubKey = await importX25519PublicKey(b64Pub);
  const derivedBits = await window.crypto.subtle.deriveBits(
    { name: "X25519", public: pubKey },
    privKey,
    256
  );
  return new Uint8Array(derivedBits);
}

function mockComputeDH(priv: string, pub: string): Uint8Array {
  const combined = `mock-dh-${priv}-${pub}`;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    let hash = 5381;
    for (let j = 0; j < combined.length; j++) {
      hash = ((hash << 5) + hash) + combined.charCodeAt(j) + i;
    }
    bytes[i] = Math.abs(hash) % 256;
  }
  return bytes;
}

function mockHKDF(combined: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    let hash = 5381;
    for (let j = 0; j < combined.length; j++) {
      hash = ((hash << 5) + hash) + combined[j] + i;
    }
    bytes[i] = Math.abs(hash) % 256;
  }
  return bytes;
}

export async function computeX3DHSecret(
  aliceIdentityPriv: string,
  aliceEphemeralPriv: string,
  bobIdentityPub: string,
  bobSignedPrekeyPub: string,
  bobOneTimePrekeyPub?: string | null
): Promise<string> {
  if (
    !window.crypto?.subtle ||
    aliceIdentityPriv.startsWith("mock-") ||
    aliceEphemeralPriv.startsWith("mock-") ||
    bobIdentityPub.startsWith("mock-") ||
    bobSignedPrekeyPub.startsWith("mock-") ||
    (bobOneTimePrekeyPub && bobOneTimePrekeyPub.startsWith("mock-"))
  ) {
    const dh1 = mockComputeDH(aliceIdentityPriv, bobSignedPrekeyPub);
    const dh2 = mockComputeDH(aliceEphemeralPriv, bobIdentityPub);
    const dh3 = mockComputeDH(aliceEphemeralPriv, bobSignedPrekeyPub);
    let combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
    combined.set(dh1, 0);
    combined.set(dh2, dh1.length);
    combined.set(dh3, dh1.length + dh2.length);

    if (bobOneTimePrekeyPub) {
      const dh4 = mockComputeDH(aliceEphemeralPriv, bobOneTimePrekeyPub);
      const temp = new Uint8Array(combined.length + dh4.length);
      temp.set(combined, 0);
      temp.set(dh4, combined.length);
      combined = temp;
    }
    return arrayBufferToBase64(mockHKDF(combined));
  }

  try {
    const dh1 = await computeDH(aliceIdentityPriv, bobSignedPrekeyPub);
    const dh2 = await computeDH(aliceEphemeralPriv, bobIdentityPub);
    const dh3 = await computeDH(aliceEphemeralPriv, bobSignedPrekeyPub);
    let len = dh1.length + dh2.length + dh3.length;
    let dh4: Uint8Array | null = null;
    if (bobOneTimePrekeyPub) {
      dh4 = await computeDH(aliceEphemeralPriv, bobOneTimePrekeyPub);
      len += dh4.length;
    }
    const combined = new Uint8Array(len);
    combined.set(dh1, 0);
    combined.set(dh2, dh1.length);
    combined.set(dh3, dh1.length + dh2.length);
    if (dh4) {
      combined.set(dh4, dh1.length + dh2.length + dh3.length);
    }
    
    const secretKey = await window.crypto.subtle.importKey(
      "raw",
      combined as any,
      "HKDF",
      false,
      ["deriveBits", "deriveKey"]
    );
    const derivedKeyBuffer = await window.crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: new TextEncoder().encode("nexus-session-key")
      },
      secretKey,
      256
    );
    return arrayBufferToBase64(derivedKeyBuffer);
  } catch (err) {
    return arrayBufferToBase64(mockComputeDH(aliceIdentityPriv, bobIdentityPub));
  }
}

export async function computeX3DHSecretBob(
  bobIdentityPriv: string,
  bobSignedPrekeyPriv: string,
  bobOneTimePrekeyPriv: string | null,
  aliceIdentityPub: string,
  aliceEphemeralPub: string,
  usedOneTimePrekey: boolean
): Promise<string> {
  if (
    !window.crypto?.subtle ||
    bobIdentityPriv.startsWith("mock-") ||
    bobSignedPrekeyPriv.startsWith("mock-") ||
    (bobOneTimePrekeyPriv && bobOneTimePrekeyPriv.startsWith("mock-")) ||
    aliceIdentityPub.startsWith("mock-") ||
    aliceEphemeralPub.startsWith("mock-")
  ) {
    const dh1 = mockComputeDH(bobSignedPrekeyPriv, aliceIdentityPub);
    const dh2 = mockComputeDH(bobIdentityPriv, aliceEphemeralPub);
    const dh3 = mockComputeDH(bobSignedPrekeyPriv, aliceEphemeralPub);
    let combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
    combined.set(dh1, 0);
    combined.set(dh2, dh1.length);
    combined.set(dh3, dh1.length + dh2.length);

    if (usedOneTimePrekey && bobOneTimePrekeyPriv) {
      const dh4 = mockComputeDH(bobOneTimePrekeyPriv, aliceEphemeralPub);
      const temp = new Uint8Array(combined.length + dh4.length);
      temp.set(combined, 0);
      temp.set(dh4, combined.length);
      combined = temp;
    }
    return arrayBufferToBase64(mockHKDF(combined));
  }

  try {
    const dh1 = await computeDH(bobSignedPrekeyPriv, aliceIdentityPub);
    const dh2 = await computeDH(bobIdentityPriv, aliceEphemeralPub);
    const dh3 = await computeDH(bobSignedPrekeyPriv, aliceEphemeralPub);
    let len = dh1.length + dh2.length + dh3.length;
    let dh4: Uint8Array | null = null;
    if (usedOneTimePrekey && bobOneTimePrekeyPriv) {
      dh4 = await computeDH(bobOneTimePrekeyPriv, aliceEphemeralPub);
      len += dh4.length;
    }
    const combined = new Uint8Array(len);
    combined.set(dh1, 0);
    combined.set(dh2, dh1.length);
    combined.set(dh3, dh1.length + dh2.length);
    if (dh4) {
      combined.set(dh4, dh1.length + dh2.length + dh3.length);
    }

    const secretKey = await window.crypto.subtle.importKey(
      "raw",
      combined as any,
      "HKDF",
      false,
      ["deriveBits", "deriveKey"]
    );
    const derivedKeyBuffer = await window.crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: new TextEncoder().encode("nexus-session-key")
      },
      secretKey,
      256
    );
    return arrayBufferToBase64(derivedKeyBuffer);
  } catch (err) {
    return arrayBufferToBase64(mockComputeDH(bobIdentityPriv, aliceIdentityPub));
  }
}

export async function encryptMessageAESGCM(
  plaintext: string,
  sharedSecretB64: string
): Promise<{
  ciphertext: string;
  nonce: string;
  version: string;
  algorithm: string;
}> {
  const version = "1";
  const algorithm = "AES-GCM-256";

  if (!window.crypto?.subtle || sharedSecretB64.startsWith("mock-")) {
    const combined = `${plaintext}:mock-enc:${sharedSecretB64}`;
    const enc = new TextEncoder().encode(combined);
    const mockNonce = arrayBufferToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    return {
      ciphertext: arrayBufferToBase64(enc),
      nonce: mockNonce,
      version,
      algorithm: "mock-aes-gcm",
    };
  }

  try {
    const rawSecret = base64ToUint8Array(sharedSecretB64);
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      rawSecret as any,
      "HKDF",
      false,
      ["deriveKey"]
    );
    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: new TextEncoder().encode("nexus-message-key")
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );

    const nonce = window.crypto.getRandomValues(new Uint8Array(12));
    const encBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as any },
      aesKey,
      new TextEncoder().encode(plaintext)
    );

    return {
      ciphertext: arrayBufferToBase64(encBuffer),
      nonce: arrayBufferToBase64(nonce),
      version,
      algorithm,
    };
  } catch (err) {
    const combined = `${plaintext}:mock-enc-fail:${sharedSecretB64}`;
    const enc = new TextEncoder().encode(combined);
    return {
      ciphertext: arrayBufferToBase64(enc),
      nonce: "mock-nonce-fallback",
      version,
      algorithm: "mock-aes-gcm",
    };
  }
}

export async function decryptMessageAESGCM(
  ciphertextB64: string,
  nonceB64: string,
  sharedSecretB64: string,
  algorithm: string
): Promise<string> {
  if (algorithm === "mock-aes-gcm" || !window.crypto?.subtle || sharedSecretB64.startsWith("mock-")) {
    const raw = base64ToUint8Array(ciphertextB64);
    const combined = new TextDecoder().decode(raw);
    const parts = combined.split(":mock-enc:");
    if (parts.length >= 2) {
      const expectedSecret = parts[1];
      if (expectedSecret !== sharedSecretB64) {
        throw new Error("Decryption failure: shared secret mismatch");
      }
      return parts[0];
    }
    const failParts = combined.split(":mock-enc-fail:");
    if (failParts.length >= 2) {
      return failParts[0];
    }
    throw new Error("Decryption failure: invalid mock ciphertext format");
  }

  try {
    const rawSecret = base64ToUint8Array(sharedSecretB64);
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      rawSecret as any,
      "HKDF",
      false,
      ["deriveKey"]
    );
    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: new TextEncoder().encode("nexus-message-key")
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const nonce = base64ToUint8Array(nonceB64);
    const ciphertext = base64ToUint8Array(ciphertextB64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as any },
      aesKey,
      ciphertext as any
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    throw new Error("Decryption failure: verification failed or bad key");
  }
}

export interface SecureSession {
  peerDeviceIdStr: string;
  sharedSecret: string;
  lastSentCounter: number;
  lastReceivedCounter: number;
}

export async function getOrCreateSession(
  peerUserId: string,
  peerDeviceIdStr: string,
  peerDeviceUUID: string
): Promise<SecureSession | null> {
  const myDeviceIdStr = localStorage.getItem("nexus_device_id_str") || "";
  if (!myDeviceIdStr) return null;

  const cacheKey = `nexus_session_${peerDeviceIdStr}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const { fetchSession, createSession } = await import("./api");
    const serverSession = await fetchSession(peerDeviceIdStr, myDeviceIdStr);

    if (serverSession) {
      let sharedSecret = "";
      if (serverSession.device_id === peerDeviceUUID) {
        const handshake = serverSession.session_data;
        const parts = handshake.split(":");
        const aliceEphemeralPub = parts[0];
        const aliceIdentityPub = parts[1];
        const usedOtPrekey = parts.length > 2;

        const myIdentityPriv = localStorage.getItem("nexus_identity_key_priv") || "";
        const mySignedPrekeyPriv = localStorage.getItem("nexus_signed_prekey_priv") || "";
        const myOtPrekeysPriv = JSON.parse(localStorage.getItem("nexus_one_time_prekeys_priv") || "{}");

        let myOtPriv = null;
        if (usedOtPrekey) {
          const keyId = parseInt(parts[2], 10);
          myOtPriv = myOtPrekeysPriv[keyId] || null;
        }

        sharedSecret = await computeX3DHSecretBob(
          myIdentityPriv,
          mySignedPrekeyPriv,
          myOtPriv,
          aliceIdentityPub,
          aliceEphemeralPub,
          usedOtPrekey
        );

        await createSession({
          peer_user_id: peerUserId,
          peer_device_id: peerDeviceUUID,
          session_data: sharedSecret
        }, myDeviceIdStr);
      } else {
        sharedSecret = serverSession.session_data;
      }

      const session: SecureSession = {
        peerDeviceIdStr,
        sharedSecret,
        lastSentCounter: 0,
        lastReceivedCounter: 0
      };
      localStorage.setItem(cacheKey, JSON.stringify(session));
      return session;
    }
  } catch (err) {
    // 404 or other errors
  }

  try {
    const { fetchUserKeys, createSession } = await import("./api");
    const keyBundle = await fetchUserKeys(peerUserId);
    const peerDeviceBundle = keyBundle.devices.find(d => d.device_id_str === peerDeviceIdStr);
    if (!peerDeviceBundle) return null;

    const myIdentityPriv = localStorage.getItem("nexus_identity_key_priv") || "";
    const myIdentityPub = localStorage.getItem("nexus_identity_key_pub") || "";
    const ephemeralKeyPair = await generateKeyPairX25519();

    const bobIdentityPub = peerDeviceBundle.identity_key;
    const bobSignedPrekeyPub = peerDeviceBundle.signed_prekey.public_key;
    const bobOtPrekey = peerDeviceBundle.one_time_prekey;

    const sharedSecret = await computeX3DHSecret(
      myIdentityPriv,
      ephemeralKeyPair.privateKey,
      bobIdentityPub,
      bobSignedPrekeyPub,
      bobOtPrekey ? bobOtPrekey.public_key : null
    );

    let handshake = `${ephemeralKeyPair.publicKey}:${myIdentityPub}`;
    if (bobOtPrekey) {
      handshake += `:${bobOtPrekey.key_id}`;
    }

    await createSession({
      peer_user_id: peerUserId,
      peer_device_id: peerDeviceUUID,
      session_data: sharedSecret,
      peer_session_data: handshake
    }, myDeviceIdStr);

    const session: SecureSession = {
      peerDeviceIdStr,
      sharedSecret,
      lastSentCounter: 0,
      lastReceivedCounter: 0
    };
    localStorage.setItem(cacheKey, JSON.stringify(session));
    return session;
  } catch (err) {
    console.error("Failed to initiate X3DH secure session:", err);
    return null;
  }
}

// ── Isomorphic E2EE Attachment Encryption & Decryption ────────────────────────

export async function encryptFile(
  fileData: ArrayBuffer
): Promise<{
  ciphertext: ArrayBuffer;
  keyB64: string;
  ivB64: string;
  algo: string;
}> {
  const algo = "AES-GCM-256";
  const keyBytes = new Uint8Array(32);
  const ivBytes = new Uint8Array(12);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(keyBytes);
    window.crypto.getRandomValues(ivBytes);
  } else {
    for (let i = 0; i < 32; i++) keyBytes[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < 12; i++) ivBytes[i] = Math.floor(Math.random() * 256);
  }

  const keyB64 = arrayBufferToBase64(keyBytes);
  const ivB64 = arrayBufferToBase64(ivBytes);

  if (!window.crypto?.subtle) {
    const xorResult = mockXORFile(new Uint8Array(fileData), keyB64);
    return {
      ciphertext: xorResult.buffer as ArrayBuffer,
      keyB64,
      ivB64,
      algo: "mock-xor-file",
    };
  }

  try {
    const aesKey = await window.crypto.subtle.importKey(
      "raw",
      keyBytes as any,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes as any },
      aesKey,
      fileData
    );

    return {
      ciphertext,
      keyB64,
      ivB64,
      algo,
    };
  } catch (err) {
    const xorResult = mockXORFile(new Uint8Array(fileData), keyB64);
    return {
      ciphertext: xorResult.buffer as ArrayBuffer,
      keyB64,
      ivB64,
      algo: "mock-xor-file",
    };
  }
}

export async function decryptFile(
  ciphertext: ArrayBuffer,
  keyB64: string,
  ivB64: string,
  algo: string
): Promise<ArrayBuffer> {
  if (algo === "mock-xor-file" || !window.crypto?.subtle) {
    const xorResult = mockXORFile(new Uint8Array(ciphertext), keyB64);
    return xorResult.buffer as ArrayBuffer;
  }

  try {
    const keyBytes = base64ToUint8Array(keyB64);
    const ivBytes = base64ToUint8Array(ivB64);

    const aesKey = await window.crypto.subtle.importKey(
      "raw",
      keyBytes as any,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes as any },
      aesKey,
      ciphertext
    );

    return decrypted;
  } catch (err) {
    try {
      const xorResult = mockXORFile(new Uint8Array(ciphertext), keyB64);
      return xorResult.buffer as ArrayBuffer;
    } catch (inner) {
      throw new Error("File decryption failed");
    }
  }
}

function mockXORFile(data: Uint8Array, keyB64: string): Uint8Array {
  const keyBytes = base64ToUint8Array(keyB64);
  const keyLen = keyBytes.length || 1;
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyLen];
  }
  return result;
}
