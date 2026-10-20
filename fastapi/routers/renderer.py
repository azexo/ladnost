# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import re
import copy
import logging
import sys
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import (
    DataType, QuestionnaireProperty, QuestionnaireAnswer, QuestionnaireSection,
    Formulation, FormulationVersion, ConditionFormulationVariant,
    QuestionnaireCondition, ConditionRuleGroup, ConditionRule,
    Document, DocumentVersion, DocumentRole
)
from database import get_db
from core.hooks import hooks
from core.i18n import t  # 🆕 Импортируем функцию перевода

router = APIRouter()

# ==========================================
# НАСТРОЙКА ЛОГГЕРА (ТОЛЬКО ВАЖНОЕ)
# ==========================================
logger = logging.getLogger("renderer_trace")
logger.setLevel(logging.INFO) # Оставлен INFO, чтобы не засорять консоль
if not logger.handlers:
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%H:%M:%S')
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

# Маркер для скрытия блоков, где не сработали условия
HIDDEN_SLOT_MARKER = "HIDDEN_SLOT"

# ==========================================
# 1. УТИЛИТЫ: ФОРМУЛЫ И ФОРМАТИРОВАНИЕ
# ==========================================
def safe_eval_formula(formula: str, context: Dict[str, Any]) -> Any:
    if not formula: return ""
    if '{value}' in formula:
        val = context.get('value', 0)
        val_str = f'"{val}"' if isinstance(val, str) else str(val)
        formula = formula.replace('{value}', val_str)
        processed_formula = re.sub(r'{([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)}', r'\1', formula)
    else:
        processed_formula = formula
        
    hook_payload = {"formula": processed_formula, "context": context}
    try:
        # Применяем фильтры. Плагин должен перехватить это и вернуть результат вычисления.
        result = hooks.apply_filters_sync("evaluate_formula", hook_payload)
        # Если хук не был обработан ни одним плагином, apply_filters вернет исходный словарь.
        if isinstance(result, dict) and "formula" in result:
            logger.warning(f"⚠️ Хук 'evaluate_formula' не был обработан. Возвращаем исходную формулу.")
            return processed_formula
        return result if result is not None else ""
    except Exception as e:
        logger.error(f"❌ Ошибка в формуле '{processed_formula}': {e}")
        return processed_formula

# 🆕 ХЕЛПЕР: Форматирование чисел с разделителями тысяч (пробелами)
def format_number_with_spaces(val: Any) -> str:
    if val is None or val == "": return ""
    try:
        if isinstance(val, str):
            val = val.replace(" ", "").replace(",", ".")
        num = float(val)
        if num.is_integer():
            # Для целых чисел: 1000 -> 1 000
            return f"{int(num):,}".replace(",", " ")
        else:
            # Для дробных: 1234567.89 -> 1 234 567,89
            formatted = f"{num:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ")
            # Убираем лишние нули в конце (например, 1 000,50 -> 1 000,5)
            if ',' in formatted:
                formatted = formatted.rstrip('0').rstrip(',')
            return formatted
    except (ValueError, TypeError):
        return str(val)

def resolve_formulation_template(template: str, context: Dict[str, Any], properties_map: Dict[int, Any]) -> str:
    if not template: return ""
    def replace_placeholder(match):
        identifier = match.group(1).strip()
        prop = next((p for p in properties_map.values() if p.identifier == identifier), None)
        if not prop: return match.group(0)
        raw_value = context.get(identifier, "")
        if raw_value is None or raw_value == "": return ""
        # 🆕 Передаем data_type для корректного форматирования денег/чисел
        dt = getattr(prop, 'data_type', None)
        if hasattr(dt, 'value'): dt = dt.value
        return get_formatted_value(prop.format, raw_value, context, str(dt) if dt else None)
        
    pattern = r'{{\s*([a-zA-Z0-9_а-яёА-ЯЁ]+)\s*}}'
    return re.sub(pattern, replace_placeholder, template)

def get_formatted_value(prop_format: Optional[str], raw_value: Any, context: Dict[str, Any], data_type: Optional[str] = None) -> str:
    if raw_value is None: raw_value = ""
    
    # 🆕 Вложенная функция для применения форматирования денег/чисел
    def apply_money_format(val: Any) -> str:
        if data_type in (DataType.MONEY, DataType.NUMBER):
            return format_number_with_spaces(val)
        return str(val)

    if not prop_format: 
        return apply_money_format(raw_value)
        
    is_formula = bool(re.search(r'[A-ZА-ЯЁa-z_]+\s*\(', prop_format)) or bool(re.search(r'[-+*/^&]', prop_format))
    
    if '{value}' not in prop_format:
        if is_formula:
            try: 
                res = safe_eval_formula(prop_format, context)
                return apply_money_format(res)
            except Exception: pass
        return prop_format
        
    if is_formula:
        try: 
            res = safe_eval_formula(prop_format, {**context, 'value': raw_value})
            return apply_money_format(res)
        except Exception: 
            if data_type in (DataType.MONEY, DataType.NUMBER):
                return prop_format.replace('{value}', format_number_with_spaces(raw_value))
            return prop_format.replace('{value}', str(raw_value))
            
    if data_type in (DataType.MONEY, DataType.NUMBER):
        return prop_format.replace('{value}', format_number_with_spaces(raw_value))
        
    return prop_format.replace('{value}', str(raw_value))

# ==========================================
# 2. РЕКУРСИВНАЯ ПРОВЕРКА УСЛОВИЙ
# ==========================================
def evaluate_single_rule(rule: Any, context: Dict[str, Any], properties_map: Dict[int, Any]) -> bool:
    prop = properties_map.get(rule.property_id)
    if not prop: return False
    val = context.get(prop.identifier)
    
    op_val = rule.operator.value.strip() if hasattr(rule.operator, 'value') else str(rule.operator).strip()
    compare_val = str(rule.compare_value) if rule.compare_value is not None else ""
    str_val = str(val) if val is not None else ""
    result = True
    
    if op_val == "=" and str_val != compare_val: result = False
    elif op_val == "!=" and str_val == compare_val: result = False
    else:
        try:
            if op_val == ">" and not (float(str_val) > float(compare_val)): result = False
            elif op_val == "<" and not (float(str_val) < float(compare_val)): result = False
            elif op_val == ">=" and not (float(str_val) >= float(compare_val)): result = False
            elif op_val == "<=" and not (float(str_val) <= float(compare_val)): result = False
        except ValueError:
            if op_val in (">", "<", ">=", "<="): result = False
    return result

def evaluate_condition_tree(condition_id: int, context: Dict[str, Any], properties_map: Dict[int, Any], db: Session) -> bool:
    logger.debug(f"🌳 [CONDITION_TRACE] Начало оценки дерева condition_id={condition_id}")
    root_groups = db.query(ConditionRuleGroup).filter(
        ConditionRuleGroup.condition_id == condition_id,
        ConditionRuleGroup.parent_group_id == None
    ).order_by(ConditionRuleGroup.id).all()
    
    if not root_groups:
        logger.debug(f"✅ [CONDITION_TRACE] Дерево {condition_id} не имеет групп. Возвращаем True.")
        return True  
        
    def eval_group(group: Any) -> bool:
        results = []
        rules = db.query(ConditionRule).filter(ConditionRule.group_id == group.id).order_by(ConditionRule.id).all()
        for rule in rules:
            results.append(evaluate_single_rule(rule, context, properties_map))
            
        child_groups = db.query(ConditionRuleGroup).filter(ConditionRuleGroup.parent_group_id == group.id).order_by(ConditionRuleGroup.id).all()
        for child in child_groups:
            results.append(eval_group(child))
            
        if not results:
            return True  
            
        op_val = group.logical_operator.value.strip() if hasattr(group.logical_operator, 'value') else str(group.logical_operator).strip()
        if op_val == "AND":
            group_result = all(results)
        elif op_val == "OR":
            group_result = any(results)
        else:
            group_result = all(results) 
            
        logger.debug(f"🔗 [CONDITION_TRACE] Группа {group.id} (логика: {op_val}). Результаты вложенных проверок: {results} => {group_result}")
        return group_result
        
    final_result = all(eval_group(g) for g in root_groups)
    logger.debug(f"🏁 [CONDITION_TRACE] Итог дерева condition_id={condition_id}: {final_result}")
    return final_result

# ==========================================
# 3. ОБРАБОТКА TIPTAP JSON
# ==========================================
def _resolve_variant(variants: List[Any], identifier: str, context: Dict, properties_map: Dict, formulations_map: Dict, db: Session):
    """Универсальная функция подбора варианта формулировки"""
    selected_text = ""
    selected_variant_id = None
    for variant in variants:
        if not variant.condition_id:
            raw_text = formulations_map.get(variant.formulation_id, "")
            selected_text = resolve_formulation_template(raw_text, context, properties_map)
            selected_variant_id = variant.id
            break
        if evaluate_condition_tree(variant.condition_id, context, properties_map, db):
            raw_text = formulations_map.get(variant.formulation_id, "")
            selected_text = resolve_formulation_template(raw_text, context, properties_map)
            selected_variant_id = variant.id
            break
            
    # Если ни одно условие не подошло, ищем fallback
    if not selected_text:
        for variant in variants:
            if variant.is_fallback:
                raw_text = formulations_map.get(variant.formulation_id, "")
                selected_text = resolve_formulation_template(raw_text, context, properties_map)
                selected_variant_id = variant.id
                break
    return selected_text, selected_variant_id

def process_table_cells(cells: List[Dict], row_context: Dict, cols: List, properties_map: Dict[int, Any], formulations_map: Dict[int, str]) -> List[Dict]:
    new_cells = []
    for cell in cells:
        if "content" in cell:
            for paragraph in cell["content"]:
                if "content" in paragraph:
                    new_p_content = []
                    for p_node in paragraph["content"]:
                        if p_node.get("type") == "token":
                            attrs = p_node.get("attrs", {})
                            token_type = attrs.get("type")
                            source_id = attrs.get("sourceId")
                            source_id_str = str(source_id) if source_id is not None else ""
                            
                            if token_type == "formulation":
                                f_id = int(source_id_str) if source_id_str.isdigit() else source_id_str
                                raw_text = formulations_map.get(f_id, "")
                                resolved_text = resolve_formulation_template(raw_text, row_context, properties_map)
                                new_p_content.append({"type": "text", "text": resolved_text})
                            else:
                                col = next((c for c in cols if str(c.id) == source_id_str), None)
                                if col:
                                    raw_val = row_context.get(col.identifier, "")
                                    # 🆕 Передаем data_type колонки
                                    dt = getattr(col, 'data_type', None)
                                    if hasattr(dt, 'value'): dt = dt.value
                                    formatted_val = get_formatted_value(col.format, raw_val, row_context, str(dt) if dt else None)
                                    new_p_content.append({"type": "text", "text": formatted_val})
                                else:
                                    new_p_content.append(p_node)
                        else:
                            new_p_content.append(p_node)
                    paragraph["content"] = new_p_content
        new_cells.append(cell)
    return new_cells

def process_tiptap_json(
    node: Dict[str, Any], context: Dict[str, Any], table_data: Dict[int, List[Dict]],
    section_columns: Dict[int, List[Any]], formulations_map: Dict[int, str],
    variants_map: Dict[str, List[Any]], properties_map: Dict[int, Any], db: Session
) -> List[Dict[str, Any]]:
    node_type = node.get("type")
    
    # Инжекция таблиц
    if node_type == "tableRow" and node.get("attrs", {}).get("isInjected"):
        return []
        
    if node_type == "tableRow" and node.get("attrs", {}).get("isTemplate"):
        section_id = node["attrs"].get("sectionId")
        rows = table_data.get(section_id, [])
        cols = section_columns.get(section_id, [])
        if not rows or not cols: return []
        
        generated_rows = []
        for row_data in rows:
            new_row = copy.deepcopy(node)
            new_row["attrs"]["isInjected"] = True
            new_row["attrs"]["isTemplate"] = False
            row_context = {**context}
            for col in cols:
                val = row_data.get("cells", {}).get(str(col.id))
                if val is not None:
                    if hasattr(col, 'data_type') and col.data_type in (DataType.NUMBER, DataType.MONEY):
                        if isinstance(val, str):
                            try: val = float(val.replace(',', '.'))
                            except ValueError: pass
                    row_context[col.identifier] = val
                    
            for _ in range(5): 
                changed = False
                for col in cols:
                    if col.value_source.value.strip() == "formula" and col.formula:
                        new_val = safe_eval_formula(col.formula, row_context)
                        if str(new_val) != str(row_context.get(col.identifier)):
                            row_context[col.identifier] = new_val
                            changed = True
                if not changed: break
                
            if "content" in new_row:
                new_row["content"] = process_table_cells(new_row["content"], row_context, cols, properties_map, formulations_map)
            generated_rows.append(new_row)
        return generated_rows
        
    # Обработка Токенов
    if node_type == "token":
        attrs = node.get("attrs", {})
        token_type = attrs.get("type")
        identifier = attrs.get("identifier")
        if token_type == "property":
            prop = next((p for p in properties_map.values() if p.identifier == identifier), None)
            raw_val = context.get(identifier, attrs.get("value", ""))
            # 🆕 Передаем data_type свойства
            if prop:
                dt = getattr(prop, 'data_type', None)
                if hasattr(dt, 'value'): dt = dt.value
                val = get_formatted_value(prop.format, raw_val, context, str(dt) if dt else None)
            else:
                val = raw_val
            return [{"type": "text", "text": str(val)}]
            
        elif token_type == "formulation":
            source_id = attrs.get("sourceId")
            variants = variants_map.get(identifier, [])
            if variants:
                selected_text, selected_variant_id = _resolve_variant(variants, identifier, context, properties_map, formulations_map, db)
                if selected_text:
                    logger.info(f"✅ [TOKEN] '{identifier}' -> выбран вариант {selected_variant_id}")
                    return [{"type": "text", "text": selected_text}]
                else:
                    logger.info(f"🙈 [TOKEN] '{identifier}' -> условия не выполнены, fallback отсутствует. Скрываем.")
                    return [{"type": HIDDEN_SLOT_MARKER}]
            else:
                f_id = int(source_id) if str(source_id).isdigit() else source_id
                raw_text = formulations_map.get(f_id, "")
                resolved_text = resolve_formulation_template(raw_text, context, properties_map)
                return [{"type": "text", "text": resolved_text}]
        return [{"type": "text", "text": str(attrs.get("value", ""))}]
        
    # Обработка Слотов (FormulationSlot)
    if node_type == "formulationSlot":
        identifier = node.get("attrs", {}).get("identifier")
        variants = variants_map.get(identifier, [])
        if variants:
            selected_text, selected_variant_id = _resolve_variant(variants, identifier, context, properties_map, formulations_map, db)
            if selected_text:
                logger.info(f"✅ [SLOT] '{identifier}' -> выбран вариант {selected_variant_id}")
                return [{"type": "text", "text": selected_text}]
            else:
                logger.info(f"🙈 [SLOT] '{identifier}' -> условия не выполнены, fallback отсутствует. Скрываем.")
                return [{"type": HIDDEN_SLOT_MARKER}]
        return [{"type": "text", "text": ""}]
        
    # --- РЕКУРСИЯ И СКРЫТИЕ БЛОЧНЫХ ЭЛЕМЕНТОВ ---
    if "content" in node and isinstance(node["content"], list):
        new_content = []
        has_hidden_slot = False
        for child in node["content"]:
            res = process_tiptap_json(child, context, table_data, section_columns, formulations_map, variants_map, properties_map, db)
            for item in res:
                if item.get("type") == HIDDEN_SLOT_MARKER:
                    has_hidden_slot = True
                else:
                    new_content.append(item)
                    
        block_level_types = {"paragraph", "legalPoint", "heading", "listItem", "blockquote"}
        if has_hidden_slot and node_type in block_level_types:
            logger.info(f"🙈 [HIDE] Блок '{node_type}' полностью удален из-за скрытого слота внутри.")
            return [] 
            
        node["content"] = new_content
    return [node]

# ==========================================
# 3.5 ПЕРЕРАСЧЕТ НУМЕРАЦИИ ПУНКТОВ (Аналог LegalNumberingPlugin)
# ==========================================
def recalculate_legal_numbers(node: Dict[str, Any], counters: List[int], number_map: Dict[str, str]):
    """
    Рекурсивно обходит JSON-дерево и пересчитывает номера пунктов (legalPoint)
    и текст ссылок (clauseRef) на основе их видимости и уровня вложенности.
    """
    node_type = node.get("type")
    attrs = node.get("attrs", {})
    
    # 1. Обработка legalPoint
    if node_type == "legalPoint":
        is_visible = attrs.get("isVisible", True)
        level = attrs.get("level", 1) - 1
        if is_visible and 0 <= level < len(counters):
            counters[level] += 1
            for i in range(level + 1, len(counters)):
                counters[i] = 0
            num_str = ".".join(str(c) for c in counters[:level + 1])
            attrs["number"] = num_str
            uuid = attrs.get("uuid")
            if uuid:
                number_map[uuid] = num_str
                
    # 2. Обработка clauseRef (перекрестных ссылок)
    elif node_type == "clauseRef":
        target_uuid = attrs.get("targetUuid")
        actual_number = number_map.get(target_uuid)
        if actual_number:
            # 🆕 Используем i18n с передачей аргумента number
            attrs["displayText"] = t("renderer.ui.clause_text", number=actual_number)
        else:
            # 🆕 Используем i18n для фоллбэка
            attrs["displayText"] = t("renderer.ui.clause_hidden_or_deleted")
            
    # 3. Рекурсивный обход дочерних элементов
    if "content" in node and isinstance(node["content"], list):
        for child in node["content"]:
            recalculate_legal_numbers(child, counters, number_map)

# ==========================================
# 4. ГЕНЕРАЦИЯ HTML ИЗ JSON
# ==========================================
def json_to_html(node: Dict[str, Any]) -> str:
    node_type = node.get("type")
    if node_type == HIDDEN_SLOT_MARKER: return ""
    
    content = node.get("content", [])
    attrs = node.get("attrs", {})
    marks = node.get("marks", [])
    
    if node_type == "doc":
        return "".join(json_to_html(c) for c in content)
        
    if node_type == "legalPoint":
        if attrs.get("isVisible") is False: return ""
        number = attrs.get("number", "")
        return f"{number}. " if number else ""
        
    if node_type == "clauseRef":
        # 🆕 Используем i18n для фоллбэка
        return attrs.get("displayText", t("renderer.ui.clause_ref_fallback"))
        
    if node_type == "text":
        text = node.get("text", "")
        mark_types = [m.get("type") for m in marks]
        if "trackDelete" in mark_types: return "" 
        
        text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        for mark in marks:
            m_type = mark.get("type")
            if m_type == "bold": text = f"<strong>{text}</strong>"
            elif m_type == "italic": text = f"<em>{text}</em>"
            elif m_type == "underline": text = f"<u>{text}</u>"
            elif m_type == "strike": text = f"<s>{text}</s>"
            elif m_type == "code": text = f"<code>{text}</code>"
        return text
        
    if node_type == "paragraph":
        if attrs.get("isVisible") is False: return ""
        inner = "".join(json_to_html(c) for c in content)
        return f"<p>{inner}</p>"
        
    if node_type == "heading":
        level = attrs.get("level", 1)
        inner = "".join(json_to_html(c) for c in content)
        return f"<h{level}>{inner}</h{level}>"
        
    if node_type == "table":
        inner = "".join(json_to_html(c) for c in content)
        return f"<table style='border-collapse: collapse; width: 100%;'>{inner}</table>"
        
    if node_type == "tableRow":
        inner = "".join(json_to_html(c) for c in content)
        return f"<tr>{inner}</tr>"
        
    if node_type in ("tableCell", "tableHeader"):
        inner = "".join(json_to_html(c) for c in content)
        tag = "th" if node_type == "tableHeader" else "td"
        is_bordered = attrs.get("bordered", False)
        style = "border: 1px solid #ccc; padding: 6px;" if is_bordered else "border: none; padding: 6px;"
        return f"<{tag} style='{style}'>{inner}</{tag}>"
        
    if node_type == "bulletList":
        return f"<ul>{''.join(json_to_html(c) for c in content)}</ul>"
        
    if node_type == "orderedList":
        return f"<ol>{''.join(json_to_html(c) for c in content)}</ol>"
        
    if node_type == "listItem":
        return f"<li>{''.join(json_to_html(c) for c in content)}</li>"
        
    if node_type == "blockquote":
        return f"<blockquote>{''.join(json_to_html(c) for c in content)}</blockquote>"
        
    if node_type == "codeBlock":
        return f"<pre><code>{''.join(json_to_html(c) for c in content)}</code></pre>"
        
    if node_type == "horizontalRule":
        return "<hr>"
        
    if node_type == "token":
        return str(attrs.get("value", attrs.get("label", "")))
        
    return "".join(json_to_html(c) for c in content)

# ==========================================
# 5. ENDPOINT (Маршрут FastAPI)
# ==========================================
@router.post("/render-html")
def render_document_html(payload: Dict[str, Any], db: Session = Depends(get_db)):
    logger.info("🚀 [START] Начало рендеринга документа.")
    
    document_version_id = payload.get("document_version_id")
    document_id = payload.get("document_id")
    document_set_id = payload.get("document_set_id")
    content_json = None
    target_doc_set_id = None
    
    if document_version_id:
        version = db.query(DocumentVersion).filter(DocumentVersion.id == document_version_id).first()
        if not version: raise HTTPException(status_code=404, detail=t("renderer.errors.document_version_not_found"))
        content_json = version.content_json
        target_doc_set_id = version.document.document_set_id
    elif document_id:
        doc = db.query(Document).filter(Document.id == document_id).first()
        if not doc: raise HTTPException(status_code=404, detail=t("renderer.errors.document_not_found"))
        version = db.query(DocumentVersion).filter(DocumentVersion.document_id == doc.id, DocumentVersion.is_current == True).first()
        if not version: raise HTTPException(status_code=404, detail=t("renderer.errors.current_version_not_found"))
        content_json = version.content_json
        target_doc_set_id = doc.document_set_id
    elif document_set_id:
        doc = db.query(Document).filter(Document.document_set_id == document_set_id, Document.document_role == DocumentRole.MAIN).first()
        if not doc: raise HTTPException(status_code=404, detail=t("renderer.errors.main_document_not_found"))
        version = db.query(DocumentVersion).filter(DocumentVersion.document_id == doc.id, DocumentVersion.is_current == True).first()
        if not version: raise HTTPException(status_code=404, detail=t("renderer.errors.main_document_current_version_not_found"))
        content_json = version.content_json
        target_doc_set_id = document_set_id
    else:
        raise HTTPException(status_code=400, detail=t("renderer.errors.id_required"))

    if not content_json:
        raise HTTPException(status_code=400, detail=t("renderer.errors.document_empty"))

    doc_set_id = target_doc_set_id
    properties = db.query(QuestionnaireProperty).filter_by(document_set_id=doc_set_id).all()
    properties_map = {p.id: p for p in properties}

    # 🆕 ФОРМИРУЕМ СПИСОК ОТВЕТОВ: приоритет у переданных с фронта
    incoming_answers = payload.get("answers")
    if incoming_answers and isinstance(incoming_answers, dict):
        answers = []
        for prop_id_str, val in incoming_answers.items():
            try:
                prop_id = int(prop_id_str)
            except (ValueError, TypeError):
                continue
            prop = properties_map.get(prop_id)
            if not prop:
                continue
                
            if isinstance(val, dict):
                for row_idx_str, cell_val in val.items():
                    try:
                        row_idx = int(row_idx_str)
                    except (ValueError, TypeError):
                        continue
                    class FakeAnswer: pass
                    fake = FakeAnswer()
                    fake.property_id = prop_id
                    fake.row_index = row_idx  
                    if isinstance(cell_val, bool):
                        fake.value_boolean = cell_val; fake.value_number = None; fake.value_text = None; fake.value_date = None
                    elif isinstance(cell_val, (int, float)):
                        fake.value_number = cell_val; fake.value_text = None; fake.value_boolean = None; fake.value_date = None
                    else:
                        fake.value_text = str(cell_val) if cell_val is not None else None; fake.value_number = None; fake.value_boolean = None; fake.value_date = None
                    answers.append(fake)
            else:
                class FakeAnswer: pass
                fake = FakeAnswer()
                fake.property_id = prop_id
                fake.row_index = 0
                if isinstance(val, bool):
                    fake.value_boolean = val; fake.value_number = None; fake.value_text = None; fake.value_date = None
                elif isinstance(val, (int, float)):
                    fake.value_number = val; fake.value_text = None; fake.value_boolean = None; fake.value_date = None
                else:
                    fake.value_text = str(val) if val is not None else None; fake.value_number = None; fake.value_boolean = None; fake.value_date = None
                answers.append(fake)
        logger.info(f"📥 [ANSWERS] Используем {len(answers)} ответов (включая табличные), переданных с фронта.")
    else:
        answers = db.query(QuestionnaireAnswer).filter_by(document_set_id=doc_set_id).all()
        logger.info(f"📥 [ANSWERS] Используем {len(answers)} ответов из БД.")

    context = {}
    for p in properties:
        if p.identifier:
            context[p.identifier] = p.default_value if p.default_value not in (None, "") else 0

    table_data = {} 
    for ans in answers:
        prop = properties_map.get(ans.property_id)
        if not prop: continue
        val = ans.value_text if ans.value_text is not None else (ans.value_number if ans.value_number is not None else (ans.value_date if ans.value_date is not None else ans.value_boolean))
        if ans.row_index == 0:
            context[prop.identifier] = val
        else:
            section_id = prop.section_id
            if not section_id: continue
            if section_id not in table_data: table_data[section_id] = []
            row_idx = ans.row_index
            while len(table_data[section_id]) < row_idx: table_data[section_id].append({"cells": {}})
            table_data[section_id][row_idx - 1]["cells"][str(prop.id)] = val

    for sec_id, rows in list(table_data.items()):
        clean_rows = [row for row in rows if any(str(v).strip() not in ("", "None", "0") for v in row.get("cells", {}).values())]
        table_data[sec_id] = clean_rows

    for _ in range(10):
        changed = False
        for p in properties:
            if p.identifier and p.value_source.value.strip() == "formula" and p.formula:
                new_val = safe_eval_formula(p.formula, context)
                if str(new_val) != str(context.get(p.identifier)):
                    context[p.identifier] = new_val
                    changed = True
        if not changed: break

    current_versions = db.query(FormulationVersion).filter(FormulationVersion.is_current == True).all()
    formulations_map = {v.formulation_id: v.text_content for v in current_versions}

    variants = db.query(ConditionFormulationVariant).filter_by(document_set_id=doc_set_id).all()
    variants_map = {}
    for v in variants:
        if v.identifier not in variants_map: variants_map[v.identifier] = []
        variants_map[v.identifier].append(v)

    section_columns = {}
    sections = db.query(QuestionnaireSection).filter_by(document_set_id=doc_set_id, is_table=True).all()
    for sec in sections:
        cols = db.query(QuestionnaireProperty).filter_by(section_id=sec.id).all()
        section_columns[sec.id] = cols

    processed_json_list = process_tiptap_json(
        content_json, context, table_data, section_columns, 
        formulations_map, variants_map, properties_map, db
    )
    
    processed_doc = processed_json_list[0] if content_json.get("type") == "doc" else {"type": "doc", "content": processed_json_list}
    
    counters = [0] * 20
    number_map = {}
    recalculate_legal_numbers(processed_doc, counters, number_map)
    
    html = json_to_html(processed_doc)
    
    logger.info("🏁 [END] Рендеринг успешно завершен.")
    return {
        "html": html, 
        "status": "success",
        "meta": {
            "document_set_id": doc_set_id,
            "document_id": document_id,
            "version_id": document_version_id
        }
    }