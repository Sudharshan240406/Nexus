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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
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
