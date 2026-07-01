import os
import sys
import json
import pytest
import pytest_asyncio
from uuid import uuid4, UUID
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

# Add nexus-backend to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from database import get_db, Base
from models import User, Device, IdentityKey, SignedPrekey, OneTimePrekey
from routers.auth import create_access_token

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
async def test_device_registration_lifecycle(client):
    user_id = uuid4()
    
    # Pre-seed user in testing DB
    async with TestingSessionLocal() as db:
        u = User(id=user_id, phone="+919999999901", display_name="Aarav", is_active=True)
        db.add(u)
        await db.commit()
        
    token = create_access_token(str(user_id))
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Register device
    reg_payload = {
        "device_id_str": "chrome-windows-1",
        "display_name": "Chrome Browser on Windows",
        "identity_key": "identity-pubkey-base64",
        "signed_prekey": {
            "public_key": "signed-prekey-pubkey",
            "signature": "signed-prekey-signature",
            "key_id": 101
        },
        "one_time_prekeys": [
            {"public_key": "ot-key-1", "key_id": 201},
            {"public_key": "ot-key-2", "key_id": 202}
        ]
    }
    
    res = client.post("/devices/register", headers=headers, json=reg_payload)
    assert res.status_code == 200
    dev = res.json()
    assert dev["device_id_str"] == "chrome-windows-1"
    assert dev["display_name"] == "Chrome Browser on Windows"
    
    # Verify values inside database
    async with TestingSessionLocal() as db:
        dev_res = await db.execute(select(Device).where(Device.user_id == user_id))
        devices = dev_res.scalars().all()
        assert len(devices) == 1
        device = devices[0]
        
        ik_res = await db.execute(select(IdentityKey).where(IdentityKey.device_id == device.id))
        ik = ik_res.scalar_one()
        assert ik.public_key == "identity-pubkey-base64"
        
        spk_res = await db.execute(select(SignedPrekey).where(SignedPrekey.device_id == device.id, SignedPrekey.is_active == True))
        spk = spk_res.scalar_one()
        assert spk.public_key == "signed-prekey-pubkey"
        assert spk.signature == "signed-prekey-signature"
        
        opk_res = await db.execute(select(OneTimePrekey).where(OneTimePrekey.device_id == device.id))
        opks = opk_res.scalars().all()
        assert len(opks) == 2
        assert {k.public_key for k in opks} == {"ot-key-1", "ot-key-2"}

    # 2. List devices
    list_res = client.get("/devices", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1
    assert list_res.json()[0]["device_id_str"] == "chrome-windows-1"

    # 3. Retrieve public keys bundle (consumes one-time prekeys)
    bundle_res = client.get(f"/keys/{user_id}", headers=headers)
    assert bundle_res.status_code == 200
    bundle = bundle_res.json()
    assert bundle["user_id"] == str(user_id)
    assert len(bundle["devices"]) == 1
    dev_bundle = bundle["devices"][0]
    assert dev_bundle["device_id_str"] == "chrome-windows-1"
    assert dev_bundle["identity_key"] == "identity-pubkey-base64"
    assert dev_bundle["signed_prekey"]["public_key"] == "signed-prekey-pubkey"
    assert dev_bundle["one_time_prekey"] is not None
    assert dev_bundle["one_time_prekey"]["public_key"] in {"ot-key-1", "ot-key-2"}
    
    # Save first consumed key ID
    consumed_id_1 = dev_bundle["one_time_prekey"]["key_id"]
    
    # 4. Fetch bundle again (consumes second one-time prekey)
    bundle_res2 = client.get(f"/keys/{user_id}", headers=headers)
    assert bundle_res2.status_code == 200
    dev_bundle2 = bundle_res2.json()["devices"][0]
    assert dev_bundle2["one_time_prekey"] is not None
    consumed_id_2 = dev_bundle2["one_time_prekey"]["key_id"]
    assert consumed_id_1 != consumed_id_2
    
    # 5. Fetch bundle a third time (one-time prekeys pool exhausted)
    bundle_res3 = client.get(f"/keys/{user_id}", headers=headers)
    assert bundle_res3.status_code == 200
    dev_bundle3 = bundle_res3.json()["devices"][0]
    assert dev_bundle3["one_time_prekey"] is None

    # 6. Rotate keys and add new one-time prekeys
    rotate_payload = {
        "signed_prekey": {
            "public_key": "signed-prekey-pubkey-v2",
            "signature": "signed-prekey-signature-v2",
            "key_id": 102
        },
        "one_time_prekeys": [
            {"public_key": "ot-key-3", "key_id": 203}
        ]
    }
    rotate_res = client.post("/keys/rotate?device_id_str=chrome-windows-1", headers=headers, json=rotate_payload)
    assert rotate_res.status_code == 200
    
    # Retrieve bundle again, check rotated prekeys and new one-time prekey
    bundle_res4 = client.get(f"/keys/{user_id}", headers=headers)
    assert bundle_res4.status_code == 200
    dev_bundle4 = bundle_res4.json()["devices"][0]
    assert dev_bundle4["signed_prekey"]["public_key"] == "signed-prekey-pubkey-v2"
    assert dev_bundle4["one_time_prekey"] is not None
    assert dev_bundle4["one_time_prekey"]["public_key"] == "ot-key-3"

    # 7. Deregister device
    device_db_id = dev["id"]
    del_res = client.delete(f"/devices/{device_db_id}", headers=headers)
    assert del_res.status_code == 200
    
    # Verify device list is now empty
    list_res2 = client.get("/devices", headers=headers)
    assert list_res2.status_code == 200
    assert len(list_res2.json()) == 0
