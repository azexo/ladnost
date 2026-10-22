# mcp_tools.py
from typing import Any, Dict, List, Optional
from datetime import datetime
from pathlib import Path
import uuid
import weasyprint
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models import (
    DocumentSet, DocumentSetMode, Document, DocumentVersion,
    QuestionnaireProperty, QuestionnaireSection, Folder, WorkspaceMember,
)
from routers.integrations import _clone_template_set, _process_and_save_answers
from routers.renderer import render_document_html
from routers.mcp import register_tool
from utils import AuthContext
from core.i18n import t

# ============================================================================
# ХЕЛПЕРЫ (без изменений)
# ============================================================================

def _ensure_pdf_dir(workspace_id: int) -> Path:
    base = Path("uploads") / "pdfs" / str(workspace_id)
    base.mkdir(parents=True, exist_ok=True)
    return base

def _normalize_answers_for_renderer(
    properties_map: Dict[int, QuestionnaireProperty],
    single_answers: Optional[Dict[str, Any]],
    table_answers: Optional[Dict[str, List[Dict[str, Any]]]],
    sections_by_name: Dict[str, QuestionnaireSection],
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if single_answers:
        for identifier, value in single_answers.items():
            prop = next((p for p in properties_map.values() if p.identifier == identifier), None)
            if not prop:
                continue
            out[str(prop.id)] = value
    if table_answers:
        for section_name, rows in table_answers.items():
            section = sections_by_name.get(section_name)
            if not section:
                continue
            section_props = [p for p in properties_map.values() if p.section_id == section.id]
            for row_idx, row in enumerate(rows, start=1):
                for identifier, cell_value in row.items():
                    prop = next((p for p in section_props if p.identifier == identifier), None)
                    if not prop:
                        continue
                    pid = str(prop.id)
                    if pid not in out:
                        out[pid] = {}
                    if isinstance(out[pid], dict):
                        out[pid][str(row_idx)] = cell_value
    return out

# ============================================================================
# ИНСТРУМЕНТ 1: СПИСОК ШАБЛОНОВ
# ============================================================================

@register_tool(
    name="list_template_document_sets",
    description="Возвращает список комплектов-шаблонов, доступных текущему пользователю в текущем воркспейсе.",
    input_schema={
        "type": "object",
        "properties": {
            "folder_id": {
                "type": "integer",
                "description": "Фильтр по ID папки (опционально)",
            },
            "q": {
                "type": "string",
                "description": "Поиск по имени шаблона (опционально)",
            },
            "limit": {
                "type": "integer",
                "description": "Лимит записей (по умолчанию 100, максимум 500)",
                "default": 100,
            },
            "offset": {
                "type": "integer",
                "description": "Сдвиг для пагинации (по умолчанию 0)",
                "default": 0,
            },
        },
        "required": [],
        "x-required-scope": "documents:read",  # Для фильтрации по API-ключам
    },
)
def list_template_document_sets(
    arguments: Dict[str, Any],
    ctx: AuthContext,
    db: Session,
) -> Dict[str, Any]:
    """
    Список шаблонов. user_id берётся из ctx, workspace_id — из ctx.
    """
    folder_id = arguments.get("folder_id")
    q = arguments.get("q")
    limit = min(int(arguments.get("limit", 100)), 500)
    offset = int(arguments.get("offset", 0))
    
    user_id = ctx.user.id
    workspace_id = ctx.workspace_id
    
    # Базовый запрос: шаблоны текущего воркспейса
    query = db.query(DocumentSet).filter(
        DocumentSet.mode == DocumentSetMode.TEMPLATE,
        DocumentSet.is_deleted == False,
    )
    
    # Фильтр по воркспейсу: либо владелец участник, либо шаблон публичный
    # (адаптируйте под вашу модель: если у DocumentSet нет workspace_id, 
    #  фильтруйте через WorkspaceMember)
    query = query.filter(
        (DocumentSet.owner_id == user_id) | 
        (DocumentSet.is_anonymous_access == True)
    )
    
    if folder_id is not None:
        # Проверка, что папка принадлежит пользователю
        folder = db.query(Folder).filter(
            Folder.id == folder_id,
            Folder.owner_id == user_id,
            Folder.is_deleted == False,
        ).first()
        if not folder:
            raise ValueError(t("mcp.errors.folder_not_found_or_no_access"))
        query = query.filter(DocumentSet.folder_id == folder_id)
    
    if q:
        query = query.filter(DocumentSet.name.ilike(f"%{q}%"))
    
    total = query.count()
    items = (
        query.order_by(DocumentSet.updated_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    
    return {
        "items": [
            {
                "id": s.id,
                "name": s.name,
                "folder_id": s.folder_id,
                "owner_id": s.owner_id,
                "is_questionnaire_enabled": s.is_questionnaire_enabled,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat(),
            }
            for s in items
        ],
        "total": total,
    }

# ============================================================================
# ИНСТРУМЕНТ 2: СОЗДАНИЕ И ГЕНЕРАЦИЯ PDF
# ============================================================================

@register_tool(
    name="create_fill_and_render_pdf",
    description="Клонирует шаблон, заполняет анкету, рендерит HTML и конвертирует в PDF.",
    input_schema={
        "type": "object",
        "properties": {
            "template_set_id": {
                "type": "integer",
                "description": "ID комплекта-шаблона",
            },
            "new_name": {
                "type": "string",
                "description": "Имя нового комплекта (опционально)",
            },
            "target_folder_id": {
                "type": "integer",
                "description": "ID папки для размещения (опционально)",
            },
            "single_answers": {
                "type": "object",
                "description": "Словарь ответов: identifier -> value",
            },
            "table_answers": {
                "type": "object",
                "description": "Табличные данные: section_name -> [row, ...]",
            },
            "pdf_filename": {
                "type": "string",
                "description": "Имя PDF-файла (без расширения, опционально)",
            },
        },
        "required": ["template_set_id"],
        "x-required-scope": "documents:write",
    },
)
def create_fill_and_render_pdf(
    arguments: Dict[str, Any],
    ctx: AuthContext,
    db: Session,
) -> Dict[str, Any]:
    """
    Создание и генерация PDF. user_id и workspace_id берутся из ctx.
    """
    template_set_id = arguments["template_set_id"]
    new_name = arguments.get("new_name")
    target_folder_id = arguments.get("target_folder_id")
    single_answers = arguments.get("single_answers")
    table_answers = arguments.get("table_answers")
    pdf_filename = arguments.get("pdf_filename")
    
    user_id = ctx.user.id
    workspace_id = ctx.workspace_id
    
    # 1. Находим шаблон
    template = (
        db.query(DocumentSet)
        .filter(
            DocumentSet.id == template_set_id,
            DocumentSet.mode == DocumentSetMode.TEMPLATE,
            DocumentSet.is_deleted == False,
        )
        .first()
    )
    if not template:
        raise ValueError(t("mcp.errors.template_not_found"))
    
    # 2. Определяем целевую папку
    final_folder_id = template.folder_id
    if target_folder_id is not None:
        target_folder = (
            db.query(Folder)
            .filter(
                Folder.id == target_folder_id,
                Folder.owner_id == user_id,
                Folder.is_deleted == False,
            )
            .first()
        )
        if not target_folder:
            raise ValueError(t("integrations.target_folder_not_found_or_no_access"))
        final_folder_id = target_folder.id
    
    # 3. Клонируем шаблон
    new_set, prop_mapping, prop_to_section_name, section_name_to_new_id, prop_is_table = (
        _clone_template_set(
            db=db,
            template=template,
            user_id=user_id,
            new_name=new_name or f"{template.name} (MCP)",
            folder_id=final_folder_id,
        )
    )
    
    # 4. Заполняем анкету
    single_count, table_count, skipped_sections, skipped_identifiers = _process_and_save_answers(
        db=db,
        document_set_id=new_set.id,
        user_id=user_id,
        single_answers=single_answers,
        table_answers=table_answers,
        prop_mapping=prop_mapping,
        prop_to_section_name=prop_to_section_name,
        section_name_to_id=section_name_to_new_id,
        prop_is_table=prop_is_table,
    )
    db.commit()
    db.refresh(new_set)
    
    # 5. Рендерим HTML
    properties_map = {p.id: p for p in db.query(QuestionnaireProperty).filter_by(document_set_id=new_set.id).all()}
    sections_by_name = {s.name: s for s in db.query(QuestionnaireSection).filter_by(document_set_id=new_set.id).all()}
    renderer_answers = _normalize_answers_for_renderer(
        properties_map=properties_map,
        single_answers=single_answers,
        table_answers=table_answers,
        sections_by_name=sections_by_name,
    )
    payload = {"document_set_id": new_set.id}
    if renderer_answers:
        payload["answers"] = renderer_answers
    result = render_document_html(payload=payload, db=db)
    html = result.get("html", "")
    if not html:
        raise RuntimeError(t("mcp.errors.render_failed"))
    
    # 6. Путь к PDF
    pdf_dir = _ensure_pdf_dir(workspace_id)
    pdf_name = pdf_filename or str(uuid.uuid4())
    pdf_name = pdf_name.replace(".pdf", "").replace("/", "_").replace("\\", "_")
    pdf_path = pdf_dir / f"{pdf_name}.pdf"
    if pdf_path.exists():
        pdf_path = pdf_dir / f"{pdf_name}_{uuid.uuid4().hex[:6]}.pdf"
    
    # 7. Конвертируем HTML -> PDF
    try:
        html_doc = weasyprint.HTML(string=html, base_url=".")
        html_doc.write_pdf(str(pdf_path))
        pdf_size = pdf_path.stat().st_size
    except Exception as e:
        raise RuntimeError(t("mcp.errors.pdf_conversion_failed", error=str(e)))
    
    # 8. Привязываем PDF к версии
    main_doc = (
        db.query(Document)
        .filter(Document.document_set_id == new_set.id, Document.document_role == "main")
        .first()
    )
    version_id = 0
    document_id = 0
    if main_doc:
        document_id = main_doc.id
        current_ver = (
            db.query(DocumentVersion)
            .filter(DocumentVersion.document_id == main_doc.id, DocumentVersion.is_current == True)
            .first()
        )
        if current_ver:
            current_ver.file_path = str(pdf_path)
            current_ver.file_size = pdf_size
            version_id = current_ver.id
            db.commit()
    
    pdf_url = f"/uploads/pdfs/{workspace_id}/{pdf_path.name}"
    
    return {
        "document_set_id": new_set.id,
        "document_id": document_id,
        "version_id": version_id,
        "pdf_url": pdf_url,
        "pdf_path": str(pdf_path),
        "pdf_size": pdf_size,
        "single_answers_saved": single_count,
        "table_rows_saved": table_count,
        "skipped_sections": skipped_sections,
        "skipped_identifiers": skipped_identifiers,
    }