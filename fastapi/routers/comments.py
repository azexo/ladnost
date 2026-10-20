# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict
from database import get_db

# === ДОБАВЛЕНЫ ИМПОРТЫ МОДЕЛЕЙ И ХЕЛПЕРА УВЕДОМЛЕНИЙ ===
from models import Comment, User, DocumentVersion, Document, Task, DocumentSet
from utils import get_current_active_user, notify_new_comment

# === ДОБАВЛЕН ИМПОРТ I18N ===
from core.i18n import t
# ===================================

# ==================== СХЕМЫ (PYDANTIC) ====================
class CommentCreate(BaseModel):
    block_uuid: str
    anchor_uuid: Optional[str] = None
    text_content: str
    parent_comment_id: Optional[int] = None
    char_offset_in_block: Optional[int] = None
    char_length_in_block: Optional[int] = None
    task_id: Optional[int] = None

class CommentResolve(BaseModel):
    is_resolved: bool

class CommentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    document_version_id: int
    task_id: Optional[int] = None
    parent_comment_id: Optional[int] = None
    block_uuid: str
    anchor_uuid: Optional[str] = None
    char_offset_in_block: Optional[int] = None
    char_length_in_block: Optional[int] = None
    is_orphan: bool
    orphan_resolved_at: Optional[datetime] = None
    text_content: str
    author_id: int
    is_resolved: bool
    resolved_by: Optional[int] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

# ==================== РОУТЕР ====================
router = APIRouter()

@router.get("/{version_id}", response_model=List[CommentResponse])
def list_comments(
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Получить все комментарии для конкретной версии документа."""
    comments = db.query(Comment).filter(Comment.document_version_id == version_id).all()
    return comments

@router.post("/{version_id}", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(
    version_id: int,
    data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Добавить новый комментарий к версии документа."""
    # 1. Проверяем существование версии и документа
    version = db.query(DocumentVersion).filter(DocumentVersion.id == version_id).first()
    if not version:
        raise HTTPException(status_code=404, detail=t("comments.version_not_found"))

    document = db.query(Document).filter(Document.id == version.document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=t("comments.document_not_found"))

    doc_set_id = document.document_set_id

    # 2. Создаем комментарий
    new_comment = Comment(
        document_version_id=version_id,
        task_id=data.task_id,
        block_uuid=data.block_uuid,
        anchor_uuid=data.anchor_uuid,
        char_offset_in_block=data.char_offset_in_block,
        char_length_in_block=data.char_length_in_block,
        text_content=data.text_content,
        author_id=current_user.id,
        is_resolved=False,
        is_orphan=False,
        parent_comment_id=data.parent_comment_id
    )
    db.add(new_comment)

    # ✅ ВАЖНО: Делаем flush, чтобы сгенерировался new_comment.id для уведомления, 
    # но транзакция еще не закоммичена
    db.flush() 

    # 3. === ЛОГИКА СБОРА ПОЛУЧАТЕЛЕЙ УВЕДОМЛЕНИЙ ===
    recipients = set()

    # А. Если это ответ на чужой комментарий, уведомляем автора родительского комментария
    if data.parent_comment_id:
        parent_comment = db.query(Comment).filter(Comment.id == data.parent_comment_id).first()
        if parent_comment and parent_comment.author_id != current_user.id:
            recipients.add(parent_comment.author_id)

    # Б. Если комментарий привязан к задаче, уведомляем её участников
    if data.task_id:
        task = db.query(Task).filter(Task.id == data.task_id).first()
        if task:
            if task.initiator_id != current_user.id:
                recipients.add(task.initiator_id)
            if task.assignee_id != current_user.id:
                recipients.add(task.assignee_id)

    # В. Уведомляем владельца комплекта документов (если он не автор)
    doc_set = db.query(DocumentSet).filter(DocumentSet.id == doc_set_id).first()
    if doc_set and doc_set.owner_id != current_user.id:
        recipients.add(doc_set.owner_id)

    # 4. === ОТПРАВКА УВЕДОМЛЕНИЙ ===
    if recipients:
        author_name = f"{current_user.first_name} {current_user.last_name}".strip()
        for recipient_id in recipients:
            notify_new_comment(
                db=db,
                recipient_id=recipient_id,
                doc_set_id=doc_set_id,
                comment_id=new_comment.id,
                author_name=author_name
            )

    # 5. Финальный коммит всех изменений (и комментария, и уведомлений)
    db.commit()
    db.refresh(new_comment)
    return new_comment

@router.patch("/{comment_id}/resolve", response_model=CommentResponse)
def resolve_comment(
    comment_id: int,
    data: CommentResolve,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Пометить комментарий как решенный или нерешенный."""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail=t("comments.comment_not_found"))

    comment.is_resolved = data.is_resolved
    if data.is_resolved:
        comment.resolved_by = current_user.id
        comment.resolved_at = datetime.now(timezone.utc) 
    else:
        comment.resolved_by = None
        comment.resolved_at = None

    db.commit()
    db.refresh(comment)
    return comment