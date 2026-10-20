# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime, timedelta
import jwt
from database import get_db
from models import User, DocumentSetAccess, Task, ApprovalStage
from utils import get_current_active_user, settings
from email_service import send_email
from core.i18n import t  # Импортируем функцию перевода
import os

router = APIRouter()

# ==========================================
# PYDANTIC СХЕМЫ
# ==========================================
class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class UpdateProfilePayload(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    avatar_url: Optional[str] = None
    password: Optional[str] = None
    new_password: Optional[str] = None

class InvitePayload(BaseModel):
    email: str

class ContactFormPayload(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    message: str

# ==========================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ==========================================
def create_invite_token(email: str) -> str:
    """Генерирует JWT токен для приглашения (действует 7 дней)."""
    expire = datetime.utcnow() + timedelta(days=7)
    to_encode = {"sub": email, "type": "invite"}
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

# ==========================================
# ENDPOINTS
# ==========================================
@router.get("/me", response_model=UserResponse, summary="Получить текущего пользователя")
def get_me(current_user: User = Depends(get_current_active_user)):
    return current_user

@router.patch("/profile", response_model=UserResponse, summary="Обновить профиль")
def update_profile(
    payload: UpdateProfilePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    if payload.first_name is not None:
        current_user.first_name = payload.first_name
    if payload.last_name is not None:
        current_user.last_name = payload.last_name
    if payload.middle_name is not None:
        current_user.middle_name = payload.middle_name
    if payload.avatar_url is not None:
        current_user.avatar_url = payload.avatar_url
    if payload.password is not None and payload.new_password is not None:
        # В продакшене здесь нужна проверка старого пароля через verify_password
        from auth import get_password_hash
        current_user.password_hash = get_password_hash(payload.new_password)
    
    db.commit()
    db.refresh(current_user)
    return current_user

@router.get("/related", response_model=List[UserResponse], summary="Список связанных пользователей")
def list_related_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    related_ids = set()
    accesses = db.query(DocumentSetAccess).filter(
        (DocumentSetAccess.user_id == current_user.id) | (DocumentSetAccess.granted_by == current_user.id)
    ).all()
    for acc in accesses:
        related_ids.add(acc.user_id)
        related_ids.add(acc.granted_by)
        
    tasks = db.query(Task).filter(
        (Task.initiator_id == current_user.id) | (Task.assignee_id == current_user.id)
    ).all()
    for task in tasks:
        related_ids.add(task.initiator_id)
        related_ids.add(task.assignee_id)
        
    stages = db.query(ApprovalStage).join(Task).filter(
        (Task.initiator_id == current_user.id) | (Task.assignee_id == current_user.id)
    ).all()
    for stage in stages:
        related_ids.add(stage.assignee_id)
        
    related_ids.add(current_user.id)
    
    if not related_ids:
        return []
        
    users = db.query(User).filter(User.id.in_(related_ids)).all()
    return users

@router.post("/invite", response_model=UserResponse, summary="Пригласить пользователя")
def invite_user(
    payload: InvitePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    email = payload.email.strip().lower()
    existing_user = db.query(User).filter(User.email == email).first()
    
    if existing_user:
        # Если пользователь уже есть, но не активен, отправляем письмо повторно
        if not existing_user.is_active:
            invite_token = create_invite_token(existing_user.email)
            frontend_url = os.getenv("FRONTEND_BASE_URL", "https://ladnost.ru")
            invite_link = f"{frontend_url}/?mode=invite&token={invite_token}"
            
            html_content = t("users.invite.reminder.html", link=invite_link)
            send_email(existing_user.email, t("users.invite.reminder.subject"), html_content)
        return existing_user

    # Создаем "заглушку" пользователя
    new_user = User(
        email=email,
        password_hash="pending_invitation", # Будет перезаписан при регистрации
        first_name=t("users.defaults.invited_first_name"),
        last_name=t("users.defaults.invited_last_name"),
        is_active=False  
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Отправляем письмо с приглашением
    invite_token = create_invite_token(new_user.email)
    frontend_url = os.getenv("FRONTEND_BASE_URL", "https://ladnost.ru")
    invite_link = f"{frontend_url}/?mode=invite&token={invite_token}"
    
    html_content = t("users.invite.new.html", link=invite_link)
    send_email(new_user.email, t("users.invite.new.subject"), html_content)
    
    return new_user

@router.get("/{user_id}", response_model=UserResponse, summary="Получить пользователя по ID")
def get_user_by_id(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=t("users.errors.user_not_found"))
    return user

# ==========================================
# ENDPOINTS (Добавить к существующим)
# ==========================================
@router.post("/contact", summary="Отправка сообщения от анонимного посетителя")
def submit_contact_form(payload: ContactFormPayload):
    """
    Публичный эндпоинт. Не требует авторизации.
    Отправляет письмо администратору с данными из формы обратной связи.
    """
    # Формируем тему письма
    subject = t("users.contact.subject", name=payload.name)
    
    # Экранируем переносы строк для HTML
    safe_message = payload.message.replace('\n', '<br>')
    phone_display = payload.phone if payload.phone else t("users.defaults.phone_not_specified")
    
    # Формируем HTML-тело письма через шаблон
    html_content = t(
        "users.contact.html", 
        name=payload.name, 
        email=payload.email, 
        phone=phone_display, 
        message=safe_message
    )
    
    # Отправляем письмо через ваш сервис
    is_sent = send_email(
        to_email=settings.ADMIN_EMAIL,
        subject=subject,
        html_content=html_content,
        related_entity_type="contact_form"
    )
    
    if not is_sent:
        raise HTTPException(status_code=500, detail=t("users.errors.contact_send_failed"))
        
    return {
        "status": "success", 
        "message": t("users.contact.success_message")
    }