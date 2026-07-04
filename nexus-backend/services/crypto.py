import base64
import hashlib
from typing import Optional
from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

def generate_x25519_keypair():
    """Generate a fresh X25519 private/public keypair and return base64 encoded strings."""
    private_key = x25519.X25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Serialize private key to PKCS8 format
    priv_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )

    # Serialize public key to raw format (32 bytes)
    pub_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )

    return {
        "private_key": base64.b64encode(priv_bytes).decode("utf-8"),
        "public_key": base64.b64encode(pub_bytes).decode("utf-8")
    }

def load_private_key_pkcs8(b64_str: str) -> x25519.X25519PrivateKey:
    """Load an X25519 private key from base64 encoded PKCS8 DER data."""
    der_data = base64.b64decode(b64_str)
    key = serialization.load_der_private_key(der_data, password=None)
    if not isinstance(key, x25519.X25519PrivateKey):
        raise ValueError("Key is not an X25519 private key")
    return key

def load_public_key_raw(b64_str: str) -> x25519.X25519PublicKey:
    """Load an X25519 public key from base64 encoded raw public bytes (32 bytes)."""
    raw_data = base64.b64decode(b64_str)
    return x25519.X25519PublicKey.from_public_bytes(raw_data)

def serialize_public_key_raw(public_key: x25519.X25519PublicKey) -> str:
    """Serialize an X25519 public key to base64 raw bytes."""
    pub_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )
    return base64.b64encode(pub_bytes).decode("utf-8")

def compute_dh(private_key_b64: str, public_key_b64: str) -> bytes:
    """Compute X25519 Diffie-Hellman key agreement."""
    priv_key = load_private_key_pkcs8(private_key_b64)
    pub_key = load_public_key_raw(public_key_b64)
    return priv_key.exchange(pub_key)

def derive_hkdf_key(shared_secret: bytes, info: bytes = b"nexus-session-key") -> bytes:
    """Derive a 256-bit key from a shared secret using HKDF-SHA256."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=info,
    )
    return hkdf.derive(shared_secret)

def compute_x3dh_secret(
    alice_identity_priv_b64: str,
    alice_ephemeral_priv_b64: str,
    bob_identity_pub_b64: str,
    bob_signed_prekey_pub_b64: str,
    bob_ot_prekey_pub_b64: Optional[str] = None,
    info: bytes = b"nexus-session-key"
) -> bytes:
    """
    Compute the X3DH shared secret for Alice.
    DH1 = DH(IK_A, SPK_B)
    DH2 = DH(EK_A, IK_B)
    DH3 = DH(EK_A, SPK_B)
    DH4 = DH(EK_A, OPK_B) (if OPK_B is present)
    Secret = HKDF(DH1 || DH2 || DH3 [|| DH4])
    """
    dh1 = compute_dh(alice_identity_priv_b64, bob_signed_prekey_pub_b64)
    dh2 = compute_dh(alice_ephemeral_priv_b64, bob_identity_pub_b64)
    dh3 = compute_dh(alice_ephemeral_priv_b64, bob_signed_prekey_pub_b64)
    
    dh_concatenated = dh1 + dh2 + dh3
    if bob_ot_prekey_pub_b64:
        dh4 = compute_dh(alice_ephemeral_priv_b64, bob_ot_prekey_pub_b64)
        dh_concatenated += dh4
        
    return derive_hkdf_key(dh_concatenated, info=info)

def compute_x3dh_secret_bob(
    bob_identity_priv_b64: str,
    bob_signed_prekey_priv_b64: str,
    bob_ot_prekey_priv_b64: Optional[str],
    alice_identity_pub_b64: str,
    alice_ephemeral_pub_b64: str,
    used_ot_prekey: bool = False,
    info: bytes = b"nexus-session-key"
) -> bytes:
    """
    Compute the X3DH shared secret for Bob.
    DH1 = DH(SPK_B, IK_A)
    DH2 = DH(IK_B, EK_A)
    DH3 = DH(SPK_B, EK_A)
    DH4 = DH(OPK_B, EK_A) (if OPK_B was used)
    Secret = HKDF(DH1 || DH2 || DH3 [|| DH4])
    """
    dh1 = compute_dh(bob_signed_prekey_priv_b64, alice_identity_pub_b64)
    dh2 = compute_dh(bob_identity_priv_b64, alice_ephemeral_pub_b64)
    dh3 = compute_dh(bob_signed_prekey_priv_b64, alice_ephemeral_pub_b64)
    
    dh_concatenated = dh1 + dh2 + dh3
    if used_ot_prekey and bob_ot_prekey_priv_b64:
        dh4 = compute_dh(bob_ot_prekey_priv_b64, alice_ephemeral_pub_b64)
        dh_concatenated += dh4
        
    return derive_hkdf_key(dh_concatenated, info=info)

def generate_session_id(
    identity_pub_a: str,
    identity_pub_b: str,
    ephemeral_pub_a: str,
    signed_prekey_pub_b: str
) -> str:
    """Generate a unique secure session identifier by hashing the public keys involved."""
    hasher = hashlib.sha256()
    hasher.update(identity_pub_a.encode("utf-8"))
    hasher.update(identity_pub_b.encode("utf-8"))
    hasher.update(ephemeral_pub_a.encode("utf-8"))
    hasher.update(signed_prekey_pub_b.encode("utf-8"))
    return hasher.hexdigest()
