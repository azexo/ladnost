# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
from typing import Tuple, Optional, List, Literal
from datetime import datetime
from database import get_db
from models import (
    DocumentSet, DocumentSetAccess, Document, DocumentVersion,
    QuestionnaireSection, QuestionnaireProperty, QuestionnaireCondition,
    ConditionRuleGroup, ConditionRule, ConditionFormulationVariant,
    Comment, ReviewEdit, DocumentSetMode, ApprovalStatus, AccessType, User
)

# === ИМПОРТ ХЕЛПЕРА ДЛЯ УВЕДОМЛЕНИЙ И I18N ===
from utils import get_current_active_user, get_accessible_document_set_ids, notify_document_sent
from utils import verify_document_set_access
from core.i18n import t  # Импортируем функцию перевода

router = APIRouter()

# ==========================================
# PYDANTIC SCHEMAS
# ==========================================
class DocumentSetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    folder_id: Optional[int] = None
    name: str
    mode: DocumentSetMode
    is_questionnaire_enabled: bool
    approval_status: ApprovalStatus
    owner_id: int
    is_favorite: bool
    is_anonymous_access: bool = False
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

class DocumentSetCreate(BaseModel):
    folder_id: Optional[int] = None
    name: str
    mode: DocumentSetMode = DocumentSetMode.TEMPLATE
    is_questionnaire_enabled: bool = False
    is_favorite: bool = False
    is_anonymous_access: bool = False

class DocumentSetUpdate(BaseModel):
    name: Optional[str] = None
    mode: Optional[DocumentSetMode] = None
    is_questionnaire_enabled: Optional[bool] = None
    approval_status: Optional[ApprovalStatus] = None
    is_favorite: Optional[bool] = None
    is_anonymous_access: bool = False

class AccessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    document_set_id: int
    user_id: int
    access_type: AccessType
    expires_at: Optional[datetime] = None
    granted_by: int
    created_at: datetime

class AccessCreate(BaseModel):
    user_id: int
    access_type: AccessType
    expires_at: Optional[datetime] = None

class AccessUpdate(BaseModel):
    user_id: Optional[int] = None
    access_type: Optional[AccessType] = None
    expires_at: Optional[datetime] = None

class BatchActionPayload(BaseModel):
    action: Literal['trash', 'move', 'favorite']
    ids: List[int]
    folder_id: Optional[int] = None

# ==========================================
# ROUTES
# ==========================================
@router.get("/", response_model=List[DocumentSetOut], summary="Получить список комплектов")
def list_document_sets(
    folder_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    accessible_ids = get_accessible_document_set_ids(db, current_user.id)
    query = db.query(DocumentSet).filter(
        DocumentSet.id.in_(accessible_ids),
        DocumentSet.is_deleted == False
    )
    if folder_id is not None:
        query = query.filter(DocumentSet.folder_id == folder_id)
    if status_filter:
        query = query.filter(DocumentSet.approval_status == status_filter)
    return query.all()

@router.get("/comments-counts", summary="Получить количество комментариев для комплектов")
def get_comments_counts(
    set_ids: Optional[List[int]] = Query(default=None),
    db: Session = Depends(get_db)
):
    if not set_ids:
        return {}
    result = {}
    for set_id in set_ids:
        docs = db.query(Document.id).filter(Document.document_set_id == set_id).all()
        doc_ids = [d[0] for d in docs]
        if not doc_ids:
            result[set_id] = 0
            continue
        current_versions = db.query(DocumentVersion.id).filter(
            DocumentVersion.document_id.in_(doc_ids),
            DocumentVersion.is_current == True
        ).all()
        ver_ids = [v[0] for v in current_versions]
        if not ver_ids:
            result[set_id] = 0
            continue
        count = db.query(Comment).filter(Comment.document_version_id.in_(ver_ids)).count()
        result[set_id] = count
    return result

@router.post("/batch", summary="Массовые действия над комплектами")
def batch_action(
    data: BatchActionPayload,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    affected = 0
    for set_id in data.ids:
        ds = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
        if ds and ds.owner_id == current_user.id:
            if data.action == 'trash':
                ds.is_deleted = True
                ds.deleted_at = datetime.utcnow()
            elif data.action == 'move':
                ds.folder_id = data.folder_id
            elif data.action == 'favorite':
                ds.is_favorite = True
            affected += 1
    db.commit()
    return {"status": "success", "affected": affected}

@router.get("/{set_id}", response_model=DocumentSetOut, summary="Получить комплект по ID")
def get_document_set(
    set_id: int,
    access_data: Tuple[DocumentSet, Optional[User]] = Depends(verify_document_set_access),
    db: Session = Depends(get_db)
):
    ds, current_user = access_data
    return ds

@router.post("/", response_model=DocumentSetOut, summary="Создать новый комплект")
def create_document_set(
    data: DocumentSetCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    new_set = DocumentSet(
        folder_id=data.folder_id,
        name=data.name,
        mode=data.mode,
        is_questionnaire_enabled=data.is_questionnaire_enabled,
        approval_status=ApprovalStatus.DRAFT,
        owner_id=current_user.id,
        is_favorite=data.is_favorite,
        is_deleted=False
    )
    db.add(new_set)
    db.commit()
    db.refresh(new_set)
    return new_set

@router.patch("/{set_id}", response_model=DocumentSetOut, summary="Обновить комплект")
def update_document_set(
    set_id: int,
    data: DocumentSetUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    ds = db.query(DocumentSet).filter(DocumentSet.id == set_id, DocumentSet.owner_id == current_user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail=t("document_sets.not_found"))
    
    update_data = data.model_dump(exclude_unset=True)

    # 🚀 ПРОВЕРКА: Меняется ли статус на "Отправлено на согласование"
    is_sent_for_approval = (
        "approval_status" in update_data and 
        update_data["approval_status"] == ApprovalStatus.IN_APPROVAL and
        ds.approval_status != ApprovalStatus.IN_APPROVAL
    )

    for key, value in update_data.items():
        setattr(ds, key, value)
    db.commit()
    db.refresh(ds)

    # 🚀 ОТПРАВКА УВЕДОМЛЕНИЙ ПРИ СМЕНЕ СТАТУСА
    if is_sent_for_approval:
        sender_name = f"{current_user.first_name} {current_user.last_name}".strip()
        accesses = db.query(DocumentSetAccess).filter(DocumentSetAccess.document_set_id == set_id).all()
        for acc in accesses:
            if acc.user_id != current_user.id:
                notify_document_sent(
                    db=db,
                    recipient_id=acc.user_id,
                    doc_set_id=set_id,
                    doc_set_name=ds.name,
                    sender_name=sender_name
                )
        db.commit()
    return ds

@router.post("/{set_id}/move", summary="Переместить комплект в папку")
def move_document_set(
    set_id: int,
    folder_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    ds = db.query(DocumentSet).filter(DocumentSet.id == set_id, DocumentSet.owner_id == current_user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail=t("document_sets.not_found"))
    ds.folder_id = folder_id
    db.commit()
    return {"status": "moved"}

@router.post("/{set_id}/trash", summary="Удалить комплект (в корзину)")
def trash_document_set(
    set_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    ds = db.query(DocumentSet).filter(DocumentSet.id == set_id, DocumentSet.owner_id == current_user.id).first()
    if not ds:
        raise HTTPException(status_code=404, detail=t("document_sets.not_found"))
    ds.is_deleted = True
    ds.deleted_at = datetime.utcnow()
    db.commit()
    return {"status": "trashed"}

@router.post("/{set_id}/clone", response_model=DocumentSetOut, summary="Клонировать комплект")
def clone_document_set(
    set_id: int,
    new_name: Optional[str] = Query(None),
    target_folder_id: Optional[int] = Query(None),
    as_standard: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    original = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
    if not original:
        raise HTTPException(status_code=404, detail=t("document_sets.original_not_found"))
    
    clone = DocumentSet(
        folder_id=target_folder_id if target_folder_id is not None else original.folder_id,
        name=new_name or t("document_sets.clone_suffix", name=original.name),
        mode=DocumentSetMode.STANDARD if as_standard else original.mode,
        is_questionnaire_enabled=original.is_questionnaire_enabled,
        approval_status=ApprovalStatus.DRAFT,
        owner_id=current_user.id,
        is_favorite=False,
        is_anonymous_access=original.is_anonymous_access,
        is_deleted=False
    )
    db.add(clone)
    db.flush()

    for doc in original.documents:
        new_doc = Document(
            document_set_id=clone.id, name=doc.name, document_role=doc.document_role, sort_order=doc.sort_order
        )
        db.add(new_doc)
        db.flush()
        for ver in doc.versions:
            new_ver = DocumentVersion(
                document_id=new_doc.id, version_number=ver.version_number, content_json=ver.content_json, 
                content_html=ver.content_html, plain_text_cache=ver.plain_text_cache, file_path=ver.file_path, 
                file_size=ver.file_size, is_current=ver.is_current, author_id=current_user.id, change_reason=ver.change_reason
            )
            db.add(new_ver)

    sec_map, cond_map, prop_map, group_map = {}, {}, {}, {}
    sections = db.query(QuestionnaireSection).filter(QuestionnaireSection.document_set_id == set_id).all()
    for sec in sections:
        new_sec = QuestionnaireSection(document_set_id=clone.id, name=sec.name, sort_order=sec.sort_order)
        db.add(new_sec)
        db.flush()
        sec_map[sec.id] = new_sec.id

    conditions = db.query(QuestionnaireCondition).filter(QuestionnaireCondition.document_set_id == set_id).all()
    for cond in conditions:
        new_cond = QuestionnaireCondition(
            document_set_id=clone.id, section_id=sec_map.get(cond.section_id) if cond.section_id else None,
            name=cond.name, is_enabled_default=cond.is_enabled_default, sort_order=cond.sort_order
        )
        db.add(new_cond)
        db.flush()
        cond_map[cond.id] = new_cond.id

    properties = db.query(QuestionnaireProperty).filter(QuestionnaireProperty.document_set_id == set_id).all()
    for prop in properties:
        new_prop = QuestionnaireProperty(
            document_set_id=clone.id, section_id=sec_map.get(prop.section_id) if prop.section_id else None,
            name=prop.name, identifier=prop.identifier, data_type=prop.data_type, text_input_type=prop.text_input_type,
            options_json=prop.options_json, description=prop.description, 
            display_condition_id=cond_map.get(prop.display_condition_id) if prop.display_condition_id else None,
            hint=prop.hint, placeholder=prop.placeholder, is_required=prop.is_required, hide_in_form=prop.hide_in_form,
            sort_order=prop.sort_order, value_source=prop.value_source, formula=prop.formula, 
            default_value=prop.default_value, format=prop.format
        )
        db.add(new_prop)
        db.flush()
        prop_map[prop.id] = new_prop.id

    if cond_map:
        groups = db.query(ConditionRuleGroup).filter(ConditionRuleGroup.condition_id.in_(cond_map.keys())).all()
        for g in groups:
            new_g = ConditionRuleGroup(
                condition_id=cond_map[g.condition_id], parent_group_id=None, 
                logical_operator=g.logical_operator, sort_order=g.sort_order
            )
            db.add(new_g)
            db.flush()
            group_map[g.id] = new_g.id

        for g in groups:
            if g.parent_group_id and g.parent_group_id in group_map:
                new_g = db.query(ConditionRuleGroup).filter(ConditionRuleGroup.id == group_map[g.id]).first()
                new_g.parent_group_id = group_map[g.parent_group_id]

    if group_map:
        rules = db.query(ConditionRule).filter(ConditionRule.group_id.in_(group_map.keys())).all()
        for r in rules:
            new_r = ConditionRule(
                group_id=group_map[r.group_id], property_id=prop_map[r.property_id],
                operator=r.operator, compare_value=r.compare_value, sort_order=r.sort_order
            )
            db.add(new_r)

    variants = db.query(ConditionFormulationVariant).filter(ConditionFormulationVariant.document_set_id == set_id).all()
    for v in variants:
        new_v = ConditionFormulationVariant(
            condition_id=cond_map.get(v.condition_id) if v.condition_id else None, formulation_id=v.formulation_id, 
            formulation_version_id=v.formulation_version_id, is_fallback=v.is_fallback,
            document_set_id=clone.id, identifier=v.identifier
        )
        db.add(new_v)

    db.commit()
    db.refresh(clone)
    return clone

# ==========================================
# УПРАВЛЕНИЕ ДОСТУПАМИ
# ==========================================
@router.get("/{set_id}/access", response_model=List[AccessOut], summary="Получить список доступов")
def get_access(
    set_id: int,
    db: Session = Depends(get_db)
):
    return db.query(DocumentSetAccess).filter(DocumentSetAccess.document_set_id == set_id).all()

@router.post("/{set_id}/access", response_model=AccessOut, summary="Выдать доступ")
def grant_access(
    set_id: int,
    data: AccessCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    ds = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail=t("document_sets.not_found"))
    
    existing = db.query(DocumentSetAccess).filter(
        DocumentSetAccess.document_set_id == set_id,
        DocumentSetAccess.user_id == data.user_id
    ).first()
    
    if existing:
        existing.access_type = data.access_type
        existing.expires_at = data.expires_at
        existing.granted_by = current_user.id
        db.commit()
        db.refresh(existing)
        access_obj = existing
    else:
        new_access = DocumentSetAccess(
            document_set_id=set_id,
            user_id=data.user_id,
            access_type=data.access_type,
            expires_at=data.expires_at,
            granted_by=current_user.id
        )
        db.add(new_access)
        db.commit()
        db.refresh(new_access)
        access_obj = new_access

    # 🚀 ОТПРАВКА УВЕДОМЛЕНИЯ О ВЫДАЧЕ ДОСТУПА
    sender_name = f"{current_user.first_name} {current_user.last_name}".strip()
    notify_document_sent(
        db=db,
        recipient_id=data.user_id,
        doc_set_id=set_id,
        doc_set_name=ds.name,
        sender_name=sender_name
    )
    db.commit()
    return access_obj

@router.patch("/{set_id}/access/{access_id}", response_model=AccessOut, summary="Обновить доступ")
def update_access(
    set_id: int,
    access_id: int,
    data: AccessUpdate,
    db: Session = Depends(get_db)
):
    access = db.query(DocumentSetAccess).filter(
        DocumentSetAccess.id == access_id,
        DocumentSetAccess.document_set_id == set_id
    ).first()
    if not access:
        raise HTTPException(status_code=404, detail=t("document_sets.access_not_found"))
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(access, key, value)
    db.commit()
    db.refresh(access)
    return access

@router.delete("/{set_id}/access/{access_id}", summary="Отозвать доступ")
def revoke_access(
    set_id: int,
    access_id: int,
    db: Session = Depends(get_db)
):
    access = db.query(DocumentSetAccess).filter(
        DocumentSetAccess.id == access_id,
        DocumentSetAccess.document_set_id == set_id
    ).first()
    if not access:
        raise HTTPException(status_code=404, detail=t("document_sets.access_not_found"))
    
    db.delete(access)
    db.commit()
    return {"status": "revoked"}