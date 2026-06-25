import hashlib
import secrets

from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ApiKey

_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_key(name: str = "") -> tuple[str, str, str]:
    raw = "ch_" + secrets.token_urlsafe(32)
    prefix = raw[:10]
    return raw, _hash(raw), prefix


async def require_api_key(
    raw: str | None = Security(_header),
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    if not raw:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == _hash(raw), ApiKey.is_active == True)
    )
    key = result.scalar_one_or_none()
    if key is None:
        # Bootstrap: if no keys exist yet, accept any value and create the first key
        count = await db.scalar(select(ApiKey).with_only_columns(ApiKey.id).limit(1))
        if count is None:
            new_raw, new_hash, prefix = generate_key("bootstrap")
            # Store the actual bootstrap key the caller provided
            boot_hash = _hash(raw)
            boot = ApiKey(name="bootstrap", key_hash=boot_hash, key_prefix=raw[:10])
            db.add(boot)
            await db.commit()
            await db.refresh(boot)
            return boot
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key
