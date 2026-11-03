import os
from sqlalchemy.orm import Session
from core.i18n import t
from models import User, Notification, NotificationType, RelatedEntityType

# Базовый URL фронтенда берется из окружения
frontend_url = os.getenv("FRONTEND_BASE_URL", "https://ladnost.ru")

# Шаблоны писем теперь хранят ключи для системы локализации (i18n)
EMAIL_TEMPLATES = {
    NotificationType.TASK_ASSIGNED: {
        "subject": "notifications.email.task_assigned.subject",
        "html": "notifications.email.task_assigned.html",
    },
    NotificationType.TASK_REJECTED: {
        "subject": "notifications.email.task_rejected.subject",
        "html": "notifications.email.task_rejected.html",
    },
    NotificationType.APPROVAL_COMPLETED: {
        "subject": "notifications.email.approval_completed.subject",
        "html": "notifications.email.approval_completed.html",
    },
    NotificationType.TASK_NEEDS_REVISION: {
        "subject": "notifications.email.task_needs_revision.subject",
        "html": "notifications.email.task_needs_revision.html",
    },
    NotificationType.COMMENT_ADDED: {
        "subject": "notifications.email.comment_added.subject",
        "html": "notifications.email.comment_added.html",
    },
    NotificationType.DOCUMENT_SENT: {
        "subject": "notifications.email.document_sent.subject",
        "html": "notifications.email.document_sent.html",
    },
    NotificationType.FORMULATION_UPDATED: {
        "subject": "notifications.email.formulation_updated.subject",
        "html": "notifications.email.formulation_updated.html",
    },
    # NotificationType.TASK_STATUS_CHANGED: {
    #     "subject": "notifications.email.task_status_changed.subject",
    #     "html": "notifications.email.task_status_changed.html",
    # }
}

def send_notification_email(notification: Notification, db: Session):
    """Отправляет email по созданному уведомлению, используя i18n шаблоны."""
    from email_service import send_email  # Локальный импорт для избежания циклических зависимостей
    
    user = db.query(User).filter(User.id == notification.user_id).first()
    if not user:
        return
        
    template = EMAIL_TEMPLATES.get(notification.type)
    if not template:
        return
        
    # Формируем ссылки в зависимости от типа сущности, к которой относится уведомление
    task_url = ""
    doc_set_url = ""
    
    if notification.related_entity_type == RelatedEntityType.TASK:
        task_url = f"{frontend_url}/tasks?taskId={notification.related_entity_id}"
    elif notification.related_entity_type == RelatedEntityType.DOCUMENT_SET:
        doc_set_url = f"{frontend_url}/editor/{notification.related_entity_id}"
        
    # Базовые переменные для подстановки в шаблоны переводов.
    # title и message уже переведены при создании уведомления в utils.py
    kwargs = {
        "user_name": user.first_name or user.email,
        "title": notification.title,
        "message": notification.message or "",
        "task_url": task_url,
        "doc_set_url": doc_set_url,
        "frontend_url": frontend_url,
    }
    
    # Получаем переведенные тему и тело письма
    subject = t(template["subject"], **kwargs)
    html = t(template["html"], **kwargs)
    
    try:
        send_email(
            to_email=user.email,
            subject=subject,
            html_content=html,
            related_entity_type="notification",
            related_entity_id=notification.id,
        )
    except Exception as e:
        print(f"⚠️ Не удалось отправить email-уведомление: {e}")