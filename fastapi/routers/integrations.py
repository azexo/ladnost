# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict, Tuple
from datetime import datetime, date
from decimal import Decimal
import re
from database import get_db
from models import (
    DocumentSet, DocumentSetMode, ApprovalStatus, Document, DocumentVersion,
    QuestionnaireSection, QuestionnaireProperty, QuestionnaireCondition,
    ConditionRuleGroup, ConditionRule, ConditionFormulationVariant,
    QuestionnaireAnswer, User, Folder, DocumentSetAccess
)
from utils import get_current_user_or_api_key, check_scope, AuthContext
# ✅ Подключаем функцию перевода из i18n 
from core.i18n import t 

router = APIRouter()

# ==========================================
# PYDANTIC SCHEMAS (DTOs)
# ==========================================

# --- Схемы для /create-and-fill (Оставлены для обратной совместимости) ---
class CreateAndFillDocumentRequest(BaseModel):
    template_set_id: int = Field(..., description="ID комплекта-шаблона для клонирования")
    new_name: Optional[str] = Field(None, description="Имя нового комплекта")
    target_folder_id: Optional[int] = Field(None, description="ID папки для размещения")
    single_answers: Optional[Dict[str, Any]] = Field(default=None, description="Словарь ответов для обычных свойств")
    table_answers: Optional[Dict[str, List[Dict[str, Any]]]] = Field(default=None, description="Табличные данные")

class CreateAndFillResponse(BaseModel):
    document_set_id: int
    name: str
    mode: str
    single_answers_saved: int
    table_rows_saved: int
    skipped_sections: List[str] = Field(default_factory=list)
    skipped_identifiers: List[str] = Field(default_factory=list)

# --- Схемы для раздельного /create ---
class CreateDocumentSetRequest(BaseModel):
    template_set_id: int = Field(..., description="ID комплекта-шаблона для клонирования")
    new_name: Optional[str] = Field(None, description="Имя нового комплекта")
    target_folder_id: Optional[int] = Field(None, description="ID папки для размещения")

class CreateDocumentSetResponse(BaseModel):
    document_set_id: int
    name: str
    mode: str
    folder_id: Optional[int]

# --- Схемы для раздельного /fill ---
class FillDocumentSetRequest(BaseModel):
    document_set_id: int = Field(..., description="ID созданного комплекта для заполнения анкеты")
    single_answers: Optional[Dict[str, Any]] = Field(default=None, description="Словарь ответов для обычных свойств")
    table_answers: Optional[Dict[str, List[Dict[str, Any]]]] = Field(default=None, description="Табличные данные")

class FillDocumentSetResponse(BaseModel):
    single_answers_saved: int
    table_rows_saved: int
    skipped_sections: List[str] = Field(default_factory=list, description="Названия секций, которых нет в комплекте")
    skipped_identifiers: List[str] = Field(default_factory=list, description="Идентификаторы свойств, которые не прошли валидацию")

# ==========================================
# ВНУТРЕННИЕ ХЕЛПЕРЫ (ПОВТОРНОЕ ИСПОЛЬЗОВАНИЕ)
# ==========================================

def _parse_value_for_db(val: Any) -> dict:
    """Умный парсер значения для БД."""
    if isinstance(val, bool):
        return {"value_boolean": val}
    elif isinstance(val, (int, float)):
        return {"value_number": Decimal(str(val))}
    elif isinstance(val, str):
        if re.match(r"^\d{4}-\d{2}-\d{2}$", val):
            try:
                return {"value_date": date.fromisoformat(val)}
            except ValueError:
                pass
        return {"value_text": val}
    else:
        return {"value_text": str(val)}

def _clone_template_set(
    db: Session,
    template: DocumentSet,
    user_id: int,
    new_name: str,
    folder_id: Optional[int]
) -> Tuple[DocumentSet, Dict[str, int], Dict[str, str], Dict[str, int], Dict[str, bool]]:
    """
    Глубокое клонирование комплекта-шаблона.
    Возвращает: new_set, prop_mapping, prop_to_section_name, section_name_to_new_id, prop_is_table
    """
    # 1. Создаем новый комплект
    new_set = DocumentSet(
        folder_id=folder_id if folder_id is not None else template.folder_id,
        name=new_name or f"{template.name} (Интеграция)",
        mode=DocumentSetMode.STANDARD,
        is_questionnaire_enabled=template.is_questionnaire_enabled,
        approval_status=ApprovalStatus.DRAFT,
        owner_id=user_id,
        is_favorite=False,
        is_anonymous_access=False,
        is_deleted=False,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_set)
    db.flush()

    # 2. Клонируем Документы и Версии
    for doc in template.documents:
        new_doc = Document(document_set_id=new_set.id, name=doc.name, document_role=doc.document_role, sort_order=doc.sort_order)
        db.add(new_doc)
        db.flush()
        for ver in doc.versions:
            new_ver = DocumentVersion(
                document_id=new_doc.id, version_number=ver.version_number, content_json=ver.content_json, 
                content_html=ver.content_html, plain_text_cache=ver.plain_text_cache, file_path=ver.file_path, 
                file_size=ver.file_size, is_current=ver.is_current, author_id=user_id, change_reason=ver.change_reason
            )
            db.add(new_ver)

    # Словари для маппинга
    section_name_to_new_id = {}
    prop_mapping = {}
    prop_to_section_name = {}
    old_id_to_identifier = {}
    prop_is_table = {}

    # 3. Клонируем Секции
    sections = db.query(QuestionnaireSection).filter(QuestionnaireSection.document_set_id == template.id).all()
    old_sec_id_to_name = {sec.id: sec.name for sec in sections} 
    old_sec_id_to_is_table = {sec.id: sec.is_table for sec in sections}

    for sec in sections:
        new_sec = QuestionnaireSection(
            document_set_id=new_set.id, name=sec.name, sort_order=sec.sort_order, is_table=sec.is_table
        )
        db.add(new_sec)
        db.flush()
        section_name_to_new_id[sec.name] = new_sec.id

    # 4. Клонируем УСЛОВИЯ
    cond_map = {}
    conditions = db.query(QuestionnaireCondition).filter(QuestionnaireCondition.document_set_id == template.id).all()
    for cond in conditions:
        new_cond = QuestionnaireCondition(
            document_set_id=new_set.id, 
            section_id=section_name_to_new_id.get(old_sec_id_to_name.get(cond.section_id)) if cond.section_id else None,
            name=cond.name, is_enabled_default=cond.is_enabled_default, sort_order=cond.sort_order
        )
        db.add(new_cond)
        db.flush()
        cond_map[cond.id] = new_cond.id

    # 5. Клонируем СВОЙСТВА
    properties = db.query(QuestionnaireProperty).filter(QuestionnaireProperty.document_set_id == template.id).all()
    for prop in properties:
        new_prop = QuestionnaireProperty(
            document_set_id=new_set.id, 
            section_id=section_name_to_new_id.get(old_sec_id_to_name.get(prop.section_id)) if prop.section_id else None,
            name=prop.name, identifier=prop.identifier, data_type=prop.data_type, 
            text_input_type=prop.text_input_type, options_json=prop.options_json, 
            description=prop.description, hint=prop.hint, placeholder=prop.placeholder, 
            is_required=prop.is_required, hide_in_form=prop.hide_in_form, sort_order=prop.sort_order, 
            value_source=prop.value_source, formula=prop.formula, default_value=prop.default_value, format=prop.format,
            display_condition_id=cond_map.get(prop.display_condition_id) if prop.display_condition_id else None 
        )
        db.add(new_prop)
        db.flush()
        prop_mapping[prop.identifier] = new_prop.id
        old_id_to_identifier[prop.id] = prop.identifier
        sec_name = old_sec_id_to_name.get(prop.section_id)
        prop_to_section_name[prop.identifier] = sec_name
        prop_is_table[prop.identifier] = old_sec_id_to_is_table.get(prop.section_id, False)

    # 6-8. Клонируем Группы правил, Правила и Варианты формулировок (без изменений)
    group_map = {}
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
                db.query(ConditionRuleGroup).filter(ConditionRuleGroup.id == group_map[g.id]).update(
                    {"parent_group_id": group_map[g.parent_group_id]}
                )

    if group_map:
        rules = db.query(ConditionRule).filter(ConditionRule.group_id.in_(group_map.keys())).all()
        for r in rules:
            identifier = old_id_to_identifier.get(r.property_id)
            new_prop_id = prop_mapping.get(identifier) if identifier else None
            new_r = ConditionRule(
                group_id=group_map[r.group_id], property_id=new_prop_id, 
                operator=r.operator, compare_value=r.compare_value, sort_order=r.sort_order
            )
            db.add(new_r)

    variants = db.query(ConditionFormulationVariant).filter(ConditionFormulationVariant.document_set_id == template.id).all()
    for v in variants:
        new_v = ConditionFormulationVariant(
            condition_id=cond_map.get(v.condition_id) if v.condition_id else None, 
            formulation_id=v.formulation_id, formulation_version_id=v.formulation_version_id, 
            is_fallback=v.is_fallback, document_set_id=new_set.id, identifier=v.identifier
        )
        db.add(new_v)

    return new_set, prop_mapping, prop_to_section_name, section_name_to_new_id, prop_is_table

def _get_mappings_for_document_set(db: Session, document_set_id: int) -> Tuple[Dict[str, int], Dict[str, str], Dict[str, int], Dict[str, bool]]:
    """
    Собирает маппинги для УЖЕ СУЩЕСТВУЮЩЕГО комплекта (нужно для эндпоинта /fill).
    Возвращает: prop_mapping, prop_to_section_name, section_name_to_id, prop_is_table
    """
    sections = db.query(QuestionnaireSection).filter(QuestionnaireSection.document_set_id == document_set_id).all()
    section_name_to_id = {sec.name: sec.id for sec in sections}
    section_id_to_name = {sec.id: sec.name for sec in sections}
    section_id_to_is_table = {sec.id: sec.is_table for sec in sections}

    properties = db.query(QuestionnaireProperty).filter(QuestionnaireProperty.document_set_id == document_set_id).all()
    prop_mapping = {}
    prop_to_section_name = {}
    prop_is_table = {}

    for prop in properties:
        prop_mapping[prop.identifier] = prop.id
        sec_name = section_id_to_name.get(prop.section_id)
        prop_to_section_name[prop.identifier] = sec_name
        prop_is_table[prop.identifier] = section_id_to_is_table.get(prop.section_id, False)

    return prop_mapping, prop_to_section_name, section_name_to_id, prop_is_table

def _process_and_save_answers(
    db: Session,
    document_set_id: int,
    user_id: int,
    single_answers: Optional[Dict[str, Any]],
    table_answers: Optional[Dict[str, List[Dict[str, Any]]]],
    prop_mapping: Dict[str, int],
    prop_to_section_name: Dict[str, str],
    section_name_to_id: Dict[str, int],
    prop_is_table: Dict[str, bool]
) -> Tuple[int, int, List[str], List[str]]:
    """
    Универсальный обработчик и сохранитель ответов в БД.
    Возвращает: single_count, table_count, skipped_sections, skipped_identifiers
    """
    skipped_sections = set()
    skipped_identifiers = set()
    single_count = 0
    table_count = 0
    now = datetime.utcnow()

    # 1. ОБРАБОТКА ОДИНОЧНЫХ ОТВЕТОВ
    if single_answers:
        for identifier, value in single_answers.items():
            new_prop_id = prop_mapping.get(identifier)
            if not new_prop_id or prop_is_table.get(identifier, False):
                skipped_identifiers.add(identifier)
                continue 
            
            parsed_val = _parse_value_for_db(value)
            new_answer = QuestionnaireAnswer(
                document_set_id=document_set_id, property_id=new_prop_id, row_index=0,
                answered_by=user_id, answered_at=now, created_at=now, updated_at=now, **parsed_val
            )
            db.add(new_answer)
            single_count += 1

    # 2. ОБРАБОТКА ТАБЛИЧНЫХ ОТВЕТОВ (ПО СЕКЦИЯМ)
    if table_answers:
        for section_name, rows in table_answers.items():
            if section_name not in section_name_to_id:
                skipped_sections.add(section_name)
                continue
            
            for row_index, row_data in enumerate(rows):
                for identifier, value in row_data.items():
                    new_prop_id = prop_mapping.get(identifier)
                    if not new_prop_id or prop_to_section_name.get(identifier) != section_name:
                        skipped_identifiers.add(identifier)
                        continue 
                    
                    parsed_val = _parse_value_for_db(value)
                    new_answer = QuestionnaireAnswer(
                        document_set_id=document_set_id,
                        property_id=new_prop_id,
                        row_index=row_index,
                        answered_by=user_id, answered_at=now, created_at=now, updated_at=now,
                        **parsed_val
                    )
                    db.add(new_answer)
                    table_count += 1

    return single_count, table_count, list(skipped_sections), list(skipped_identifiers)

# ==========================================
# ENDPOINTS
# ==========================================

@router.post(
    "/create",
    response_model=CreateDocumentSetResponse,
    summary="Создание комплекта из шаблона (без заполнения)",
    description="Клонирует шаблон и возвращает ID нового комплекта для последующего заполнения."
)
def create_document_set(
    payload: CreateDocumentSetRequest,
    ctx: AuthContext = Depends(get_current_user_or_api_key),
    db: Session = Depends(get_db)
):
    # check_scope("documents:write", ctx)
    user_id = ctx.user.id
    
    template = db.query(DocumentSet).filter(
        DocumentSet.id == payload.template_set_id, 
        DocumentSet.is_deleted == False
    ).first()
    
    if not template:
        raise HTTPException(status_code=404, detail=t("integrations.template_set_not_found"))

    final_folder_id = template.folder_id
    if payload.target_folder_id is not None:
        target_folder = db.query(Folder).filter(
            Folder.id == payload.target_folder_id,
            Folder.owner_id == user_id,
            Folder.is_deleted == False
        ).first()
        if not target_folder:
            raise HTTPException(status_code=404, detail=t("integrations.target_folder_not_found_or_no_access"))
        final_folder_id = target_folder.id

    new_set, _, _, _, _ = _clone_template_set(
        db=db, template=template, user_id=user_id, new_name=payload.new_name, folder_id=final_folder_id
    )
    
    db.commit()
    db.refresh(new_set)
    
    return CreateDocumentSetResponse(
        document_set_id=new_set.id,
        name=new_set.name,
        mode=new_set.mode.value,
        folder_id=new_set.folder_id
    )

@router.post(
    "/fill",
    response_model=FillDocumentSetResponse,
    summary="Заполнение анкеты существующего комплекта",
    description="Сохраняет ответы в анкету указанного комплекта. Требует прав на редактирование."
)
def fill_document_set(
    payload: FillDocumentSetRequest,
    ctx: AuthContext = Depends(get_current_user_or_api_key),
    db: Session = Depends(get_db)
):
    # check_scope("documents:write", ctx)
    user_id = ctx.user.id
    
    # 1. Проверяем существование и права на комплект
    target_set = db.query(DocumentSet).filter(
        DocumentSet.id == payload.document_set_id,
        DocumentSet.is_deleted == False
    ).first()
    
    if not target_set:
        raise HTTPException(status_code=404, detail=t("integrations.document_set_not_found"))

    # Проверка прав (Владелец или есть явный доступ)
    if target_set.owner_id != user_id:
        has_access = db.query(DocumentSetAccess).filter(
            DocumentSetAccess.document_set_id == target_set.id,
            DocumentSetAccess.user_id == user_id
        ).first()
        if not has_access:
            raise HTTPException(status_code=403, detail=t("integrations.no_access_to_fill"))

    # 2. Получаем маппинги для существующего комплекта
    prop_mapping, prop_to_section_name, section_name_to_id, prop_is_table = _get_mappings_for_document_set(
        db=db, document_set_id=target_set.id
    )

    # 3. Обрабатываем и сохраняем ответы
    single_count, table_count, skipped_sections, skipped_identifiers = _process_and_save_answers(
        db=db,
        document_set_id=target_set.id,
        user_id=user_id,
        single_answers=payload.single_answers,
        table_answers=payload.table_answers,
        prop_mapping=prop_mapping,
        prop_to_section_name=prop_to_section_name,
        section_name_to_id=section_name_to_id,
        prop_is_table=prop_is_table
    )
    
    db.commit()
    
    return FillDocumentSetResponse(
        single_answers_saved=single_count,
        table_rows_saved=table_count,
        skipped_sections=skipped_sections,
        skipped_identifiers=skipped_identifiers
    )

@router.post(
    "/create-and-fill",
    response_model=CreateAndFillResponse,
    summary="Создание документа из шаблона с заполнением анкеты (Атомарная операция)",
    description="Клонирует шаблон, меняет режим на 'Типовой' и заполняет анкету. Табличные данные группируются по названиям секций."
)
def create_and_fill_document(
    payload: CreateAndFillDocumentRequest,
    ctx: AuthContext = Depends(get_current_user_or_api_key),
    db: Session = Depends(get_db)
):
    # check_scope("documents:write", ctx)
    user_id = ctx.user.id
    
    template = db.query(DocumentSet).filter(
        DocumentSet.id == payload.template_set_id, 
        DocumentSet.is_deleted == False
    ).first()
    
    if not template:
        raise HTTPException(status_code=404, detail=t("integrations.template_set_not_found"))

    final_folder_id = template.folder_id
    if payload.target_folder_id is not None:
        target_folder = db.query(Folder).filter(
            Folder.id == payload.target_folder_id,
            Folder.owner_id == user_id,
            Folder.is_deleted == False
        ).first()
        if not target_folder:
            raise HTTPException(status_code=404, detail=t("integrations.target_folder_not_found_or_no_access"))
        final_folder_id = target_folder.id

    # Клонируем и получаем все маппинги
    new_set, prop_mapping, prop_to_section_name, section_name_to_new_id, prop_is_table = _clone_template_set(
        db=db, template=template, user_id=user_id, new_name=payload.new_name, folder_id=final_folder_id
    )

    # Используем общий хелпер для сохранения ответов
    single_count, table_count, skipped_sections, skipped_identifiers = _process_and_save_answers(
        db=db,
        document_set_id=new_set.id,
        user_id=user_id,
        single_answers=payload.single_answers,
        table_answers=payload.table_answers,
        prop_mapping=prop_mapping,
        prop_to_section_name=prop_to_section_name,
        section_name_to_id=section_name_to_new_id, # В контексте клонов это section_name_to_new_id
        prop_is_table=prop_is_table
    )
    
    db.commit()
    db.refresh(new_set)
    
    return CreateAndFillResponse(
        document_set_id=new_set.id,
        name=new_set.name,
        mode=new_set.mode.value,
        single_answers_saved=single_count,
        table_rows_saved=table_count,
        skipped_sections=skipped_sections,
        skipped_identifiers=skipped_identifiers
    )
