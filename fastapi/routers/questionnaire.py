# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Tuple, Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from decimal import Decimal
from database import get_db
from models import (
    QuestionnaireSection, QuestionnaireProperty, QuestionnaireCondition,
    ConditionRuleGroup, ConditionRule, QuestionnaireAnswer,
    ConditionFormulationVariant, Formulation, FormulationVersion, DocumentSet, User
)
from utils import get_current_user, get_accessible_document_set_ids
from models import DataType, ValueSource, TextInputType, LogicalOperator, CompareOperator
from utils import verify_document_set_access
# Импортируем функцию перевода
from core.i18n import t 

router = APIRouter()

# ==================== SCHEMAS (DTOs) ====================

class SectionPayload(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    is_table: Optional[bool] = False

class AnswerItem(BaseModel):
    property_id: int
    row_index: int = 0
    value: Any

class PropertyPayload(BaseModel):
    section_id: Optional[int] = None
    name: str
    identifier: str
    data_type: DataType
    text_input_type: Optional[TextInputType] = TextInputType.SHORT
    options: Optional[List[str]] = []
    description: Optional[str] = None
    hint: Optional[str] = None
    placeholder: Optional[str] = None
    is_required: Optional[bool] = False
    hide_in_form: Optional[bool] = False
    sort_order: Optional[int] = None
    value_source: Optional[ValueSource] = ValueSource.USER_INPUT
    formula: Optional[str] = None
    format: Optional[str] = None
    default_value: Optional[str] = None
    display_condition_id: Optional[int] = None

# 🆕 НОВАЯ СХЕМА ДЛЯ КОРРЕКТНОГО ОТВЕТА НА ФРОНТЕНД
class PropertyResponse(BaseModel):
    # Разрешаем чтение данных напрямую из ORM-объектов SQLAlchemy
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    
    id: int
    document_set_id: int
    section_id: Optional[int] = None
    name: str
    identifier: str
    data_type: DataType
    text_input_type: Optional[TextInputType] = None
    # 🪄 МАГИЯ: validation_alias берет из ORM-поля options_json, 
    # но в JSON-ответе поле будет называться options (как ждет фронтенд)
    options: Optional[List[str]] = Field(default=None, validation_alias="options_json")
    description: Optional[str] = None
    hint: Optional[str] = None
    placeholder: Optional[str] = None
    is_required: bool
    hide_in_form: bool
    sort_order: int
    value_source: ValueSource
    formula: Optional[str] = None
    format: Optional[str] = None
    default_value: Optional[str] = None
    display_condition_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

class PropertyUpdatePayload(BaseModel):
    section_id: Optional[int] = None
    name: Optional[str] = None
    identifier: Optional[str] = None
    data_type: Optional[DataType] = None
    text_input_type: Optional[TextInputType] = None
    options: Optional[List[str]] = None
    description: Optional[str] = None
    hint: Optional[str] = None
    placeholder: Optional[str] = None
    is_required: Optional[bool] = None
    hide_in_form: Optional[bool] = None
    sort_order: Optional[int] = None
    value_source: Optional[ValueSource] = None
    formula: Optional[str] = None
    format: Optional[str] = None
    default_value: Optional[str] = None
    display_condition_id: Optional[int] = None

class ConditionPayload(BaseModel):
    section_id: Optional[int] = None
    name: str
    is_enabled_default: Optional[bool] = True
    sort_order: Optional[int] = None

class RuleGroupPayload(BaseModel):
    parent_group_id: Optional[int] = None
    logical_operator: Optional[LogicalOperator] = LogicalOperator.AND
    sort_order: Optional[int] = None

class RulePayload(BaseModel):
    group_id: int
    property_id: int
    operator: CompareOperator
    compare_value: Optional[str] = None
    sort_order: Optional[int] = None

# Переименовано для соответствия ConditionFormulationVariantPayload из types.ts
class ConditionFormulationVariantPayload(BaseModel):
    condition_id: Optional[int] = None
    formulation_id: Optional[int] = None
    formulation_version_id: Optional[int] = None
    is_fallback: Optional[bool] = False
    document_set_id: Optional[int] = None
    identifier: Optional[str] = None

# ==================== VARIANTS ====================

@router.post("/variants/unassigned")
async def add_unassigned_variant(data: ConditionFormulationVariantPayload, db: Session = Depends(get_db)):
    new_var = ConditionFormulationVariant(
        condition_id=data.condition_id,
        document_set_id=data.document_set_id,
        identifier=data.identifier or "unassigned",
        formulation_id=data.formulation_id,
        formulation_version_id=data.formulation_version_id,
        is_fallback=data.is_fallback if data.is_fallback is not None else True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_var)
    db.commit()
    db.refresh(new_var)
    return new_var

@router.get("/conditions/{cond_id}/variants")
async def get_condition_variants(cond_id: int, db: Session = Depends(get_db)):
    return db.query(ConditionFormulationVariant).filter(ConditionFormulationVariant.condition_id == cond_id).all()

@router.post("/conditions/{cond_id}/variants")
async def add_condition_variant(cond_id: int, data: ConditionFormulationVariantPayload, db: Session = Depends(get_db)):
    cond = db.get(QuestionnaireCondition, cond_id)
    if not cond:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.condition_not_found"))
    
    new_var = ConditionFormulationVariant(
        condition_id=cond_id, 
        document_set_id=data.document_set_id or cond.document_set_id,
        identifier=data.identifier or f"variant_{cond_id}", 
        formulation_id=data.formulation_id,
        formulation_version_id=data.formulation_version_id,
        is_fallback=data.is_fallback if data.is_fallback is not None else False,
        created_at=datetime.utcnow(), 
        updated_at=datetime.utcnow()
    )
    db.add(new_var)
    db.commit()
    db.refresh(new_var)
    return new_var

@router.patch("/variants/{variant_id}")
async def update_condition_variant(variant_id: int, data: ConditionFormulationVariantPayload, db: Session = Depends(get_db)):
    var = db.get(ConditionFormulationVariant, variant_id)
    if not var:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.variant_not_found"))
    
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(var, key, value)
    var.updated_at = datetime.utcnow()
    db.commit()
    return var

@router.delete("/variants/{variant_id}")
async def delete_condition_variant(variant_id: int, db: Session = Depends(get_db)):
    var = db.get(ConditionFormulationVariant, variant_id)
    if var:
        db.delete(var)
        db.commit()
    return {"status": "deleted"}

@router.get("/conditions/{cond_id}/variants/full-render")
async def get_condition_full_render_data(cond_id: int, db: Session = Depends(get_db)):
    condition = db.get(QuestionnaireCondition, cond_id)
    if not condition:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.condition_not_found"))
    
    groups = db.query(ConditionRuleGroup).filter(ConditionRuleGroup.condition_id == cond_id).all()
    group_ids = [g.id for g in groups]
    rules = db.query(ConditionRule).filter(ConditionRule.group_id.in_(group_ids)).all() if group_ids else []
    variants = db.query(ConditionFormulationVariant).filter(ConditionFormulationVariant.condition_id == cond_id).all()
    
    rendered_variants = []
    for v in variants:
        form_ver = db.get(FormulationVersion, v.formulation_version_id) if v.formulation_version_id else None
        if not form_ver and v.formulation_id:
            form_ver = db.query(FormulationVersion).filter(
                FormulationVersion.formulation_id == v.formulation_id,
                FormulationVersion.is_current == True
            ).first()
        form = db.get(Formulation, v.formulation_id)
        
        rendered_variants.append({
            "id": v.id,
            "condition_id": v.condition_id,
            "formulation_id": v.formulation_id,
            "formulation_version_id": v.formulation_version_id,
            "is_fallback": v.is_fallback,
            "document_set_id": v.document_set_id,
            "identifier": v.identifier,
            "resolved_text": form_ver.text_content if form_ver else t("questionnaire.messages.version_not_found"),
            "formulation_name": form.name if form else t("questionnaire.messages.unknown_formulation")
        })
        
    return {
        "condition": condition,
        "groups": groups,
        "rules": rules,
        "variants": rendered_variants
    }

# ==================== CONDITION LOGIC (GROUPS & RULES) ====================

@router.get("/conditions/{cond_id}/logic")
async def get_condition_logic(cond_id: int, db: Session = Depends(get_db)):
    groups = db.query(ConditionRuleGroup).filter(ConditionRuleGroup.condition_id == cond_id).all()
    group_ids = [g.id for g in groups]
    rules = db.query(ConditionRule).filter(ConditionRule.group_id.in_(group_ids)).all() if group_ids else []
    return {"groups": groups, "rules": rules}

@router.post("/conditions/{cond_id}/groups")
async def add_condition_rule_group(cond_id: int, data: RuleGroupPayload, db: Session = Depends(get_db)):
    new_group = ConditionRuleGroup(
        condition_id=cond_id, parent_group_id=data.parent_group_id,
        logical_operator=data.logical_operator, sort_order=data.sort_order or 1
    )
    db.add(new_group)
    db.commit()
    db.refresh(new_group)
    return new_group

@router.patch("/groups/{group_id}")
async def update_condition_rule_group(group_id: int, data: RuleGroupPayload, db: Session = Depends(get_db)):
    group = db.get(ConditionRuleGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.group_not_found"))
    
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(group, key, value)
    db.commit()
    return group

@router.delete("/groups/{group_id}")
async def delete_condition_rule_group(group_id: int, db: Session = Depends(get_db)):
    group = db.get(ConditionRuleGroup, group_id)
    if group:
        db.delete(group)
        db.commit()
    return {"status": "deleted"}

@router.post("/conditions/{cond_id}/rules")
async def add_condition_rule(cond_id: int, data: RulePayload, db: Session = Depends(get_db)):
    new_rule = ConditionRule(
        group_id=data.group_id, property_id=data.property_id,
        operator=data.operator, compare_value=data.compare_value, sort_order=data.sort_order or 1
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return new_rule

@router.patch("/rules/{rule_id}")
async def update_condition_rule(rule_id: int, data: RulePayload, db: Session = Depends(get_db)):
    rule = db.get(ConditionRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.rule_not_found"))
    
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(rule, key, value)
    db.commit()
    return rule

@router.delete("/rules/{rule_id}")
async def delete_condition_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(ConditionRule, rule_id)
    if rule:
        db.delete(rule)
        db.commit()
    return {"status": "deleted"}

# ==================== SECTIONS ====================

@router.patch("/sections/{section_id}")
async def update_section(section_id: int, data: SectionPayload, db: Session = Depends(get_db)):
    sec = db.get(QuestionnaireSection, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.section_not_found"))
    
    update_data = data.model_dump(exclude_unset=True) 
    for key, value in update_data.items():
        setattr(sec, key, value)
    sec.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(sec) 
    return sec

@router.delete("/sections/{section_id}")
async def delete_section(section_id: int, db: Session = Depends(get_db)):
    db.query(QuestionnaireProperty).filter(QuestionnaireProperty.section_id == section_id).update({"section_id": None})
    db.query(QuestionnaireCondition).filter(QuestionnaireCondition.section_id == section_id).update({"section_id": None})
    sec = db.get(QuestionnaireSection, section_id)
    if sec: 
        db.delete(sec)
        db.commit()
    return {"status": "deleted"}

@router.get("/{set_id}/sections")
async def get_sections(
    set_id: int,
    access_data: Tuple[DocumentSet, Optional[User]] = Depends(verify_document_set_access),
    db: Session = Depends(get_db)
):
    return db.query(QuestionnaireSection).filter(
        QuestionnaireSection.document_set_id == set_id
    ).order_by(QuestionnaireSection.sort_order).all()

@router.post("/{set_id}/sections")
async def add_section(set_id: int, data: SectionPayload, db: Session = Depends(get_db)):
    max_order = db.query(QuestionnaireSection).filter_by(document_set_id=set_id).count()
    new_sec = QuestionnaireSection(
        document_set_id=set_id,
        name=data.name,
        sort_order=data.sort_order or (max_order + 1),
        is_table=data.is_table,  # 🆕 НОВОЕ: Сохраняем признак таблицы
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_sec)
    db.commit()
    db.refresh(new_sec)
    return new_sec

# ==================== PROPERTIES ====================

# 🆕 ИСПРАВЛЕНО: добавлен response_model=List[PropertyResponse]
@router.get("/{set_id}/properties", response_model=List[PropertyResponse])
async def get_properties(
    set_id: int,
    access_data: Tuple[DocumentSet, Optional[User]] = Depends(verify_document_set_access),
    db: Session = Depends(get_db)
):
    return db.query(QuestionnaireProperty).filter(QuestionnaireProperty.document_set_id == set_id).all()

# 🆕 ИСПРАВЛЕНО: добавлен response_model и options_json=data.options
@router.post("/{set_id}/properties", response_model=PropertyResponse)
async def add_property(set_id: int, data: PropertyPayload, db: Session = Depends(get_db)):
    new_prop = QuestionnaireProperty(
        document_set_id=set_id, section_id=data.section_id, name=data.name, identifier=data.identifier,
        data_type=data.data_type, text_input_type=data.text_input_type,
        description=data.description, hint=data.hint, placeholder=data.placeholder,
        is_required=data.is_required, hide_in_form=data.hide_in_form,
        sort_order=data.sort_order or 1, value_source=data.value_source,
        formula=data.formula, format=data.format, default_value=data.default_value,
        display_condition_id=data.display_condition_id,
        options_json=data.options, # <--- СОХРАНЯЕМ options ИЗ DTO В options_json БД
        created_at=datetime.utcnow(), updated_at=datetime.utcnow()
    )
    db.add(new_prop)
    db.commit()
    db.refresh(new_prop)
    return new_prop

@router.patch("/{set_id}/properties/{prop_id}", response_model=PropertyResponse)
async def update_property(set_id: int, prop_id: int, data: PropertyUpdatePayload, db: Session = Depends(get_db)):
    prop = db.get(QuestionnaireProperty, prop_id)
    if not prop:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.property_not_found"))
    
    # exclude_unset=True гарантирует, что мы обновим только те поля, что реально пришли с фронта
    update_data = data.model_dump(exclude_unset=True)
    
    # Маппинг options -> options_json (остается как у вас было)
    if "options" in update_data:
        prop.options_json = update_data.pop("options")
        
    for key, value in update_data.items():
        setattr(prop, key, value)
    prop.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(prop) 
    return prop

@router.delete("/{set_id}/properties/{prop_id}")
async def delete_property(set_id: int, prop_id: int, db: Session = Depends(get_db)):
    prop = db.get(QuestionnaireProperty, prop_id)
    if prop:
        db.delete(prop)
        db.commit()
    return {"status": "deleted"}

# ==================== CONDITIONS ====================

@router.get("/{set_id}/conditions")
async def get_conditions(
    set_id: int,
    access_data: Tuple[DocumentSet, Optional[User]] = Depends(verify_document_set_access),
    db: Session = Depends(get_db)
):
    return db.query(QuestionnaireCondition).filter(
        QuestionnaireCondition.document_set_id == set_id
    ).order_by(QuestionnaireCondition.sort_order).all()

@router.post("/{set_id}/conditions")
async def add_condition(set_id: int, data: ConditionPayload, db: Session = Depends(get_db)):
    new_cond = QuestionnaireCondition(
        document_set_id=set_id, section_id=data.section_id, name=data.name,
        is_enabled_default=data.is_enabled_default, sort_order=data.sort_order or 1,
        created_at=datetime.utcnow()
    )
    db.add(new_cond)
    db.commit()
    db.refresh(new_cond)
    return new_cond

@router.patch("/{set_id}/conditions/{cond_id}")
async def update_condition(set_id: int, cond_id: int, data: ConditionPayload, db: Session = Depends(get_db)):
    cond = db.get(QuestionnaireCondition, cond_id)
    if not cond:
        raise HTTPException(status_code=404, detail=t("questionnaire.errors.condition_not_found"))
    
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(cond, key, value)
    db.commit()
    db.refresh(cond) 
    return cond

@router.delete("/{set_id}/conditions/{cond_id}")
async def delete_condition(set_id: int, cond_id: int, db: Session = Depends(get_db)):
    cond = db.get(QuestionnaireCondition, cond_id)
    if cond:
        db.delete(cond)
        db.commit()
    return {"status": "deleted"}

# ==================== ANSWERS ====================

@router.get("/{set_id}/answers")
async def get_answers(set_id: int, db: Session = Depends(get_db)):
    """Получение всех сохраненных ответов для комплекта документов"""
    answers = db.query(QuestionnaireAnswer).filter(
        QuestionnaireAnswer.document_set_id == set_id
    ).order_by(QuestionnaireAnswer.property_id, QuestionnaireAnswer.row_index).all()
    
    # 🆕 ИЗМЕНЕНО: Возвращаем список объектов вместо плоского словаря,
    # чтобы фронтенд мог корректно собрать табличные данные.
    result = []
    for ans in answers:
        # Определяем значение
        val = None
        if ans.value_text is not None:
            val = ans.value_text
        elif ans.value_number is not None:
            val = float(ans.value_number)
            if val.is_integer():
                val = int(val)
        elif ans.value_boolean is not None:
            val = ans.value_boolean
        elif ans.value_date is not None:
            val = str(ans.value_date)
            
        result.append({
            "property_id": ans.property_id,
            "row_index": ans.row_index,
            "value": val
        })
    return result

@router.post("/{set_id}/answers")
async def save_answers(
    set_id: int,
    data: List[AnswerItem],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 🆕 ШАГ 1: Полностью удаляем все старые ответы для этого document_set_id
    # Это гарантирует, что удаленные на фронте строки исчезнут и в базе
    db.query(QuestionnaireAnswer).filter(
        QuestionnaireAnswer.document_set_id == set_id
    ).delete()
    
    answers = []
    
    # 🆕 ШАГ 2: Вставляем только те ответы, которые сейчас актуальны на фронте
    for item in data:
        prop_id = item.property_id
        row_index = item.row_index
        value = item.value
        
        # Парсинг значения
        val_text = str(value) if isinstance(value, str) else None
        val_number = Decimal(str(value)) if isinstance(value, (int, float)) else None
        val_boolean = value if isinstance(value, bool) else None
        
        # Дату можно оставить в text, как у вас было, или добавить парсинг
        new_ans = QuestionnaireAnswer(
            document_set_id=set_id, 
            property_id=prop_id,
            row_index=row_index,
            value_text=val_text,
            value_number=val_number,
            value_boolean=val_boolean,
            answered_by=current_user.id, 
            answered_at=datetime.utcnow(),
            created_at=datetime.utcnow(), 
            updated_at=datetime.utcnow()
        )
        db.add(new_ans)
        answers.append(new_ans)
        
    db.commit()
    return {"status": "saved", "count": len(answers)}