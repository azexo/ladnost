# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import sys
import smtplib
import re
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

from database import SessionLocal
from models import EmailLog, EmailStatus

from config import get_settings

# Получаем экземпляр настроек (кэшируется через lru_cache)
settings = get_settings()

def _strip_html(html: str) -> str:
    """Простая функция для удаления HTML-тегов и получения plain text."""
    clean_text = re.sub('<[^<]+?>', '', html)
    return ' '.join(clean_text.split())

def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    plain_text_content: str = None,
    related_entity_type: str = None,
    related_entity_id: int = None
) -> bool:
    """
    Отправляет письмо через SMTP и автоматически логирует результат в БД.
    """
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = settings.FROM_EMAIL
    msg['To'] = to_email
    
    if plain_text_content is None:
        plain_text_content = _strip_html(html_content)
        
    msg.set_content(plain_text_content, charset='utf-8')
    msg.add_alternative(html_content, subtype='html', charset='utf-8')
    
    # Переменные для логирования
    log_status = EmailStatus.SENT
    log_error = None
    log_sent_at = datetime.utcnow()
    is_success = False
    
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        is_success = True
    except Exception as e:
        log_status = EmailStatus.FAILED
        log_error = str(e)
        log_sent_at = None
        is_success = False
        print(f"❌ Ошибка отправки email на {to_email}: {e}")
        
    # === ЗАПИСЬ В ЛОГ (EMAIL LOGGING) ===
    db = SessionLocal()
    try:
        new_log = EmailLog(
            recipient_email=to_email,
            subject=subject,
            html_content=html_content,
            plain_text_content=plain_text_content,
            status=log_status,
            error_message=log_error[:1000] if log_error else None, # Обрезаем длинные трейсбеки
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            sent_at=log_sent_at
        )
        db.add(new_log)
        db.commit()
    except Exception as db_err:
        print(f"🔥 Критическая ошибка записи в EmailLog: {db_err}")
        db.rollback()
    finally:
        db.close()
        
    return is_success