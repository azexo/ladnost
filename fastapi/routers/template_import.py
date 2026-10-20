# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

# routers/template_import.py
"""
Роутер импорта шаблона документа из YAML-описания.
Возвращает подробные данные о созданных сущностях для генерации TipTap JSON.
"""
import yaml
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, Dict, List, Any
from datetime import datetime
from database import get_db
from models import (
    DocumentSet, Document, DocumentVersion,
    DocumentSetMode, ApprovalStatus, DocumentRole,
    QuestionnaireSection, QuestionnaireProperty,
    DataType, ValueSource, TextInputType,
    QuestionnaireCondition, ConditionRuleGroup, ConditionRule,
    LogicalOperator, CompareOperator,
    FormulationType, Formulation, FormulationVersion,
    ConditionFormulationVariant, User,
)
from utils import get_current_user
from core.i18n import t

logger = logging.getLogger(__name__)
router = APIRouter()

# =====================================================================
# PYDANTIC-МОДЕЛИ ДЛЯ ЗАПРОСА / ОТВЕТА
# =====================================================================

class TemplateImportRequest(BaseModel):
    """Тело запроса: YAML-строка + ID пользователя."""
    yaml_content: str
    markdown_body: str

# --- Модели для экспорта данных в TipTap ---

class SectionOut(BaseModel):
    """Данные секции для фронтенда."""
    id: int
    name: str
    is_table: bool = False

class PropertyOut(BaseModel):
    """Данные свойства для вставки в TipTap как переменная (Variable/Mention)."""
    id: int
    identifier: str       # Уникальный ключ для TipTap (например, {{contract_sum}})
    name: str             # Отображаемое имя
    data_type: str        # Тип данных (text, number, date и т.д.)
    section: Optional[str] = None
    default_value: Optional[Any] = None  # ИЗМЕНЕНО: Any вместо str, чтобы поддерживать числа (500), булевы и т.д.
    options: Optional[Any] = None        # Для списков (LIST)
    is_required: bool = False
    is_table: bool = False

class ConditionRuleOut(BaseModel):
    """Одно правило внутри группы."""
    property_identifier: str # Связь с PropertyOut.identifier
    operator: str            # "=", "!=", ">=" и т.д.
    compare_value: str

class ConditionGroupOut(BaseModel):
    """Группа правил (поддерживает рекурсию для вложенных AND/OR)."""
    operator: str            # "AND" или "OR"
    rules: List[ConditionRuleOut] = []
    groups: List["ConditionGroupOut"] = []

# Разрешаем рекурсию для Pydantic
try:
    ConditionGroupOut.model_rebuild()
except AttributeError:
    ConditionGroupOut.update_forward_refs()

class ConditionOut(BaseModel):
    """Условие целиком."""
    id: int
    name: str
    section: Optional[str] = None
    logic: Optional[ConditionGroupOut] = None

class FormulationOut(BaseModel):
    """Данные формулировки (текст для вставки)."""
    id: int
    name: str
    type: str
    text_content: str       # Сам текст, который пойдет в TipTap

class VariantOut(BaseModel):
    """Вариант привязки. identifier — это ключ для слота в TipTap."""
    id: int
    identifier: str         # Уникальный ID слота/блока в TipTap JSON
    condition_id: Optional[int] = None # Если null, то это fallback (всегда показывается)
    formulation: FormulationOut
    is_fallback: bool = False

class TemplateImportResponse(BaseModel):
    """Итоговый ответ эндпоинта."""
    status: str
    document_set_id: int
    document_id: int
    created: dict
    warnings: List[str] = []
    
    # === ДАННЫЕ ДЛЯ ГЕНЕРАЦИИ TAPTAP JSON ===
    sections: List[SectionOut] = []
    properties: List[PropertyOut] = []
    conditions: List[ConditionOut] = []
    variants: List[VariantOut] = []

# =====================================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =====================================================================

def _resolve_enum(enum_class, value: Any):
    """Приводит строку к значению enum, нечувствительно к регистру."""
    if value is None:
        return None
    val_stripped = str(value).strip()
    val_lower = val_stripped.lower()
    for member in enum_class:
        if member.value.strip().lower() == val_lower:
            return member
    val_upper = val_stripped.upper()
    try:
        return enum_class[val_upper]
    except KeyError:
        pass
    raise ValueError(
        t("template_import.errors.unknown_enum_value", 
          value=value, 
          enum_name=enum_class.__name__, 
          allowed_values=str([m.value for m in enum_class]))
    )

def _find_or_create_formulation_type(
    db: Session, type_name: str, user_id: int
) -> FormulationType:
    ft = db.query(FormulationType).filter(FormulationType.name == type_name).first()
    if ft:
        return ft
    max_sort = db.query(FormulationType).count()
    ft = FormulationType(name=type_name, sort_order=max_sort + 1, owner_id=user_id)
    db.add(ft)
    db.flush()
    return ft

def _find_or_create_formulation(
    db: Session, name: str, type_name: str, text_content: str, user_id: int
) -> dict:
    """
    Ищет/создает формулировку.
    Возвращает словарь с данными, нужными для TipTap и ответа API.
    """
    ft = _find_or_create_formulation_type(db, type_name, user_id)
    form = db.query(Formulation).filter(
        Formulation.name == name, Formulation.type_id == ft.id
    ).first()
    
    if form:
        prev_versions = db.query(FormulationVersion).filter(FormulationVersion.formulation_id == form.id).all()
        next_ver = max((v.version_number for v in prev_versions), default=0) + 1
        for v in prev_versions:
            v.is_current = False
        version = FormulationVersion(
            formulation_id=form.id, version_number=next_ver,
            text_content=text_content, is_current=True, author_id=user_id
        )
        db.add(version)
        db.flush()
        form.current_version_id = version.id
        form.updated_at = datetime.utcnow()
    else:
        form = Formulation(name=name, type_id=ft.id, is_favorite=False, created_by=user_id)
        db.add(form)
        db.flush()
        version = FormulationVersion(
            formulation_id=form.id, version_number=1,
            text_content=text_content, is_current=True, author_id=user_id
        )
        db.add(version)
        db.flush()
        form.current_version_id = version.id
        db.flush()
        
    # Возвращаем готовые данные для ответа
    return {
        "id": form.id,
        "version_id": version.id,
        "name": form.name,
        "type": ft.name,
        "text_content": version.text_content
    }

def _create_condition_logic(
    db: Session, condition_id: int, logic: dict,
    prop_identifier_to_id: Dict[str, int],
    created_counts: dict, warnings: list, cond_name: str,
    parent_group_id: Optional[int] = None, depth: int = 0
) -> Optional[dict]:
    """
    Создает логику в БД И возвращает JSON-структуру для фронтенда.
    """
    if depth > 10:
        warnings.append(t("template_import.warnings.condition_deep_nesting", name=cond_name))
        logger.warning(f"Условие '{cond_name}': превышена максимальная глубина вложенности логики.")
        return None

    operator_str = str(logic.get("operator", "AND")).strip()
    try:
        logical_op = _resolve_enum(LogicalOperator, operator_str)
    except ValueError:
        logical_op = LogicalOperator.AND
        warnings.append(t("template_import.warnings.condition_unknown_logical_operator", name=cond_name, operator=operator_str))
        logger.warning(f"Условие '{cond_name}': невалидный логический оператор '{operator_str}', fallback на AND")

    group = ConditionRuleGroup(
        condition_id=condition_id, parent_group_id=parent_group_id,
        logical_operator=logical_op, sort_order=1
    )
    db.add(group)
    db.flush()
    created_counts["rule_groups"] += 1

    # Структура для возврата в API
    result_group = {
        "operator": str(logical_op.value),
        "rules": [],
        "groups": []
    }

    for rule_idx, rule_data in enumerate(logic.get("rules", [])):
        prop_identifier = str(rule_data.get("property", "")).strip()
        db_prop_id = prop_identifier_to_id.get(prop_identifier)
        if not db_prop_id:
            warnings.append(t("template_import.warnings.condition_property_not_found", name=cond_name, property=prop_identifier))
            continue
            
        op_str = str(rule_data.get("compare_operator", "=")).strip()
        try:
            compare_op = _resolve_enum(CompareOperator, op_str)
        except ValueError:
            compare_op = CompareOperator.EQ
            warnings.append(t("template_import.warnings.condition_unknown_compare_operator", name=cond_name, operator=op_str))
            
        compare_value = str(rule_data.get("compare_value", ""))
        sort_order = int(rule_data.get("sort_order", rule_idx + 1))
        
        rule = ConditionRule(
            group_id=group.id, property_id=db_prop_id, operator=compare_op,
            compare_value=compare_value,
            sort_order=sort_order
        )
        db.add(rule)
        db.flush()
        created_counts["rules"] += 1

        # Добавляем правило в возвращаемую структуру
        result_group["rules"].append({
            "property_identifier": str(prop_identifier),
            "operator": str(compare_op.value),
            "compare_value": str(compare_value)
        })

    for sub_logic in logic.get("groups", []):
        sub_group = _create_condition_logic(
            db, condition_id, sub_logic, prop_identifier_to_id,
            created_counts, warnings, cond_name,
            parent_group_id=group.id, depth=depth + 1
        )
        if sub_group:
            result_group["groups"].append(sub_group)

    return result_group

# =====================================================================
# ОСНОВНОЙ ENDPOINT: ИМПОРТ ИЗ YAML-СТРОКИ
# =====================================================================

@router.post("/import", response_model=TemplateImportResponse)
async def import_template(
    req: TemplateImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id
    logger.info(f"Начало импорта шаблона. User ID: {user_id}")
    
    warnings: List[str] = []
    created_counts = {
        "sections": 0, "properties": 0, "conditions": 0,
        "rule_groups": 0, "rules": 0, "formulations": 0, "variants": 0
    }

    # Контейнеры для сбора данных в ответ (для генерации TipTap JSON на фронте)
    sections_out: List[SectionOut] = []
    properties_out: List[PropertyOut] = []
    conditions_out: List[ConditionOut] = []
    variants_out: List[VariantOut] = []

    # 1. ПАРСИМ YAML
    try:
        data = yaml.safe_load(req.yaml_content)
        logger.info("YAML успешно распарсен.")
    except yaml.YAMLError as e:
        logger.error(f"Ошибка парсинга YAML от пользователя {user_id}: {e}")
        raise HTTPException(status_code=400, detail=t("template_import.errors.yaml_parse_error", error=str(e)))

    if not data or not isinstance(data, dict):
        logger.error("YAML пуст или имеет неверную структуру (не словарь).")
        raise HTTPException(status_code=400, detail=t("template_import.errors.yaml_empty_or_invalid_structure"))

    metadata = data.get("template_metadata", {})
    entities = data.get("entities", {})

    if not metadata.get("name"):
        logger.error("Отсутствует обязательное поле template_metadata.name в YAML.")
        raise HTTPException(status_code=400, detail=t("template_import.errors.metadata_name_required"))

    # 2. СОЗДАЁМ DocumentSet
    doc_set = DocumentSet(
        name=str(metadata["name"]), mode=DocumentSetMode.TEMPLATE, 
        is_questionnaire_enabled=True, approval_status=ApprovalStatus.DRAFT, 
        owner_id=user_id, is_favorite=False, is_deleted=False
    )
    db.add(doc_set); db.flush()
    logger.info(f"Создан DocumentSet ID: {doc_set.id}, Name: '{doc_set.name}'")

    # 3. СОЗДАЁМ Document + DocumentVersion
    doc = Document(
        document_set_id=doc_set.id, name=str(metadata.get("document_name", metadata["name"])), 
        document_role=DocumentRole.MAIN, sort_order=1
    )
    db.add(doc); db.flush()
    
    document_body = req.markdown_body
    empty_json = {"type": "doc", "content": [{"type": "paragraph"}]}
    doc_version = DocumentVersion(
        document_id=doc.id, version_number=1, content_json=empty_json, 
        content_html=document_body or None, plain_text_cache=document_body or None, 
        is_current=True, author_id=user_id
    )
    db.add(doc_version); db.flush()
    logger.info(f"Создан Document ID: {doc.id} и DocumentVersion ID: {doc_version.id}")

    # 4. СЕКЦИИ (✅ ОБНОВЛЕНО: Парсинг флага is_table)
    section_names_ordered: List[str] = []
    def _add_section_name(name: Any):
        name = str(name).strip()
        if name and name not in section_names_ordered: 
            section_names_ordered.append(name)

    # Собираем имена секций из всех сущностей
    for sec in entities.get("sections", []): _add_section_name(sec.get("name", ""))
    for prop in entities.get("properties", []): _add_section_name(prop.get("section", ""))
    for cond in entities.get("conditions", []): _add_section_name(cond.get("section", ""))

    # ✅ Собираем флаги is_table из явного описания секций в YAML
    yaml_sections = entities.get("sections", [])
    yaml_section_is_table = {
        str(s.get("name", "")).strip(): bool(s.get("is_table", False)) 
        for s in yaml_sections if s.get("name")
    }

    section_name_to_id: Dict[str, int] = {}
    section_name_to_is_table: Dict[str, bool] = {}
    for idx, sec_name in enumerate(section_names_ordered):
        is_table = yaml_section_is_table.get(sec_name, False)
        section = QuestionnaireSection(
            document_set_id=doc_set.id, 
            name=sec_name, 
            is_table=is_table,  # ✅ Сохраняем флаг в БД
            sort_order=idx + 1
        )
        db.add(section); db.flush()
        section_name_to_id[sec_name] = section.id
        section_name_to_is_table[sec_name] = is_table
        created_counts["sections"] += 1
        
        # ✅ Добавляем в ответ для фронтенда
        sections_out.append(SectionOut(id=section.id, name=sec_name, is_table=is_table))
    logger.info(f"Создано секций: {created_counts['sections']}")

    # 5. СВОЙСТВА (✅ ОБНОВЛЕНО: Определение колонок таблиц)
    prop_identifier_to_id: Dict[str, int] = {}
    yaml_properties = entities.get("properties", [])
    for idx, prop_data in enumerate(yaml_properties):
        identifier = str(prop_data.get("identifier", "")).strip()
        if not identifier:
            warnings.append(t("template_import.warnings.property_missing_identifier", index=idx + 1)); continue
        if identifier in prop_identifier_to_id:
            warnings.append(t("template_import.warnings.property_duplicate", identifier=identifier)); continue
            
        sec_name = str(prop_data.get("section", "")).strip()
        section_id = section_name_to_id.get(sec_name) if sec_name else None
        
        # ✅ Определяем, является ли свойство колонкой таблицы (на основе секции)
        is_table_col = section_name_to_is_table.get(sec_name, False)
        
        try: 
            data_type = _resolve_enum(DataType, str(prop_data.get("data_type", "TEXT")))
        except ValueError: 
            data_type = DataType.TEXT
            warnings.append(t("template_import.warnings.property_invalid_data_type", identifier=identifier))
            
        try: 
            value_source = _resolve_enum(ValueSource, str(prop_data.get("value_source", "USER_INPUT")))
        except ValueError: 
            value_source = ValueSource.USER_INPUT
            
        text_input_type = None
        if prop_data.get("text_input_type"):
            try: 
                text_input_type = _resolve_enum(TextInputType, str(prop_data["text_input_type"]))
            except ValueError: 
                text_input_type = TextInputType.SHORT

        # Явное приведение типов для полей БД
        is_required = bool(prop_data.get("is_required", False))
        hide_in_form = bool(prop_data.get("hide_in_form", False))
        sort_order = int(prop_data.get("sort_order", idx + 1))
        
        prop = QuestionnaireProperty(
            document_set_id=doc_set.id, section_id=section_id, name=str(prop_data.get("name", identifier)),
            identifier=identifier, data_type=data_type, text_input_type=text_input_type,
            options_json=prop_data.get("options"), 
            description=str(prop_data.get("description")) if prop_data.get("description") else None,
            hint=str(prop_data.get("hint")) if prop_data.get("hint") else None, 
            placeholder=str(prop_data.get("placeholder")) if prop_data.get("placeholder") else None,
            is_required=is_required, hide_in_form=hide_in_form,
            sort_order=sort_order, value_source=value_source,
            formula=str(prop_data.get("formula")) if prop_data.get("formula") else None, 
            default_value=prop_data.get("default_value"), 
            format=str(prop_data.get("format")) if prop_data.get("format") else None, 
            display_condition_id=None
        )
        db.add(prop); db.flush()
        prop_identifier_to_id[identifier] = prop.id
        created_counts["properties"] += 1
        
        # === СБОР ДАННЫХ ДЛЯ ОТВЕТА ===
        properties_out.append(PropertyOut(
            id=int(prop.id), 
            identifier=str(identifier), 
            name=str(prop.name),
            data_type=str(data_type.value), 
            section=str(sec_name) if sec_name else None,
            default_value=prop.default_value, 
            options=prop.options_json,
            is_required=bool(prop.is_required),
            is_table=is_table_col  # ✅ Передаем флаг на фронтенд
        ))
    logger.info(f"Создано свойств: {created_counts['properties']}")

    # 6. УСЛОВИЯ (СБОР ЛОГИКИ ДЛЯ TAPTAP)
    cond_yaml_id_to_db_id: Dict[str, int] = {}
    yaml_conditions = entities.get("conditions", [])
    for idx, cond_data in enumerate(yaml_conditions):
        cond_yaml_id = str(cond_data.get("id", f"cond_{idx + 1}")).strip()
        cond_name = str(cond_data.get("name", cond_yaml_id)).strip()
        if cond_yaml_id in cond_yaml_id_to_db_id:
            warnings.append(t("template_import.warnings.condition_duplicate", id=cond_yaml_id)); continue
            
        sec_name = str(cond_data.get("section", "")).strip()
        section_id = section_name_to_id.get(sec_name) if sec_name else None
        is_enabled_default = bool(cond_data.get("is_enabled_default", True))
        sort_order = int(cond_data.get("sort_order", idx + 1))
        
        condition = QuestionnaireCondition(
            document_set_id=doc_set.id, section_id=section_id, name=cond_name,
            is_enabled_default=is_enabled_default,
            sort_order=sort_order
        )
        db.add(condition); db.flush()
        cond_yaml_id_to_db_id[cond_yaml_id] = condition.id
        created_counts["conditions"] += 1
        
        logic_dict = None
        logic = cond_data.get("logic")
        if logic and isinstance(logic, dict):
            logic_dict = _create_condition_logic(
                db=db, condition_id=condition.id, logic=logic,
                prop_identifier_to_id=prop_identifier_to_id,
                created_counts=created_counts, warnings=warnings, cond_name=cond_name
            )
            
        # === СБОР ДАННЫХ ДЛЯ ОТВЕТА ===
        conditions_out.append(ConditionOut(
            id=int(condition.id), 
            name=str(cond_name), 
            section=str(sec_name) if sec_name else None, 
            logic=logic_dict
        ))
    logger.info(f"Создано условий: {created_counts['conditions']}, групп правил: {created_counts['rule_groups']}, самих правил: {created_counts['rules']}")

    # 6.1. ПОСТ-ОБРАБОТКА: display_condition_id
    for prop_data in yaml_properties:
        identifier = str(prop_data.get("identifier", "")).strip()
        display_cond_key = prop_data.get("display_condition_id")
        if not identifier or not display_cond_key: continue
        db_cond_id = cond_yaml_id_to_db_id.get(str(display_cond_key))
        db_prop_id = prop_identifier_to_id.get(identifier)
        if db_cond_id and db_prop_id:
            prop_obj = db.query(QuestionnaireProperty).get(db_prop_id)
            if prop_obj: 
                prop_obj.display_condition_id = db_cond_id
                db.flush()

    # 7. ФОРМУЛИРОВКИ (СБОР ТЕКСТОВ)
    form_yaml_id_to_db: Dict[str, dict] = {} 
    yaml_formulations = entities.get("formulations", [])
    for form_data in yaml_formulations:
        form_yaml_id = str(form_data.get("id", "")).strip()
        form_name = str(form_data.get("name", "")).strip()
        form_type = str(form_data.get("type", "Стандартные")).strip()
        form_text = str(form_data.get("text", "")).strip()
        
        if not form_name:
            warnings.append(t("template_import.warnings.formulation_missing_name", id=form_yaml_id)); continue
        if form_yaml_id in form_yaml_id_to_db:
            warnings.append(t("template_import.warnings.formulation_duplicate", id=form_yaml_id)); continue
            
        try:
            form_data_dict = _find_or_create_formulation(db, form_name, form_type, form_text, user_id)
            form_yaml_id_to_db[form_yaml_id] = form_data_dict
            created_counts["formulations"] += 1
        except Exception as e:
            logger.exception(f"Ошибка создания формулировки '{form_name}'")
            warnings.append(t("template_import.errors.formulation_creation_error", name=form_name, error=str(e)))
    logger.info(f"Обработано формулировок: {created_counts['formulations']}")

    # 8. ВАРИАНТЫ ПРИВЯЗКИ (СБОР СЛОТОВ ДЛЯ TAPTAP)
    yaml_variants = entities.get("variants", [])
    for var_data in yaml_variants:
        var_identifier = str(var_data.get("identifier", "")).strip()
        if not var_identifier:
            warnings.append(t("template_import.warnings.variant_missing_identifier")); continue
            
        cond_yaml_key = var_data.get("condition_id")
        db_condition_id = None
        if cond_yaml_key is not None:
            db_condition_id = cond_yaml_id_to_db_id.get(str(cond_yaml_key))
            if db_condition_id is None:
                warnings.append(t("template_import.warnings.variant_condition_not_found", identifier=var_identifier, condition_id=cond_yaml_key))
                
        form_yaml_key = str(var_data.get("formulation_id", "")).strip()
        form_db_info = form_yaml_id_to_db.get(form_yaml_key)
        if not form_db_info:
            warnings.append(t("template_import.warnings.variant_formulation_not_found", identifier=var_identifier, formulation_id=form_yaml_key)); continue
            
        is_fallback = bool(var_data.get("is_fallback", False))
        variant = ConditionFormulationVariant(
            condition_id=db_condition_id, formulation_id=form_db_info["id"],
            formulation_version_id=form_db_info["version_id"],
            is_fallback=is_fallback,
            document_set_id=doc_set.id, identifier=var_identifier
        )
        db.add(variant); db.flush()
        created_counts["variants"] += 1
        
        # === СБОР ДАННЫХ ДЛЯ ОТВЕТА ===
        variants_out.append(VariantOut(
            id=int(variant.id), 
            identifier=str(var_identifier),
            condition_id=int(db_condition_id) if db_condition_id is not None else None,
            formulation=FormulationOut(
                id=int(form_db_info["id"]), 
                name=str(form_db_info["name"]),
                type=str(form_db_info["type"]), 
                text_content=str(form_db_info["text_content"])
            ),
            is_fallback=bool(variant.is_fallback)
        ))
    logger.info(f"Создано вариантов привязки: {created_counts['variants']}")

    # 9. КОММИТ И ОТВЕТ
    try:
        db.commit()
        logger.info(f"Транзакция успешно закоммичена для DocumentSet ID: {doc_set.id}")
    except Exception as e:
        db.rollback()
        logger.exception(f"Ошибка коммита при импорте шаблона (User ID: {user_id})")
        raise HTTPException(status_code=500, detail=t("template_import.errors.db_commit_error", error=str(e)))

    # Логирование предупреждений
    if warnings:
        logger.warning(f"Импорт шаблона (DocSet ID: {doc_set.id}) завершен с {len(warnings)} предупреждениями: {warnings}")
    else:
        logger.info(f"Импорт шаблона (DocSet ID: {doc_set.id}) завершен без предупреждений.")
        
    logger.info(f"Итоговая статистика создания для DocSet ID {doc_set.id}: {created_counts}")

    return TemplateImportResponse(
        status="success",
        document_set_id=int(doc_set.id),
        document_id=int(doc.id),
        created=created_counts,
        warnings=[str(w) for w in warnings],
        sections=sections_out,       # ✅ НОВОЕ: Возвращаем секции с флагом is_table
        properties=properties_out,
        conditions=conditions_out,
        variants=variants_out
    )

# =====================================================================
# ДОПОЛНИТЕЛЬНЫЙ ENDPOINT: ИМПОРТ ИЗ ЗАГРУЖЕННОГО ФАЙЛА
# =====================================================================

@router.post("/import-file", response_model=TemplateImportResponse)
async def import_template_from_file(
    file: UploadFile = File(..., description="YAML-файл шаблона"),
    current_user: User = Depends(get_current_user), # Исправлено для корректной передачи пользователя
    db: Session = Depends(get_db),
):
    user_id = current_user.id
    logger.info(f"Попытка импорта шаблона из файла: '{file.filename}'. User ID: {user_id}")
    
    if not file.filename or not file.filename.endswith((".yaml", ".yml")):
        logger.warning(f"Отказ в загрузке файла '{file.filename}': неверное расширение.")
        raise HTTPException(status_code=400, detail=t("template_import.errors.file_invalid_extension"))
        
    try:
        content = await file.read()
        yaml_content = content.decode("utf-8")
        logger.info(f"Файл '{file.filename}' успешно прочитан. Размер содержимого: {len(yaml_content)} символов.")
    except Exception as e:
        logger.error(f"Не удалось прочитать файл '{file.filename}': {e}")
        raise HTTPException(status_code=400, detail=t("template_import.errors.file_read_error", error=str(e)))

    req = TemplateImportRequest(yaml_content=yaml_content, markdown_body="") 
    return await import_template(req, current_user=current_user, db=db)