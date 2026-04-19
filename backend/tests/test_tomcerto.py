"""Tom Certo Backend Tests - health, auth, admin tokens"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')

@pytest.fixture
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s

@pytest.fixture
def admin_token(session):
    res = session.post(f"{BASE_URL}/api/admin/login", json={"username": "admin", "password": "tomcerto2025"})
    assert res.status_code == 200
    return res.json()["access_token"]

# Health check
def test_health(session):
    res = session.get(f"{BASE_URL}/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    print("PASS: /api/health ok")

def test_root(session):
    res = session.get(f"{BASE_URL}/api/")
    assert res.status_code == 200
    print("PASS: /api/ ok")

# Admin login
def test_admin_login_success(session):
    res = session.post(f"{BASE_URL}/api/admin/login", json={"username": "admin", "password": "tomcerto2025"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    print("PASS: admin login ok")

def test_admin_login_wrong_password(session):
    res = session.post(f"{BASE_URL}/api/admin/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401
    print("PASS: admin login bad password returns 401")

# Admin UI
def test_admin_ui(session):
    res = session.get(f"{BASE_URL}/api/admin-ui")
    assert res.status_code == 200
    print("PASS: admin-ui accessible")

# Token validation - valid token
def test_validate_valid_token(session):
    res = session.post(f"{BASE_URL}/api/auth/validate", json={"token": "2C5FRRR6V59C", "device_id": "test-device-001"})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] == True
    assert "session" in data
    print(f"PASS: valid token ok, expires_at={data.get('expires_at')}")

def test_validate_invalid_token(session):
    res = session.post(f"{BASE_URL}/api/auth/validate", json={"token": "INVALIDTOKEN123", "device_id": "test-device-001"})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] == False
    assert data["reason"] == "not_found"
    print("PASS: invalid token returns not_found")

def test_validate_missing_fields(session):
    res = session.post(f"{BASE_URL}/api/auth/validate", json={"token": "", "device_id": ""})
    assert res.status_code == 400
    print("PASS: empty fields return 400")

# Admin token CRUD
def test_admin_list_tokens(session, admin_token):
    res = session.get(f"{BASE_URL}/api/admin/tokens", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    print(f"PASS: list tokens - {len(data)} tokens found")

def test_admin_create_token(session, admin_token):
    payload = {"duration_minutes": 525600, "max_devices": 3, "customer_name": "TEST_playwright", "notes": "created by test"}
    res = session.post(f"{BASE_URL}/api/admin/tokens", json=payload, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["customer_name"] == "TEST_playwright"
    token_id = data["id"]
    print(f"PASS: create token ok - {data['token']}")

    # Cleanup: delete test token
    del_res = session.delete(f"{BASE_URL}/api/admin/tokens/{token_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert del_res.status_code == 200
    print("PASS: delete test token ok")

def test_admin_tokens_no_auth(session):
    res = session.get(f"{BASE_URL}/api/admin/tokens")
    assert res.status_code == 401
    print("PASS: admin tokens without auth returns 401")
