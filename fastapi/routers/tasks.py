# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date
from pydantic import BaseModel
from database import get_db
from models import (
    Task, ApprovalStage, TaskAttachment, TaskHistory, User,
    TaskType, TaskStatus, RouteType, StageStatus, AccessLevel, HistoryAction,
    DocumentSet, ApprovalStatus, NotificationType  # <-- ДОБАВЛЕНО
)
from utils import (
    get_current_active_user, get_initial_stage_status, get_initial_subtask_status, is_task_visible,
    notify_task_assigned, notify_task_status_changed
)
from core.i18n import t

router = APIRouter()

# ==========================================
# Pydantic Schemas (Схемы для ответов)
# ==========================================
class TaskResponse(BaseModel):
    id: int
    parent_task_id: Optional[int]
    document_set_id: int
    name: str
    description: Optional[str]
    task_type: TaskType
    status: TaskStatus
    initiator_id: int
    assignee_id: int
    deadline: Optional[date]
    route_type: Optional[RouteType]
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class ApprovalStageResponse(BaseModel):
    id: int
    task_id: int
    stage_number: int
    assignee_id: int
    access_level: AccessLevel
    status: StageStatus
    comment: Optional[str]
    completed_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}

class TaskAttachmentResponse(BaseModel):
    id: int
    task_id: int
    document_version_id: int
    attached_by: int
    created_at: datetime

    model_config = {"from_attributes": True}

class TaskHistoryResponse(BaseModel):
    id: int
    task_id: int
    root_task_id: int
    user_id: int
    action: HistoryAction
    comment: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

# ==========================================
# Pydantic Schemas (Схемы для запросов)
# ==========================================
class TaskCreateSchema(BaseModel):
    parent_task_id: Optional[int] = None
    document_set_id: int
    name: str
    description: Optional[str] = None
    task_type: TaskType = TaskType.APPROVAL
    assignee_id: int
    deadline: Optional[date] = None
    route_type: Optional[RouteType] = None

class StageCreateSchema(BaseModel):
    stage_number: int
    assignee_id: int
    access_level: AccessLevel = AccessLevel.REVIEW
    comment: Optional[str] = None

class TaskActionSchema(BaseModel):
    comment: Optional[str] = None

class HistoryCreateSchema(BaseModel):
    action: HistoryAction
    comment: Optional[str] = None

class AttachmentCreateSchema(BaseModel):
    document_version_id: int

# ==========================================
# Вспомогательные функции
# ==========================================
def get_visible_tasks(db: Session, user_id: int) -> List[Task]:
    """Получает все задачи, фильтруя их по правилу видимости из utils.py"""
    all_tasks = db.query(Task).all()
    return [t for t in all_tasks if is_task_visible(db, t, user_id)]

def _add_history(db: Session, task: Task, user_id: int, action: HistoryAction, comment: Optional[str] = None):
    """Вспомогательная функция для добавления записи в историю задач"""
    root_id = task.parent_task_id if task.parent_task_id else task.id
    history = TaskHistory(
        task_id=task.id,
        root_task_id=root_id,
        user_id=user_id,
        action=action,
        comment=comment,
        created_at=datetime.utcnow()
    )
    db.add(history)

def _update_document_set_status(db: Session, document_set_id: int, new_status: ApprovalStatus):
    """Вспомогательная функция для обновления статуса комплекта"""
    doc_set = db.query(DocumentSet).filter(DocumentSet.id == document_set_id).first()
    if doc_set:
        doc_set.approval_status = new_status
        doc_set.updated_at = datetime.utcnow()

# ==========================================
# ENDPOINTS
# ==========================================
@router.get("/", response_model=List[TaskResponse])
async def list_tasks(
    assignee_id: Optional[int] = None,
    initiator_id: Optional[int] = None,
    status: Optional[str] = None,
    parent_task_id: Optional[int] = None,
    is_root: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    result = get_visible_tasks(db, current_user.id)
    if assignee_id is not None:
        result = [t for t in result if t.assignee_id == assignee_id]
    if initiator_id is not None:
        result = [t for t in result if t.initiator_id == initiator_id]
    if status:
        result = [t for t in result if t.status.value == status]
    if is_root:
        result = [t for t in result if not t.parent_task_id]
    if parent_task_id is not None:
        result = [t for t in result if t.parent_task_id == parent_task_id]
    
    result.sort(key=lambda x: x.updated_at, reverse=True)
    return result

@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=t("tasks.errors.not_found"))
    if not is_task_visible(db, task, current_user.id):
        raise HTTPException(status_code=403, detail=t("tasks.errors.access_denied"))
    return task

@router.get("/{task_id}/subtasks", response_model=List[TaskResponse])
async def get_subtasks(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    subtasks = db.query(Task).filter(Task.parent_task_id == task_id).all()
    return [t for t in subtasks if is_task_visible(db, t, current_user.id)]

@router.get("/{task_id}/stages", response_model=List[ApprovalStageResponse])
async def get_stages(
    task_id: int,
    db: Session = Depends(get_db)
):
    stages = db.query(ApprovalStage).filter(ApprovalStage.task_id == task_id).all()
    return sorted(stages, key=lambda x: x.stage_number)

@router.get("/{task_id}/attachments", response_model=List[TaskAttachmentResponse])
async def get_attachments(
    task_id: int,
    db: Session = Depends(get_db)
):
    return db.query(TaskAttachment).filter(TaskAttachment.task_id == task_id).all()

@router.get("/{task_id}/history", response_model=List[TaskHistoryResponse])
async def get_history(
    task_id: int,
    db: Session = Depends(get_db)
):
    history = db.query(TaskHistory).filter(
        (TaskHistory.task_id == task_id) | (TaskHistory.root_task_id == task_id)
    ).all()
    return sorted(history, key=lambda x: x.created_at, reverse=True)

@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    data: TaskCreateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    new_task = Task(
        parent_task_id=data.parent_task_id,
        document_set_id=data.document_set_id,
        name=data.name,
        description=data.description,
        task_type=data.task_type,
        status=TaskStatus.IN_REVIEW if (not data.parent_task_id and data.task_type == TaskType.APPROVAL) else TaskStatus.PENDING,
        initiator_id=current_user.id,
        assignee_id=data.assignee_id,
        deadline=data.deadline,
        route_type=data.route_type,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(new_task)
    db.flush()

    if not new_task.parent_task_id and new_task.task_type == TaskType.APPROVAL:
        _update_document_set_status(db, new_task.document_set_id, ApprovalStatus.IN_APPROVAL)

    _add_history(db, new_task, current_user.id, HistoryAction.CREATED)
    if new_task.status == TaskStatus.IN_REVIEW:
        _add_history(db, new_task, current_user.id, HistoryAction.SENT_FOR_APPROVAL)

    # === УВЕДОМЛЕНИЕ: Исполнителю о новой задаче ===
    notify_task_assigned(db, data.assignee_id, new_task.id, new_task.name, current_user.first_name)

    db.commit()
    db.refresh(new_task)
    return new_task

@router.post("/{task_id}/stages", response_model=ApprovalStageResponse)
async def add_stage(
    task_id: int,
    data: StageCreateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    main_task = db.query(Task).filter(Task.id == task_id).first()
    if not main_task:
        raise HTTPException(status_code=404, detail=t("tasks.errors.main_not_found"))

    new_stage = ApprovalStage(
        task_id=task_id,
        stage_number=data.stage_number,
        assignee_id=data.assignee_id,
        access_level=data.access_level,
        status=get_initial_stage_status(main_task, data.stage_number),
        comment=data.comment,
        created_at=datetime.utcnow()
    )
    db.add(new_stage)

    subtask = Task(
        parent_task_id=task_id,
        document_set_id=main_task.document_set_id,
        name=t("tasks.history.stage_name", stage_number=data.stage_number, assignee_id=data.assignee_id),
        task_type=TaskType.APPROVAL,
        status=get_initial_subtask_status(main_task, data.stage_number),
        initiator_id=main_task.initiator_id,
        assignee_id=data.assignee_id,
        deadline=main_task.deadline,
        route_type=main_task.route_type,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(subtask)
    db.flush()

    _add_history(db, main_task, current_user.id, HistoryAction.SENT_FOR_APPROVAL, t("tasks.history.stage_added", stage_number=data.stage_number))

    # === УВЕДОМЛЕНИЕ: Исполнителю нового этапа ===
    notify_task_assigned(db, data.assignee_id, subtask.id, subtask.name, current_user.first_name)

    db.commit()
    db.refresh(new_stage)

    main_attachments = db.query(TaskAttachment).filter(TaskAttachment.task_id == task_id).all()
    for att in main_attachments:
        new_att = TaskAttachment(
            task_id=subtask.id,
            document_version_id=att.document_version_id,
            attached_by=att.attached_by,
            created_at=datetime.utcnow()
        )
        db.add(new_att)
    
    db.commit()
    return new_stage

# ==========================================
# ЛОГИКА СОГЛАСОВАНИЯ (APPROVE / REJECT / REVISION)
# ==========================================
@router.post("/{task_id}/approve")
async def approve_task(
    task_id: int,
    data: Optional[TaskActionSchema] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=t("tasks.errors.not_found"))
    
    comment = data.comment if data else None

    if task.parent_task_id:
        task.status = TaskStatus.APPROVED
        task.completed_at = datetime.utcnow()
        task.updated_at = datetime.utcnow()
        _add_history(db, task, current_user.id, HistoryAction.APPROVED, comment)

        stage = db.query(ApprovalStage).filter(
            ApprovalStage.task_id == task.parent_task_id,
            ApprovalStage.assignee_id == task.assignee_id
        ).first()
        
        if stage:
            stage.status = StageStatus.APPROVED
            stage.completed_at = datetime.utcnow()
            if comment: 
                stage.comment = comment

        main_task = db.query(Task).filter(Task.id == task.parent_task_id).first()
        if main_task:
            if main_task.route_type == RouteType.SEQUENTIAL:
                current_stage_num = stage.stage_number if stage else 0
                next_stage = db.query(ApprovalStage).filter(
                    ApprovalStage.task_id == main_task.id,
                    ApprovalStage.stage_number == current_stage_num + 1
                ).first()
                
                if next_stage:
                    next_stage.status = StageStatus.IN_PROGRESS
                    next_subtask = db.query(Task).filter(
                        Task.parent_task_id == main_task.id,
                        Task.assignee_id == next_stage.assignee_id
                    ).first()
                    if next_subtask:
                        next_subtask.status = TaskStatus.IN_REVIEW
                        next_subtask.updated_at = datetime.utcnow()
                        # === УВЕДОМЛЕНИЕ: Следующему исполнителю в цепочке ===
                        notify_task_assigned(db, next_stage.assignee_id, next_subtask.id, next_subtask.name, current_user.first_name)
                else:
                    main_task.status = TaskStatus.APPROVED
                    main_task.completed_at = datetime.utcnow()
                    _add_history(db, main_task, current_user.id, HistoryAction.COMPLETED, comment)
                    _update_document_set_status(db, main_task.document_set_id, ApprovalStatus.APPROVED)
                    # === УВЕДОМЛЕНИЕ: Инициатору о полном согласовании ===
                    notify_task_status_changed(
                        db, main_task.initiator_id, main_task.id, main_task.name, 
                        NotificationType.APPROVAL_COMPLETED, 
                        current_user.first_name, 
                        t("tasks.notifications.approved")
                    )
            elif main_task.route_type == RouteType.PARALLEL:
                all_stages = db.query(ApprovalStage).filter(ApprovalStage.task_id == main_task.id).all()
                if all(s.status == StageStatus.APPROVED for s in all_stages):
                    main_task.status = TaskStatus.APPROVED
                    main_task.completed_at = datetime.utcnow()
                    _add_history(db, main_task, current_user.id, HistoryAction.COMPLETED, comment)
                    _update_document_set_status(db, main_task.document_set_id, ApprovalStatus.APPROVED)
                    # === УВЕДОМЛЕНИЕ: Инициатору о полном согласовании ===
                    notify_task_status_changed(
                        db, main_task.initiator_id, main_task.id, main_task.name, 
                        NotificationType.APPROVAL_COMPLETED, 
                        current_user.first_name, 
                        t("tasks.notifications.approved")
                    )
            main_task.updated_at = datetime.utcnow()
    else:
        task.status = TaskStatus.APPROVED
        task.completed_at = datetime.utcnow()
        task.updated_at = datetime.utcnow()
        _add_history(db, task, current_user.id, HistoryAction.APPROVED, comment)
        _add_history(db, task, current_user.id, HistoryAction.COMPLETED, comment)
        _update_document_set_status(db, task.document_set_id, ApprovalStatus.APPROVED)
        
        # === УВЕДОМЛЕНИЕ: Если согласуем сразу корневую задачу (и инициатор не сам себя) ===
        if task.initiator_id != current_user.id:
            notify_task_status_changed(
                db, task.initiator_id, task.id, task.name, 
                NotificationType.APPROVAL_COMPLETED, 
                current_user.first_name, 
                t("tasks.notifications.approved")
            )

    db.commit()
    return {"status": "approved"}

@router.post("/{task_id}/reject")
async def reject_task(
    task_id: int,
    data: Optional[TaskActionSchema] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=t("tasks.errors.not_found"))
    
    comment = data.comment if data else None

    if task.parent_task_id:
        task.status = TaskStatus.REJECTED
        task.updated_at = datetime.utcnow()
        _add_history(db, task, current_user.id, HistoryAction.REJECTED, comment)

        stage = db.query(ApprovalStage).filter(
            ApprovalStage.task_id == task.parent_task_id,
            ApprovalStage.assignee_id == task.assignee_id
        ).first()
        
        if stage:
            stage.status = StageStatus.REJECTED
            if comment: 
                stage.comment = comment

        main_task = db.query(Task).filter(Task.id == task.parent_task_id).first()
        if main_task:
            main_task.status = TaskStatus.REJECTED
            main_task.updated_at = datetime.utcnow()
            _add_history(db, main_task, current_user.id, HistoryAction.REJECTED, comment)
            _update_document_set_status(db, main_task.document_set_id, ApprovalStatus.REJECTED)
            
            # === УВЕДОМЛЕНИЕ: Инициатору об отклонении ===
            notify_task_status_changed(
                db, main_task.initiator_id, main_task.id, main_task.name, 
                NotificationType.TASK_REJECTED, 
                current_user.first_name, 
                t("tasks.notifications.rejected")
            )

            db.query(ApprovalStage).filter(
                ApprovalStage.task_id == main_task.id, 
                ApprovalStage.status == StageStatus.IN_PROGRESS
            ).update({ApprovalStage.status: StageStatus.REJECTED})
            
            db.query(Task).filter(
                Task.parent_task_id == main_task.id, 
                Task.status == TaskStatus.IN_REVIEW
            ).update({Task.status: TaskStatus.REJECTED, Task.updated_at: datetime.utcnow()})
    else:
        task.status = TaskStatus.REJECTED
        task.updated_at = datetime.utcnow()
        _add_history(db, task, current_user.id, HistoryAction.REJECTED, comment)
        _update_document_set_status(db, task.document_set_id, ApprovalStatus.REJECTED)
        
        # === УВЕДОМЛЕНИЕ: Если отклоняем сразу корневую задачу ===
        if task.initiator_id != current_user.id:
            notify_task_status_changed(
                db, task.initiator_id, task.id, task.name, 
                NotificationType.TASK_REJECTED, 
                current_user.first_name, 
                t("tasks.notifications.rejected")
            )

    db.commit()
    return {"status": "rejected"}

@router.post("/{task_id}/revision")
async def request_revision(
    task_id: int,
    data: TaskActionSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task or not task.parent_task_id:
        raise HTTPException(status_code=400, detail=t("tasks.errors.stage_only"))
    
    comment = data.comment if data else None

    task.status = TaskStatus.NEEDS_REVISION
    task.updated_at = datetime.utcnow()
    _add_history(db, task, current_user.id, HistoryAction.NEEDS_REVISION, comment)

    stage = db.query(ApprovalStage).filter(
        ApprovalStage.task_id == task.parent_task_id,
        ApprovalStage.assignee_id == task.assignee_id
    ).first()
    
    if stage:
        stage.status = StageStatus.NEEDS_REVISION
        if comment: stage.comment = comment

    main_task = db.query(Task).filter(Task.id == task.parent_task_id).first()
    if main_task:
        main_task.status = TaskStatus.NEEDS_REVISION
        main_task.updated_at = datetime.utcnow()
        _add_history(db, main_task, current_user.id, HistoryAction.NEEDS_REVISION, comment)
        _update_document_set_status(db, main_task.document_set_id, ApprovalStatus.DRAFT)
        
        # === УВЕДОМЛЕНИЕ: Инициатору о возврате на доработку ===
        notify_task_status_changed(
            db, main_task.initiator_id, main_task.id, main_task.name, 
            NotificationType.TASK_NEEDS_REVISION, 
            current_user.first_name, 
            t("tasks.notifications.revision_requested")
        )

        db.query(ApprovalStage).filter(
            ApprovalStage.task_id == main_task.id, 
            ApprovalStage.status == StageStatus.IN_PROGRESS,
            ApprovalStage.id != stage.id
        ).update({ApprovalStage.status: StageStatus.NOT_STARTED})
        
        db.query(Task).filter(
            Task.parent_task_id == main_task.id, 
            Task.status == TaskStatus.IN_REVIEW,
            Task.id != task.id
        ).update({Task.status: TaskStatus.PENDING, Task.updated_at: datetime.utcnow()})

    db.commit()
    return {"status": "revision_requested"}

# ==========================================
# ДОПОЛНИТЕЛЬНЫЕ ДЕЙСТВИЯ
# ==========================================
@router.post("/{task_id}/history", response_model=TaskHistoryResponse)
async def add_history(
    task_id: int,
    data: HistoryCreateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    task = db.query(Task).filter(Task.id == task_id).first()
    new_history = TaskHistory(
        task_id=task_id,
        root_task_id=task.parent_task_id if task and task.parent_task_id else task_id,
        user_id=current_user.id,
        action=data.action,
        comment=data.comment,
        created_at=datetime.utcnow()
    )
    db.add(new_history)
    db.commit()
    db.refresh(new_history)
    return new_history

@router.post("/{task_id}/attachments", response_model=TaskAttachmentResponse)
async def attach_document(
    task_id: int,
    data: AttachmentCreateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    new_att = TaskAttachment(
        task_id=task_id,
        document_version_id=data.document_version_id,
        attached_by=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_att)
    db.commit()
    db.refresh(new_att)
    return new_att

@router.post("/{task_id}/resubmit")
async def resubmit_task(
    task_id: int,
    data: Optional[TaskActionSchema] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    main_task = db.query(Task).filter(Task.id == task_id).first()
    if not main_task or main_task.parent_task_id:
        raise HTTPException(status_code=400, detail=t("tasks.errors.not_found"))
    if main_task.initiator_id != current_user.id:
        raise HTTPException(status_code=403, detail=t("tasks.errors.initiator_resubmit_only"))
    if main_task.status != TaskStatus.NEEDS_REVISION:
        raise HTTPException(status_code=400, detail=t("tasks.errors.not_in_revision"))
    
    comment = data.comment if data else None

    main_task.status = TaskStatus.IN_REVIEW
    main_task.updated_at = datetime.utcnow()
    _update_document_set_status(db, main_task.document_set_id, ApprovalStatus.IN_APPROVAL)
    _add_history(db, main_task, current_user.id, HistoryAction.RESUBMITTED, comment)
    _add_history(db, main_task, current_user.id, HistoryAction.SENT_FOR_APPROVAL, comment)

    stages = db.query(ApprovalStage).filter(ApprovalStage.task_id == task_id).order_by(ApprovalStage.stage_number).all()
    
    if main_task.route_type == RouteType.SEQUENTIAL:
        for s in stages:
            if s.status != StageStatus.APPROVED:
                s.status = StageStatus.IN_PROGRESS
                subtask = db.query(Task).filter(Task.parent_task_id == task_id, Task.assignee_id == s.assignee_id).first()
                if subtask: 
                    subtask.status = TaskStatus.IN_REVIEW
                    # === УВЕДОМЛЕНИЕ: Исполнителю о повторной отправке ===
                    notify_task_assigned(db, s.assignee_id, subtask.id, subtask.name, current_user.first_name)
                break
    else:
        for s in stages:
            if s.status != StageStatus.APPROVED:
                s.status = StageStatus.IN_PROGRESS
                subtask = db.query(Task).filter(Task.parent_task_id == task_id, Task.assignee_id == s.assignee_id).first()
                if subtask: 
                    subtask.status = TaskStatus.IN_REVIEW
                    # === УВЕДОМЛЕНИЕ: Исполнителю о повторной отправке ===
                    notify_task_assigned(db, s.assignee_id, subtask.id, subtask.name, current_user.first_name)

    db.commit()
    return {"status": "resubmitted"}

@router.post("/{task_id}/withdraw")
async def withdraw_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    main_task = db.query(Task).filter(Task.id == task_id).first()
    if not main_task or main_task.parent_task_id:
        raise HTTPException(status_code=400, detail=t("tasks.errors.not_found"))
    if main_task.initiator_id != current_user.id:
        raise HTTPException(status_code=403, detail=t("tasks.errors.initiator_withdraw_only"))
    if main_task.status not in [TaskStatus.IN_REVIEW, TaskStatus.NEEDS_REVISION]:
        raise HTTPException(status_code=400, detail=t("tasks.errors.cannot_withdraw_completed"))

    # === СНАЧАЛА ПОЛУЧАЕМ СПИСОК ЭТАПОВ ДЛЯ УВЕДОМЛЕНИЙ ===
    stages_to_cancel = db.query(ApprovalStage).filter(
        ApprovalStage.task_id == task_id, 
        ApprovalStage.status.in_([StageStatus.IN_PROGRESS, StageStatus.NOT_STARTED, StageStatus.NEEDS_REVISION])
    ).all()

    main_task.status = TaskStatus.CANCELED
    main_task.updated_at = datetime.utcnow()
    _update_document_set_status(db, main_task.document_set_id, ApprovalStatus.DRAFT)
    _add_history(db, main_task, current_user.id, HistoryAction.WITHDRAWN)

    db.query(ApprovalStage).filter(
        ApprovalStage.task_id == task_id, 
        ApprovalStage.status.in_([StageStatus.IN_PROGRESS, StageStatus.NOT_STARTED, StageStatus.NEEDS_REVISION])
    ).update({ApprovalStage.status: StageStatus.CANCELED}, synchronize_session=False)
    
    db.query(Task).filter(
        Task.parent_task_id == task_id,
        Task.status.in_([TaskStatus.IN_REVIEW, TaskStatus.PENDING, TaskStatus.NEEDS_REVISION])
    ).update({Task.status: TaskStatus.CANCELED, Task.updated_at: datetime.utcnow()}, synchronize_session=False)

    # === УВЕДОМЛЕНИЯ: Всем исполнителям активных этапов об отзыве ===
    # Примечание: В models.py нет отдельного NotificationType.TASK_WITHDRAWN, 
    # поэтому используем TASK_REJECTED. Если нужно различать визуально - добавьте его в Enum.
    for s in stages_to_cancel:
        notify_task_status_changed(
            db, s.assignee_id, task_id, main_task.name, 
            NotificationType.TASK_REJECTED, 
            current_user.first_name, 
            t("tasks.notifications.withdrawn")
        )

    db.commit()
    return {"status": "withdrawn"}