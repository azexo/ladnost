// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// lib/realApi.ts
import {
    User, Folder, DocumentSet, Document, DocumentVersion,
    QuestionnaireSection, QuestionnaireProperty, QuestionnaireCondition, QuestionnaireAnswer,
    ConditionRuleGroup, ConditionRule, ConditionFormulationVariant, ConditionFullRenderData,
    FormulationType, FormulationGroup, Formulation, FormulationVersion, FormulationVariable,
    Task, ApprovalStage, TaskAttachment, TaskHistory,
    ReviewEdit, Comment, DocumentSetAccess, Notification,
    RegisterPayload, FolderPayload, DocumentSetPayload, DocumentPayload, DocumentVersionPayload,
    PropertyPayload, ConditionPayload, AnswerItem, AnswerPayload,
    ConditionRuleGroupPayload, ConditionRulePayload, ConditionFormulationVariantPayload,
    FormulationPayload, FormulationVersionPayload, FormulationTypePayload, FormulationGroupPayload,
    FormulationVariablePayload, TaskPayload, ApprovalStagePayload, TaskHistoryPayload,
    TaskAttachmentPayload, CommentPayload, ReviewEditPayload, AccessPayload,
    BatchActionPayload, SectionPayload, UpdateProfilePayload,
    DocumentSetMode, ApprovalStatus, DocumentRole, DataType, ValueSource, TextInputType,
    EditType, ResolutionStatus,
    AccessType, NotificationType, BlockType, AnchorType,
    AccessLevel, StageStatus, TaskType, TaskStatus, LogicalOperator, CompareOperator, RouteType, HistoryAction,
    TariffPlan, Workspace, WorkspaceMember, Subscription,
    WorkspaceCreatePayload, WorkspaceMemberAddPayload, ActivateTrialPayload,
    SubscriptionStatus, BillingPeriod, WorkspaceRole,
    CheckoutPayload, CheckoutResponse, PaymentStatusResponse,
    ApiKeyCreatePayload, ApiKeyResponse, ApiKeyCreatedResponse, ApiKeyRevokePayload,
    TemplateImportResponse,
    ContactFormPayload,
    tokenUtils
} from './types';
import { useNavbarStore } from '@/store/useNavbarStore';
// 🔹 Импортируем геттер для использования переводов вне React-компонентов
import { getT } from '@/store/i18nStore';

// ==========================================
// 1. НАСТРОЙКИ И HTTP КЛИЕНТ
// ==========================================
const BASE_URL = '/api/v1'; // Укажите актуальный URL вашего бэкенда

// Вспомогательная функция для формирования Query-параметров
const buildQueryString = (params?: Record<string, any>): string => {
    if (!params) return '';
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
                value.forEach(v => searchParams.append(key, String(v)));
            } else {
                searchParams.append(key, String(value));
            }
        }
    });
    const str = searchParams.toString();
    return str ? `?${str}` : '';
};

// Базовая функция для выполнения HTTP запросов
export async function request<T>(
    endpoint: string,
    options: RequestInit & { skipLogout?: boolean } = {}
): Promise<T> {
    const { skipLogout, ...restOptions } = options;
    const token = tokenUtils.getToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(restOptions.headers || {}),
    };
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        ...restOptions,
        headers,
    });

    // 🆕 ОБРАБОТКА 401 (UNAUTHORIZED)
    if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        // 🔹 Используем перевод
        const errorMessage = errorData.detail || getT()('api.errors.session_expired');

        if (!skipLogout) {
            tokenUtils.removeToken();
            useNavbarStore.getState().logout();
        }
        throw new Error(errorMessage);
    }

    // ✅ ОБРАБОТКА 402 (PAYMENT REQUIRED)
    if (response.status === 402) {
        if (window.location.pathname !== '/trial-expired') {
            window.location.href = '/trial-expired';
        }
        // 🔹 Используем перевод
        throw new Error(getT()('api.errors.access_limited_sales'));
    }

    // Общая обработка остальных ошибок
    if (!response.ok) {
        // 🔹 Используем перевод с передачей параметра status
        let errorMessage = getT()('api.errors.http_error', { status: response.status });
        try {
            const errorData = await response.json();
            if (errorData && errorData.detail) {
                if (typeof errorData.detail === 'string') {
                    errorMessage = errorData.detail;
                } else if (Array.isArray(errorData.detail)) {
                    errorMessage = errorData.detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join('; ');
                } else if (typeof errorData.detail === 'object') {
                    errorMessage = JSON.stringify(errorData.detail);
                }
            }
        } catch (e) { }
        throw new Error(errorMessage);
    }
    if (response.status === 204) return null as T;
    return response.json();
}

// ==========================================
// 2. УТИЛИТЫ (Для совместимости с фронтом)
// ==========================================
const getCurrentUserId = (): number => {
    const token = tokenUtils.getToken();
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return parseInt(payload.sub, 10);
        } catch (e) {
            // 🔹 Используем перевод для console.warn
            console.warn(getT()('api.warnings.jwt_parse_failed'));
        }
    }
    return 1; // fallback
};

// ==========================================
// 3. РЕАЛИЗАЦИЯ API (ЭНДПОИНТЫ)
// ==========================================
export const authApi = {
    activate: async (token: string) => {
        const response = await fetch('/api/v1/auth/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        if (!response.ok) {
            const error = await response.json();
            // 🔹 Используем перевод
            throw new Error(error.detail || getT()('api.errors.activation_error'));
        }
        return response.json();
    },
    resetPassword: async (token: string, newPassword: string) => {
        return request<any>('/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPassword }),
            skipLogout: true,
        });
    },
    login: async (username: string, password: string): Promise<{ access_token: string; token_type: string }> => {
        const res = await request<{ access_token: string; token_type: string }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
            skipLogout: true,
        });
        tokenUtils.setToken(res.access_token);
        return res;
    },
    register: async (data: RegisterPayload): Promise<User> => {
        return request<User>('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
            skipLogout: true,
        });
    },
    getMe: async (): Promise<User> => {
        return request<User>('/auth/me', { method: 'GET' });
    },
    forgotPassword: async (email: string): Promise<{ status: string }> => {
        return request<{ status: string }>('/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email }),
            skipLogout: true,
        });
    },
};

export const usersApi = {
    updateProfile: async (data: UpdateProfilePayload): Promise<User> => {
        return request<User>('/users/profile', {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    getById: async (id: number): Promise<User> => {
        return request<User>(`/users/${id}`, { method: 'GET' });
    },
    invite: async (email: string): Promise<User> => {
        return request<User>('/users/invite', {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
    },
    listRelated: async (): Promise<User[]> => {
        return request<User[]>('/users/related', { method: 'GET' });
    },
};

export const foldersApi = {
    listShared: async (): Promise<Folder[]> => {
        return request<Folder[]>('/folders/shared', { method: 'GET' });
    },
    restore: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/folders/${id}/restore`, { method: 'POST' });
    },
    permanentDelete: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/folders/${id}/permanent`, { method: 'DELETE' });
    },
    list: async (parentId?: number): Promise<Folder[]> => {
        const query = buildQueryString({ parent_id: parentId });
        return request<Folder[]>(`/folders/${query}`, { method: 'GET' });
    },
    create: async (data: FolderPayload): Promise<Folder> => {
        return request<Folder>('/folders/', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    update: async (id: number, data: Partial<FolderPayload>): Promise<Folder> => {
        return request<Folder>(`/folders/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    delete: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/folders/${id}`, { method: 'DELETE' });
    },
    getFolderAccess: async (folderId: number): Promise<any[]> => {
        return request<any[]>(`/folders/${folderId}/access`, { method: 'GET' });
    },
    grantFolderAccess: async (folderId: number, data: { user_id: number; access_type: AccessType }): Promise<any> => {
        return request<any>(`/folders/${folderId}/access`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    revokeFolderAccess: async (folderId: number, userId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/folders/${folderId}/access/${userId}`, { method: 'DELETE' });
    },
};

export const documentSetsApi = {
    getCommentsCounts: async (setIds: number[]): Promise<Record<number, number>> => {
        const query = buildQueryString({ set_ids: setIds });
        return request<Record<number, number>>(`/document-sets/comments-counts${query}`, { method: 'GET' });
    },
    permanentDelete: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/trash/document-sets/${id}`, { method: 'DELETE' });
    },
    cloneAsStandard: async (setId: number, newName: string, targetFolderId: number | null | undefined): Promise<DocumentSet> => {
        const params = new URLSearchParams();
        if (newName) params.append('new_name', newName);
        if (targetFolderId !== undefined && targetFolderId !== null) params.append('target_folder_id', String(targetFolderId));
        params.append('as_standard', 'true');
        return request<DocumentSet>(`/document-sets/${setId}/clone?${params.toString()}`, { method: 'POST' });
    },
    clone: async (setId: number, newName?: string): Promise<DocumentSet> => {
        const query = newName ? `?new_name=${encodeURIComponent(newName)}` : '';
        return request<DocumentSet>(`/document-sets/${setId}/clone${query}`, { method: 'POST' });
    },
    listShared: async (): Promise<DocumentSet[]> => {
        const all = await request<DocumentSet[]>('/document-sets/', { method: 'GET' });
        const currentUserId = getCurrentUserId();
        return all.filter(ds => ds.owner_id !== currentUserId && !ds.is_deleted);
    },
    list: async (params?: { folder_id?: number; status?: string }): Promise<DocumentSet[]> => {
        const query = buildQueryString(params);
        return request<DocumentSet[]>(`/document-sets/${query}`, { method: 'GET' });
    },
    getAccess: async (setId: number): Promise<DocumentSetAccess[]> => {
        return request<DocumentSetAccess[]>(`/document-sets/${setId}/access`, { method: 'GET' });
    },
    get: async (id: number): Promise<DocumentSet> => {
        return request<DocumentSet>(`/document-sets/${id}`, { method: 'GET' });
    },
    create: async (data: DocumentSetPayload): Promise<DocumentSet> => {
        return request<DocumentSet>('/document-sets/', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    update: async (id: number, data: Partial<DocumentSetPayload>): Promise<DocumentSet> => {
        return request<DocumentSet>(`/document-sets/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    move: async (id: number, folderId: number | null | undefined): Promise<{ status: string }> => {
        const query = folderId !== undefined && folderId !== null ? `?folder_id=${folderId}` : '';
        return request<{ status: string }>(`/document-sets/${id}/move${query}`, { method: 'POST' });
    },
    trash: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/document-sets/${id}/trash`, { method: 'POST' });
    },
    restore: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/trash/document-sets/${id}/restore`, { method: 'POST' });
    },
    batchAction: async (data: BatchActionPayload): Promise<{ status: string; affected: number }> => {
        return request<{ status: string; affected: number }>('/document-sets/batch', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    grantAccess: async (setId: number, data: AccessPayload): Promise<DocumentSetAccess> => {
        return request<DocumentSetAccess>(`/document-sets/${setId}/access`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateAccess: async (setId: number, accessId: number, data: Partial<AccessPayload>): Promise<DocumentSetAccess> => {
        return request<DocumentSetAccess>(`/document-sets/${setId}/access/${accessId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    revokeAccess: async (setId: number, accessId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/document-sets/${setId}/access/${accessId}`, { method: 'DELETE' });
    },
};

export const documentsApi = {
    makeVersionCurrent: async (docId: number, versionId: number): Promise<DocumentVersion> => {
        return request<DocumentVersion>(`/documents/${docId}/versions/${versionId}/make-current`, { method: 'PUT' });
    },
    create: async (setId: number, data: DocumentPayload): Promise<Document> => {
        return request<Document>(`/documents/sets/${setId}/documents`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    get: async (id: number): Promise<Document> => {
        return request<Document>(`/documents/${id}`, { method: 'GET' });
    },
    createVersion: async (docId: number, data: DocumentVersionPayload): Promise<DocumentVersion> => {
        return request<DocumentVersion>(`/documents/${docId}/versions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    listVersions: async (docId: number): Promise<DocumentVersion[]> => {
        return request<DocumentVersion[]>(`/documents/${docId}/versions`, { method: 'GET' });
    },
    getComments: async (docId: number): Promise<Comment[]> => {
        return request<Comment[]>(`/documents/${docId}/comments`, { method: 'GET' });
    },
    addComment: async (docId: number, data: CommentPayload): Promise<Comment> => {
        return request<Comment>(`/documents/${docId}/comments`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    resolveComment: async (commentId: number, data: { is_resolved: boolean }): Promise<Comment> => {
        return request<Comment>(`/documents/comments/${commentId}/resolve`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },
    addReviewEdit: async (docId: number, data: ReviewEditPayload): Promise<ReviewEdit> => {
        return request<ReviewEdit>(`/documents/${docId}/review-edits`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    listBySet: async (setId: number): Promise<Document[]> => {
        return request<Document[]>(`/documents/sets/${setId}/documents`, { method: 'GET' });
    },
    rename: async (id: number, name: string): Promise<Document> => {
        return request<Document>(`/documents/${id}/rename`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
        });
    },
    remove: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/documents/${id}`, { method: 'DELETE' });
    },
    updateContent: async (docId: number, json: any, html?: string): Promise<{ status: string }> => {
        return request<{ status: string }>(`/documents/${docId}/content`, {
            method: 'PUT',
            body: JSON.stringify({ content_json: json, content_html: html }),
        });
    },
    uploadSourceFile: async (docId: number, file: File, workspaceId?: number): Promise<{ status: string; file_path: string; file_size: number }> => {
        const token = tokenUtils.getToken();
        const formData = new FormData();
        formData.append('file', file);
        const query = workspaceId ? `?workspace_id=${workspaceId}` : '';
        const response = await fetch(`${BASE_URL}/documents/${docId}/upload-source-file${query}`, {
            method: 'POST',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: formData,
        });

        if (response.status === 401) {
            tokenUtils.removeToken();
            useNavbarStore.getState().logout();
            // 🔹 Используем перевод
            throw new Error(getT()('api.errors.session_expired'));
        }
        if (!response.ok) {
            // 🔹 Используем перевод с параметром
            let errorMessage = getT()('api.errors.http_error', { status: response.status });
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorMessage;
            } catch (e) { }
            throw new Error(errorMessage);
        }
        return response.json();
    },
    downloadArchive: async (setId: number): Promise<Blob> => {
        const token = tokenUtils.getToken();
        const response = await fetch(`${BASE_URL}/documents/sets/${setId}/download-archive`, {
            method: 'GET',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
        });

        if (response.status === 401) {
            tokenUtils.removeToken();
            useNavbarStore.getState().logout();
            // 🔹 Используем перевод
            throw new Error(getT()('api.errors.session_expired'));
        }
        if (response.status === 402) {
            window.location.href = '/trial-expired';
            // 🔹 Используем перевод
            throw new Error(getT()('api.errors.access_limited'));
        }
        if (!response.ok) {
            // 🔹 Используем перевод с параметром
            let errorMessage = getT()('api.errors.http_error', { status: response.status });
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorMessage;
            } catch (e) { }
            throw new Error(errorMessage);
        }
        return response.blob();
    },
};

export const questionnaireApi = {
    getSections: async (setId: number): Promise<QuestionnaireSection[]> => {
        return request<QuestionnaireSection[]>(`/questionnaire/${setId}/sections`, { method: 'GET' });
    },
    addSection: async (setId: number, data: SectionPayload): Promise<QuestionnaireSection> => {
        return request<QuestionnaireSection>(`/questionnaire/${setId}/sections`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateSection: async (id: number, data: Partial<SectionPayload>): Promise<QuestionnaireSection> => {
        return request<QuestionnaireSection>(`/questionnaire/sections/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    deleteSection: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/questionnaire/sections/${id}`, { method: 'DELETE' });
    },
    getProperties: async (setId: number): Promise<QuestionnaireProperty[]> => {
        return request<QuestionnaireProperty[]>(`/questionnaire/${setId}/properties`, { method: 'GET' });
    },
    addProperty: async (setId: number, data: PropertyPayload): Promise<QuestionnaireProperty> => {
        return request<QuestionnaireProperty>(`/questionnaire/${setId}/properties`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateProperty: async (setId: number, propId: number, data: Partial<PropertyPayload>): Promise<QuestionnaireProperty> => {
        return request<QuestionnaireProperty>(`/questionnaire/${setId}/properties/${propId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    deleteProperty: async (setId: number, propId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/questionnaire/${setId}/properties/${propId}`, { method: 'DELETE' });
    },
    getConditions: async (setId: number): Promise<QuestionnaireCondition[]> => {
        return request<QuestionnaireCondition[]>(`/questionnaire/${setId}/conditions`, { method: 'GET' });
    },
    addCondition: async (setId: number, data: ConditionPayload): Promise<QuestionnaireCondition> => {
        return request<QuestionnaireCondition>(`/questionnaire/${setId}/conditions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateCondition: async (setId: number, conditionId: number, data: Partial<ConditionPayload>): Promise<QuestionnaireCondition> => {
        return request<QuestionnaireCondition>(`/questionnaire/${setId}/conditions/${conditionId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    deleteCondition: async (setId: number, conditionId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/questionnaire/${setId}/conditions/${conditionId}`, { method: 'DELETE' });
    },
    getConditionLogic: async (conditionId: number): Promise<{ groups: ConditionRuleGroup[], rules: ConditionRule[] }> => {
        return request<{ groups: ConditionRuleGroup[], rules: ConditionRule[] }>(`/questionnaire/conditions/${conditionId}/logic`, { method: 'GET' });
    },
    addConditionRuleGroup: async (conditionId: number, data: ConditionRuleGroupPayload): Promise<ConditionRuleGroup> => {
        return request<ConditionRuleGroup>(`/questionnaire/conditions/${conditionId}/groups`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateConditionRuleGroup: async (groupId: number, data: Partial<ConditionRuleGroupPayload>): Promise<ConditionRuleGroup> => {
        return request<ConditionRuleGroup>(`/questionnaire/groups/${groupId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    deleteConditionRuleGroup: async (groupId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/questionnaire/groups/${groupId}`, { method: 'DELETE' });
    },
    addConditionRule: async (conditionId: number, data: ConditionRulePayload): Promise<ConditionRule> => {
        return request<ConditionRule>(`/questionnaire/conditions/${conditionId}/rules`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateConditionRule: async (ruleId: number, data: Partial<ConditionRulePayload>): Promise<ConditionRule> => {
        return request<ConditionRule>(`/questionnaire/rules/${ruleId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    deleteConditionRule: async (ruleId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/questionnaire/rules/${ruleId}`, { method: 'DELETE' });
    },
    saveAnswers: async (setId: number, data: AnswerPayload): Promise<any> => {
        return request<any>(`/questionnaire/${setId}/answers`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    getAnswers: async (setId: number): Promise<AnswerItem[]> => {
        return request<AnswerItem[]>(`/questionnaire/${setId}/answers`, {
            method: 'GET'
        });
    },
    addUnassignedVariant: async (data: any): Promise<ConditionFormulationVariant> => {
        return request<ConditionFormulationVariant>('/questionnaire/variants/unassigned', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    getConditionVariants: async (conditionId: number): Promise<ConditionFormulationVariant[]> => {
        return request<ConditionFormulationVariant[]>(`/questionnaire/conditions/${conditionId}/variants`, { method: 'GET' });
    },
    addConditionVariant: async (conditionId: number, data: ConditionFormulationVariantPayload): Promise<ConditionFormulationVariant> => {
        return request<ConditionFormulationVariant>(`/questionnaire/conditions/${conditionId}/variants`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateConditionVariant: async (variantId: number, data: Partial<ConditionFormulationVariantPayload>): Promise<ConditionFormulationVariant> => {
        return request<ConditionFormulationVariant>(`/questionnaire/variants/${variantId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    deleteConditionVariant: async (variantId: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/questionnaire/variants/${variantId}`, { method: 'DELETE' });
    },
    getConditionFullRenderData: async (conditionId: number): Promise<ConditionFullRenderData> => {
        return request<ConditionFullRenderData>(`/questionnaire/conditions/${conditionId}/variants/full-render`, { method: 'GET' });
    }
};

export const formulationsApi = {
    deleteFormulation: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/formulations/${id}`, { method: 'DELETE' });
    },
    toggleFavorite: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/formulations/${id}/toggle-favorite`, { method: 'POST' });
    },
    list: async (typeId?: number): Promise<any[]> => {
        const query = typeId ? `?type_id=${typeId}` : '';
        return request<any[]>(`/formulations/${query}`, { method: 'GET' });
    },
    listByAuthor: async (authorId: number): Promise<any[]> => {
        return request<any[]>(`/formulations/by-author/${authorId}`, { method: 'GET' });
    },
    listUsedInSet: async (setId: number): Promise<any[]> => {
        return request<any[]>(`/formulations/used-in-set/${setId}`, { method: 'GET' });
    },
    get: async (id: number): Promise<Formulation> => {
        return request<Formulation>(`/formulations/${id}`, { method: 'GET' });
    },
    create: async (data: FormulationPayload): Promise<Formulation> => {
        return request<Formulation>('/formulations/', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    createVersion: async (id: number, data: FormulationVersionPayload): Promise<FormulationVersion> => {
        return request<FormulationVersion>(`/formulations/${id}/versions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    update: async (id: number, data: Partial<FormulationPayload>): Promise<Formulation> => {
        return request<Formulation>(`/formulations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    getTypes: async (): Promise<FormulationType[]> => {
        return request<FormulationType[]>('/formulations/types', { method: 'GET' });
    },
    createType: async (data: FormulationTypePayload): Promise<FormulationType> => {
        return request<FormulationType>('/formulations/types', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    updateType: async (id: number, data: any): Promise<FormulationType> => {
        return request<FormulationType>(`/formulations/types/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
    moveType: async (id: number, direction: 'up' | 'down'): Promise<{ status: string }> => {
        return request<{ status: string }>(`/formulations/types/${id}/move?direction=${direction}`, { method: 'POST' });
    },
    deleteType: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/formulations/types/${id}`, { method: 'DELETE' });
    },
    getGroups: async (): Promise<FormulationGroup[]> => {
        return request<FormulationGroup[]>('/formulations/groups', { method: 'GET' });
    },
    createGroup: async (data: FormulationGroupPayload): Promise<FormulationGroup> => {
        return request<FormulationGroup>('/formulations/groups', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    addVariable: async (id: number, data: FormulationVariablePayload): Promise<FormulationVariable> => {
        return request<FormulationVariable>(`/formulations/${id}/variables`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    getUsage: async (id: number): Promise<{ count: number; document_sets: DocumentSet[] }> => {
        return request<{ count: number; document_sets: DocumentSet[] }>(`/formulations/${id}/usage`, { method: 'GET' });
    },
};

export const tasksApi = {
    list: async (params?: { assignee_id?: number; initiator_id?: number; status?: string; parent_task_id?: number | null; is_root?: boolean }): Promise<Task[]> => {
        const query = buildQueryString(params);
        return request<Task[]>(`/tasks/${query}`, { method: 'GET' });
    },
    get: async (id: number): Promise<Task> => {
        return request<Task>(`/tasks/${id}`, { method: 'GET' });
    },
    getSubtasks: async (parentId: number): Promise<Task[]> => {
        return request<Task[]>(`/tasks/${parentId}/subtasks`, { method: 'GET' });
    },
    getStages: async (taskId: number): Promise<ApprovalStage[]> => {
        return request<ApprovalStage[]>(`/tasks/${taskId}/stages`, { method: 'GET' });
    },
    getAttachments: async (taskId: number): Promise<TaskAttachment[]> => {
        return request<TaskAttachment[]>(`/tasks/${taskId}/attachments`, { method: 'GET' });
    },
    create: async (data: TaskPayload): Promise<Task> => {
        const { initiator_id, ...rest } = data as any;
        return request<Task>('/tasks/', {
            method: 'POST',
            body: JSON.stringify(rest),
        });
    },
    addStage: async (id: number, data: ApprovalStagePayload): Promise<ApprovalStage> => {
        return request<ApprovalStage>(`/tasks/${id}/stages`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    approve: async (id: number, data?: any): Promise<{ status: string }> => {
        return request<{ status: string }>(`/tasks/${id}/approve`, {
            method: 'POST',
            body: data ? JSON.stringify(data) : '{}',
        });
    },
    reject: async (id: number, data?: any): Promise<{ status: string }> => {
        return request<{ status: string }>(`/tasks/${id}/reject`, {
            method: 'POST',
            body: data ? JSON.stringify(data) : '{}',
        });
    },
    requestRevision: async (id: number, data: { comment?: string }): Promise<{ status: string }> => {
        return request<{ status: string }>(`/tasks/${id}/revision`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    resubmit: async (id: number, data?: { comment?: string }): Promise<{ status: string }> => {
        return request<{ status: string }>(`/tasks/${id}/resubmit`, {
            method: 'POST',
            body: data ? JSON.stringify(data) : '{}',
        });
    },
    withdraw: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/tasks/${id}/withdraw`, {
            method: 'POST',
        });
    },
    getHistory: async (id: number): Promise<TaskHistory[]> => {
        return request<TaskHistory[]>(`/tasks/${id}/history`, { method: 'GET' });
    },
    addHistory: async (id: number, data: TaskHistoryPayload): Promise<TaskHistory> => {
        return request<TaskHistory>(`/tasks/${id}/history`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    attachDocument: async (id: number, data: TaskAttachmentPayload): Promise<TaskAttachment> => {
        return request<TaskAttachment>(`/tasks/${id}/attachments`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
};

export const notificationsApi = {
    list: async (): Promise<Notification[]> => {
        return request<Notification[]>('/notifications/', { method: 'GET' });
    },
    markRead: async (id: number): Promise<{ status: string }> => {
        return request<{ status: string }>(`/notifications/${id}/read`, { method: 'PATCH' });
    },
    markAllRead: async (): Promise<{ status: string }> => {
        return request<{ status: string }>('/notifications/read-all', { method: 'PATCH' });
    },
};

export const trashApi = {
    get: async (): Promise<{ folders: Folder[]; document_sets: DocumentSet[] }> => {
        return request<{ folders: Folder[]; document_sets: DocumentSet[] }>('/trash/', { method: 'GET' });
    },
};

export const commentsApi = {
    list: async (versionId: number): Promise<Comment[]> => {
        return request<Comment[]>(`/comments/${versionId}`, { method: 'GET' });
    },
    add: async (versionId: number, data: CommentPayload): Promise<Comment> => {
        return request<Comment>(`/comments/${versionId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    resolve: async (commentId: number, isResolved: boolean): Promise<Comment> => {
        return request<Comment>(`/comments/${commentId}/resolve`, {
            method: 'PATCH',
            body: JSON.stringify({ is_resolved: isResolved }),
        });
    }
};

// ============================================================================
// РЕАЛИЗАЦИЯ API (ЭНДПОИНТЫ)
// ============================================================================
export const templateImportApi = {
    importFromYaml: async (yamlContent: string, markdownBody: string): Promise<TemplateImportResponse> => {
        return request<TemplateImportResponse>('/template_import/import', {
            method: 'POST',
            body: JSON.stringify({
                yaml_content: yamlContent,
                markdown_body: markdownBody,
            }),
        });
    },
    importFromFile: async (file: File, userId: number = 1): Promise<TemplateImportResponse> => {
        const token = tokenUtils.getToken();
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', String(userId));

        const response = await fetch(`${BASE_URL}/template_import/import-file`, {
            method: 'POST',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: formData,
        });

        if (response.status === 401) {
            tokenUtils.removeToken();
            useNavbarStore.getState().logout();
            // 🔹 Используем перевод
            throw new Error(getT()('api.errors.session_expired'));
        }
        if (!response.ok) {
            // 🔹 Используем перевод с параметром
            let errorMessage = getT()('api.errors.http_error', { status: response.status });
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorMessage;
            } catch (e) { }
            throw new Error(errorMessage);
        }
        return response.json();
    },
};

// ============================================================================
// RENDERER
// ============================================================================
export const rendererApi = {
    renderHtml: async (payload: {
        document_version_id?: number;
        document_id?: number;
        document_set_id?: number;
        answers?: Record<string, any>;
    }): Promise<{ html: string; status: string; meta: any }> => {
        return request<{ html: string; status: string; meta: any }>('/documents/render-html', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
};

// ============================================================================
// WORKSPACES
// ============================================================================
export const workspacesApi = {
    create: async (data: WorkspaceCreatePayload): Promise<Workspace> => {
        return request<Workspace>('/workspaces/', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    getMy: async (): Promise<Workspace[]> => {
        return request<Workspace[]>('/workspaces/my', { method: 'GET' });
    },
    addMember: async (workspaceId: number, data: WorkspaceMemberAddPayload): Promise<{ message: string; role: string }> => {
        return request<{ message: string; role: string }>(`/workspaces/${workspaceId}/members`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
};

// ============================================================================
// BILLING
// ============================================================================
export const billingApi = {
    getTariffs: async (): Promise<TariffPlan[]> => {
        return request<TariffPlan[]>('/billing/tariffs', { method: 'GET' });
    },
    activateTrial: async (data: ActivateTrialPayload): Promise<Subscription> => {
        return request<Subscription>('/billing/trial/activate', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    getWorkspaceSubscription: async (workspaceId: number): Promise<Subscription> => {
        return request<Subscription>(`/billing/workspaces/${workspaceId}/subscription`, { method: 'GET' });
    },
    createCheckoutSession: async (data: CheckoutPayload): Promise<CheckoutResponse> => {
        return request<CheckoutResponse>('/billing/checkout', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    getPaymentStatus: async (paymentId: number): Promise<PaymentStatusResponse> => {
        return request<PaymentStatusResponse>(`/billing/payments/${paymentId}/status`, {
            method: 'GET',
        });
    },
};

// ============================================================================
// API KEYS
// ============================================================================
export const apiKeysApi = {
    create: async (workspaceId: number, data: ApiKeyCreatePayload): Promise<ApiKeyCreatedResponse> => {
        return request<ApiKeyCreatedResponse>(`/workspaces/${workspaceId}/api-keys`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
    list: async (workspaceId: number): Promise<ApiKeyResponse[]> => {
        return request<ApiKeyResponse[]>(`/workspaces/${workspaceId}/api-keys`, {
            method: 'GET',
        });
    },
    delete: async (workspaceId: number, keyId: number): Promise<void> => {
        return request<void>(`/workspaces/${workspaceId}/api-keys/${keyId}`, {
            method: 'DELETE',
        });
    },
    toggle: async (workspaceId: number, keyId: number, data: ApiKeyRevokePayload): Promise<ApiKeyResponse> => {
        return request<ApiKeyResponse>(`/workspaces/${workspaceId}/api-keys/${keyId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },
};

export const contactApi = {
    submit: async (data: ContactFormPayload): Promise<{ status: string; message: string }> => {
        return request<{ status: string; message: string }>('/users/contact', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },
};