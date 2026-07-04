import os
import sys
import json
import pytest
import pytest_asyncio
from uuid import uuid4, UUID
from datetime import datetime, timezone, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, update

# Add nexus-backend to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from database import get_db, Base
from models import User, Device, IdentityKey, SignedPrekey, OneTimePrekey, DeviceSession
from routers.auth import create_access_token
from services.crypto import (
    generate_x25519_keypair,
    compute_x3dh_secret,
    compute_x3dh_secret_bob,
    generate_session_id
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_cryptographic_shared_secret_derivation():
    """Verify that simulated Alice and Bob arrive at the exact same shared secret via X3DH."""
    # 1. Bob generates his identity, signed prekey, and a one-time prekey
    bob_ik = generate_x25519_keypair()
    bob_spk = generate_x25519_keypair()
    bob_opk = generate_x25519_keypair()

    # 2. Alice generates her identity and a temporary ephemeral key
    alice_ik = generate_x25519_keypair()
    alice_ek = generate_x25519_keypair()

    # Alice computes shared secret using Bob's public keys
    alice_secret = compute_x3dh_secret(
        alice_identity_priv_b64=alice_ik["private_key"],
        alice_ephemeral_priv_b64=alice_ek["private_key"],
        bob_identity_pub_b64=bob_ik["public_key"],
        bob_signed_prekey_pub_b64=bob_spk["public_key"],
        bob_ot_prekey_pub_b64=bob_opk["public_key"]
    )

    # Bob computes shared secret using Alice's public keys
    bob_secret = compute_x3dh_secret_bob(
        bob_identity_priv_b64=bob_ik["private_key"],
        bob_signed_prekey_priv_b64=bob_spk["private_key"],
        bob_ot_prekey_priv_b64=bob_opk["private_key"],
        alice_identity_pub_b64=alice_ik["public_key"],
        alice_ephemeral_pub_b64=alice_ek["public_key"],
        used_ot_prekey=True
    )

    # Ensure shared secrets match exactly
    assert alice_secret == bob_secret
    assert len(alice_secret) == 32


@pytest.mark.asyncio
async def test_session_lifecycle_and_replay_protection(client):
    alice_id = uuid4()
    bob_id = uuid4()

    # Pre-seed users in testing DB
    async with TestingSessionLocal() as db:
        alice_user = User(id=alice_id, phone="+919999999901", display_name="Alice", is_active=True)
        bob_user = User(id=bob_id, phone="+919999999902", display_name="Bob", is_active=True)
        db.add_all([alice_user, bob_user])
        await db.commit()

    # Create auth tokens
    alice_token = create_access_token(str(alice_id))
    bob_token = create_access_token(str(bob_id))

    alice_headers = {"Authorization": f"Bearer {alice_token}"}
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    # 1. Register Alice's device
    alice_dev_payload = {
        "device_id_str": "alice-phone",
        "display_name": "Alice's Phone",
        "identity_key": "alice-ik-pub",
        "signed_prekey": {"public_key": "alice-spk-pub", "signature": "sig", "key_id": 1},
        "one_time_prekeys": []
    }
    res = client.post("/devices/register", headers=alice_headers, json=alice_dev_payload)
    assert res.status_code == 200
    alice_device_id = res.json()["id"]

    # 2. Register Bob's device
    bob_dev_payload = {
        "device_id_str": "bob-laptop",
        "display_name": "Bob's Laptop",
        "identity_key": "bob-ik-pub",
        "signed_prekey": {"public_key": "bob-spk-pub", "signature": "sig", "key_id": 2},
        "one_time_prekeys": [{"public_key": "bob-opk-1", "key_id": 10}]
    }
    res = client.post("/devices/register", headers=bob_headers, json=bob_dev_payload)
    assert res.status_code == 200
    bob_device_id = res.json()["id"]

    # 3. Create Session (Alice initiates handshake)
    handshake_payload = "handshake-info-containing-ephemeral-keys"
    session_payload = {
        "peer_user_id": str(bob_id),
        "peer_device_id": bob_device_id,
        "session_data": "alice-serialized-session-state",
        "peer_session_data": handshake_payload
    }
    
    # POST /sessions as Alice (specifying her active device)
    res = client.post("/sessions?device_id_str=alice-phone", headers=alice_headers, json=session_payload)
    assert res.status_code == 200
    session_data = res.json()
    assert session_data["peer_device_id"] == bob_device_id
    assert session_data["session_data"] == "alice-serialized-session-state"

    # 4. Verify Replay Protection
    # Re-sending the same handshake envelope should be rejected
    res = client.post("/sessions?device_id_str=alice-phone", headers=alice_headers, json=session_payload)
    assert res.status_code == 400
    assert "Replay attack detected" in res.json()["detail"]

    # 5. Bob fetches his session (receives the handshake initiation data)
    res = client.get(f"/sessions/{alice_device_id}?device_id_str=bob-laptop", headers=bob_headers)
    assert res.status_code == 200
    bob_session = res.json()
    assert bob_session["session_data"] == handshake_payload

    # Bob completes setup and updates his session state
    bob_update_payload = {
        "peer_user_id": str(alice_id),
        "peer_device_id": alice_device_id,
        "session_data": "bob-finalized-session-state"
    }
    res = client.post("/sessions?device_id_str=bob-laptop", headers=bob_headers, json=bob_update_payload)
    assert res.status_code == 200

    # 6. Retrieve Session by device_id_str
    res = client.get(f"/sessions/alice-phone?device_id_str=bob-laptop", headers=bob_headers)
    assert res.status_code == 200
    assert res.json()["session_data"] == "bob-finalized-session-state"

    # 7. Check session status
    res = client.get("/sessions/status?device_id_str=alice-phone", headers=alice_headers)
    assert res.status_code == 200
    status_list = res.json()
    assert len(status_list) == 1
    assert status_list[0]["peer_device_id"] == bob_device_id
    assert status_list[0]["is_expired"] is False

    # 8. Test Session Expiration
    # Artificially update the session timestamp to be more than 30 days ago
    async with TestingSessionLocal() as db:
        thirty_one_days_ago = datetime.now(timezone.utc) - timedelta(days=31)
        await db.execute(
            update(DeviceSession).values(updated_at=thirty_one_days_ago)
        )
        await db.commit()

    # Query status — should show is_expired = True
    res = client.get("/sessions/status?device_id_str=alice-phone", headers=alice_headers)
    assert res.status_code == 200
    assert res.json()[0]["is_expired"] is True

    # Retrieve individual session — should return 410 Gone
    res = client.get(f"/sessions/bob-laptop?device_id_str=alice-phone", headers=alice_headers)
    assert res.status_code == 410
    assert "Session has expired" in res.json()["detail"]

    # 9. Test Session Deletion
    session_db_id = session_data["id"]
    res = client.delete(f"/sessions/{session_db_id}", headers=alice_headers)
    assert res.status_code == 200
    
    # Retrieve status — should be empty
    res = client.get("/sessions/status?device_id_str=alice-phone", headers=alice_headers)
    assert res.status_code == 200
    assert len(res.json()) == 0


@pytest.mark.asyncio
async def test_multi_device_sessions(client):
    """Verify that independent sessions can be established and retrieved for multi-device setup."""
    alice_id = uuid4()
    bob_id = uuid4()

    async with TestingSessionLocal() as db:
        db.add_all([
            User(id=alice_id, phone="+919999999901", display_name="Alice", is_active=True),
            User(id=bob_id, phone="+919999999902", display_name="Bob", is_active=True)
        ])
        await db.commit()

    alice_token = create_access_token(str(alice_id))
    bob_token = create_access_token(str(bob_id))

    alice_headers = {"Authorization": f"Bearer {alice_token}"}
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    # Register Alice device
    client.post("/devices/register", headers=alice_headers, json={
        "device_id_str": "alice-phone", "display_name": "Alice Phone", "identity_key": "ak",
        "signed_prekey": {"public_key": "spk", "signature": "sig", "key_id": 1}
    })

    # Register Bob Device 1 (laptop)
    res1 = client.post("/devices/register", headers=bob_headers, json={
        "device_id_str": "bob-laptop", "display_name": "Bob Laptop", "identity_key": "bk1",
        "signed_prekey": {"public_key": "spk1", "signature": "sig", "key_id": 2}
    })
    bob_dev1_id = res1.json()["id"]

    # Register Bob Device 2 (tablet)
    res2 = client.post("/devices/register", headers=bob_headers, json={
        "device_id_str": "bob-tablet", "display_name": "Bob Tablet", "identity_key": "bk2",
        "signed_prekey": {"public_key": "spk2", "signature": "sig", "key_id": 3}
    })
    bob_dev2_id = res2.json()["id"]

    # Alice creates sessions with both Bob devices
    client.post("/sessions?device_id_str=alice-phone", headers=alice_headers, json={
        "peer_user_id": str(bob_id), "peer_device_id": bob_dev1_id,
        "session_data": "session-state-with-laptop"
    })
    client.post("/sessions?device_id_str=alice-phone", headers=alice_headers, json={
        "peer_user_id": str(bob_id), "peer_device_id": bob_dev2_id,
        "session_data": "session-state-with-tablet"
    })

    # Retrieve status for Alice — should see two sessions
    res = client.get("/sessions/status?device_id_str=alice-phone", headers=alice_headers)
    assert res.status_code == 200
    sessions = res.json()
    assert len(sessions) == 2
    assert {s["peer_device_id"] for s in sessions} == {bob_dev1_id, bob_dev2_id}
