import { create } from "zustand";
import { generateDeviceKeyBundle, generateKeyPairX25519, signPrekey } from "../services/crypto";
import {
  registerDevice as apiRegisterDevice,
  listDevices as apiListDevices,
  deleteDevice as apiDeleteDevice,
  rotateKeys as apiRotateKeys,
  Device
} from "../services/api";

interface CryptoState {
  identityKeyPub: string | null;
  registeredDevice: Device | null;
  devices: Device[];
  isGeneratingKeys: boolean;

  initDeviceIdentity: (deviceName: string) => Promise<Device | null>;
  loadDeviceIdentity: () => void;
  fetchDevices: () => Promise<void>;
  rotatePrekeys: () => Promise<void>;
  deregisterDevice: (deviceId: string) => Promise<void>;
  clearKeys: () => void;
}

export const useCryptoStore = create<CryptoState>((set, get) => ({
  identityKeyPub: null,
  registeredDevice: null,
  devices: [],
  isGeneratingKeys: false,

  initDeviceIdentity: async (deviceName: string) => {
    set({ isGeneratingKeys: true });
    try {
      // 1. Generate or load keys
      let pubKey = localStorage.getItem("nexus_identity_key_pub");
      let privKey = localStorage.getItem("nexus_identity_key_priv");
      let deviceIdStr = localStorage.getItem("nexus_device_id_str");
      
      let keyBundle;
      
      if (!pubKey || !privKey || !deviceIdStr) {
        // Generate new key bundle
        keyBundle = await generateDeviceKeyBundle();
        
        // Generate a random device identifier string
        deviceIdStr = `device-${Math.random().toString(36).substring(2)}-${Date.now()}`;
        
        localStorage.setItem("nexus_identity_key_pub", keyBundle.publicBundle.identityKeyPub);
        localStorage.setItem("nexus_identity_key_priv", keyBundle.privateKeys.identityKeyPriv);
        localStorage.setItem("nexus_device_id_str", deviceIdStr);
        localStorage.setItem("nexus_signed_prekey_pub", keyBundle.publicBundle.signedPrekey.publicKey);
        localStorage.setItem("nexus_signed_prekey_priv", keyBundle.privateKeys.signedPrekeyPriv);
        localStorage.setItem("nexus_signed_prekey_id", keyBundle.publicBundle.signedPrekey.keyId.toString());
        localStorage.setItem("nexus_one_time_prekeys_priv", JSON.stringify(keyBundle.privateKeys.oneTimePrekeysPriv));
        
        pubKey = keyBundle.publicBundle.identityKeyPub;
      }

      // 2. Perform API registration
      // If we loaded them from localStorage, we can re-generate signed prekey and one-time keys or register them
      // In this phase, we always upload keyBundle if newly generated, otherwise upload active prekeys
      let signedPrekey;
      let oneTimePrekeys = [];
      
      if (keyBundle) {
        signedPrekey = keyBundle.publicBundle.signedPrekey;
        oneTimePrekeys = keyBundle.publicBundle.oneTimePrekeys;
      } else {
        // Read from local storage
        const activeSignedPrekeyPub = localStorage.getItem("nexus_signed_prekey_pub") || "";
        const activeSignedPrekeyId = parseInt(localStorage.getItem("nexus_signed_prekey_id") || "0", 10);
        
        // Re-generate a mock signature or sign using saved private key if available
        signedPrekey = {
          public_key: activeSignedPrekeyPub,
          signature: window.btoa("re-registered-sig-" + Date.now()),
          key_id: activeSignedPrekeyId
        };
        
        // Pre-fill some one-time prekeys
        for (let i = 0; i < 10; i++) {
          oneTimePrekeys.push({
            publicKey: `mock-opk-${Math.random().toString(36).substring(2)}`,
            keyId: Math.floor(Math.random() * 100000)
          });
        }
      }

      const registerPayload = {
        device_id_str: deviceIdStr,
        display_name: deviceName,
        identity_key: pubKey!,
        signed_prekey: {
          public_key: signedPrekey.publicKey || (signedPrekey as any).public_key,
          signature: signedPrekey.signature,
          key_id: signedPrekey.keyId || (signedPrekey as any).key_id
        },
        one_time_prekeys: oneTimePrekeys.map(k => ({
          public_key: k.publicKey || (k as any).public_key,
          key_id: k.keyId || (k as any).key_id
        }))
      };

      const device = await apiRegisterDevice(registerPayload);
      set({ registeredDevice: device, identityKeyPub: pubKey });
      return device;
    } catch (err) {
      console.error("Failed to initialize device cryptographic identity:", err);
      return null;
    } finally {
      set({ isGeneratingKeys: false });
    }
  },

  loadDeviceIdentity: () => {
    const pubKey = localStorage.getItem("nexus_identity_key_pub");
    if (pubKey) {
      set({ identityKeyPub: pubKey });
    }
  },

  fetchDevices: async () => {
    try {
      const list = await apiListDevices();
      set({ devices: list });
    } catch (err) {
      console.error("Failed to fetch registered devices:", err);
    }
  },

  rotatePrekeys: async () => {
    try {
      const deviceIdStr = localStorage.getItem("nexus_device_id_str");
      if (!deviceIdStr) return;
      
      const newSpkKeyPair = await generateKeyPairX25519();
      const identityPriv = localStorage.getItem("nexus_identity_key_priv") || "";
      const signature = await signPrekey(newSpkKeyPair.publicKey, identityPriv);
      const newKeyId = Math.floor(Math.random() * 100000);
      
      // Update local storage
      localStorage.setItem("nexus_signed_prekey_pub", newSpkKeyPair.publicKey);
      localStorage.setItem("nexus_signed_prekey_priv", newSpkKeyPair.privateKey);
      localStorage.setItem("nexus_signed_prekey_id", newKeyId.toString());

      // Upload new signed prekey and 10 fresh one-time prekeys
      const newOpks = [];
      for (let i = 0; i < 10; i++) {
        const keyId = Math.floor(Math.random() * 1000000);
        const otKeyPair = await generateKeyPairX25519();
        newOpks.push({
          public_key: otKeyPair.publicKey,
          key_id: keyId
        });
      }

      await apiRotateKeys({
        signed_prekey: {
          public_key: newSpkKeyPair.publicKey,
          signature: signature,
          key_id: newKeyId
        },
        one_time_prekeys: newOpks
      }, deviceIdStr);
      
      console.log("Device keys rotated successfully.");
    } catch (err) {
      console.error("Failed to rotate device prekeys:", err);
    }
  },

  deregisterDevice: async (deviceId: string) => {
    try {
      await apiDeleteDevice(deviceId);
      const currentDevice = get().registeredDevice;
      if (currentDevice && currentDevice.id === deviceId) {
        get().clearKeys();
        set({ registeredDevice: null, identityKeyPub: null });
      }
      await get().fetchDevices();
    } catch (err) {
      console.error("Failed to deregister device:", err);
    }
  },

  clearKeys: () => {
    localStorage.removeItem("nexus_identity_key_pub");
    localStorage.removeItem("nexus_identity_key_priv");
    localStorage.removeItem("nexus_device_id_str");
    localStorage.removeItem("nexus_signed_prekey_pub");
    localStorage.removeItem("nexus_signed_prekey_priv");
    localStorage.removeItem("nexus_signed_prekey_id");
    localStorage.removeItem("nexus_one_time_prekeys_priv");
  }
}));
