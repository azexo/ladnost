// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// lib/types.ts 

// ============================================================================
// 1. ENUMS (Mapped from models.py)
// ============================================================================
export enum DocumentSetMode {FILE = "file", TEMPLATE = "template", STANDARD = "standard", NON_STANDARD = "non_standard" }
export enum ApprovalStatus { DRAFT = "draft", IN_APPROVAL = "in_approval", APPROVED = "approved", REJECTED = "rejected" }
export enum DocumentRole { MAIN = "main", APPENDIX = "appendix", ACT = "act", SPECIFICATION = "specification", OTHER = "other" }
export enum BlockType { PARAGRAPH = "paragraph", HEADING = "heading", LIST_ITEM = "list_item", TABLE_CELL = "table_cell", IMAGE = "image", FORMULATION = "formulation" }
export enum AnchorType { WORD = "word", CHAR = "char", INLINE_NODE = "inline_node" }
export enum DataType { TEXT = "text", NUMBER = "number", MONEY = "money", PERCENT = "percent", DATE = "date", PHOTO = "photo", LINK = "link", CONDITION = "condition" }
export enum ValueSource { USER_INPUT = "user_input", FORMULA = "formula", DATABASE = "database", READONLY = "readonly" }
export enum LogicalOperator { AND = "AND", OR = "OR" }
export enum CompareOperator { EQ = "=", NEQ = "!=", GT = ">", LT = "<", GTE = ">=", LTE = "<=" }
export enum TaskType { APPROVAL = "approval", REVIEW = "review", SIGN = "sign", REVISION = "revision", CASCADE_UPDATE = "cascade_update", OTHER = "other" }
export enum TaskStatus { 
  PENDING = "pending", IN_REVIEW = "in_review", APPROVED = "approved", 
  NEEDS_REVISION = "needs_revision", REJECTED = "rejected", COMPLETED = "completed",
  CANCELED = "canceled" // ✅ НОВОЕ
}
export enum RouteType { SEQUENTIAL = "sequential", PARALLEL = "parallel" }
export enum AccessLevel { FULL = "full", REVIEW = "review", COMMENT = "comment", VIEW = "view" }
export enum StageStatus { 
  NOT_STARTED = "not_started", IN_PROGRESS = "in_progress", APPROVED = "approved", 
  NEEDS_REVISION = "needs_revision", REJECTED = "rejected",
  CANCELED = "canceled" // ✅ НОВОЕ
}
export enum HistoryAction { CREATED = "created", SENT_FOR_APPROVAL = "sent_for_approval", APPROVED = "approved", REJECTED = "rejected", NEEDS_REVISION = "needs_revision", COMMENTED = "commented", COMPLETED = "completed", VERSION_UPDATED = "version_updated",   RESUBMITTED = "resubmitted", WITHDRAWN = "withdrawn"  }
export enum UsageSource { DIRECT = "direct", VIA_CONDITION = "via_condition" }
export enum CascadeStatus { PENDING = "pending", TASK_CREATED = "task_created", APPLIED = "applied", SKIPPED = "skipped" }
export enum EditType { INSERTION = "insertion", DELETION = "deletion", REPLACEMENT = "replacement" }
export enum ResolutionStatus { PENDING = "pending", ACCEPTED = "accepted", REJECTED = "rejected" }
export enum OrphanReason { BLOCK_DELETED = "block_deleted", ANCHOR_DELETED = "anchor_deleted", TEXT_CHANGED = "text_changed" }
export enum AccessType { OWNER = "owner", FULL = "full", REVIEW = "review", COMMENT = "comment", VIEW = "view" }
export enum NotificationType { TASK_ASSIGNED = "task_assigned", TASK_REJECTED = "task_rejected", TASK_NEEDS_REVISION = "task_needs_revision", COMMENT_ADDED = "comment_added", APPROVAL_COMPLETED = "approval_completed", FORMULATION_UPDATED = "formulation_updated", SIGNATURE_REQUIRED = "signature_required", DOCUMENT_SENT = "document_sent" }
export enum RelatedEntityType { TASK = "task", DOCUMENT_SET = "document_set", FORMULATION = "formulation", COMMENT = "comment" }
export enum TextInputType { SHORT = "short", LONG = "long", LIST = "list" }

// ============================================================================
// 2. DATA MODELS (Interfaces)
// ============================================================================
export interface User { id: number; email: string; first_name: string; last_name: string; middle_name?: string; avatar_url?: string; is_active: boolean; created_at: string; updated_at: string; }
export interface Folder { id: number; parent_id?: number; name: string; owner_id: number; is_deleted: boolean; created_at: string; updated_at: string; }
export interface DocumentSet { 
    id: number; 
    folder_id?: number; 
    name: string; 
    mode: DocumentSetMode; 
    is_questionnaire_enabled: boolean; 
    approval_status: ApprovalStatus; 
    owner_id: number; 
    is_favorite: boolean; 
    is_anonymous_access: boolean; // ✅ НОВОЕ ПОЛЕ
    is_deleted: boolean; 
    deleted_at?: string; 
    created_at: string; 
    updated_at: string; 
}
export interface Document { id: number; document_set_id: number; name: string; document_role: DocumentRole; sort_order: number; created_at: string; updated_at: string; }
export interface DocumentVersion { id: number; document_id: number; version_number: number; content_html?: string; content_json: any; plain_text_cache?: string; file_path?: string; file_size?: number; author_id: number; change_reason?: string; is_current: boolean; created_at: string; }
export interface DocumentBlock { id: number; document_version_id: number; block_uuid: string; block_type: BlockType; block_path: string; parent_block_uuid?: string; sort_order: number; }
export interface DocumentAnchor { id: number; document_version_id: number; block_uuid: string; anchor_uuid: string; anchor_type: AnchorType; text_content: string; char_offset: number; char_length: number; }
export interface QuestionnaireSection { id: number; document_set_id: number; name: string; sort_order: number; is_table?: boolean; created_at: string; updated_at: string; }
export interface QuestionnaireProperty { id: number; document_set_id: number; section_id?: number | null; name: string; identifier: string; data_type: DataType; text_input_type?: TextInputType; options?: string[]; description?: string; hint?: string; placeholder?: string; is_required: boolean; hide_in_form: boolean; sort_order: number; value_source: ValueSource; formula?: string; format?: string; default_value?: string; display_condition_id?: number | null; created_at: string; updated_at: string; }
export interface QuestionnaireCondition { id: number; document_set_id: number; section_id?: number | null; name: string; is_enabled_default: boolean; sort_order: number; created_at: string; }
export interface ConditionRuleGroup { id: number; condition_id: number; parent_group_id?: number | null; logical_operator: LogicalOperator; sort_order: number; }
export interface ConditionRule { id: number; group_id: number; property_id: number; operator: CompareOperator; compare_value?: string; sort_order: number; }
export interface QuestionnaireAnswer { id: number; document_set_id: number; property_id: number; row_index?: number; value_text?: string; value_number?: number; value_date?: string; value_boolean?: boolean; answered_by?: number; answered_at?: string; created_at: string; updated_at: string; }
export interface FormulationType { id: number; name: string; sort_order: number; owner_id: number; }
export interface FormulationGroup { id: number; name: string; color_label?: string; description?: string; owner_id: number; created_at: string; updated_at: string; }
export interface Formulation { id: number; type_id?: number; group_id?: number; name: string; is_favorite: boolean; current_version_id?: number; created_by: number; created_at: string; updated_at: string; }
export interface FormulationVersion { id: number; formulation_id: number; version_number: number; text_content: string; change_reason?: string; author_id: number; is_current: boolean; created_at: string; }
export interface FormulationVariable { id: number; formulation_id: number; variable_name: string; created_at: string; }
export interface ConditionFormulationVariant { id: number; condition_id: number; formulation_id: number; formulation_version_id?: number; is_fallback: boolean; document_set_id: number; identifier: string; created_at: string; updated_at: string; }
export interface ConditionFullRenderData { condition: QuestionnaireCondition; groups: ConditionRuleGroup[]; rules: ConditionRule[]; variants: (ConditionFormulationVariant & { resolved_text?: string; formulation_name?: string })[]; }
export interface EnrichedFormulation extends Formulation { text_content: string; author_name: string; author_avatar: string; }
export interface FormulationVariantItem { variant: ConditionFormulationVariant; formulation: EnrichedFormulation; condition: QuestionnaireCondition; }
export interface FormulationGroupedByToken { identifier: string; variants: FormulationVariantItem[]; } 
export interface Task { id: number; parent_task_id?: number; document_set_id: number; name: string; description?: string; task_type: TaskType; status: TaskStatus; initiator_id: number; assignee_id: number; deadline?: string; route_type?: RouteType; completed_at?: string; created_at: string; updated_at: string; }
export interface ApprovalStage { id: number; task_id: number; stage_number: number; assignee_id: number; access_level: AccessLevel; status: StageStatus; comment?: string; completed_at?: string; created_at: string; }
export interface TaskAttachment { id: number; task_id: number; document_version_id: number; attached_by: number; created_at: string; }
export interface TaskHistory { id: number; task_id: number; root_task_id: number; user_id: number; action: HistoryAction; comment?: string; created_at: string; }
export interface ReviewEdit { id: number; document_version_id: number; task_id?: number; edit_type: EditType; old_text?: string; new_text?: string; block_uuid: string; anchor_from_uuid?: string; anchor_to_uuid?: string; char_offset_in_block?: number; char_length_in_block?: number; is_orphan: boolean; orphan_reason?: OrphanReason; author_id: number; resolution_status: ResolutionStatus; resolved_by?: number; resolved_at?: string; created_at: string; }
export interface Comment { id: number; document_version_id: number; task_id?: number; parent_comment_id?: number | null; block_uuid: string; anchor_uuid?: string; char_offset_in_block?: number; char_length_in_block?: number; is_orphan: boolean; orphan_resolved_at?: string; text_content: string; author_id: number; is_resolved: boolean; resolved_by?: number; resolved_at?: string; created_at: string; updated_at: string; }
export interface DocumentSetAccess { id: number; document_set_id: number; user_id: number; access_type: AccessType; expires_at?: string; granted_by: number; created_at: string; }
export interface Notification { id: number; user_id: number; type: NotificationType; title: string; message?: string; related_entity_type?: RelatedEntityType; related_entity_id?: number; is_read: boolean; created_at: string; }

// ============================================================================
// 3. REQUEST PAYLOADS (DTOs)
// ============================================================================
export interface RegisterPayload { email: string; password: string; first_name: string; last_name: string; middle_name?: string; }
export interface FolderPayload { name: string; parent_id?: number; }
export interface DocumentSetPayload { 
    name: string; 
    folder_id?: number; 
    mode?: DocumentSetMode; 
    is_questionnaire_enabled?: boolean; 
    is_favorite?: boolean; 
    is_anonymous_access?: boolean; // ✅ НОВОЕ ПОЛЕ
}
export interface DocumentPayload { name: string; document_role?: DocumentRole; sort_order?: number; }
export interface DocumentVersionPayload { content_html?: string; content_json: any; change_reason?: string; }
export interface BlockPayload { block_uuid: string; block_type: BlockType; block_path: string; parent_block_uuid?: string; sort_order?: number; }
export interface AnchorPayload { block_uuid: string; anchor_uuid: string; anchor_type: AnchorType; text_content: string; char_offset: number; char_length: number; }
export interface PropertyPayload { name: string; identifier: string; data_type: DataType; section_id?: number | null; text_input_type?: TextInputType; options?: string[]; description?: string; hint?: string; placeholder?: string; is_required?: boolean; hide_in_form?: boolean; sort_order?: number; value_source?: ValueSource; formula?: string; format?: string; default_value?: string; display_condition_id?: number | null; }
export interface ConditionPayload { name: string; section_id?: number | null; is_enabled_default?: boolean; sort_order?: number; }
export interface ConditionRuleGroupPayload { parent_group_id?: number | null; logical_operator?: LogicalOperator; sort_order?: number; }
export interface ConditionRulePayload { group_id: number; property_id: number; operator: CompareOperator; compare_value?: string; sort_order?: number; }
export interface AnswerItem {
    property_id: number;
    row_index: number;
    value: any;
}
export type AnswerPayload = AnswerItem[]; 
export interface ConditionFormulationVariantPayload { condition_id: number | null; formulation_id: number; formulation_version_id?: number; is_fallback?: boolean; document_set_id?: number; identifier?: string; }
export interface FormulationPayload { name: string; type_id?: number; group_id?: number; is_favorite?: boolean; }
export interface FormulationVersionPayload { text_content: string; change_reason?: string; }
export interface FormulationTypePayload { name: string; sort_order?: number; }
export interface FormulationGroupPayload { name: string; color_label?: string; description?: string; }
export interface FormulationVariablePayload { variable_name: string; }
export interface TaskPayload { document_set_id: number; name: string; description?: string; parent_task_id?: number; initiator_id?: number; task_type?: TaskType; assignee_id: number; deadline?: string; route_type?: RouteType; }
export interface ApprovalStagePayload { stage_number: number; assignee_id: number; access_level?: AccessLevel; comment?: string; }
export interface TaskHistoryPayload { action: HistoryAction; comment?: string; }
export interface TaskAttachmentPayload { document_version_id: number; } 
export interface CommentPayload { block_uuid: string; anchor_uuid?: string; char_offset_in_block?: number; char_length_in_block?: number; text_content: string; parent_comment_id?: number; task_id?: number;}
export interface ReviewEditPayload { edit_type: EditType; old_text?: string; new_text?: string; block_uuid: string; anchor_from_uuid?: string; anchor_to_uuid?: string; char_offset_in_block?: number; char_length_in_block?: number; }
export interface AccessPayload { user_id: number; access_type: AccessType; expires_at?: string; }
export interface BatchActionPayload { ids: number[]; action: 'trash' | 'move' | 'favorite'; folder_id?: number; }
export interface SectionPayload { name: string; sort_order?: number; is_table?: boolean;}
export interface UpdateProfilePayload { first_name?: string; last_name?: string; middle_name?: string; avatar_url?: string; password?: string; new_password?: string; }



// ============================================================================
// 1. ENUMS (Добавьте к существующим)
// ============================================================================
export enum SubscriptionStatus { 
    TRIAL = "trial", 
    ACTIVE = "active", 
    PAST_DUE = "past_due", 
    CANCELED = "canceled", 
    EXPIRED = "expired" 
}

export enum BillingPeriod { 
    MONTHLY = "monthly", 
    YEARLY = "yearly", 
    LIFETIME = "lifetime", 
    TRIAL = "trial" 
}

export enum WorkspaceRole { 
    OWNER = "owner", 
    ADMIN = "admin", 
    MEMBER = "member", 
    GUEST = "guest" 
}

// ============================================================================
// 2. DATA MODELS (Добавьте к существующим интерфейсам)
// ============================================================================
export interface TariffPlan {
    id: number;
    code: string;
    name: string;
    description?: string;
    price_monthly: number;
    price_yearly: number;
    limits_json: Record<string, any>; // Например: { max_users: 10, max_documents: 100 }
    features_json: string[];          // Например: ["api_access", "advanced_analytics"]
    is_public: boolean;
    is_active: boolean;
    sort_order: number;
}

export interface Workspace {
    id: number;
    name: string;
    owner_id: number;
    settings_json?: Record<string, any>;
    is_deleted: boolean;
    created_at: string;
    updated_at: string;
}

export interface WorkspaceMember {
    id: number;
    workspace_id: number;
    user_id: number;
    role: WorkspaceRole;
    invited_by?: number;
    joined_at: string;
    user?: User; // Опционально, если бэкенд будет отдавать данные юзера
}

export interface Subscription {
    id: number;
    workspace_id: number;
    tariff_plan_id: number;
    status: SubscriptionStatus;
    billing_period: BillingPeriod;
    started_at: string;
    expires_at?: string;
    trial_ends_at?: string;
    auto_renew: boolean;
    canceled_at?: string;
    tariff_plan?: TariffPlan; // Опционально, если бэкенд делает eager load
}

// ============================================================================
// 3. REQUEST PAYLOADS (DTOs) (Добавьте к существующим)
// ============================================================================
export interface WorkspaceCreatePayload {
    name: string;
}

export interface WorkspaceMemberAddPayload {
    user_id: number;
    role?: WorkspaceRole;
}

export interface ActivateTrialPayload {
    workspace_id: number;
}

// ============================================================================
// 4. DTO ДЛЯ ОТВЕТА ИМПОРТА ШАБЛОНА (ДЛЯ ГЕНЕРАЦИИ TAPTAP)
// ============================================================================

export interface SectionOut {
    id: number;
    name: string;
    is_table: boolean; // ✅ НОВОЕ
}

export interface PropertyOut {
    id: number;
    identifier: string;       // Уникальный ключ для TipTap
    name: string;             
    data_type: string;        // Значение из enum DataType
    section?: string | null;
    default_value?: string | null;
    options?: any;            // Для списков
    is_required: boolean;
    is_table?: boolean;
}

export interface ConditionRuleOut {
    property_identifier: string; // Связь с PropertyOut.identifier
    operator: string;            // Значение из enum CompareOperator
    compare_value: string;
}

export interface ConditionGroupOut {
    operator: string;            // Значение из enum LogicalOperator
    rules: ConditionRuleOut[];
    groups: ConditionGroupOut[]; // Рекурсия для вложенных AND/OR
}

export interface ConditionOut {
    id: number;
    name: string;
    section?: string | null;
    logic?: ConditionGroupOut | null;
}

export interface FormulationOut {
    id: number;
    name: string;
    type: string;
    text_content: string;       // Текст для вставки в TipTap
}

export interface VariantOut {
    id: number;
    identifier: string;         // ID слота в TipTap JSON
    condition_id?: number | null; 
    formulation: FormulationOut;
    is_fallback: boolean;
}

// ОБНОВЛЕННЫЙ ИНТЕРФЕЙС ОТВЕТА
export interface TemplateImportResponse {
    status: string;
    document_set_id: number;
    document_id: number;
    created: Record<string, number>; 
    warnings: string[];
    
    // === НОВЫЕ ДАННЫЕ ДЛЯ ГЕНЕРАЦИИ TAPTAP JSON ===
    sections: SectionOut[];
    properties: PropertyOut[];
    conditions: ConditionOut[];
    variants: VariantOut[];
}


export const tokenUtils = {
  setToken: (token: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('access_token', token);
  },
  getToken: () => {
    if (typeof window !== 'undefined') return localStorage.getItem('access_token');
    return null;
  },
  removeToken: () => {
    if (typeof window !== 'undefined') localStorage.removeItem('access_token');
  },
};


// ============================================================================
// API KEYS (Управление API-ключами воркспейса)
// ============================================================================
export interface ApiKeyCreatePayload {
    name: string;
    description?: string;
    scopes?: string[];
    allowed_ips?: string[];
    expires_in_days?: number;
}

export interface ApiKeyResponse {
    id: number;
    name: string;
    key_prefix: string;
    scopes: string[];
    is_active: boolean;
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

export interface ApiKeyCreatedResponse extends ApiKeyResponse {
    full_key: string; // ⚠️ Возвращается ТОЛЬКО при создании, содержит полный ключ
}

export interface ApiKeyRevokePayload {
    is_active: boolean;
}




export interface CheckoutPayload {
    workspace_id: number;
    tariff_plan_id: number;
    billing_period: BillingPeriod; // monthly или yearly
    return_url: string;
}

export interface CheckoutResponse {
    payment_url: string;
    payment_id: number;
}

export interface PaymentStatusResponse {
    status: string; // pending, success, canceled, failed
    payment_url?: string;
}

export interface ContactFormPayload {
    name: string;
    email: string;
    phone?: string;
    message: string;
}