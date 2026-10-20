# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import Depends, HTTPException, status, Request, Security
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
import jwt
from jwt.exceptions import PyJWTError
from sqlalchemy.orm import Session
from typing import List, Optional, Tuple
from datetime import datetime
from passlib.context import CryptContext

from config import get_settings
from database import get_db
from models import (
    User, Task, RouteType, TaskStatus, StageStatus,
    DocumentSet, DocumentSetAccess, Document, Formulation,
    ConditionFormulationVariant, QuestionnaireCondition,
    Notification, NotificationType, RelatedEntityType,
    ApiKey, Workspace, WorkspaceMember, WorkspaceRole
)
from core.hooks import hooks
from core.i18n import t  # <-- Импортируем функцию перевода

settings = get_settings()

# =====================================================================
# 1. СХЕМЫ АВТОРИЗАЦИИ (OAuth2)
# =====================================================================
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# =====================================================================
# 2. БАЗОВЫЕ ЗАВИСИМОСТИ ПОЛЬЗОВАТЕЛЕЙ
# =====================================================================
def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=t("utils.errors.unauthorized"),
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except PyJWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=400, detail=t("utils.errors.user_deactivated"))
    return user

def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    return current_user

# =====================================================================
# 3. ЗАВИСИМОСТИ ДЛЯ АНОНИМНОГО ДОСТУПА
# =====================================================================
def get_optional_user(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db)
) -> Optional[User]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            return None
    except PyJWTError:
        return None
        
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        return None
    return user

def verify_document_set_access(
    set_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user)
) -> Tuple[DocumentSet, Optional[User]]:
    ds = db.query(DocumentSet).filter(
        DocumentSet.id == set_id,
        DocumentSet.is_deleted == False
    ).first()
    if not ds:
        raise HTTPException(status_code=404, detail=t("utils.errors.set_not_found"))

    if ds.is_anonymous_access:
        return ds, current_user

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("utils.errors.auth_required_for_set"),
            headers={"WWW-Authenticate": "Bearer"},
        )

    if ds.owner_id == current_user.id:
        return ds, current_user

    has_access = db.query(DocumentSetAccess).filter(
        DocumentSetAccess.document_set_id == set_id,
        DocumentSetAccess.user_id == current_user.id
    ).first()
    if not has_access:
        raise HTTPException(status_code=403, detail=t("utils.errors.access_to_set_forbidden"))
    return ds, current_user

def verify_document_access(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user)
) -> Tuple[Document, DocumentSet, Optional[User]]:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=t("utils.errors.document_not_found"))
        
    ds = doc.document_set
    if not ds or ds.is_deleted:
        raise HTTPException(status_code=404, detail=t("utils.errors.set_not_found"))

    if ds.is_anonymous_access:
        return doc, ds, current_user

    if not current_user:
        raise HTTPException(status_code=401, detail=t("utils.errors.auth_required_for_set"))

    if ds.owner_id == current_user.id:
        return doc, ds, current_user

    has_access = db.query(DocumentSetAccess).filter(
        DocumentSetAccess.document_set_id == ds.id,
        DocumentSetAccess.user_id == current_user.id
    ).first()
    if not has_access:
        raise HTTPException(status_code=403, detail=t("utils.errors.access_to_document_forbidden"))
    return doc, ds, current_user

# =====================================================================
# 8. УНИВЕРСАЛЬНАЯ ЗАВИСИМОСТЬ ДЛЯ УПРАВЛЕНИЯ WORKSPACE
# =====================================================================
class ManagerContext:
    def __init__(self, clm_user: User = None, workspace_id: int = None, **kwargs):
        self.clm_user = clm_user
        self.workspace_id = workspace_id
        self.extra = kwargs

    def __getattr__(self, name):
        if name in self.extra:
            return self.extra[name]
        raise AttributeError(f"У ManagerContext нет атрибута '{name}'")

    @property
    def is_partner(self) -> bool:
        return 'partner_user' in self.extra

def get_workspace_manager(
    workspace_id: int,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> ManagerContext:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=t("utils.errors.unauthorized"),
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
    except PyJWTError:
        raise credentials_exception

    clm_user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if clm_user:
        member = db.query(WorkspaceMember).filter(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == clm_user.id
        ).first()
        if member and member.role in [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]:
            ctx = ManagerContext(clm_user=clm_user, workspace_id=workspace_id)
            ctx = hooks.apply_filters_sync('enrich_workspace_context', ctx)
            return ctx

    hook_payload = {
        'user_id': user_id,
        'workspace_id': workspace_id,
        'db': db,
        'resolved_context': None
    }
    hook_payload = hooks.apply_filters_sync('resolve_workspace_manager_fallback', hook_payload)
    if hook_payload.get('resolved_context'):
        return hook_payload['resolved_context']

    raise HTTPException(status_code=403, detail=t("utils.errors.no_workspace_api_rights"))

# =====================================================================
# 4. БИЗНЕС-ЛОГИКА ЗАДАЧ И МАРШРУТОВ
# =====================================================================
def get_initial_stage_status(task: Task, stage_number: int) -> StageStatus:
    if task.route_type == RouteType.PARALLEL:
        return StageStatus.IN_PROGRESS
    if task.route_type == RouteType.SEQUENTIAL:
        return StageStatus.IN_PROGRESS if stage_number == 1 else StageStatus.NOT_STARTED
    return StageStatus.NOT_STARTED

def get_initial_subtask_status(task: Task, stage_number: int) -> TaskStatus:
    if task.route_type == RouteType.PARALLEL:
        return TaskStatus.IN_REVIEW
    if task.route_type == RouteType.SEQUENTIAL:
        return TaskStatus.IN_REVIEW if stage_number == 1 else TaskStatus.PENDING
    return TaskStatus.PENDING

# =====================================================================
# 5. ПРОВЕРКА ДОСТУПОВ И ВИДИМОСТИ
# =====================================================================
def is_task_visible(db: Session, task: Task, current_user_id: int) -> bool:
    if task.initiator_id == current_user_id or task.assignee_id == current_user_id:
        return True
    if task.parent_task_id:
        parent_task = db.query(Task).filter(Task.id == task.parent_task_id).first()
        if parent_task and (parent_task.initiator_id == current_user_id or parent_task.assignee_id == current_user_id):
            return True
    return False

def get_accessible_document_set_ids(db: Session, current_user_id: int) -> List[int]:
    owned_ids = db.query(DocumentSet.id).filter(DocumentSet.owner_id == current_user_id).all()
    access_ids = db.query(DocumentSetAccess.document_set_id).filter(
        DocumentSetAccess.user_id == current_user_id
    ).all()
    all_ids = set([item[0] for item in owned_ids] + [item[0] for item in access_ids])
    return list(all_ids)

def is_formulation_visible(
    db: Session,
    formulation_id: int,
    accessible_set_ids: List[int],
    current_user_id: int
) -> bool:
    form = db.query(Formulation).filter(Formulation.id == formulation_id).first()
    if not form:
        return False
    if form.created_by == current_user_id:
        return True
    variants = db.query(ConditionFormulationVariant).filter(
        ConditionFormulationVariant.formulation_id == formulation_id
    ).all()
    for v in variants:
        if v.document_set_id and v.document_set_id in accessible_set_ids:
            return True
        if v.condition_id:
            cond = db.query(QuestionnaireCondition).filter(
                QuestionnaireCondition.id == v.condition_id
            ).first()
            if cond and cond.document_set_id in accessible_set_ids:
                return True
    return False

# =====================================================================
# 6. УПРАВЛЕНИЕ УВЕДОМЛЕНИЯМИ (NOTIFICATIONS)
# =====================================================================
def create_notification(
    db: Session, user_id: int, notif_type: NotificationType, title: str,
    message: Optional[str] = None, entity_type: Optional[RelatedEntityType] = None,
    entity_id: Optional[int] = None
) -> Notification:
    notification = Notification(
        user_id=user_id, type=notif_type, title=title, message=message,
        related_entity_type=entity_type, related_entity_id=entity_id, is_read=False
    )
    db.add(notification)
    db.flush()
    return notification

def create_bulk_notifications(
    db: Session, user_ids: List[int], notif_type: NotificationType, title: str,
    message: Optional[str] = None, entity_type: Optional[RelatedEntityType] = None,
    entity_id: Optional[int] = None
) -> List[Notification]:
    notifications = []
    for uid in set(user_ids):
        notif = Notification(
            user_id=uid, type=notif_type, title=title, message=message,
            related_entity_type=entity_type, related_entity_id=entity_id, is_read=False
        )
        db.add(notif)
        notifications.append(notif)
    if notifications:
        db.flush()
    return notifications

def mark_notifications_as_read(
    db: Session, user_id: int, notification_ids: Optional[List[int]] = None
) -> int:
    query = db.query(Notification).filter(
        Notification.user_id == user_id, Notification.is_read == False
    )
    if notification_ids:
        query = query.filter(Notification.id.in_(notification_ids))
    updated_count = query.update({"is_read": True}, synchronize_session=False)
    db.flush()
    return updated_count

def notify_task_assigned(db: Session, assignee_id: int, task_id: int, task_name: str, initiator_name: str):
    return create_notification(
        db=db, user_id=assignee_id, notif_type=NotificationType.TASK_ASSIGNED,
        title=t("utils.notifications.task_assigned_title", task_name=task_name),
        message=t("utils.notifications.task_assigned_msg", initiator_name=initiator_name),
        entity_type=RelatedEntityType.TASK, entity_id=task_id
    )

def notify_task_status_changed(
    db: Session, 
    user_id: int, 
    task_id: int, 
    task_name: str, 
    notif_type: NotificationType,  
    actor_name: str, 
    action_text: str               
):
    return create_notification(
        db=db, 
        user_id=user_id, 
        notif_type=notif_type,
        title=t("utils.notifications.task_status_changed_title", task_name=task_name),
        message=t("utils.notifications.task_status_changed_msg", actor_name=actor_name, action=action_text),
        entity_type=RelatedEntityType.TASK, 
        entity_id=task_id
    )

def notify_new_comment(db: Session, recipient_id: int, doc_set_id: int, comment_id: int, author_name: str):
    return create_notification(
        db=db, user_id=recipient_id, notif_type=NotificationType.COMMENT_ADDED,
        title=t("utils.notifications.new_comment_title", author_name=author_name),
        message=t("utils.notifications.new_comment_msg"),
        entity_type=RelatedEntityType.COMMENT, entity_id=comment_id
    )

def notify_document_sent(db: Session, recipient_id: int, doc_set_id: int, doc_set_name: str, sender_name: str):
    return create_notification(
        db=db, user_id=recipient_id, notif_type=NotificationType.DOCUMENT_SENT,
        title=t("utils.notifications.doc_sent_title", doc_set_name=doc_set_name),
        message=t("utils.notifications.doc_sent_msg", sender_name=sender_name),
        entity_type=RelatedEntityType.DOCUMENT_SET, entity_id=doc_set_id
    )

def notify_formulation_updated(db: Session, formulation_id: int, formulation_name: str, actor_id: int, actor_name: str):
    variants = db.query(ConditionFormulationVariant.document_set_id).filter(
        ConditionFormulationVariant.formulation_id == formulation_id
    ).distinct().all()
    doc_set_ids = [v[0] for v in variants]
    if not doc_set_ids:
        return  
    owners = db.query(DocumentSet.owner_id).filter(DocumentSet.id.in_(doc_set_ids)).distinct().all()
    owner_ids = [o[0] for o in owners if o[0] != actor_id]
    if not owner_ids:
        return
    create_bulk_notifications(
        db=db, user_ids=owner_ids, notif_type=NotificationType.FORMULATION_UPDATED,
        title=t("utils.notifications.formulation_updated_title", formulation_name=formulation_name),
        message=t("utils.notifications.formulation_updated_msg", actor_name=actor_name),
        entity_type=RelatedEntityType.FORMULATION, entity_id=formulation_id
    )

# =====================================================================
# 7. АВТОРИЗАЦИЯ ПО API-КЛЮЧУ
# =====================================================================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

class AuthContext:
    def __init__(self, user: User, workspace_id: int, auth_type: str, scopes: list = None):
        self.user = user
        self.workspace_id = workspace_id
        self.auth_type = auth_type
        self.scopes = scopes or []

def get_current_user_or_api_key(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    api_key: Optional[str] = Security(api_key_header),
    db: Session = Depends(get_db)
) -> AuthContext:
    if token:
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            user_id_str = payload.get("sub")
            if user_id_str is None:
                raise HTTPException(status_code=401, detail=t("utils.errors.invalid_token"))
            user_id = int(user_id_str)
        except PyJWTError:
            raise HTTPException(status_code=401, detail=t("utils.errors.invalid_or_expired_token"))

        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail=t("utils.errors.user_not_found_or_deactivated"))

        ws_member = db.query(WorkspaceMember).filter(WorkspaceMember.user_id == user.id).first()
        workspace_id = ws_member.workspace_id if ws_member else None
        if not workspace_id:
            ws_owner = db.query(Workspace).filter(Workspace.owner_id == user.id).first()
            workspace_id = ws_owner.id if ws_owner else None
        if not workspace_id:
            raise HTTPException(status_code=403, detail=t("utils.errors.no_active_workspace"))

        return AuthContext(user=user, workspace_id=workspace_id, auth_type="jwt")

    if api_key:
        prefix = api_key[:9] + "..."
        candidates = db.query(ApiKey).filter(
            ApiKey.key_prefix == prefix, ApiKey.is_active == True
        ).all()
        if not candidates:
            raise HTTPException(status_code=401, detail=t("utils.errors.invalid_api_key"))

        matched_key = None
        for candidate in candidates:
            if pwd_context.verify(api_key, candidate.key_hash):
                matched_key = candidate
                break
        if not matched_key:
            raise HTTPException(status_code=401, detail=t("utils.errors.invalid_api_key"))

        if matched_key.expires_at and matched_key.expires_at < datetime.utcnow():
            raise HTTPException(status_code=401, detail=t("utils.errors.api_key_expired"))

        if matched_key.allowed_ips:
            client_ip = request.client.host if request.client else None
            if client_ip not in matched_key.allowed_ips:
                raise HTTPException(status_code=403, detail=t("utils.errors.ip_not_allowed"))

        matched_key.last_used_at = datetime.utcnow()
        db.commit()
        return AuthContext(
            user=matched_key.creator,
            workspace_id=matched_key.workspace_id,
            auth_type="api_key",
            scopes=matched_key.scopes or []
        )

    raise HTTPException(
        status_code=401,
        detail=t("utils.errors.auth_required_any"),
        headers={"WWW-Authenticate": "Bearer"}
    )

def check_scope(required_scope: str, ctx: AuthContext):
    if ctx.auth_type == "api_key" and required_scope not in ctx.scopes:
        raise HTTPException(
            status_code=403,
            detail=t("utils.errors.api_key_missing_scope", scope=required_scope)
        )