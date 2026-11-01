# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import jwt
from jwt.exceptions import PyJWTError
from passlib.context import CryptContext
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict
from database import get_db
import os
import secrets
from models import DocumentSet, DocumentSetAccess, AccessType
from models import (
    User, Workspace, WorkspaceMember, WorkspaceRole,
    Subscription, SubscriptionStatus, BillingPeriod, TariffPlan, OneTimeToken
)
from utils import get_current_user, settings
from email_service import send_email

# ✅ ИМПОРТ ЛОКАЛИЗАЦИИ
# Если i18n.py лежит в той же директории, используйте: from i18n import t
from core.i18n import t 

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SYSTEM_EMAIL = "sandys133@yandex.ru"

# ==========================================
# PYDANTIC СХЕМЫ
# ==========================================
class UserRegister(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    middle_name: Optional[str] = None

class UserLogin(BaseModel):
    username: str = Field(..., description="Email пользователя")
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    model_config = ConfigDict(from_attributes=True)

class RegisterResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    check_token: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ActivateAccountRequest(BaseModel):
    token: str

class CheckActivationRequest(BaseModel):
    check_token: str

class ExchangeOTTRequest(BaseModel):
    ott: str = Field(..., description="Одноразовый токен для обмена")

# ==========================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ==========================================
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_auth_token(data: dict, token_type: str, expires_delta: timedelta) -> str:
    """Универсальная функция создания JWT для активации, сброса пароля и т.д."""
    to_encode = data.copy()
    expire = datetime.utcnow() + expires_delta
    to_encode.update({"exp": expire, "type": token_type})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire_minutes = getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 30)
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user

def ensure_workspace_and_trial(user: User, db: Session):
    """
    Проверяет, есть ли у пользователя рабочее пространство.
    Если нет, создает его, добавляет пользователя как OWNER
    и выдает пробный период (Trial).
    """
    existing_workspace = db.query(Workspace).filter(Workspace.owner_id == user.id).first()
    if existing_workspace:
        return  

    new_workspace = Workspace(
        name=f"Рабочее пространство {user.first_name}",
        owner_id=user.id
    )
    db.add(new_workspace)
    db.flush()  

    owner_member = WorkspaceMember(
        workspace_id=new_workspace.id,
        user_id=user.id,
        role=WorkspaceRole.OWNER
    )
    db.add(owner_member)

    trial_tariff = db.query(TariffPlan).filter(TariffPlan.code == "trial").first()
    
    if not trial_tariff:
        trial_tariff = TariffPlan(
            code="trial",
            name="Пробный период (1 день)",
            description="Автоматически созданный триальный тариф",
            price_monthly=0,
            price_yearly=0,
            limits_json={"max_users": 5, "max_documents": 100, "max_storage_mb": 1000},
            features_json=["basic_editing", "basic_approvals"],
            is_public=False,
            is_active=True,
            sort_order=0
        )
        db.add(trial_tariff)
        db.flush()

    now = datetime.utcnow()
    trial_ends = now + timedelta(days=2)
    new_subscription = Subscription(
        workspace_id=new_workspace.id,
        tariff_plan_id=trial_tariff.id,
        status=SubscriptionStatus.TRIAL,
        billing_period=BillingPeriod.TRIAL,
        started_at=now,
        expires_at=trial_ends,
        trial_ends_at=trial_ends,
        auto_renew=False
    )
    db.add(new_subscription)
    db.commit()


def grant_global_template_accesses(db: Session, new_user_id: int):
    """Выдаёт доступ VIEW на все глобальные шаблоны новому пользователю."""
    system_user = db.query(User).filter(User.email == SYSTEM_EMAIL).first()
    if not system_user:
        return

    global_templates = db.query(DocumentSet).filter(
        DocumentSet.is_global_template == True,
        DocumentSet.is_deleted == False
    ).all()

    for tmpl in global_templates:
        # Проверяем, что доступ ещё не выдан (на случай повторных вызовов)
        exists = db.query(DocumentSetAccess).filter(
            DocumentSetAccess.document_set_id == tmpl.id,
            DocumentSetAccess.user_id == new_user_id
        ).first()
        if not exists:
            db.add(DocumentSetAccess(
                document_set_id=tmpl.id,
                user_id=new_user_id,
                access_type=AccessType.VIEW,
                granted_by=system_user.id
            ))
    db.commit()

# ==========================================
# ENDPOINTS
# ==========================================
@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        if not existing_user.is_active and existing_user.password_hash == "pending_invitation":
            existing_user.first_name = user_in.first_name
            existing_user.last_name = user_in.last_name
            existing_user.middle_name = user_in.middle_name
            existing_user.password_hash = get_password_hash(user_in.password)
            existing_user.is_active = True
            db.commit()
            db.refresh(existing_user)
            ensure_workspace_and_trial(existing_user, db)
            grant_global_template_accesses(db, existing_user.id)
            return existing_user
        
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=t("auth.errors.email_already_registered")
        )

    db_user = User(
        email=user_in.email,
        password_hash=get_password_hash(user_in.password),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        middle_name=user_in.middle_name,
        is_active=False 
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    activate_token = create_auth_token(
        data={"sub": db_user.email}, 
        token_type="activate", 
        expires_delta=timedelta(hours=24)
    )
    check_token = create_auth_token(
        data={"sub": db_user.email},
        token_type="activation_check",
        expires_delta=timedelta(hours=24)
    )

    frontend_url = os.getenv("FRONTEND_BASE_URL", "https://ladnost.ru")
    activate_link = f"{frontend_url}/?mode=activate&token={activate_token}"
    
    html_content = f"""
    <h2>{t("auth.emails.registration_confirmation.subject")}</h2>
    <p>{t("auth.emails.registration_confirmation.greeting", name=user_in.first_name)}</p>
    <p>{t("auth.emails.registration_confirmation.body", hours=24)}</p>
    <p><a href="{activate_link}">{activate_link}</a></p>
    """
    send_email(db_user.email, t("auth.emails.registration_confirmation.subject"), html_content)

    return {
        "id": db_user.id,
        "email": db_user.email,
        "first_name": db_user.first_name,
        "last_name": db_user.last_name,
        "middle_name": db_user.middle_name,
        "avatar_url": db_user.avatar_url,
        "is_active": db_user.is_active,
        "check_token": check_token
    }

@router.post("/activate")
async def activate_account(request: ActivateAccountRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(request.token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "activate":
            raise HTTPException(status_code=400, detail=t("auth.errors.invalid_token_type"))
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=400, detail=t("auth.errors.invalid_token"))
    except PyJWTError:
        raise HTTPException(status_code=400, detail=t("auth.errors.token_expired_or_invalid"))

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail=t("auth.errors.user_not_found"))

    # Если аккаунт уже активирован — всё равно выдаём токен, чтобы пользователь мог войти
    if user.is_active:
        access_token_expires = timedelta(minutes=getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 30))
        access_token = create_access_token(data={"sub": str(user.id)}, expires_delta=access_token_expires)
        return {
            "status": "success",
            "message": t("auth.messages.account_already_activated"),
            "access_token": access_token,
            "token_type": "bearer"
        }

    user.is_active = True
    db.commit()
    ensure_workspace_and_trial(user, db)
    grant_global_template_accesses(db, user.id)

    # 🔑 ГЕНЕРИРУЕМ access_token для автоматического входа
    access_token_expires = timedelta(minutes=getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 30))
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=access_token_expires
    )

    return {
        "status": "success",
        "message": t("auth.messages.account_activated"),
        "access_token": access_token,
        "token_type": "bearer"
    }

@router.post("/login", response_model=Token)
async def login(form_data: UserLogin, db: Session = Depends(get_db)):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=t("auth.errors.invalid_credentials"))

    if not user.is_active:
        activate_token = create_auth_token(
            data={"sub": user.email}, 
            token_type="activate", 
            expires_delta=timedelta(hours=24)
        )
        frontend_url = os.getenv("FRONTEND_BASE_URL", "https://ladnost.ru")
        activate_link = f"{frontend_url}/?mode=activate&token={activate_token}"
        
        html_content = f"""
        <h2>{t("auth.emails.registration_confirmation.resend_subject")}</h2>
        <p>{t("auth.emails.registration_confirmation.greeting", name=user.first_name)}</p>
        <p>{t("auth.emails.registration_confirmation.resend_body")}</p>
        <p>{t("auth.emails.registration_confirmation.body", hours=24)}</p>
        <p><a href="{activate_link}">{activate_link}</a></p>
        """
        send_email(user.email, t("auth.emails.registration_confirmation.resend_subject"), html_content)
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail=t("auth.messages.account_not_activated_email_sent")
        )

    ensure_workspace_and_trial(user, db)
    
    access_token_expires = timedelta(minutes=getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 30))
    access_token = create_access_token(data={"sub": str(user.id)}, expires_delta=access_token_expires)
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user:
        return {"status": "success", "message": t("auth.messages.if_user_exists_instructions_sent")}

    reset_token = create_auth_token(
        data={"sub": user.email}, 
        token_type="reset_password", 
        expires_delta=timedelta(minutes=15)
    )
    frontend_url = os.getenv("FRONTEND_BASE_URL", "https://ladnost.ru") 
    reset_link = f"{frontend_url}/?mode=reset&token={reset_token}"
    
    html_content = f"""
    <h2>{t("auth.emails.password_reset.subject")}</h2>
    <p>{t("auth.emails.password_reset.greeting")}</p>
    <p>{t("auth.emails.password_reset.body", minutes=15)}</p>
    <p><a href="{reset_link}">{reset_link}</a></p>
    <p>{t("auth.emails.password_reset.ignore")}</p>
    """
    send_email(user.email, t("auth.emails.password_reset.subject"), html_content)
    return {"status": "success", "message": t("auth.messages.password_reset_instructions_sent")}

@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(request.token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "reset_password":
            raise HTTPException(status_code=400, detail=t("auth.errors.invalid_token_type"))
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=400, detail=t("auth.errors.invalid_token"))
    except PyJWTError:
        raise HTTPException(status_code=400, detail=t("auth.errors.token_expired_or_invalid"))

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail=t("auth.errors.user_not_found"))

    user.password_hash = get_password_hash(request.new_password)
    db.commit()
    return {"status": "success", "message": t("auth.messages.password_changed")}


@router.post("/activation-status")
async def check_activation_status(
    request: CheckActivationRequest,
    db: Session = Depends(get_db)
):
    """
    Проверяет статус активации аккаунта по check_token.
    Если аккаунт активирован — выдаёт access_token для автоматического входа.
    НЕ активирует аккаунт (в отличие от /activate).
    """
    try:
        payload = jwt.decode(
            request.check_token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        
        # Проверяем тип токена
        if payload.get("type") != "activation_check":
            raise HTTPException(
                status_code=400,
                detail=t("auth.errors.invalid_token_type")
            )
        
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(
                status_code=400,
                detail=t("auth.errors.invalid_token")
            )
            
    except PyJWTError:
        raise HTTPException(
            status_code=400,
            detail=t("auth.errors.token_expired_or_invalid")
        )
    
    # Ищем пользователя
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail=t("auth.errors.user_not_found")
        )
    
    # Проверяем статус активации
    if not user.is_active:
        return {
            "is_active": False,
            "message": t("auth.messages.account_not_activated")
        }
    
    # 🔑 Аккаунт активирован — выдаём access_token
    access_token_expires = timedelta(
        minutes=getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 30)
    )
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=access_token_expires
    )
    
    return {
        "is_active": True,
        "access_token": access_token,
        "token_type": "bearer",
        "message": t("auth.messages.account_activated")
    }


@router.post("/generate-ott")
async def generate_ott(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Генерирует одноразовый токен для перехода в новую вкладку."""
    ott = secrets.token_urlsafe(32)
    
    # Сохраняем токен в БД (живет 60 секунд)
    new_token = OneTimeToken(
        token=ott,
        user_id=current_user.id,
        expires_at=datetime.utcnow() + timedelta(seconds=60),
        is_used=False
    )
    db.add(new_token)
    db.commit()
    
    return {"ott": ott}


@router.post("/exchange-ott")
async def exchange_ott(
    request: ExchangeOTTRequest,
    db: Session = Depends(get_db)
):
    """Обменивает одноразовый токен на полноценный JWT."""
    # 1. Ищем токен в БД
    ott_record = db.query(OneTimeToken).filter(OneTimeToken.token == request.ott).first()
    
    if not ott_record:
        raise HTTPException(status_code=400, detail=t("auth.errors.token_expired_or_invalid"))
    
    # 2. Проверяем, не был ли он уже использован
    if ott_record.is_used:
        raise HTTPException(status_code=400, detail=t("auth.errors.token_expired_or_invalid"))
        
    # 3. Проверяем срок жизни
    if ott_record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail=t("auth.errors.token_expired_or_invalid"))
        
    # 4. Помечаем токен как использованный (гарантия одноразовости)
    ott_record.is_used = True
    db.commit()
    
    # 5. Получаем пользователя и генерируем JWT
    user = db.query(User).filter(User.id == ott_record.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=t("auth.errors.user_not_found"))
        
    access_token_expires = timedelta(minutes=getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 30))
    access_token = create_access_token(data={"sub": str(user.id)}, expires_delta=access_token_expires)
    
    return {"access_token": access_token, "token_type": "bearer"}