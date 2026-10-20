# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from core.i18n import t  # Импортируем глобальную функцию перевода

# Импорты из вашего проекта (замените на актуальные пути)
from database import get_db
from models import Workspace, WorkspaceMember, WorkspaceRole, User
from utils import get_current_user

router = APIRouter()

# --- Схемы Pydantic ---
class WorkspaceCreate(BaseModel):
    name: str

class WorkspaceMemberAdd(BaseModel):
    user_id: int
    role: WorkspaceRole = WorkspaceRole.MEMBER

class WorkspaceResponse(BaseModel):
    id: int
    name: str
    owner_id: int

    class Config:
        from_attributes = True

# --- Эндпоинты ---
@router.post("/", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
def create_workspace(
    data: WorkspaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Создание нового рабочего пространства (Компании/Команды).
    Создатель автоматически получает роль OWNER.
    """
    current_user_id = current_user.id
    new_workspace = Workspace(
        name=data.name,
        owner_id=current_user_id
    )
    db.add(new_workspace)
    db.flush()  # Чтобы получить ID

    # Добавляем создателя как владельца
    owner_member = WorkspaceMember(
        workspace_id=new_workspace.id,
        user_id=current_user_id,
        role=WorkspaceRole.OWNER
    )
    db.add(owner_member)
    db.commit()
    db.refresh(new_workspace)
    return new_workspace

@router.post("/{workspace_id}/members", status_code=status.HTTP_201_CREATED)
def add_member_to_workspace(
    workspace_id: int,
    data: WorkspaceMemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Добавление пользователя в рабочее пространство.
    Требуются права OWNER или ADMIN.
    """
    # 1. Проверка существования воркспейса
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(
            status_code=404, 
            detail=t("workspaces.not_found")
        )

    # 2. Проверка, нет ли уже такого участника
    existing_member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == data.user_id
    ).first()
    if existing_member:
        raise HTTPException(
            status_code=400, 
            detail=t("workspaces.already_member")
        )

    # 3. Добавление участника
    new_member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=data.user_id,
        role=data.role
    )
    db.add(new_member)
    db.commit()
    
    return {
        "message": t("workspaces.member_added", role=data.role.value), 
        "role": data.role.value
    }

@router.get("/my", response_model=List[WorkspaceResponse])
def get_my_workspaces(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Получить список всех рабочих пространств, где пользователь является участником."""
    current_user_id = current_user.id
    
    # Находим все воркспейсы, где юзер есть в таблице members
    workspaces = db.query(Workspace).join(WorkspaceMember).filter(
        WorkspaceMember.user_id == current_user_id,
        Workspace.is_deleted == False
    ).all()
    return workspaces