# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from database import get_db
from utils import get_current_active_user
from models import Folder, DocumentSet, DocumentSetAccess, User
from core.i18n import t  # Импортируем функцию перевода

router = APIRouter()

# ==========================================
# PYDANTIC СХЕМЫ
# ==========================================
class FolderResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    owner_id: int
    is_deleted: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DocumentSetResponse(BaseModel):
    id: int
    name: str
    folder_id: Optional[int]
    owner_id: int
    is_deleted: bool
    deleted_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TrashResponse(BaseModel):
    folders: List[FolderResponse]
    document_sets: List[DocumentSetResponse]

# ==========================================
# ENDPOINTS
# ==========================================
@router.get("/", response_model=TrashResponse, summary="Получить содержимое корзины")
def get_trash(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Аналог trashApi.get
    Возвращает удаленные папки (где юзер владелец) и удаленные комплекты документов
    (где юзер владелец ИЛИ имеет к ним доступ).
    """
    # 1. Удаленные папки (только те, что принадлежат текущему пользователю)
    folders = db.query(Folder).filter(
        Folder.is_deleted == True,
        Folder.owner_id == current_user.id
    ).all()
    
    # 2. Удаленные комплекты документов (владелец ИЛИ есть запись в DocumentSetAccess)
    document_sets = db.query(DocumentSet).filter(
        DocumentSet.is_deleted == True,
        (DocumentSet.owner_id == current_user.id) | (
            DocumentSet.id.in_(
                db.query(DocumentSetAccess.document_set_id).filter(
                    DocumentSetAccess.user_id == current_user.id
                )
            )
        )
    ).all()
    
    return {
        "folders": folders,
        "document_sets": document_sets
    }

# --- ОПЕРАЦИИ С ПАПКАМИ ---
@router.post("/folders/{folder_id}/restore", summary="Восстановить папку из корзины")
def restore_folder(
    folder_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Аналог foldersApi.restore"""
    folder = db.query(Folder).filter(
        Folder.id == folder_id,
        Folder.owner_id == current_user.id
    ).first()
    
    if not folder:
        raise HTTPException(
            status_code=404, 
            detail=t("trash.folder.not_found_or_no_rights")
        )
        
    folder.is_deleted = False
    db.commit()
    return {"status": "restored"}

@router.delete("/folders/{folder_id}", summary="Окончательно удалить папку")
def permanent_delete_folder(
    folder_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Аналог foldersApi.permanentDelete"""
    folder = db.query(Folder).filter(
        Folder.id == folder_id,
        Folder.owner_id == current_user.id
    ).first()
    
    if not folder:
        raise HTTPException(
            status_code=404, 
            detail=t("trash.folder.not_found_or_no_rights")
        )
        
    # В реальном приложении здесь нужно проверить, нет ли внутри папки дочерних элементов,
    # либо настроить CASCADE в SQLAlchemy/БД.
    db.delete(folder)
    db.commit()
    return {"status": "deleted"}

# --- ОПЕРАЦИИ С КОМПЛЕКТАМИ ДОКУМЕНТОВ ---
@router.post("/document-sets/{set_id}/restore", summary="Восстановить комплект документов из корзины")
def restore_document_set(
    set_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Аналог documentSetsApi.restore"""
    ds = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
    
    if not ds:
        raise HTTPException(
            status_code=404, 
            detail=t("trash.document_set.not_found")
        )
        
    # Проверяем права (владелец или есть доступ)
    has_access = ds.owner_id == current_user.id or db.query(DocumentSetAccess).filter(
        DocumentSetAccess.document_set_id == set_id,
        DocumentSetAccess.user_id == current_user.id
    ).first()
    
    if not has_access:
        raise HTTPException(
            status_code=403, 
            detail=t("trash.document_set.no_restore_rights")
        )
        
    ds.is_deleted = False
    ds.deleted_at = None
    db.commit()
    return {"status": "restored"}

@router.delete("/document-sets/{set_id}", summary="Окончательно удалить комплект документов")
def permanent_delete_document_set(
    set_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Аналог documentSetsApi.permanentDelete"""
    ds = db.query(DocumentSet).filter(
        DocumentSet.id == set_id,
        DocumentSet.owner_id == current_user.id
    ).first()
    
    if not ds:
        raise HTTPException(
            status_code=404, 
            detail=t("trash.document_set.not_found_or_no_owner_rights")
        )
        
    # Благодаря cascade="all, delete-orphan" в моделях SQLAlchemy, 
    # удаление DocumentSet автоматически удалит связанные Documents, Versions, Questionnaire и т.д.
    db.delete(ds)
    db.commit()
    return {"status": "deleted"}