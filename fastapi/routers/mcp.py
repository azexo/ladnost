# routers/mcp.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from database import get_db
from utils import get_current_user_or_api_key, AuthContext, check_scope
from core.i18n import t

router = APIRouter()

# ============================================================================
# РЕЕСТР ИНСТРУМЕНТОВ (описания + реализации)
# ============================================================================

class MCPTool:
    """Дескриптор инструмента с JSON Schema для аргументов."""
    def __init__(self, name: str, description: str, input_schema: Dict[str, Any], handler):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.handler = handler

# Инструменты регистрируются ниже (см. mcp_tools.py)
TOOLS: Dict[str, MCPTool] = {}

def register_tool(name: str, description: str, input_schema: Dict[str, Any]):
    """Декоратор для регистрации инструмента."""
    def decorator(func):
        TOOLS[name] = MCPTool(name, description, input_schema, func)
        return func
    return decorator

# ============================================================================
# ЭНДПОИНТ 1: СПИСОК ИНСТРУМЕНТОВ
# ============================================================================

@router.get("/tools")
def list_tools(
    ctx: AuthContext = Depends(get_current_user_or_api_key),
    db: Session = Depends(get_db),
):
    """
    Возвращает список доступных инструментов в формате MCP.
    Фильтрует по scopes API-ключа.
    """
    tools = []
    for tool in TOOLS.values():
        # Для API-ключей проверяем scope
        if ctx.auth_type == "api_key":
            required_scope = tool.input_schema.get("x-required-scope")
            if required_scope and required_scope not in ctx.scopes:
                continue
        
        tools.append({
            "name": tool.name,
            "description": tool.description,
            "inputSchema": tool.input_schema,
        })
    
    return {"tools": tools}

# ============================================================================
# ЭНДПОИНТ 2: ВЫЗОВ ИНСТРУМЕНТА
# ============================================================================

class MCPToolCallRequest(BaseModel):
    name: str = Field(..., description="Имя инструмента")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="Аргументы инструмента")

@router.post("/call")
def call_tool(
    payload: MCPToolCallRequest,
    ctx: AuthContext = Depends(get_current_user_or_api_key),
    db: Session = Depends(get_db),
):
    """
    Вызывает инструмент с авторизацией и валидацией.
    """
    tool = TOOLS.get(payload.name)
    if not tool:
        raise HTTPException(status_code=404, detail=t("mcp.errors.tool_not_found"))
    
    # Проверка scope для API-ключей
    if ctx.auth_type == "api_key":
        required_scope = tool.input_schema.get("x-required-scope")
        if required_scope:
            check_scope(required_scope, ctx)
    
    # Вызов инструмента, передаём ctx и db
    try:
        result = tool.handler(
            arguments=payload.arguments,
            ctx=ctx,
            db=db,
        )
        return {
            "content": [
                {
                    "type": "text",
                    "text": result if isinstance(result, str) else str(result),
                }
            ],
            "isError": False,
        }
    except ValueError as e:
        # Ожидаемые ошибки (не найдено, нет доступа)
        return {
            "content": [{"type": "text", "text": str(e)}],
            "isError": True,
        }
    except Exception as e:
        # Неожиданные ошибки
        return {
            "content": [{"type": "text", "text": t("mcp.errors.internal_error")}],
            "isError": True,
        }