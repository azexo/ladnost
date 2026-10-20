# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import secrets
from datetime import datetime, timedelta
from typing import Optional, List, Tuple
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from config import get_settings
from database import get_db
from models import ApiKey, Workspace, WorkspaceMember, WorkspaceRole, User
from utils import ManagerContext, get_workspace_manager
from core.i18n import t  # ← Импортируем функцию перевода

settings = get_settings()
router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ====================== СХЕМЫ (PYDANTIC) ======================

class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, examples=["1С Интеграция"])
    description: Optional[str] = None
    scopes: List[str] = Field(
        default=["documents:read"],
        examples=[["documents:read", "documents:write", "tasks:read"]],
    )
    allowed_ips: List[str] = Field(default=[], examples=[["185.22.153.1"]])
    expires_in_days: Optional[int] = Field(
        default=None, ge=1, le=365,
        description="Срок жизни в днях. NULL = бессрочно."
    )

class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list
    is_active: bool
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True

class ApiKeyCreatedResponse(ApiKeyResponse):
    """Возвращается ТОЛЬКО при создании — содержит полный ключ."""
    full_key: str = Field(..., description="Сохраните! Ключ больше не будет показан.")

class ApiKeyRevoke(BaseModel):
    is_active: bool = False

# ====================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======================

def _resolve_created_by(ctx: ManagerContext, db: Session, description: Optional[str]) -> Tuple[int, str]:
    """
    Решает проблему Foreign Key.
    В ApiKey.created_by можно записать только ID из таблицы users.
    Если ключ создает Партнер, мы записываем ID Владельца (Owner) воркспейса,
    а в description добавляем пометку для аудита.
    """
    if ctx.is_partner:
        # Находим Owner воркспейса
        owner_member = db.query(WorkspaceMember).filter(
            WorkspaceMember.workspace_id == ctx.workspace_id,
            WorkspaceMember.role == WorkspaceRole.OWNER
        ).first()
        
        if not owner_member:
            # ← Используем i18n
            raise HTTPException(status_code=400, detail=t("api_keys.workspace_owner_not_found"))
            
        created_by_id = owner_member.user_id
        partner_mark = f"[Создано партнером ID: {ctx.partner_user.partner_id}]"
        final_desc = f"{description} {partner_mark}" if description else partner_mark
        return created_by_id, final_desc
    else:
        return ctx.clm_user.id, description or ""

# ====================== ENDPOINTS ======================

@router.post(
    "/{workspace_id}/api-keys",
    response_model=ApiKeyCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Создать API-ключ (для CLM Admin или Партнера)",
)
async def create_api_key(
    workspace_id: int,
    body: ApiKeyCreate,
    db: Session = Depends(get_db),
    ctx: ManagerContext = Depends(get_workspace_manager), # ← ИСПОЛЬЗУЕМ НОВЫЙ КОНТЕКСТ
):
    """
    Генерирует новый API-ключ для воркспейса.
    Доступно как админам воркспейса, так и партнерам, выдавшим лицензию.
    """
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.is_deleted == False).first()
    if not ws:
        # ← Используем i18n
        raise HTTPException(status_code=404, detail=t("api_keys.workspace_not_found"))

    # Генерируем ключ
    raw_key = f"ldn_{secrets.token_urlsafe(36)}"
    key_hash = pwd_context.hash(raw_key)
    key_prefix = raw_key[:9] + "..."
    
    expires_at = None
    if body.expires_in_days:
        expires_at = datetime.utcnow() + timedelta(days=body.expires_in_days)

    # Определяем, кого записать в created_by (обход FK ограничения)
    final_created_by_id, final_description = _resolve_created_by(ctx, db, body.description)

    api_key = ApiKey(
        workspace_id=workspace_id,
        created_by=final_created_by_id, 
        key_hash=key_hash,
        key_prefix=key_prefix,
        name=body.name,
        description=final_description,
        scopes=body.scopes,
        allowed_ips=body.allowed_ips,
        expires_at=expires_at,
    )
    
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return ApiKeyCreatedResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        scopes=api_key.scopes or [],
        is_active=api_key.is_active,
        expires_at=api_key.expires_at,
        last_used_at=api_key.last_used_at,
        created_at=api_key.created_at,
        full_key=raw_key,
    )

@router.get(
    "/{workspace_id}/api-keys",
    response_model=List[ApiKeyResponse],
    summary="Список API-ключей воркспейса",
)
async def list_api_keys(
    workspace_id: int,
    db: Session = Depends(get_db),
    ctx: ManagerContext = Depends(get_workspace_manager), # ← ИСПОЛЬЗУЕМ НОВЫЙ КОНТЕКСТ
):
    keys = (
        db.query(ApiKey)
        .filter(ApiKey.workspace_id == workspace_id)
        .order_by(ApiKey.created_at.desc())
        .all()
    )
    return keys

@router.delete(
    "/{workspace_id}/api-keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить API-ключ",
)
async def delete_api_key(
    workspace_id: int,
    key_id: int,
    db: Session = Depends(get_db),
    ctx: ManagerContext = Depends(get_workspace_manager), # ← ИСПОЛЬЗУЕМ НОВЫЙ КОНТЕКСТ
):
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.id == key_id, ApiKey.workspace_id == workspace_id)
        .first()
    )
    if not api_key:
        # ← Используем i18n
        raise HTTPException(status_code=404, detail=t("api_keys.key_not_found"))

    db.delete(api_key)
    db.commit()

@router.patch(
    "/{workspace_id}/api-keys/{key_id}",
    response_model=ApiKeyResponse,
    summary="Отозвать / активировать ключ",
)
async def toggle_api_key(
    workspace_id: int,
    key_id: int,
    body: ApiKeyRevoke,
    db: Session = Depends(get_db),
    ctx: ManagerContext = Depends(get_workspace_manager), # ← ИСПОЛЬЗУЕМ НОВЫЙ КОНТЕКСТ
):
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.id == key_id, ApiKey.workspace_id == workspace_id)
        .first()
    )
    if not api_key:
        # ← Используем i18n
        raise HTTPException(status_code=404, detail=t("api_keys.key_not_found"))

    api_key.is_active = body.is_active
    db.commit()
    db.refresh(api_key)
    
    return api_key