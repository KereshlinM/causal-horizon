from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import generate_key, require_api_key
from app.database import get_db
from app.models import ApiKey

router = APIRouter(prefix="/api/v1/keys", tags=["keys"])


class CreateKeyRequest(BaseModel):
    name: str


@router.post("")
async def create_key(
    body: CreateKeyRequest,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    raw, hashed, prefix = generate_key(body.name)
    key = ApiKey(name=body.name, key_hash=hashed, key_prefix=prefix)
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return {"id": key.id, "key": raw, "prefix": prefix, "name": body.name}


@router.get("")
async def list_keys(
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ApiKey).where(ApiKey.is_active == True))
    keys = result.scalars().all()
    return {"keys": [{"id": k.id, "name": k.name, "prefix": k.key_prefix, "created_at": k.created_at} for k in keys]}


@router.delete("/{key_id}")
async def revoke_key(
    key_id: int,
    _: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ApiKey).where(ApiKey.id == key_id))
    key = result.scalar_one_or_none()
    if key:
        key.is_active = False
        await db.commit()
    return {"revoked": True}
