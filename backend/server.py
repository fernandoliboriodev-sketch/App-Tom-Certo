from __future__ import annotations

import logging
import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ─── Configuration ────────────────────────────────────────────────────────────
# Prioriza variáveis de ambiente (Railway/Atlas/produção).
# Em dev, vêm do /app/backend/.env via load_dotenv acima.
MONGO_URL = os.environ.get("MONGO_URL")
if not MONGO_URL:
    raise RuntimeError(
        "MONGO_URL não configurado. Defina a variável de ambiente com a connection "
        "string do MongoDB Atlas (ex.: mongodb+srv://user:pass@cluster.xxx.mongodb.net/)."
    )

# DB_NAME opcional: se a connection string já incluir o nome do banco, será usado.
# Caso contrário, usamos o valor de DB_NAME (fallback 'tom_certo_db').
DB_NAME = os.environ.get("DB_NAME", "tom_certo_db")

JWT_SECRET = os.environ.get("JWT_SECRET", "tom-certo-dev-secret-change-in-prod")
JWT_ALG = "HS256"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_PLAIN = os.environ.get("ADMIN_PASSWORD", "admin123")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ADMIN_PASSWORD_HASH = pwd_context.hash(ADMIN_PASSWORD_PLAIN)

# Motor com timeouts sensatos para detectar problemas de conexão cedo
client = AsyncIOMotorClient(
    MONGO_URL,
    serverSelectionTimeoutMS=10000,  # 10s para selecionar servidor
    connectTimeoutMS=10000,
    retryWrites=True,
)
db = client[DB_NAME]
tokens_col = db["tokens"]

app = FastAPI(title="Tom Certo API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tom_certo")


# ─── Helpers ──────────────────────────────────────────────────────────────────
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def generate_token_code(length: int = 12) -> str:
    alphabet = string.ascii_uppercase + string.digits
    alphabet = alphabet.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def serialize_token(doc: dict) -> dict:
    """Convert MongoDB doc to JSON-friendly dict."""
    if not doc:
        return {}
    d = dict(doc)
    d.pop("_id", None)
    for field in ["created_at", "first_used_at", "expires_at", "last_used_at"]:
        v = d.get(field)
        if isinstance(v, datetime):
            d[field] = v.isoformat()
    return d


def compute_effective_status(doc: dict) -> str:
    """Return the effective status considering expiration."""
    if not doc:
        return "missing"
    status_field = doc.get("status", "active")
    if status_field in ("revoked", "expired"):
        return status_field
    expires_at = doc.get("expires_at")
    if expires_at:
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
            except Exception:
                expires_at = None
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and now_utc() >= expires_at:
            return "expired"
    return "active"


# ─── Models ───────────────────────────────────────────────────────────────────
class TokenValidateRequest(BaseModel):
    token: str
    device_id: str


class TokenValidateResponse(BaseModel):
    valid: bool
    reason: Optional[str] = None
    token_id: Optional[str] = None
    expires_at: Optional[str] = None
    customer_name: Optional[str] = None
    duration_minutes: Optional[int] = None
    session: Optional[str] = None


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenCreateRequest(BaseModel):
    duration_minutes: int = Field(..., gt=0)
    max_devices: int = Field(1, ge=1)
    customer_name: Optional[str] = ""
    notes: Optional[str] = ""
    token_code: Optional[str] = None


class AdminTokenDoc(BaseModel):
    id: str
    token: str
    status: str
    created_at: Optional[str] = None
    first_used_at: Optional[str] = None
    expires_at: Optional[str] = None
    duration_minutes: int
    max_devices: int
    used_count: int
    last_used_at: Optional[str] = None
    linked_device_ids: List[str] = []
    customer_name: str = ""
    notes: str = ""
    effective_status: Optional[str] = None


# ─── Admin auth ───────────────────────────────────────────────────────────────
def create_admin_jwt(username: str) -> str:
    payload = {
        "sub": username,
        "role": "admin",
        "exp": now_utc() + timedelta(hours=12),
        "iat": now_utc(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def require_admin(creds: HTTPAuthorizationCredentials = Depends(security)):
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Autenticação necessária")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão admin expirada")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token admin inválido")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso proibido")
    return payload


# ─── App-side endpoints ───────────────────────────────────────────────────────
@api_router.get("/")
async def root():
    return {"service": "Tom Certo API", "status": "ok"}


@api_router.get("/health")
async def health():
    return {"status": "ok", "time": now_utc().isoformat()}


@api_router.post("/auth/validate", response_model=TokenValidateResponse)
async def auth_validate(req: TokenValidateRequest):
    code = (req.token or "").strip().upper()
    device_id = (req.device_id or "").strip()
    if not code or not device_id:
        raise HTTPException(status_code=400, detail="token e device_id são obrigatórios")

    doc = await tokens_col.find_one({"token": code})
    if not doc:
        return TokenValidateResponse(valid=False, reason="not_found")

    if doc.get("status") == "revoked":
        return TokenValidateResponse(valid=False, reason="revoked")

    now = now_utc()
    update: dict = {}
    if not doc.get("first_used_at"):
        dur = int(doc.get("duration_minutes") or 0)
        update["first_used_at"] = now
        update["expires_at"] = now + timedelta(minutes=dur)
        doc["first_used_at"] = update["first_used_at"]
        doc["expires_at"] = update["expires_at"]

    expires_at = doc.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            expires_at = None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at and now >= expires_at:
        await tokens_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "expired"}},
        )
        return TokenValidateResponse(valid=False, reason="expired")

    linked = list(doc.get("linked_device_ids") or [])
    max_devices = int(doc.get("max_devices") or 1)
    if device_id in linked:
        pass
    else:
        if len(linked) >= max_devices:
            return TokenValidateResponse(valid=False, reason="device_limit")
        linked.append(device_id)
        update["linked_device_ids"] = linked

    update["last_used_at"] = now
    update["used_count"] = int(doc.get("used_count") or 0) + 1

    if update:
        await tokens_col.update_one({"_id": doc["_id"]}, {"$set": update})

    session_payload = {
        "token_id": doc["id"],
        "device_id": device_id,
        "exp": expires_at if expires_at else now + timedelta(days=365),
        "iat": now,
    }
    session = jwt.encode(session_payload, JWT_SECRET, algorithm=JWT_ALG)

    return TokenValidateResponse(
        valid=True,
        token_id=doc["id"],
        expires_at=expires_at.isoformat() if expires_at else None,
        customer_name=doc.get("customer_name", ""),
        duration_minutes=int(doc.get("duration_minutes") or 0),
        session=session,
    )


class RevalidateRequest(BaseModel):
    session: str
    device_id: str


@api_router.post("/auth/revalidate", response_model=TokenValidateResponse)
async def auth_revalidate(req: RevalidateRequest):
    try:
        payload = jwt.decode(req.session, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        return TokenValidateResponse(valid=False, reason="session_expired")
    except jwt.PyJWTError:
        return TokenValidateResponse(valid=False, reason="session_invalid")

    if payload.get("device_id") != req.device_id:
        return TokenValidateResponse(valid=False, reason="device_mismatch")

    token_id = payload.get("token_id")
    doc = await tokens_col.find_one({"id": token_id})
    if not doc:
        return TokenValidateResponse(valid=False, reason="not_found")

    effective = compute_effective_status(doc)
    if effective != "active":
        if effective == "expired" and doc.get("status") != "expired":
            await tokens_col.update_one({"_id": doc["_id"]}, {"$set": {"status": "expired"}})
        return TokenValidateResponse(valid=False, reason=effective)

    await tokens_col.update_one({"_id": doc["_id"]}, {"$set": {"last_used_at": now_utc()}})

    expires_at = doc.get("expires_at")
    if isinstance(expires_at, datetime):
        expires_at_str = expires_at.isoformat()
    else:
        expires_at_str = expires_at

    return TokenValidateResponse(
        valid=True,
        token_id=doc["id"],
        expires_at=expires_at_str,
        customer_name=doc.get("customer_name", ""),
        duration_minutes=int(doc.get("duration_minutes") or 0),
    )


# ─── Admin endpoints ──────────────────────────────────────────────────────────
@api_router.post("/admin/login", response_model=AdminLoginResponse)
async def admin_login(req: AdminLoginRequest):
    if req.username != ADMIN_USERNAME or not pwd_context.verify(
        req.password, ADMIN_PASSWORD_HASH
    ):
        raise HTTPException(status_code=401, detail="Usuário ou senha incorretos")
    return AdminLoginResponse(access_token=create_admin_jwt(req.username))


@api_router.post("/admin/tokens", response_model=AdminTokenDoc)
async def admin_create_token(
    req: TokenCreateRequest,
    _=Depends(require_admin),
):
    import uuid

    code = (req.token_code or generate_token_code()).upper()
    while await tokens_col.find_one({"token": code}):
        code = generate_token_code()

    doc = {
        "id": str(uuid.uuid4()),
        "token": code,
        "status": "active",
        "created_at": now_utc(),
        "first_used_at": None,
        "expires_at": None,
        "duration_minutes": int(req.duration_minutes),
        "max_devices": int(req.max_devices),
        "used_count": 0,
        "last_used_at": None,
        "linked_device_ids": [],
        "customer_name": req.customer_name or "",
        "notes": req.notes or "",
    }
    await tokens_col.insert_one(doc)
    result = serialize_token(doc)
    result["effective_status"] = compute_effective_status(doc)
    return result


@api_router.get("/admin/tokens", response_model=List[AdminTokenDoc])
async def admin_list_tokens(
    status: Optional[str] = Query(None, description="active | expired | revoked"),
    q: Optional[str] = Query(None, description="busca por token ou cliente"),
    _=Depends(require_admin),
):
    find_filter: dict = {}
    if q:
        q_up = q.upper()
        find_filter["$or"] = [
            {"token": {"$regex": q_up, "$options": "i"}},
            {"customer_name": {"$regex": q, "$options": "i"}},
            {"notes": {"$regex": q, "$options": "i"}},
        ]

    docs = await tokens_col.find(find_filter).sort("created_at", -1).to_list(500)

    # Batch-expire tokens whose expires_at has passed (single bulk update)
    now = now_utc()
    expired_ids = []
    for d in docs:
        if d.get("status") != "active":
            continue
        exp = d.get("expires_at")
        if not exp:
            continue
        # Normalizar tzinfo: MongoDB pode retornar datetimes offset-naive
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp <= now:
            expired_ids.append(d["_id"])
    if expired_ids:
        await tokens_col.update_many(
            {"_id": {"$in": expired_ids}},
            {"$set": {"status": "expired"}},
        )
        # Reflect in-memory
        for d in docs:
            if d["_id"] in expired_ids:
                d["status"] = "expired"

    out = []
    for d in docs:
        eff = compute_effective_status(d)
        if status and eff != status:
            continue
        item = serialize_token(d)
        item["effective_status"] = eff
        out.append(item)
    return out


@api_router.post("/admin/tokens/{token_id}/revoke", response_model=AdminTokenDoc)
async def admin_revoke_token(token_id: str, _=Depends(require_admin)):
    doc = await tokens_col.find_one({"id": token_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Token não encontrado")
    await tokens_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "revoked"}}
    )
    doc["status"] = "revoked"
    item = serialize_token(doc)
    item["effective_status"] = "revoked"
    return item


@api_router.delete("/admin/tokens/{token_id}/devices")
async def admin_reset_devices(token_id: str, _=Depends(require_admin)):
    """Remove todos os dispositivos vinculados ao token."""
    doc = await tokens_col.find_one({"id": token_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Token não encontrado")
    await tokens_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"linked_device_ids": [], "used_count": 0}},
    )
    return {"ok": True, "message": "Dispositivos removidos com sucesso"}


@api_router.patch("/admin/tokens/{token_id}")
async def admin_update_token(
    token_id: str,
    payload: dict,
    _=Depends(require_admin),
):
    """Atualiza campos editáveis de um token."""
    doc = await tokens_col.find_one({"id": token_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Token não encontrado")
    allowed = {}
    if "max_devices" in payload and isinstance(payload["max_devices"], int) and payload["max_devices"] >= 1:
        allowed["max_devices"] = payload["max_devices"]
    if "customer_name" in payload:
        allowed["customer_name"] = str(payload["customer_name"])
    if "notes" in payload:
        allowed["notes"] = str(payload["notes"])
    if allowed:
        await tokens_col.update_one({"_id": doc["_id"]}, {"$set": allowed})
    updated = await tokens_col.find_one({"id": token_id})
    item = serialize_token(updated)
    item["effective_status"] = compute_effective_status(updated)
    return item


@api_router.delete("/admin/tokens/{token_id}")
async def admin_delete_token(token_id: str, _=Depends(require_admin)):
    """Remove permanentemente um token."""
    res = await tokens_col.delete_one({"id": token_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Token não encontrado")
    return {"ok": True}


# ─── Admin UI ─────────────────────────────────────────────────────────────────
@api_router.get("/admin-ui", response_class=HTMLResponse)
async def admin_ui():
    html_path = ROOT_DIR / "admin_ui.html"
    if html_path.exists():
        return HTMLResponse(content=html_path.read_text(encoding="utf-8"))
    return HTMLResponse(
        "<html><body style='font-family:sans-serif;background:#111;color:#fff;padding:40px'>"
        "<h1>Tom Certo Admin</h1>"
        "<p>admin_ui.html não encontrado. Use a API diretamente.</p>"
        "<a href='/docs' style='color:#FFB020'>Abrir Swagger UI</a>"
        "</body></html>",
        status_code=200
    )


# ─── ML Key Analysis (CREPE + Krumhansl) ──────────────────────────────────────
# Carrega módulo sob demanda (evita impacto em boot se torchcrepe falhar)
_key_detection_mod = None
_key_detection_load_error: Optional[str] = None


def _get_key_detection():
    global _key_detection_mod, _key_detection_load_error
    if _key_detection_mod is not None:
        return _key_detection_mod
    if _key_detection_load_error is not None:
        return None
    try:
        from key_detection import analyze_audio_bytes  # noqa: WPS433
        _key_detection_mod = analyze_audio_bytes
        logger.info("✓ Módulo ML key_detection carregado (torchcrepe)")
        return _key_detection_mod
    except Exception as e:
        _key_detection_load_error = str(e)
        logger.error("✗ Falha ao carregar key_detection: %s", e)
        return None


@app.post("/api/analyze-key")
async def analyze_key(request: Request):
    """
    Analisa um áudio a capela e retorna a tonalidade detectada.
    Aceita multipart/form-data com campo 'audio' OU body raw de áudio.
    Resposta: { success, key_name, tonic, quality, confidence, notes_count, ... }
    """
    # Aceita tanto multipart quanto body raw
    content_type = request.headers.get("content-type", "")
    audio_bytes: Optional[bytes] = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        audio_field = form.get("audio")
        if audio_field is None:
            raise HTTPException(status_code=400, detail="Campo 'audio' ausente no form")
        # UploadFile tem .read()
        if hasattr(audio_field, "read"):
            audio_bytes = await audio_field.read()
        else:
            audio_bytes = bytes(audio_field)  # type: ignore
    else:
        audio_bytes = await request.body()

    if not audio_bytes or len(audio_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Áudio vazio ou muito pequeno")

    # Tamanho máximo: 5MB
    if len(audio_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Áudio muito grande (máx 5MB)")

    analyze_fn = _get_key_detection()
    if analyze_fn is None:
        raise HTTPException(
            status_code=503,
            detail=f"Módulo de análise ML indisponível: {_key_detection_load_error or 'erro desconhecido'}",
        )

    try:
        import asyncio
        # Roda análise em thread separada (CPU-bound, não bloqueia loop)
        result = await asyncio.to_thread(analyze_fn, audio_bytes)
        return result
    except Exception as e:
        logger.exception("Erro na análise de tonalidade")
        raise HTTPException(status_code=500, detail=f"Erro ao analisar áudio: {e}")


# ─── Include router and middleware ────────────────────────────────────────────
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    # ── Validar conexão com MongoDB ANTES de atender requisições ──
    try:
        await client.admin.command("ping")
        logger.info("✓ MongoDB conectado em %s", DB_NAME)
    except Exception as e:
        logger.error("✗ Falha ao conectar no MongoDB: %s", e)
        raise

    # ── Índices ──────────────────────────────────────────────────
    await tokens_col.create_index("token", unique=True)
    await tokens_col.create_index("id", unique=True)
    await tokens_col.create_index("status")
    logger.info("Tom Certo API pronta. Admin user: %s", ADMIN_USERNAME)

    # Seed test token for dev/preview environment (upsert: only creates if missing)
    import uuid
    existing = await tokens_col.find_one({"token": "TEST-DEV2026"})
    if not existing:
        await tokens_col.insert_one({
            "id": str(uuid.uuid4()),
            "token": "TEST-DEV2026",
            "status": "active",
            "created_at": now_utc(),
            "first_used_at": None,
            "expires_at": None,
            "duration_minutes": 525600,
            "max_devices": 10,
            "used_count": 0,
            "last_used_at": None,
            "linked_device_ids": [],
            "customer_name": "Dev Test",
            "notes": "Token de teste para ambiente de desenvolvimento",
        })
        logger.info("Seed token TEST-DEV2026 criado.")


# ─── Health check routes (usadas por Railway / load balancers) ──────────────
@app.get("/health")
async def health_root():
    """Health check público (sem prefixo /api) — usado pelo Railway."""
    try:
        await client.admin.command("ping")
        return {"status": "OK", "db": "connected"}
    except Exception as e:
        logger.warning("Health check: DB unreachable: %s", e)
        return {"status": "OK", "db": "disconnected"}


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
    logger.info("MongoDB client fechado.")
