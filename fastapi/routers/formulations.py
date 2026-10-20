# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Literal
from datetime import datetime
from database import get_db
from models import (
    Formulation, FormulationVersion, FormulationType, FormulationGroup,
    FormulationVariable, ConditionFormulationVariant, QuestionnaireCondition,
    User, DocumentSet, DocumentSetMode, ApprovalStatus
)
from utils import (
    get_current_active_user, is_formulation_visible,
    get_accessible_document_set_ids, notify_formulation_updated,
    get_optional_user
)
# ✅ Импортируем функцию перевода
from core.i18n import t 

router = APIRouter()

# ==================== PYDANTIC SCHEMAS ====================

class FormulationTypeSchema(BaseModel):
    id: int
    name: str
    owner_id: int
    sort_order: int
    model_config = ConfigDict(from_attributes=True)

class FormulationGroupSchema(BaseModel):
    id: int
    name: str
    color_label: Optional[str] = None
    description: Optional[str] = None
    owner_id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormulationVersionSchema(BaseModel):
    id: int
    formulation_id: int
    version_number: int
    text_content: str
    change_reason: Optional[str] = None
    author_id: int
    is_current: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormulationSchema(BaseModel):
    id: int
    name: str
    type_id: Optional[int] = None
    group_id: Optional[int] = None
    is_favorite: bool
    current_version_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormulationListItemSchema(BaseModel):
    id: int
    name: str
    type_id: Optional[int] = None
    type_name: str
    text_content: str
    author_name: str
    author_avatar: Optional[str] = None
    author_email: str
    is_favorite: bool
    current_version_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormulationPayload(BaseModel):
    name: str
    type_id: Optional[int] = 1
    group_id: Optional[int] = None
    is_favorite: bool = False

class FormulationVersionPayload(BaseModel):
    text_content: str
    change_reason: Optional[str] = None

class FormulationTypePayload(BaseModel):
    name: str
    sort_order: Optional[int] = None

# 🆕 Модель для PATCH-запроса (обновления типа), чтобы не использовать dict
class FormulationTypeUpdatePayload(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None

class FormulationGroupPayload(BaseModel):
    name: str
    color_label: Optional[str] = None
    description: Optional[str] = None

class FormulationVariablePayload(BaseModel):
    variable_name: str

class FormulationVariableSchema(BaseModel):
    id: int
    formulation_id: int
    variable_name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ConditionFormulationVariantSchema(BaseModel):
    id: int
    condition_id: Optional[int] = None
    formulation_id: int
    formulation_version_id: Optional[int] = None
    is_fallback: bool
    document_set_id: int
    identifier: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class QuestionnaireConditionSchema(BaseModel):
    id: int
    document_set_id: int
    section_id: Optional[int] = None
    name: str
    is_enabled_default: bool
    sort_order: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class UsedFormulationDetailSchema(BaseModel):
    id: int
    name: str
    type_name: str
    text_content: str
    author_name: str
    author_avatar: Optional[str] = None
    author_email: str
    model_config = ConfigDict(from_attributes=True)

class UsedVariantItemSchema(BaseModel):
    variant: ConditionFormulationVariantSchema
    formulation: UsedFormulationDetailSchema
    condition: Optional[QuestionnaireConditionSchema] = None
    model_config = ConfigDict(from_attributes=True)

class FormulationUsedInSetSchema(BaseModel):
    identifier: str
    variants: List[UsedVariantItemSchema]
    model_config = ConfigDict(from_attributes=True)

class DocumentSetSchema(BaseModel):
    id: int
    folder_id: Optional[int] = None
    name: str
    mode: DocumentSetMode
    is_questionnaire_enabled: bool
    approval_status: ApprovalStatus
    owner_id: int
    is_favorite: bool
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormulationUsageSchema(BaseModel):
    count: int
    document_sets: List[DocumentSetSchema]
    model_config = ConfigDict(from_attributes=True)

# ==================== ROUTES ====================

@router.get("/by-author/{author_id}", response_model=List[FormulationListItemSchema])
def list_by_author(
    author_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_optional_user)
):
    """Список формулировок конкретного автора с учетом прав доступа"""
    if current_user:
        accessible_set_ids = get_accessible_document_set_ids(db, current_user.id)
    else:
        accessible_set_ids = [
            ds_id for ds_id, in db.query(DocumentSet.id).filter(
                DocumentSet.is_anonymous_access == True,
                DocumentSet.is_deleted == False
            ).all()
        ]

    formulations = db.query(Formulation).filter(Formulation.created_by == author_id).all()
    
    visible_formulations = [
        f for f in formulations 
        if is_formulation_visible(db, f.id, accessible_set_ids, current_user.id if current_user else 0)
    ]
    
    if not visible_formulations:
        return []

    current_version_ids = [f.current_version_id for f in visible_formulations if f.current_version_id]
    author_ids = set()
    type_ids = set()
    for f in visible_formulations:
        if f.type_id:
            type_ids.add(f.type_id)
        author_ids.add(f.created_by)

    versions_map = {}
    if current_version_ids:
        versions = db.query(FormulationVersion).filter(
            FormulationVersion.id.in_(current_version_ids)
        ).all()
        versions_map = {v.id: v for v in versions}
        for v in versions:
            if v.author_id:
                author_ids.add(v.author_id)

    authors_map = {}
    if author_ids:
        authors = db.query(User).filter(User.id.in_(list(author_ids))).all()
        authors_map = {u.id: u for u in authors}

    types_map = {}
    if type_ids:
        types = db.query(FormulationType).filter(FormulationType.id.in_(list(type_ids))).all()
        types_map = {t_obj.id: t_obj for t_obj in types} # Переименовал t в t_obj, чтобы не конфликтовало с i18n.t

    result = []
    for f in visible_formulations:
        version = versions_map.get(f.current_version_id)
        if not version:
            version = db.query(FormulationVersion).filter(
                FormulationVersion.formulation_id == f.id,
                FormulationVersion.is_current == True
            ).first()
        
        author_id = version.author_id if version and version.author_id else f.created_by
        author = authors_map.get(author_id)
        type_obj = types_map.get(f.type_id)
        
        result.append({
            "id": f.id,
            "name": f.name,
            "type_id": f.type_id,
            "type_name": type_obj.name if type_obj else t("formulations.fallbacks.no_type"),
            "text_content": version.text_content if version else t("formulations.fallbacks.no_text"),
            "author_name": f"{author.first_name} {author.last_name}" if author else t("formulations.fallbacks.author"),
            "author_avatar": author.avatar_url if author else "",
            "author_email": author.email if author else "",
            "is_favorite": f.is_favorite,
            "current_version_id": version.id if version else None, 
            "created_by": f.created_by,
            "created_at": f.created_at,
            "updated_at": f.updated_at
        })
    return result

@router.get("/types", response_model=List[FormulationTypeSchema])
def get_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Получение типов с учетом видимости формулировок"""
    accessible_set_ids = get_accessible_document_set_ids(db, current_user.id)
    all_formulations = db.query(Formulation).all()
    visible_type_ids = set()
    for f in all_formulations:
        if is_formulation_visible(db, f.id, accessible_set_ids, current_user.id):
            if f.type_id:
                visible_type_ids.add(f.type_id)

    if visible_type_ids:
        types = db.query(FormulationType).filter(
            (FormulationType.owner_id == current_user.id) | 
            (FormulationType.id.in_(list(visible_type_ids)))
        ).order_by(FormulationType.sort_order).all()
    else:
        types = db.query(FormulationType).filter(
            FormulationType.owner_id == current_user.id
        ).order_by(FormulationType.sort_order).all()
    return types

@router.post("/types", response_model=FormulationTypeSchema)
def create_type(
    data: FormulationTypePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    max_sort_obj = db.query(FormulationType).order_by(FormulationType.sort_order.desc()).first()
    max_sort = max_sort_obj.sort_order if max_sort_obj else 0
    new_type = FormulationType(
        name=data.name,
        sort_order=data.sort_order or (max_sort + 1),
        owner_id=current_user.id
    )
    db.add(new_type)
    db.commit()
    db.refresh(new_type)
    return new_type

@router.patch("/types/{type_id}", response_model=FormulationTypeSchema)
def update_type(
    type_id: int,
    data: FormulationTypeUpdatePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    type_obj = db.query(FormulationType).filter(FormulationType.id == type_id).first()
    if not type_obj:
        raise HTTPException(status_code=404, detail=t("formulations.errors.type_not_found"))
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(type_obj, key):
            setattr(type_obj, key, value)
            
    db.commit()
    db.refresh(type_obj)
    return type_obj

@router.post("/types/{type_id}/move")
def move_type(
    type_id: int,
    direction: Literal['up', 'down'],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    types = db.query(FormulationType).order_by(FormulationType.sort_order).all()
    index = next((i for i, t_obj in enumerate(types) if t_obj.id == type_id), -1)
    if index == -1:
        raise HTTPException(status_code=404, detail=t("formulations.errors.type_not_found"))
        
    target_index = index - 1 if direction == 'up' else index + 1
    if target_index < 0 or target_index >= len(types):
        raise HTTPException(status_code=400, detail=t("formulations.errors.out_of_bounds"))

    types[index].sort_order, types[target_index].sort_order = types[target_index].sort_order, types[index].sort_order
    db.commit()
    return {"status": "success"}

@router.delete("/types/{type_id}")
def delete_type(
    type_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    is_used = db.query(Formulation).filter(Formulation.type_id == type_id).first()
    if is_used:
        raise HTTPException(status_code=400, detail=t("formulations.errors.type_in_use"))
        
    type_obj = db.query(FormulationType).filter(FormulationType.id == type_id).first()
    if not type_obj:
        raise HTTPException(status_code=404, detail=t("formulations.errors.type_not_found"))
        
    db.delete(type_obj)
    db.commit()
    return {"status": "deleted"}

@router.get("/groups", response_model=List[FormulationGroupSchema])
def get_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    groups = db.query(FormulationGroup).all()
    return groups

@router.post("/groups", response_model=FormulationGroupSchema)
def create_group(
    data: FormulationGroupPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    new_group = FormulationGroup(
        name=data.name,
        color_label=data.color_label,
        description=data.description,
        owner_id=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_group)
    db.commit()
    db.refresh(new_group)
    return new_group

@router.get("/used-in-set/{set_id}", response_model=List[FormulationUsedInSetSchema])
def list_used_in_set(
    set_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_optional_user)
):
    """Группировка формулировок по identifier для конкретного комплекта"""
    ds = db.query(DocumentSet).filter(DocumentSet.id == set_id, DocumentSet.is_deleted == False).first()
    if not ds:
        raise HTTPException(status_code=404, detail=t("formulations.errors.set_not_found"))
        
    if not ds.is_anonymous_access and not current_user:
        raise HTTPException(status_code=401, detail=t("formulations.errors.auth_required_for_set"))

    variants = db.query(ConditionFormulationVariant).filter(
        ConditionFormulationVariant.document_set_id == set_id
    ).all()
    
    if not variants:
        return []

    condition_ids = list(set(v.condition_id for v in variants if v.condition_id is not None))
    conditions = db.query(QuestionnaireCondition).filter(
        QuestionnaireCondition.id.in_(condition_ids)
    ).all() if condition_ids else []

    formulation_ids = list(set(v.formulation_id for v in variants))
    formulations_map = {f.id: f for f in db.query(Formulation).filter(
        Formulation.id.in_(formulation_ids)
    ).all()}

    current_version_ids = [f.current_version_id for f in formulations_map.values() if f.current_version_id]
    versions_map = {}
    if current_version_ids:
        versions_map = {v.id: v for v in db.query(FormulationVersion).filter(
            FormulationVersion.id.in_(current_version_ids)
        ).all()}

    author_ids = list(set(
        v.author_id for v in versions_map.values() if v.author_id
    ) | set(
        f.created_by for f in formulations_map.values()
    ))
    authors_map = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()} if author_ids else {}
    
    type_ids = list(set(f.type_id for f in formulations_map.values() if f.type_id))
    types_map = {t_obj.id: t_obj for t_obj in db.query(FormulationType).filter(
        FormulationType.id.in_(type_ids)
    ).all()} if type_ids else {}

    grouped = {}
    for v in variants:
        if v.identifier not in grouped:
            grouped[v.identifier] = []
            
        form = formulations_map.get(v.formulation_id)
        
        current_version = None
        if form and form.current_version_id:
            current_version = versions_map.get(form.current_version_id)
            
        if not current_version and form:
            current_version = db.query(FormulationVersion).filter(
                FormulationVersion.formulation_id == form.id,
                FormulationVersion.is_current == True
            ).first()
            
        author_id = current_version.author_id if current_version and current_version.author_id else (form.created_by if form else (current_user.id if current_user else 0))
        author = authors_map.get(author_id)
        type_obj = types_map.get(form.type_id) if form else None
        
        condition = next((c for c in conditions if c.id == v.condition_id), None) if v.condition_id else None
        
        grouped[v.identifier].append({
            "variant": v,
            "formulation": {
                "id": form.id if form else None,
                "name": form.name if form else t("formulations.fallbacks.unknown"),
                "type_name": type_obj.name if type_obj else t("formulations.fallbacks.no_type"),
                "text_content": current_version.text_content if current_version else t("formulations.fallbacks.no_text"),
                "author_name": f"{author.first_name} {author.last_name}" if author else t("formulations.fallbacks.author"),
                "author_avatar": author.avatar_url if author else "",
                "author_email": author.email if author else ""
            },
            "condition": condition
        })
        
    return [{"identifier": k, "variants": v_list} for k, v_list in grouped.items()]

@router.get("/", response_model=List[FormulationListItemSchema])
def list_formulations(
    type_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Список формулировок с учетом прав доступа"""
    accessible_set_ids = get_accessible_document_set_ids(db, current_user.id)
    query = db.query(Formulation)
    if type_id:
        query = query.filter(Formulation.type_id == type_id)
        
    formulations = query.all()

    current_version_ids = [f.current_version_id for f in formulations if f.current_version_id]
    versions_map = {}
    if current_version_ids:
        versions_map = {v.id: v for v in db.query(FormulationVersion).filter(
            FormulationVersion.id.in_(current_version_ids)
        ).all()}

    author_ids = list(set(
        v.author_id for v in versions_map.values() if v.author_id
    ) | set(
        f.created_by for f in formulations
    ))
    authors_map = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()} if author_ids else {}
    
    type_ids = list(set(f.type_id for f in formulations if f.type_id))
    types_map = {t_obj.id: t_obj for t_obj in db.query(FormulationType).filter(
        FormulationType.id.in_(type_ids)
    ).all()} if type_ids else {}

    result = []
    for f in formulations:
        if not is_formulation_visible(db, f.id, accessible_set_ids, current_user.id):
            continue
            
        version = versions_map.get(f.current_version_id)
        if not version:
            version = db.query(FormulationVersion).filter(
                FormulationVersion.formulation_id == f.id,
                FormulationVersion.is_current == True
            ).first()
            
        author_id = version.author_id if version and version.author_id else f.created_by
        author = authors_map.get(author_id)
        type_obj = types_map.get(f.type_id)
        
        result.append({
            "id": f.id,
            "name": f.name,
            "type_id": f.type_id,
            "type_name": type_obj.name if type_obj else t("formulations.fallbacks.no_type"),
            "text_content": version.text_content if version else t("formulations.fallbacks.no_text"),
            "author_name": f"{author.first_name} {author.last_name}" if author else t("formulations.fallbacks.author"),
            "author_avatar": author.avatar_url if author else "",
            "author_email": author.email if author else "",
            "is_favorite": f.is_favorite,
            "current_version_id": version.id if version else None,
            "created_by": f.created_by,
            "created_at": f.created_at,
            "updated_at": f.updated_at
        })
    return result

@router.post("/", response_model=FormulationSchema)
def create_formulation(
    data: FormulationPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Создание новой формулировки"""
    new_form = Formulation(
        name=data.name,
        type_id=data.type_id,
        group_id=data.group_id,
        is_favorite=data.is_favorite,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    return new_form

@router.get("/{formulation_id}", response_model=FormulationSchema)
def get_formulation(
    formulation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    f = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if not f:
        raise HTTPException(status_code=404, detail=t("formulations.errors.formulation_not_found"))
    return f

@router.patch("/{formulation_id}", response_model=FormulationSchema)
def update_formulation(
    formulation_id: int,
    data: FormulationPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    f = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if not f:
        raise HTTPException(status_code=404, detail=t("formulations.errors.formulation_not_found"))

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(f, key, value)
        
    f.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(f)
    return f

@router.post("/{formulation_id}/toggle-favorite")
def toggle_favorite(
    formulation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    f = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if f:
        f.is_favorite = not f.is_favorite
        db.commit()
    return {"status": "success"}

@router.post("/{formulation_id}/versions", response_model=FormulationVersionSchema)
def create_version(
    formulation_id: int,
    data: FormulationVersionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Создание новой версии формулировки"""
    f = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if not f:
        raise HTTPException(status_code=404, detail=t("formulations.errors.formulation_not_found"))

    db.query(FormulationVersion).filter(
        FormulationVersion.formulation_id == formulation_id
    ).update({"is_current": False})
    
    prev_versions = db.query(FormulationVersion).filter(FormulationVersion.formulation_id == formulation_id).all()
    next_version_number = max([v.version_number for v in prev_versions], default=0) + 1
    
    new_version = FormulationVersion(
        formulation_id=formulation_id,
        version_number=next_version_number,
        text_content=data.text_content,
        change_reason=data.change_reason,
        is_current=True,
        author_id=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_version)

    f.current_version_id = new_version.id
    f.updated_at = datetime.utcnow()

    actor_name = f"{current_user.first_name} {current_user.last_name}"
    notify_formulation_updated(
        db=db,
        formulation_id=formulation_id,
        formulation_name=f.name,
        actor_id=current_user.id,
        actor_name=actor_name
    )

    db.commit()
    db.refresh(new_version)
    return new_version

@router.post("/{formulation_id}/variables", response_model=FormulationVariableSchema)
def add_variable(
    formulation_id: int,
    data: FormulationVariablePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    f = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if not f:
        raise HTTPException(status_code=404, detail=t("formulations.errors.formulation_not_found"))

    new_var = FormulationVariable(
        formulation_id=formulation_id,
        variable_name=data.variable_name,
        created_at=datetime.utcnow()
    )
    db.add(new_var)
    db.commit()
    db.refresh(new_var)
    return new_var

@router.get("/{formulation_id}/usage", response_model=FormulationUsageSchema)
def get_usage(
    formulation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    variants = db.query(ConditionFormulationVariant).filter(
        ConditionFormulationVariant.formulation_id == formulation_id
    ).all()
    
    set_ids = list(set(v.document_set_id for v in variants if v.document_set_id))
    if set_ids:
        document_sets = db.query(DocumentSet).filter(DocumentSet.id.in_(set_ids)).all()
    else:
        document_sets = []
        
    return {
        "count": len(set_ids),
        "document_sets": document_sets
    }

@router.delete("/{formulation_id}")
def delete_formulation(
    formulation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Удаление формулировки"""
    f = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if not f:
        raise HTTPException(status_code=404, detail=t("formulations.errors.formulation_not_found"))

    is_used = db.query(ConditionFormulationVariant).filter(
        ConditionFormulationVariant.formulation_id == formulation_id
    ).first()
    if is_used:
        raise HTTPException(
            status_code=400, 
            detail=t("formulations.errors.formulation_in_use")
        )

    db.delete(f)
    db.commit()
    return {"status": "deleted"}