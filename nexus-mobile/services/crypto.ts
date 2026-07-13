// ── Mobile Crypto Helper ──────────────────────────────────────────────────────

import { fetchSession, createSession, fetchUserKeys } from "./api";

const localMemoryStore: Record<string, string> = {
  nexus_device_id_str: "mobile-mock-device-id",
  nexus_identity_key_pub: "mock-pub-mobile-identity",
  nexus_identity_key_priv: "mock-priv-mobile-identity",
  nexus_signed_prekey_pub: "mock-pub-mobile-signed-prekey",
  nexus_signed_prekey_priv: "mock-priv-mobile-signed-prekey"
};

const localStorage = {
  getItem: (key: string) => localMemoryStore[key] || null,
  setItem: (key: string, value: string) => { localMemoryStore[key] = value; },
  removeItem: (key: string) => { delete localMemoryStore[key]; }
};

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // Lightweight btoa fallback
  if (typeof btoa !== "undefined") {
    return btoa(binary);
  }
  // Simple Base64 implementation
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  let i = 0;
  while (i < len) {
    const b1 = bytes[i++];
    const b2 = i < len ? bytes[i++] : NaN;
    const b3 = i < len ? bytes[i++] : NaN;
    const enc1 = b1 >> 2;
    const enc2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
    const enc3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
    const enc4 = isNaN(b3) ? 64 : b3 & 63;
    result += chars.charAt(enc1) + chars.charAt(enc2) + 
              (enc3 === 64 ? "=" : chars.charAt(enc3)) + 
              (enc4 === 64 ? "=" : chars.charAt(enc4));
  }
  return result;
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Lightweight atob fallback
  let binaryString = "";
  if (typeof atob !== "undefined") {
    binaryString = atob(base64);
  } else {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const bufferLength = base64.length * 0.75;
    const len = base64.length;
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const enc1 = lookup[base64.charCodeAt(i)];
      const enc2 = lookup[base64.charCodeAt(i + 1)];
      const enc3 = lookup[base64.charCodeAt(i + 2)];
      const enc4 = lookup[base64.charCodeAt(i + 3)];
      binaryString += String.fromCharCode((enc1 << 2) | (enc2 >> 4));
      if (enc3 !== 64) binaryString += String.fromCharCode(((enc2 & 15) << 4) | (enc3 >> 2));
      if (enc4 !== 64) binaryString += String.fromCharCode(((enc3 & 3) << 6) | enc4);
    }
  }
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function generateKeyPairX25519(): Promise<KeyPair> {
  const randStr = () => Math.random().toString(36).substring(2);
  return {
    publicKey: `mock-pub-X25519-${randStr()}`,
    privateKey: `mock-priv-X25519-${randStr()}`
  };
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

export async function computeX3DHSecretBob(
  bobIdentityPriv: string,
  bobSignedPrekeyPriv: string,
  bobOneTimePrekeyPriv: string | null,
  aliceIdentityPub: string,
  aliceEphemeralPub: string,
  usedOneTimePrekey: boolean
): Promise<string> {
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

export async function encryptMessageAESGCM(
  plaintext: string,
  sharedSecretB64: string
): Promise<{
  ciphertext: string;
  nonce: string;
  version: string;
  algorithm: string;
}> {
  const combined = `${plaintext}:mock-enc:${sharedSecretB64}`;
  const enc = new TextEncoder().encode(combined);
  const mockNonce = arrayBufferToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  return {
    ciphertext: arrayBufferToBase64(enc),
    nonce: mockNonce,
    version: "1",
    algorithm: "mock-aes-gcm",
  };
}

export async function decryptMessageAESGCM(
  ciphertextB64: string,
  nonceB64: string,
  sharedSecretB64: string,
  algorithm: string
): Promise<string> {
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

  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : null;

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(keyBytes);
    cryptoObj.getRandomValues(ivBytes);
  } else {
    for (let i = 0; i < 32; i++) keyBytes[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < 12; i++) ivBytes[i] = Math.floor(Math.random() * 256);
  }

  const keyB64 = arrayBufferToBase64(keyBytes);
  const ivB64 = arrayBufferToBase64(ivBytes);

  if (!cryptoObj?.subtle) {
    const xorResult = mockXORFile(new Uint8Array(fileData), keyB64);
    return {
      ciphertext: xorResult.buffer as ArrayBuffer,
      keyB64,
      ivB64,
      algo: "mock-xor-file",
    };
  }

  try {
    const aesKey = await cryptoObj.subtle.importKey(
      "raw",
      keyBytes as any,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const ciphertext = await cryptoObj.subtle.encrypt(
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
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : null;

  if (algo === "mock-xor-file" || !cryptoObj?.subtle) {
    const xorResult = mockXORFile(new Uint8Array(ciphertext), keyB64);
    return xorResult.buffer as ArrayBuffer;
  }

  try {
    const keyBytes = base64ToUint8Array(keyB64);
    const ivBytes = base64ToUint8Array(ivB64);

    const aesKey = await cryptoObj.subtle.importKey(
      "raw",
      keyBytes as any,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decrypted = await cryptoObj.subtle.decrypt(
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

export const mobileLocalStorage = localStorage;
