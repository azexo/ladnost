# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import enum
from datetime import datetime, date
from typing import Optional, List
from decimal import Decimal
from sqlalchemy import (
    String, Text, Boolean, Date, DateTime, ForeignKey, JSON, Numeric,
    UniqueConstraint, Index, BigInteger, Integer,
    Enum as SAEnum,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
import secrets


# =====================================================================
# БАЗОВЫЙ КЛАСС И ENUM
# =====================================================================
class Base(DeclarativeBase):
    pass

class TextInputType(str, enum.Enum): SHORT = "short"; LONG = "long"; LIST = "list"
class DocumentSetMode(str, enum.Enum): FILE = "file"; TEMPLATE = "template"; STANDARD = "standard"; NON_STANDARD = "non_standard"
class ApprovalStatus(str, enum.Enum): DRAFT = "draft"; IN_APPROVAL = "in_approval"; APPROVED = "approved"; REJECTED = "rejected"
class DocumentRole(str, enum.Enum): MAIN = "main"; APPENDIX = "appendix"; ACT = "act"; SPECIFICATION = "specification"; OTHER = "other"
class BlockType(str, enum.Enum): PARAGRAPH = "paragraph"; HEADING = "heading"; LIST_ITEM = "list_item"; TABLE_CELL = "table_cell"; IMAGE = "image"; FORMULATION = "formulation"
class AnchorType(str, enum.Enum): WORD = "word"; CHAR = "char"; INLINE_NODE = "inline_node"
class DataType(str, enum.Enum): TEXT = "text"; NUMBER = "number"; MONEY = "money"; PERCENT = "percent"; DATE = "date"; PHOTO = "photo"; LINK = "link"; CONDITION = "condition"
class ValueSource(str, enum.Enum): USER_INPUT = "user_input"; FORMULA = "formula"; DATABASE = "database"; READONLY = "readonly"
class FormatLanguage(str, enum.Enum): RU = "ru"; EN = "en"
class FormatCase(str, enum.Enum): AS_IS = "as_is"; UPPER = "upper"; LOWER = "lower"; CAPITALIZE = "capitalize"
class GrammaticalCase(str, enum.Enum): NOMINATIVE = "nominative"; GENITIVE = "genitive"; DATIVE = "dative"; ACCUSATIVE = "accusative"; INSTRUMENTAL = "instrumental"; PREPOSITIONAL = "prepositional"
class LogicalOperator(str, enum.Enum): AND = "AND"; OR = "OR"
class CompareOperator(str, enum.Enum): EQ = "="; NEQ = "!="; GT = ">"; LT = "<"; GTE = ">="; LTE = "<="
class TaskType(str, enum.Enum): APPROVAL = "approval"; REVIEW = "review"; SIGN = "sign"; REVISION = "revision"; CASCADE_UPDATE = "cascade_update"; OTHER = "other"

class TaskStatus(str, enum.Enum): 
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    NEEDS_REVISION = "needs_revision"
    REJECTED = "rejected"
    COMPLETED = "completed"
    CANCELED = "canceled"  # ✅ НОВОЕ: Отозвано инициатором

class RouteType(str, enum.Enum): SEQUENTIAL = "sequential"; PARALLEL = "parallel"
class AccessLevel(str, enum.Enum): FULL = "full"; REVIEW = "review"; COMMENT = "comment"; VIEW = "view"

# ✅ ОБНОВЛЕННЫЙ StageStatus (Добавлен CANCELED)
class StageStatus(str, enum.Enum): 
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    APPROVED = "approved"
    NEEDS_REVISION = "needs_revision"
    REJECTED = "rejected"
    CANCELED = "canceled"  # ✅ НОВОЕ: Этап отменен вместе с задачей

# ✅ ОБНОВЛЕННЫЙ HistoryAction (Добавлены RESUBMITTED и WITHDRAWN)
class HistoryAction(str, enum.Enum): 
    CREATED = "created"
    SENT_FOR_APPROVAL = "sent_for_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    NEEDS_REVISION = "needs_revision"
    COMMENTED = "commented"
    COMPLETED = "completed"
    VERSION_UPDATED = "version_updated"
    RESUBMITTED = "resubmitted"  # ✅ НОВОЕ: Повторная отправка после доработки
    WITHDRAWN = "withdrawn"      # ✅ НОВОЕ: Отзыв документа

class EmailStatus(str, enum.Enum):
    PENDING = "pending"   # В очереди (если используем асинхронную очередь)
    SENT = "sent"         # Успешно отправлено через SMTP
    FAILED = "failed"     # Ошибка отправки
    
class UsageSource(str, enum.Enum): DIRECT = "direct"; VIA_CONDITION = "via_condition"
class CascadeStatus(str, enum.Enum): PENDING = "pending"; TASK_CREATED = "task_created"; APPLIED = "applied"; SKIPPED = "skipped"
class EditType(str, enum.Enum): INSERTION = "insertion"; DELETION = "deletion"; REPLACEMENT = "replacement"
class ResolutionStatus(str, enum.Enum): PENDING = "pending"; ACCEPTED = "accepted"; REJECTED = "rejected"
class OrphanReason(str, enum.Enum): BLOCK_DELETED = "block_deleted"; ANCHOR_DELETED = "anchor_deleted"; TEXT_CHANGED = "text_changed"
class AccessType(str, enum.Enum): OWNER = "owner"; FULL = "full"; REVIEW = "review"; COMMENT = "comment"; VIEW = "view"
class NotificationType(str, enum.Enum): TASK_ASSIGNED = "task_assigned"; TASK_REJECTED = "task_rejected"; TASK_NEEDS_REVISION = "task_needs_revision"; COMMENT_ADDED = "comment_added"; APPROVAL_COMPLETED = "approval_completed"; FORMULATION_UPDATED = "formulation_updated"; SIGNATURE_REQUIRED = "signature_required"; DOCUMENT_SENT = "document_sent"
class RelatedEntityType(str, enum.Enum): TASK = "task"; DOCUMENT_SET = "document_set"; FORMULATION = "formulation"; COMMENT = "comment"

# =====================================================================
# ПОЛЬЗОВАТЕЛИ
# =====================================================================
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    middle_name: Mapped[Optional[str]] = mapped_column(String(100))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True) # Добавлен index
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    folders: Mapped[List["Folder"]] = relationship(back_populates="owner")
    document_sets: Mapped[List["DocumentSet"]] = relationship(back_populates="owner")
    

# =====================================================================
# ФАЙЛОВАЯ СИСТЕМА (ПАПКИ)
# =====================================================================
class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (
        Index('ix_folder_parent_deleted', 'parent_id', 'is_deleted'), # Составной для tree traversal
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner: Mapped["User"] = relationship(back_populates="folders")
    parent: Mapped[Optional["Folder"]] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[List["Folder"]] = relationship(back_populates="parent")
    document_sets: Mapped[List["DocumentSet"]] = relationship(back_populates="folder")

# =====================================================================
# КОМПЛЕКТЫ ДОКУМЕНТОВ
# =====================================================================
class DocumentSet(Base):
    __tablename__ = "document_sets"
    __table_args__ = (
        Index('ix_ds_folder_deleted', 'folder_id', 'is_deleted'),
        Index('ix_ds_owner_deleted', 'owner_id', 'is_deleted'),
        Index('ix_ds_status', 'approval_status'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    mode: Mapped[DocumentSetMode] = mapped_column(default=DocumentSetMode.NON_STANDARD)
    is_questionnaire_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_status: Mapped[ApprovalStatus] = mapped_column(default=ApprovalStatus.DRAFT, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_anonymous_access: Mapped[bool] = mapped_column(Boolean, default=False, comment="Анонимный доступ к комплекту")
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    folder: Mapped[Optional["Folder"]] = relationship(back_populates="document_sets")
    owner: Mapped["User"] = relationship(back_populates="document_sets")
    documents: Mapped[List["Document"]] = relationship(back_populates="document_set", cascade="all, delete-orphan")

# =====================================================================
# ДОКУМЕНТЫ И ИХ ВЕРСИИ
# =====================================================================
class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    document_role: Mapped[DocumentRole] = mapped_column(default=DocumentRole.MAIN)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    document_set: Mapped["DocumentSet"] = relationship(back_populates="documents")
    versions: Mapped[List["DocumentVersion"]] = relationship(back_populates="document", cascade="all, delete-orphan")

class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint('document_id', 'version_number', name='uq_doc_version'),
        Index('ix_doc_ver_doc_current', 'document_id', 'is_current'), # Критично для поиска текущей версии
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    content_json: Mapped[dict] = mapped_column(JSON, comment='Массив блоков с UUID')
    content_html: Mapped[Optional[str]] = mapped_column(Text)
    plain_text_cache: Mapped[Optional[str]] = mapped_column(Text)

    file_path: Mapped[Optional[str]] = mapped_column(String(500))
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger)

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    change_reason: Mapped[Optional[str]] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    document: Mapped["Document"] = relationship(back_populates="versions")
    author: Mapped["User"] = relationship()
    blocks: Mapped[List["DocumentBlock"]] = relationship(back_populates="version", cascade="all, delete-orphan")
    anchors: Mapped[List["DocumentAnchor"]] = relationship(back_populates="version", cascade="all, delete-orphan")

# =====================================================================
# БЛОЧНАЯ МОДЕЛЬ ДОКУМЕНТА
# =====================================================================
class DocumentBlock(Base):
    __tablename__ = "document_blocks"
    __table_args__ = (UniqueConstraint('document_version_id', 'block_uuid', name='uq_block'),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    block_uuid: Mapped[str] = mapped_column(String(36))
    block_type: Mapped[BlockType] = mapped_column()
    block_path: Mapped[str] = mapped_column(String(255))
    parent_block_uuid: Mapped[Optional[str]] = mapped_column(String(36), index=True) # Для вложенности
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped["DocumentVersion"] = relationship(back_populates="blocks")

class DocumentAnchor(Base):
    __tablename__ = "document_anchors"
    __table_args__ = (UniqueConstraint('document_version_id', 'anchor_uuid', name='uq_anchor'),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    block_uuid: Mapped[str] = mapped_column(String(36), index=True)
    anchor_uuid: Mapped[str] = mapped_column(String(36))
    anchor_type: Mapped[AnchorType] = mapped_column(default=AnchorType.WORD)
    text_content: Mapped[str] = mapped_column(String(500))
    char_offset: Mapped[int] = mapped_column(Integer)
    char_length: Mapped[int] = mapped_column(Integer)
    version: Mapped["DocumentVersion"] = relationship(back_populates="anchors")

# =====================================================================
# АНКЕТА (СВОЙСТВА, УСЛОВИЯ, ОТВЕТЫ)
# =====================================================================
class QuestionnaireProperty(Base):
    __tablename__ = "questionnaire_properties"
    __table_args__ = (UniqueConstraint('document_set_id', 'identifier', name='uq_prop_identifier'),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    identifier: Mapped[str] = mapped_column(String(100))
    section_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questionnaire_sections.id", ondelete="SET NULL"), index=True)
    data_type: Mapped[DataType] = mapped_column()
    text_input_type: Mapped[Optional[TextInputType]] = mapped_column(default=TextInputType.SHORT)
    options_json: Mapped[Optional[str]] = mapped_column(JSON, comment='Массив строк для LIST')
    description: Mapped[Optional[str]] = mapped_column(Text)
    display_condition_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questionnaire_conditions.id", ondelete="SET NULL"), index=True)
    hint: Mapped[Optional[str]] = mapped_column(Text)
    placeholder: Mapped[Optional[str]] = mapped_column(String(255))
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    hide_in_form: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    value_source: Mapped[ValueSource] = mapped_column(default=ValueSource.USER_INPUT)
    formula: Mapped[Optional[str]] = mapped_column(Text)
    default_value: Mapped[Optional[str]] = mapped_column(Text)
    format: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class QuestionnaireCondition(Base):
    __tablename__ = "questionnaire_conditions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    section_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questionnaire_sections.id", ondelete="SET NULL"), index=True)
    is_enabled_default: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class ConditionRuleGroup(Base):
    __tablename__ = "condition_rule_groups"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    condition_id: Mapped[int] = mapped_column(ForeignKey("questionnaire_conditions.id", ondelete="CASCADE"), index=True)
    parent_group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("condition_rule_groups.id", ondelete="CASCADE"), index=True)
    logical_operator: Mapped[LogicalOperator] = mapped_column(default=LogicalOperator.AND)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

class ConditionRule(Base):
    __tablename__ = "condition_rules"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("condition_rule_groups.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("questionnaire_properties.id", ondelete="CASCADE"), index=True)
    operator: Mapped[CompareOperator] = mapped_column(
        SAEnum(CompareOperator, values_callable=lambda obj: [e.value for e in obj])
    )
    compare_value: Mapped[Optional[str]] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

class QuestionnaireAnswer(Base):
    __tablename__ = "questionnaire_answers"
    __table_args__ = (UniqueConstraint('document_set_id', 'property_id', 'row_index', name='uq_answer'),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("questionnaire_properties.id", ondelete="CASCADE"), index=True)
    row_index: Mapped[int] = mapped_column(Integer, default=0, index=True, comment="Индекс строки для таблиц")
    value_text: Mapped[Optional[str]] = mapped_column(Text)
    value_number: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 4))
    value_date: Mapped[Optional[date]] = mapped_column(Date)
    value_boolean: Mapped[Optional[bool]] = mapped_column(Boolean)
    answered_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True)
    answered_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# =====================================================================
# БИБЛИОТЕКА ФОРМУЛИРОВОК
# =====================================================================
class FormulationType(Base):
    __tablename__ = "formulation_types"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

class FormulationGroup(Base):
    __tablename__ = "formulation_groups"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    color_label: Mapped[Optional[str]] = mapped_column(String(20))
    description: Mapped[Optional[str]] = mapped_column(Text)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Formulation(Base):
    __tablename__ = "formulations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type_id: Mapped[Optional[int]] = mapped_column(ForeignKey("formulation_types.id", ondelete="SET NULL"), index=True)
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("formulation_groups.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    current_version_id: Mapped[Optional[int]] = mapped_column(ForeignKey("formulation_versions.id", ondelete="SET NULL"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class FormulationVersion(Base):
    __tablename__ = "formulation_versions"
    __table_args__ = (
        UniqueConstraint('formulation_id', 'version_number', name='uq_form_version'),
        Index('ix_form_ver_current', 'formulation_id', 'is_current'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    formulation_id: Mapped[int] = mapped_column(ForeignKey("formulations.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    text_content: Mapped[str] = mapped_column(Text)
    change_reason: Mapped[Optional[str]] = mapped_column(Text)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class FormulationVariable(Base):
    __tablename__ = "formulation_variables"
    __table_args__ = (UniqueConstraint('formulation_id', 'variable_name', name='uq_form_var'),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    formulation_id: Mapped[int] = mapped_column(ForeignKey("formulations.id", ondelete="CASCADE"), index=True)
    variable_name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# =====================================================================
# ПРИВЯЗКА ФОРМУЛИРОВОК
# =====================================================================
class ConditionFormulationVariant(Base):
    __tablename__ = "condition_formulation_variants"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    condition_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questionnaire_conditions.id", ondelete="SET NULL"), nullable=True, index=True)
    formulation_id: Mapped[int] = mapped_column(ForeignKey("formulations.id", ondelete="CASCADE"), index=True)
    formulation_version_id: Mapped[Optional[int]] = mapped_column(ForeignKey("formulation_versions.id", ondelete="SET NULL"), index=True)
    is_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    identifier: Mapped[str] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# =====================================================================
# ЗАДАЧИ И МАРШРУТЫ СОГЛАСОВАНИЯ
# =====================================================================
class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index('ix_task_assignee_status', 'assignee_id', 'status'),
        Index('ix_task_initiator_status', 'initiator_id', 'status'),
        Index('ix_task_parent', 'parent_task_id'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    task_type: Mapped[TaskType] = mapped_column(default=TaskType.APPROVAL)
    status: Mapped[TaskStatus] = mapped_column(default=TaskStatus.PENDING, index=True)
    initiator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    deadline: Mapped[Optional[date]] = mapped_column(Date, index=True)
    route_type: Mapped[Optional[RouteType]] = mapped_column()
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ApprovalStage(Base):
    __tablename__ = "approval_stages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    stage_number: Mapped[int] = mapped_column(Integer)
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    access_level: Mapped[AccessLevel] = mapped_column(default=AccessLevel.REVIEW)
    status: Mapped[StageStatus] = mapped_column(default=StageStatus.NOT_STARTED, index=True)
    comment: Mapped[Optional[str]] = mapped_column(Text)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class TaskAttachment(Base):
    __tablename__ = "task_attachments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    attached_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class TaskHistory(Base):
    __tablename__ = "task_history"
    __table_args__ = (
        Index('ix_taskhist_task_date', 'task_id', 'created_at'),
        Index('ix_taskhist_root_date', 'root_task_id', 'created_at'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    root_task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[HistoryAction] = mapped_column()
    comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# =====================================================================
# КАСКАДНЫЕ ОБНОВЛЕНИЯ
# =====================================================================
class FormulationUpdateCascade(Base):
    __tablename__ = "formulation_update_cascades"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    formulation_id: Mapped[int] = mapped_column(ForeignKey("formulations.id", ondelete="CASCADE"), index=True)
    old_version_id: Mapped[int] = mapped_column(ForeignKey("formulation_versions.id"), index=True)
    new_version_id: Mapped[int] = mapped_column(ForeignKey("formulation_versions.id"), index=True)
    usage_source: Mapped[UsageSource] = mapped_column()
    document_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[Optional[int]] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    condition_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questionnaire_conditions.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("condition_formulation_variants.id", ondelete="CASCADE"), index=True)
    generated_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), index=True)
    status: Mapped[CascadeStatus] = mapped_column(default=CascadeStatus.PENDING, index=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# =====================================================================
# РЕЦЕНЗИРОВАНИЕ И КОММЕНТИРОВАНИЕ
# =====================================================================
class ReviewEdit(Base):
    __tablename__ = "review_edits"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), index=True)
    edit_type: Mapped[EditType] = mapped_column()
    old_text: Mapped[Optional[str]] = mapped_column(Text)
    new_text: Mapped[Optional[str]] = mapped_column(Text)
    block_uuid: Mapped[str] = mapped_column(String(36), index=True)
    anchor_from_uuid: Mapped[Optional[str]] = mapped_column(String(36))
    anchor_to_uuid: Mapped[Optional[str]] = mapped_column(String(36))
    char_offset_in_block: Mapped[Optional[int]] = mapped_column(Integer)
    char_length_in_block: Mapped[Optional[int]] = mapped_column(Integer)
    is_orphan: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    orphan_reason: Mapped[Optional[OrphanReason]] = mapped_column()
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    resolution_status: Mapped[ResolutionStatus] = mapped_column(default=ResolutionStatus.PENDING, index=True)
    resolved_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        Index('ix_comment_ver_resolved', 'document_version_id', 'is_resolved'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), index=True)
    parent_comment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), index=True)
    block_uuid: Mapped[str] = mapped_column(String(36), index=True)
    anchor_uuid: Mapped[Optional[str]] = mapped_column(String(36))
    char_offset_in_block: Mapped[Optional[int]] = mapped_column(Integer)
    char_length_in_block: Mapped[Optional[int]] = mapped_column(Integer)
    is_orphan: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    orphan_resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    text_content: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    resolved_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# =====================================================================
# ДОСТУП И УВЕДОМЛЕНИЯ
# =====================================================================
class DocumentSetAccess(Base):
    __tablename__ = "document_set_access"
    __table_args__ = (
        UniqueConstraint('document_set_id', 'user_id', name='uq_access'),
        Index('ix_access_user', 'user_id'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    access_type: Mapped[AccessType] = mapped_column(default=AccessType.VIEW)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    granted_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index('ix_notif_user_read_date', 'user_id', 'is_read', 'created_at'), # Идеально для get_notifications
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[NotificationType] = mapped_column()
    title: Mapped[str] = mapped_column(String(255))
    message: Mapped[Optional[str]] = mapped_column(Text)
    related_entity_type: Mapped[Optional[RelatedEntityType]] = mapped_column()
    related_entity_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class QuestionnaireSection(Base):
    __tablename__ = "questionnaire_sections"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_set_id: Mapped[int] = mapped_column(ForeignKey("document_sets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    is_table: Mapped[bool] = mapped_column(Boolean, default=False, comment="Секция является таблицей")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)




# =====================================================================
# ЭНУМЫ ДЛЯ БИЛЛИНГА И ТАРИФОВ
# =====================================================================
class SubscriptionStatus(str, enum.Enum):
    TRIAL = "trial"           # Пробный период
    ACTIVE = "active"         # Активна
    PAST_DUE = "past_due"     # Просрочена (ожидается оплата)
    CANCELED = "canceled"     # Отменена пользователем (до конца периода)
    EXPIRED = "expired"       # Истекла

class BillingPeriod(str, enum.Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"
    LIFETIME = "lifetime"
    TRIAL = "trial"

class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"       # Владелец (покупатель), может управлять биллингом
    ADMIN = "admin"       # Администратор, может управлять пользователями
    MEMBER = "member"     # Обычный участник
    GUEST = "guest"       # Гость (только просмотр)

# =====================================================================
# ТАРИФНЫЕ ПЛАНЫ (СПРАВОЧНИК)
# =====================================================================
class TariffPlan(Base):
    """
    Справочник тарифных планов.
    Лимиты и фичи хранятся в JSON для гибкости, 
    чтобы не менять схему БД при добавлении новых лимитов.
    """
    __tablename__ = "tariff_plans"
    __table_args__ = (
        Index('ix_tariff_code', 'code', unique=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, comment="Уникальный код (free, trial, pro, enterprise)")
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    
    # Цены (в копейках/центах для избежания проблем с float)
    price_monthly: Mapped[Optional[int]] = mapped_column(BigInteger, default=0)
    price_yearly: Mapped[Optional[int]] = mapped_column(BigInteger, default=0)
    
    # Лимиты (пример: {"max_users": 10, "max_documents": 1000, "max_storage_mb": 5000})
    limits_json: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    
    # Доступные функции/фичи (пример: ["advanced_analytics", "api_access", "custom_templates"])
    features_json: Mapped[Optional[dict]] = mapped_column(JSON, default=list)
    
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, comment="Виден ли тариф в прайсе")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# =====================================================================
# РАБОЧИЕ ПРОСТРАНСТВА (КОМАНДЫ / КОМПАНИИ)
# =====================================================================
class Workspace(Base):
    """
    Рабочее пространство (Компания, Команда, Юротдел).
    Именно к нему привязывается подписка.
    """
    __tablename__ = "workspaces"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, comment="Создатель/Покупатель")
    
    # Настройки воркспейса
    settings_json: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    owner: Mapped["User"] = relationship()
    members: Mapped[List["WorkspaceMember"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    subscriptions: Mapped[List["Subscription"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")

    ai_settings: Mapped[Optional["WorkspaceAISettings"]] = relationship(
        back_populates="workspace", uselist=False, cascade="all, delete-orphan"
    )
    mcp_servers: Mapped[List["WorkspaceMCPServer"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMember(Base):
    """Связь пользователей с рабочим пространством."""
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint('workspace_id', 'user_id', name='uq_workspace_user'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[WorkspaceRole] = mapped_column(default=WorkspaceRole.MEMBER)
    
    invited_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    workspace: Mapped["Workspace"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    invited_by_user: Mapped[Optional["User"]] = relationship(foreign_keys=[invited_by])

# =====================================================================
# ПОДПИСКИ (АКТИВНЫЕ ТАРИФЫ)
# =====================================================================
class Subscription(Base):
    """
    Активная подписка рабочего пространства на тарифный план.
    """
    __tablename__ = "subscriptions"
    __table_args__ = (
        Index('ix_sub_workspace_status', 'workspace_id', 'status'),
        Index('ix_sub_expires', 'expires_at'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    tariff_plan_id: Mapped[int] = mapped_column(ForeignKey("tariff_plans.id"), index=True)
    
    status: Mapped[SubscriptionStatus] = mapped_column(default=SubscriptionStatus.TRIAL, index=True)
    billing_period: Mapped[BillingPeriod] = mapped_column(default=BillingPeriod.MONTHLY)
    
    # Даты
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, comment="Дата окончания текущего периода")
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="Дата окончания пробного периода")
    
    # Автопродление и оплаты
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    canceled_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    workspace: Mapped["Workspace"] = relationship(back_populates="subscriptions")
    tariff_plan: Mapped["TariffPlan"] = relationship()

# =====================================================================
# ПЛАТЕЖИ (ИСТОРИЯ ТРАНЗАКЦИЙ)
# =====================================================================
class Payment(Base):
    """История платежей по подпискам."""
    __tablename__ = "payments"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)


    subscription_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"), 
        index=True, 
        nullable=True
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, comment="Кто оплатил")
    
    amount: Mapped[int] = mapped_column(BigInteger, comment="Сумма в минимальных единицах валюты (копейки)")
    currency: Mapped[str] = mapped_column(String(10), default="RUB")
    
    external_id: Mapped[Optional[str]] = mapped_column(String(255), index=True, comment="ID платежа в шлюзе (ЮKassa, Stripe)")
    payment_url: Mapped[Optional[str]] = mapped_column(String(500))
    
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True) # pending, success, failed, refunded
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EmailLog(Base):
    """
    Лог всех отправленных (или попыток отправки) писем.
    Позволяет отслеживать статус, ошибки и связывать письма с сущностями (вебинары, юзеры).
    """
    __tablename__ = "email_logs"
    __table_args__ = (
        Index('ix_emaillog_recipient', 'recipient_email'),
        Index('ix_emaillog_status', 'status'),
        Index('ix_emaillog_created', 'created_at'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Основные данные письма
    recipient_email: Mapped[str] = mapped_column(String(255), index=True, comment="Кому отправлено")
    subject: Mapped[str] = mapped_column(String(255), comment="Тема письма")
    html_content: Mapped[str] = mapped_column(Text, comment="HTML тело письма")
    plain_text_content: Mapped[Optional[str]] = mapped_column(Text, comment="Текстовая версия")
    
    # Статус и ошибки
    status: Mapped[EmailStatus] = mapped_column(SAEnum(EmailStatus), default=EmailStatus.SENT, index=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, comment="Текст ошибки SMTP, если статус FAILED")
    
    # Связь с другими сущностями (опционально, но очень полезно)
    related_entity_type: Mapped[Optional[str]] = mapped_column(String(50), comment="Тип сущности: webinar, registration, password_reset")
    related_entity_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="ID связанной сущности")
    
    # Временные метки
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="Время фактической отправки")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ApiKey(Base):
    """
    API-ключи для доступа сторонних сервисов к кабинету пользователя.
    Ключ привязан к воркспейсу — сторонний сервис видит только данные этого воркспейса.
    """
    __tablename__ = "api_keys"
    __table_args__ = (
        Index('ix_apikey_prefix', 'key_prefix'),
        Index('ix_apikey_workspace', 'workspace_id'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True, comment="Кто создал ключ"
    )

    # Храним только хеш ключа (как пароль). Сам ключ показываем один раз при создании.
    key_hash: Mapped[str] = mapped_column(String(255), comment="bcrypt-хеш полного ключа")
    key_prefix: Mapped[str] = mapped_column(
        String(12), comment="Первые 8-12 символов для отображения в UI, напр. ldn_a3F8x..."
    )

    name: Mapped[str] = mapped_column(
        String(255), comment="Человекочитаемое имя, напр. '1С Интеграция'"
    )
    description: Mapped[Optional[str]] = mapped_column(Text)

    # Ограничения прав
    scopes: Mapped[Optional[dict]] = mapped_column(
        JSON, default=list,
        comment='Разрешённые области: ["documents:read", "documents:write", "tasks:read"]'
    )

    # Ограничения по IP (опционально)
    allowed_ips: Mapped[Optional[dict]] = mapped_column(
        JSON, default=list,
        comment='Список разрешённых IP, пустой = все'
    )

    # Статус и сроки
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, comment="Дата истечения, NULL = бессрочно"
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    workspace: Mapped["Workspace"] = relationship()
    creator: Mapped["User"] = relationship()