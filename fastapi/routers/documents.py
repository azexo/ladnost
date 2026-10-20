# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

# routers/documents.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Tuple, Optional, List, Any, Dict
from datetime import datetime, timedelta
import os
import shutil
import uuid
from fastapi import Query, UploadFile, File
import zipfile
import io
from fastapi.responses import StreamingResponse
from database import get_db
from models import (
    User, Document, DocumentSet, DocumentVersion, Comment, ReviewEdit,
    DocumentRole, EditType, ResolutionStatus, WorkspaceMember
)
from utils import get_current_active_user
from utils import verify_document_set_access, verify_document_access

# Импортируем функцию перевода из вашего модуля i18n
from core.i18n import t

router = APIRouter()

# ==========================================
# Pydantic Schemas
# ==========================================
class DocumentPayload(BaseModel):
    name: str
    document_role: Optional[DocumentRole] = DocumentRole.MAIN
    sort_order: Optional[int] = 1

class DocumentVersionPayload(BaseModel):
    content_json: Dict[str, Any]
    content_html: Optional[str] = None
    change_reason: Optional[str] = None

class ContentUpdatePayload(BaseModel):
    content_json: Dict[str, Any]
    content_html: Optional[str] = None

class CommentPayload(BaseModel):
    block_uuid: str
    anchor_uuid: Optional[str] = None
    text_content: str
    parent_comment_id: Optional[int] = None
    char_offset_in_block: Optional[int] = None
    char_length_in_block: Optional[int] = None

class ReviewEditPayload(BaseModel):
    edit_type: EditType
    old_text: Optional[str] = None
    new_text: Optional[str] = None
    block_uuid: str
    anchor_from_uuid: Optional[str] = None
    anchor_to_uuid: Optional[str] = None
    char_offset_in_block: Optional[int] = None
    char_length_in_block: Optional[int] = None

class RenameDocumentPayload(BaseModel):
    name: str

class ResolveCommentPayload(BaseModel):
    is_resolved: bool

# ==========================================
# Endpoints
# ==========================================

@router.get("/sets/{set_id}/documents", summary="Получить документы комплекта")
def list_by_set(
    set_id: int,
    access_data: Tuple[DocumentSet, Optional[User]] = Depends(verify_document_set_access),
    db: Session = Depends(get_db)
):
    docs = db.query(Document).filter(Document.document_set_id == set_id).order_by(Document.sort_order).all()
    return docs

@router.post("/sets/{set_id}/documents", summary="Создать документ в комплекте")
def create_document(
    set_id: int,
    data: DocumentPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Проверка существования комплекта
    doc_set = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
    if not doc_set:
        raise HTTPException(status_code=404, detail=t("documents.errors.document_set_not_found"))

    new_doc = Document(
        document_set_id=set_id,
        name=data.name,
        document_role=data.document_role,
        sort_order=data.sort_order,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    return new_doc

@router.get("/{document_id}", summary="Получить документ по ID")
def get_document(
    document_id: int,
    access_data: Tuple[Document, DocumentSet, Optional[User]] = Depends(verify_document_access),
    db: Session = Depends(get_db)
):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=t("documents.errors.document_not_found"))
    return doc

# 🛠️ ИСПРАВЛЕНО: Используем RenameDocumentPayload для приема JSON Body
@router.put("/{document_id}/rename", summary="Переименовать документ")
def rename_document(
    document_id: int,
    data: RenameDocumentPayload,
    db: Session = Depends(get_db)
):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=t("documents.errors.document_not_found"))
    
    doc.name = data.name
    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)  # 🛠️ Добавлен refresh для возврата актуальных данных
    return doc

@router.delete("/{document_id}", summary="Удалить документ")
def remove_document(document_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=t("documents.errors.document_not_found"))

    # 1. Собираем пути к исходным файлам всех версий перед удалением из БД
    # Используем связь doc.versions, чтобы не делать лишний запрос
    files_to_remove = [v.file_path for v in doc.versions if v.file_path]
    
    # 2. Удаляем документ из БД (версии удалятся каскадно)
    db.delete(doc)
    db.commit()
    
    # 3. Физически удаляем файлы с диска ПОСЛЕ успешного коммита в БД
    # Это гарантирует, что если БД не сохранит изменения, мы не потеряем файлы
    for file_path in files_to_remove:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError as e:
                # Логируем ошибку, но не прерываем выполнение (файл мог быть удален ранее или заблокирован)
                # 🛠️ ИСПРАВЛЕНО: Локализация сообщения в логе с передачей переменных
                print(t("documents.logs.file_delete_failed", file_path=file_path, error=str(e)))
                
    return {"status": "deleted"}

@router.get("/{document_id}/versions", summary="Получить все версии документа")
def list_versions(
    document_id: int,
    access_data: Tuple[Document, DocumentSet, Optional[User]] = Depends(verify_document_access),
    db: Session = Depends(get_db)
):
    return db.query(DocumentVersion).filter(DocumentVersion.document_id == document_id).all()

@router.post("/{document_id}/versions", summary="Создать новую версию вручную")
def create_version(
    document_id: int,
    data: DocumentVersionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # Снимаем флаг current с предыдущих версий
    db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.is_current == True
    ).update({"is_current": False})
    
    last_ver = db.query(DocumentVersion).filter(DocumentVersion.document_id == document_id).order_by(DocumentVersion.version_number.desc()).first()
    next_num = (last_ver.version_number + 1) if last_ver else 1
    
    new_ver = DocumentVersion(
        document_id=document_id,
        version_number=next_num,
        content_json=data.content_json,
        content_html=data.content_html,
        change_reason=data.change_reason,  # 🛠️ Передаем причину изменения
        is_current=True,
        author_id=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_ver)
    db.commit()
    db.refresh(new_ver)
    return new_ver

@router.put("/{document_id}/versions/{version_id}/make-current", summary="Сделать версию текущей")
def make_version_current(
    document_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    source_version = db.query(DocumentVersion).filter(DocumentVersion.id == version_id, DocumentVersion.document_id == document_id).first()
    if not source_version:
        raise HTTPException(status_code=404, detail=t("documents.errors.version_not_found"))

    # Снимаем current со всех
    db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id, 
        DocumentVersion.is_current == True
    ).update({"is_current": False})
    
    last_ver = db.query(DocumentVersion).filter(DocumentVersion.document_id == document_id).order_by(DocumentVersion.version_number.desc()).first()
    next_num = (last_ver.version_number + 1) if last_ver else 1
    
    # Создаем новую текущую версию на основе выбранной
    new_version = DocumentVersion(
        document_id=document_id,
        version_number=next_num,
        content_json=source_version.content_json,
        content_html=source_version.content_html,
        change_reason=source_version.change_reason, # 🛠️ Копируем причину, если она была
        is_current=True,
        author_id=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_version)
    db.commit()
    db.refresh(new_version)
    return new_version

@router.put("/{document_id}/content", summary="Обновить контент (с авто-версионированием)")
def update_content(
    document_id: int,
    data: ContentUpdatePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    current_ver = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.is_current == True
    ).first()
    
    # Проверка на изменения
    is_content_changed = current_ver is None or current_ver.content_json != data.content_json
    if not is_content_changed:
        return {"status": "saved_no_changes"}

    VERSION_THRESHOLD = timedelta(minutes=5)
    now = datetime.utcnow()
    
    # 🛠️ ИСПРАВЛЕНИЕ: Получаем МАКСИМАЛЬНЫЙ номер версии для этого документа.
    # Это гарантирует, что мы никогда не получим Duplicate entry, 
    # даже если флаг is_current сбился или были конкурентные запросы.
    max_version_num = db.query(func.max(DocumentVersion.version_number)).filter(
        DocumentVersion.document_id == document_id
    ).scalar() or 0
    
    if current_ver:
        last_version_time = current_ver.created_at
        is_time_to_create_new_version = (now - last_version_time) > VERSION_THRESHOLD
        if is_time_to_create_new_version:
            current_ver.is_current = False
            new_version = DocumentVersion(
                document_id=document_id,
                version_number=max_version_num + 1, # 🛠️ Используем безопасный инкремент
                content_json=data.content_json,
                content_html=data.content_html,
                is_current=True,
                author_id=current_user.id,
                created_at=now
            )
            db.add(new_version)
            db.flush() # Чтобы получить new_version.id
            
            # Переносим комментарии на новую версию
            db.query(Comment).filter(Comment.document_version_id == current_ver.id).update(
                {Comment.document_version_id: new_version.id}
            )
        else:
            current_ver.content_json = data.content_json
            current_ver.content_html = data.content_html
    else:
        # 🛠️ ИСПРАВЛЕНИЕ: Убираем жесткую единицу. 
        # Если current_ver нет (сбились флаги), мы всё равно создаем версию на основе MAX + 1
        new_version = DocumentVersion(
            document_id=document_id,
            version_number=max_version_num + 1, # 🛠️ Безопасный инкремент
            content_json=data.content_json,
            content_html=data.content_html,
            is_current=True,
            author_id=current_user.id,
            created_at=now
        )
        db.add(new_version)
        
    db.commit()
    return {"status": "saved"}

@router.post("/{document_id}/upload-source-file", summary="Загрузить исходный файл для текущей версии")
async def upload_source_file(
    document_id: int,
    workspace_id: Optional[int] = Query(None, description="ID воркспейса (опционально)"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    # 1. Находим текущую версию документа
    current_ver = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.is_current == True
    ).first()
    
    if not current_ver:
        raise HTTPException(status_code=400, detail=t("documents.errors.no_current_version"))

    # 2. Определяем ID воркспейса
    if not workspace_id:
        # Если фронт не передал, берем первый связанный воркспейс пользователя
        ws_member = db.query(WorkspaceMember).filter(WorkspaceMember.user_id == current_user.id).first()
        workspace_id = ws_member.workspace_id if ws_member else 1  # Fallback на 1, если воркспейсов нет
        
    # 3. Формируем путь с учетом воркспейса
    upload_dir = f"uploads/documents/{workspace_id}"
    os.makedirs(upload_dir, exist_ok=True)
    
    # 4. Генерируем уникальное имя
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(upload_dir, unique_filename)
    
    # 5. Сохраняем файл на диск
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # 6. Получаем реальный размер и обновляем БД
    file_size = os.path.getsize(file_path)
    current_ver.file_path = file_path
    current_ver.file_size = file_size
    db.commit()
    db.refresh(current_ver)
    
    return {"status": "success", "file_path": file_path, "file_size": file_size}

@router.get("/{document_id}/comments", summary="Получить комментарии текущей версии")
def get_comments(
    document_id: int,
    access_data: Tuple[Document, DocumentSet, Optional[User]] = Depends(verify_document_access),
    db: Session = Depends(get_db)
):
    current_ver = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.is_current == True
    ).first()
    
    if not current_ver:
        return []
        
    return db.query(Comment).filter(Comment.document_version_id == current_ver.id).all()

@router.post("/{document_id}/comments", summary="Добавить комментарий")
def add_comment(
    document_id: int,
    data: CommentPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    current_ver = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.is_current == True
    ).first()
    
    if not current_ver:
        raise HTTPException(status_code=400, detail=t("documents.errors.no_current_version"))

    new_comment = Comment(
        document_version_id=current_ver.id,
        block_uuid=data.block_uuid,
        anchor_uuid=data.anchor_uuid,
        text_content=data.text_content,
        author_id=current_user.id,
        parent_comment_id=data.parent_comment_id,
        char_offset_in_block=data.char_offset_in_block,  # 🛠️ Передаем смещение
        char_length_in_block=data.char_length_in_block,  # 🛠️ Передаем длину
        is_resolved=False,
        is_orphan=False,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)
    return new_comment

# 🛠️ ИСПРАВЛЕНО: Используем ResolveCommentPayload для приема JSON Body
@router.put("/comments/{comment_id}/resolve", summary="Отметить комментарий как решенный")
def resolve_comment(
    comment_id: int,
    data: ResolveCommentPayload,
    db: Session = Depends(get_db)
):
    c = db.query(Comment).filter(Comment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail=t("documents.errors.comment_not_found"))
        
    c.is_resolved = data.is_resolved
    c.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(c)  # 🛠️ Добавлен refresh
    return c

@router.post("/{document_id}/review-edits", summary="Добавить правку (Review Edit)")
def add_review_edit(
    document_id: int,
    data: ReviewEditPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    current_ver = db.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.is_current == True
    ).first()
    
    if not current_ver:
        raise HTTPException(status_code=400, detail=t("documents.errors.no_current_version"))

    new_edit = ReviewEdit(
        document_version_id=current_ver.id,
        edit_type=data.edit_type,
        old_text=data.old_text,
        new_text=data.new_text,
        block_uuid=data.block_uuid,
        anchor_from_uuid=data.anchor_from_uuid,
        anchor_to_uuid=data.anchor_to_uuid,
        char_offset_in_block=data.char_offset_in_block,  # 🛠️ Передаем смещение
        char_length_in_block=data.char_length_in_block,  # 🛠️ Передаем длину
        author_id=current_user.id,
        resolution_status=ResolutionStatus.PENDING,
        is_orphan=False,
        created_at=datetime.utcnow()
    )
    db.add(new_edit)
    db.commit()
    db.refresh(new_edit)
    return new_edit

@router.get("/sets/{set_id}/download-archive", summary="Скачать комплект файлов архивом (ZIP)")
def download_set_archive(
    set_id: int,
    access_data: Tuple[DocumentSet, Optional[User]] = Depends(verify_document_set_access),
    db: Session = Depends(get_db)
):
    doc_set = access_data[0]
    
    # Получаем все документы в комплекте
    docs = db.query(Document).filter(Document.document_set_id == set_id).all()
    if not docs:
        raise HTTPException(status_code=404, detail=t("documents.errors.no_documents_in_set"))

    # Создаем архив в памяти
    memory_file = io.BytesIO()
    files_added = 0
    
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            # Находим текущую версию документа
            current_ver = db.query(DocumentVersion).filter(
                DocumentVersion.document_id == doc.id,
                DocumentVersion.is_current == True
            ).first()
            
            # Если у версии есть привязанный физический файл
            if current_ver and current_ver.file_path and os.path.exists(current_ver.file_path):
                ext = os.path.splitext(current_ver.file_path)[1]
                # Формируем имя файла внутри архива (ИмяДокумента.расширение)
                filename_in_zip = f"{doc.name}{ext}"
                zf.write(current_ver.file_path, arcname=filename_in_zip)
                files_added += 1
                
    if files_added == 0:
        raise HTTPException(status_code=404, detail=t("documents.errors.no_files_to_download"))

    # Возвращаем архив как поток
    memory_file.seek(0)
    return StreamingResponse(
        memory_file,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f"attachment; filename={doc_set.name}.zip"}
    )