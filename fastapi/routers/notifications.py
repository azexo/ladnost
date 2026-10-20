# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime

from database import get_db
from models import Notification, User
from utils import get_current_active_user
# Импортируем функцию перевода из core.i18n
from core.i18n import t 

router = APIRouter()

# ==========================================
# --- Pydantic Schemas ---
# ==========================================

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: str
    title: str
    message: Optional[str] = None
    is_read: bool
    created_at: datetime

    # Настройка для корректного маппинга из SQLAlchemy ORM в Pydantic (Pydantic V2)
    model_config = ConfigDict(from_attributes=True)
    
    # Если вы используете Pydantic V1, закомментируйте строку выше и раскомментируйте эту:
    # class Config:
    #     orm_mode = True

# ==========================================
# --- Endpoints ---
# ==========================================

@router.patch("/read-all", summary="Отметить все уведомления как прочитанные")
def mark_all_as_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Массово помечает все непрочитанные уведомления пользователя как прочитанные.
    """
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).update({"is_read": True})
    db.commit()
    
    return {
        "status": "success", 
        "message": t("notifications.all_marked_as_read")
    }

@router.get("/", response_model=List[NotificationResponse], summary="Получить список уведомлений")
def get_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Возвращает все уведомления текущего пользователя,
    отсортированные по дате создания (новые сверху).
    """
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .all()
    )
    return notifications

@router.patch("/{notification_id}/read", summary="Отметить уведомление как прочитанное")
def mark_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Помечает конкретное уведомление как прочитанное.
    Проверяет, что уведомление принадлежит именно текущему пользователю.
    """
    notif = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == current_user.id)
        .first()
    )
    
    if not notif:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("notifications.not_found_or_no_access")
        )
        
    notif.is_read = True
    db.commit()
    db.refresh(notif) # Обновляем объект в сессии после коммита
    
    return {
        "status": "success", 
        "message": t("notifications.marked_as_read")
    }