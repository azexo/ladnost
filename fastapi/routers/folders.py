# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime
from database import get_db
from models import Folder, DocumentSet, DocumentSetAccess, User, AccessType
from utils import get_current_active_user, get_accessible_document_set_ids
# Импортируем функцию перевода из модуля i18n
from core.i18n import t 

router = APIRouter()

# ==================== СХЕМЫ (Pydantic) ====================

class FolderPayload(BaseModel):
    name: str
    parent_id: Optional[int] = None

class FolderResponse(BaseModel):
    id: int
    parent_id: Optional[int]
    name: str
    owner_id: int
    is_deleted: bool
    created_at: datetime
    updated_at: datetime

    # Pydantic V2 синтаксис для работы с SQLAlchemy ORM объектами
    model_config = ConfigDict(from_attributes=True)

class FolderAccessUserOut(BaseModel):
    user_id: int
    email: str
    first_name: str
    last_name: str
    avatar_url: Optional[str]
    access_type: AccessType

class FolderAccessCreate(BaseModel):
    user_id: int
    access_type: AccessType
    expires_at: Optional[datetime] = None

# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

def get_ancestor_folder_ids(db: Session, folder_id: Optional[int]) -> set:
    """Рекурсивно собирает ID всех родительских папок до самого корня."""
    ancestors = set()
    current_id = folder_id
    while current_id is not None:
        ancestors.add(current_id)
        parent_id = db.query(Folder.parent_id).filter(Folder.id == current_id).scalar()
        current_id = parent_id
    return ancestors

def get_folder_doc_sets(db: Session, folder_id: int, owner_id: int) -> List[DocumentSet]:
    """Рекурсивно находит все комплекты в папке и её подпапках, принадлежащие владельцу."""
    folder_ids = [folder_id]
    current_level = [folder_id]
    while current_level:
        next_level = db.query(Folder.id).filter(Folder.parent_id.in_(current_level)).all()
        next_level = [f[0] for f in next_level]
        folder_ids.extend(next_level)
        current_level = next_level
        
    return db.query(DocumentSet).filter(
        DocumentSet.folder_id.in_(folder_ids),
        DocumentSet.owner_id == owner_id,
        DocumentSet.is_deleted == False
    ).all()

# ==================== ЭНДПОИНТЫ ====================

@router.get("/", response_model=List[FolderResponse])
def list_folders(
    parent_id: Optional[int] = Query(None, description="ID родительской папки. Если null, то корневые."),
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    Получение списка папок.
    Логика: видны папки, где юзер владелец ИЛИ папки, в которых лежат доступные юзеру комплекты (включая их родителей).
    """
    # 1. Получаем ID всех доступных юзеру комплектов документов
    accessible_set_ids = get_accessible_document_set_ids(db, current_user.id)

    # 2. Находим ID папок, в которых лежат эти комплекты
    set_folder_ids = db.query(DocumentSet.folder_id).filter(
        DocumentSet.id.in_(accessible_set_ids),
        DocumentSet.folder_id.isnot(None)
    ).all()
    set_folder_ids = {f[0] for f in set_folder_ids}

    # 3. Собираем всех родителей (анцесторов) для этих папок, чтобы дерево не рвалось
    visible_folder_ids = set()
    for fid in set_folder_ids:
        visible_folder_ids.update(get_ancestor_folder_ids(db, fid))

    # 4. Добавляем все папки, где текущий юзер является владельцем
    owned_folder_ids = db.query(Folder.id).filter(Folder.owner_id == current_user.id).all()
    visible_folder_ids.update({f[0] for f in owned_folder_ids})

    if not visible_folder_ids:
        return []

    # 5. Формируем итоговый запрос
    query = db.query(Folder).filter(
        Folder.id.in_(visible_folder_ids),
        Folder.is_deleted == False
    )

    # 6. Фильтрация по уровню вложенности
    if parent_id is not None:
        query = query.filter(Folder.parent_id == parent_id)
    else:
        query = query.filter(Folder.parent_id.is_(None)) # Только корневые

    return query.all()

@router.get("/shared", response_model=List[FolderResponse])
def list_shared_folders(
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Папки, в которых лежат комплекты, к которым юзеру дали доступ (не его собственные)."""
    # Находим комплекты, к которым дали доступ именно этому юзеру
    shared_set_ids = db.query(DocumentSetAccess.document_set_id).filter(
        DocumentSetAccess.user_id == current_user.id
    ).all()
    shared_set_ids = {s[0] for s in shared_set_ids}
    
    if not shared_set_ids:
        return []

    # Находим папки этих комплектов
    shared_folder_ids = db.query(DocumentSet.folder_id).filter(
        DocumentSet.id.in_(shared_set_ids),
        DocumentSet.folder_id.isnot(None)
    ).all()
    shared_folder_ids = {f[0] for f in shared_folder_ids}
    
    if not shared_folder_ids:
        return []

    return db.query(Folder).filter(
        Folder.id.in_(shared_folder_ids),
        Folder.is_deleted == False
    ).all()

@router.post("/", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
def create_folder(
    data: FolderPayload,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Создание новой папки."""
    new_folder = Folder(
        name=data.name,
        parent_id=data.parent_id,
        owner_id=current_user.id,
        is_deleted=False
    )
    db.add(new_folder)
    db.commit()
    db.refresh(new_folder)
    return new_folder

@router.patch("/{folder_id}", response_model=FolderResponse)
def update_folder(
    folder_id: int,
    data: FolderPayload,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Обновление папки (переименование или перемещение)."""
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.owner_id == current_user.id).first()
    if not folder:
        raise HTTPException(status_code=404, detail=t("folders.not_found_or_no_rights"))

    # Pydantic V2 синтаксис
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(folder, key, value)
        
    db.commit()
    db.refresh(folder)
    return folder

@router.delete("/{folder_id}")
def delete_folder(
    folder_id: int,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Мягкое удаление папки (в корзину)."""
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.owner_id == current_user.id).first()
    if not folder:
        raise HTTPException(status_code=404, detail=t("folders.not_found_or_no_rights"))
        
    folder.is_deleted = True
    db.commit()
    return {"status": "deleted", "message": t("folders.moved_to_trash")}

@router.post("/{folder_id}/restore")
def restore_folder(
    folder_id: int,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Восстановление папки из корзины."""
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.owner_id == current_user.id).first()
    if not folder:
        raise HTTPException(status_code=404, detail=t("folders.not_found"))
        
    folder.is_deleted = False
    db.commit()
    return {"status": "restored", "message": t("folders.restored_successfully")}

@router.delete("/{folder_id}/permanent")
def permanent_delete_folder(
    folder_id: int,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Полное удаление папки из БД."""
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.owner_id == current_user.id).first()
    if not folder:
        raise HTTPException(status_code=404, detail=t("folders.not_found"))
        
    db.delete(folder)
    db.commit()
    return {"status": "deleted", "message": t("folders.deleted_permanently")}

@router.get("/{folder_id}/access", response_model=List[FolderAccessUserOut])
def get_folder_access(
    folder_id: int,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    doc_sets = get_folder_doc_sets(db, folder_id, current_user.id)
    if not doc_sets:
        return []
        
    ds_ids = [ds.id for ds in doc_sets]
    accesses = db.query(DocumentSetAccess).filter(
        DocumentSetAccess.document_set_id.in_(ds_ids)
    ).all()

    # Группируем по пользователю и берем максимальный уровень доступа
    user_access_map = {}
    hierarchy = {
        AccessType.OWNER: 4, AccessType.FULL: 3, 
        AccessType.REVIEW: 2, AccessType.COMMENT: 1, AccessType.VIEW: 0
    }
    for acc in accesses:
        if acc.user_id not in user_access_map or hierarchy.get(acc.access_type, 0) > hierarchy.get(user_access_map[acc.user_id], 0):
            user_access_map[acc.user_id] = acc.access_type

    user_ids = list(user_access_map.keys())
    users = db.query(User).filter(User.id.in_(user_ids)).all()

    result = []
    for u in users:
        result.append(FolderAccessUserOut(
            user_id=u.id, email=u.email, first_name=u.first_name, last_name=u.last_name,
            avatar_url=u.avatar_url, access_type=user_access_map[u.id]
        ))
    return result

@router.post("/{folder_id}/access")
def grant_folder_access(
    folder_id: int,
    data: FolderAccessCreate,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    doc_sets = get_folder_doc_sets(db, folder_id, current_user.id)
    if not doc_sets:
        return {"status": "success", "affected": 0, "message": t("folders.no_doc_sets_in_folder")}
        
    ds_ids = [ds.id for ds in doc_sets]
    for ds_id in ds_ids:
        existing = db.query(DocumentSetAccess).filter(
            DocumentSetAccess.document_set_id == ds_id,
            DocumentSetAccess.user_id == data.user_id
        ).first()
        if existing:
            existing.access_type = data.access_type
            existing.expires_at = data.expires_at
            existing.granted_by = current_user.id
        else:
            new_access = DocumentSetAccess(
                document_set_id=ds_id, user_id=data.user_id,
                access_type=data.access_type, expires_at=data.expires_at,
                granted_by=current_user.id
            )
            db.add(new_access)
            
    db.commit()
    return {"status": "success", "message": t("folders.access_granted")}

@router.delete("/{folder_id}/access/{user_id}")
def revoke_folder_access(
    folder_id: int,
    user_id: int,
    current_user = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    doc_sets = get_folder_doc_sets(db, folder_id, current_user.id)
    if not doc_sets:
        return {"status": "success", "message": t("folders.no_doc_sets_in_folder")}
        
    ds_ids = [ds.id for ds in doc_sets]
    db.query(DocumentSetAccess).filter(
        DocumentSetAccess.document_set_id.in_(ds_ids),
        DocumentSetAccess.user_id == user_id
    ).delete(synchronize_session=False)
    
    db.commit()
    return {"status": "revoked", "message": t("folders.access_revoked")}