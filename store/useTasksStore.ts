// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand';
import {
  Task, User, ApprovalStage, TaskHistory, TaskAttachment, Comment,
  TaskStatus, DocumentSet, Document, DocumentVersion, TaskType
} from '../lib/types';
import { tasksApi, usersApi, documentsApi, commentsApi, documentSetsApi } from '../lib/realApi';
import { useNavbarStore } from './useNavbarStore';
import { getT } from './i18nStore';

// ============================================================================
// ТИПЫ И ИНТЕРФЕЙСЫ
// ============================================================================
export type TaskTab = 'all' | 'my' | 'assigned_by_me';

export interface TaskDetailsState {
  task: Task | null;
  subtasks: Task[];
  stages: ApprovalStage[];
  history: TaskHistory[];
  attachments: TaskAttachment[];
  comments: Comment[];
  currentVersionId: number | null;
  documentsMap: Record<number, string>;
}

interface TasksStoreState {
  // --- Данные ---
  tasks: Task[];
  usersMap: Record<number, User>;
  selectedTaskId: number | null;
  taskDetails: TaskDetailsState | null;
  // --- Фильтры ---
  activeTab: TaskTab;
  statusFilter: string | null;
  // --- UI State ---
  isLoadingTasks: boolean;
  isLoadingDetails: boolean;
  isSubmitting: boolean;
  error: string | null;
  // --- Действия (Actions) ---
  initialize: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  selectTask: (taskId: number | null) => Promise<void>;
  setTab: (tab: TaskTab) => void;
  setStatusFilter: (status: string | null) => void;
  approveTask: (taskId: number, comment?: string) => Promise<void>;
  rejectTask: (taskId: number, comment?: string) => Promise<void>;
  requestRevision: (taskId: number, comment?: string) => Promise<void>;
  addComment: (versionId: number, text: string, parentCommentId?: number) => Promise<void>;
  resolveComment: (commentId: number, isResolved: boolean) => Promise<void>;
  resubmitTask: (taskId: number) => Promise<void>;
  withdrawTask: (taskId: number) => Promise<void>;
  createSubtask: (
    parentTaskId: number,
    payload: {
      name: string;
      assignee_id: number;
      description?: string;
      deadline?: string;
      task_type?: string;
    }
  ) => Promise<void>;
  sendForApproval: (payload: {
    documentSetId: number;
    taskName: string;
    comment: string;
    deadline: string | null;
    routeType: 'parallel' | 'sequential';
    participants: Array<{ id: number; access: string }>;
  }) => Promise<void>;
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================
// ✅ Вспомогательная функция для получения ID текущего пользователя
const getCurrentUserId = (): number | undefined => {
  return useNavbarStore.getState().user?.id;
};

// ✅ Маппинг статусов вынесен в функцию, чтобы getT() вызывался динамически 
// (иначе переводы инициализировались бы до загрузки next-intl)
export const getTaskStatusLabels = (): Record<string, string> => {
  const t = getT();
  return {
    [TaskStatus.PENDING]: t('tasks.statuses.pending'),
    [TaskStatus.IN_REVIEW]: t('tasks.statuses.inReview'),
    [TaskStatus.APPROVED]: t('tasks.statuses.approved'),
    [TaskStatus.NEEDS_REVISION]: t('tasks.statuses.needsRevision'),
    [TaskStatus.REJECTED]: t('tasks.statuses.rejected'),
    [TaskStatus.COMPLETED]: t('tasks.statuses.completed'),
    [TaskStatus.CANCELED]: t('tasks.statuses.canceled'),
  };
};

// ============================================================================
// СОЗДАНИЕ СОТОРА
// ============================================================================
export const useTasksStore = create<TasksStoreState>((set, get) => ({
  tasks: [],
  usersMap: {},
  selectedTaskId: null,
  taskDetails: null,
  activeTab: 'my',
  statusFilter: null,
  isLoadingTasks: false,
  isLoadingDetails: false,
  isSubmitting: false,
  error: null,

  initialize: async () => {
    set({ isLoadingTasks: true });
    try {
      const users = await usersApi.listRelated();
      const usersMap: Record<number, User> = {};
      users.forEach(u => { usersMap[u.id] = u; });
      set({ usersMap });
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoadingTasks: false });
    }
  },

  resubmitTask: async (taskId) => {
    set({ isSubmitting: true });
    try {
      await tasksApi.resubmit(taskId);
      await get().fetchTasks();
      if (get().selectedTaskId === taskId) await get().selectTask(taskId);
    } catch (error: any) { set({ error: error.message }); }
    finally { set({ isSubmitting: false }); }
  },

  withdrawTask: async (taskId) => {
    set({ isSubmitting: true });
    try {
      await tasksApi.withdraw(taskId);
      await get().fetchTasks();
      if (get().selectedTaskId === taskId) await get().selectTask(taskId);
    } catch (error: any) { set({ error: error.message }); }
    finally { set({ isSubmitting: false }); }
  },

  fetchTasks: async () => {
    set({ isLoadingTasks: true, error: null });
    try {
      const { activeTab, statusFilter } = get();
      const params: any = {};
      const currentUserId = getCurrentUserId();
      
      if (activeTab === 'my' || activeTab === 'assigned_by_me') {
        if (!currentUserId) {
          set({ tasks: [], isLoadingTasks: false });
          return;
        }
      }
      if (activeTab === 'my') params.assignee_id = currentUserId;
      else if (activeTab === 'assigned_by_me') params.initiator_id = currentUserId;
      
      params.is_root = true;
      if (statusFilter) params.status = statusFilter;
      
      const tasks = await tasksApi.list(params);
      set({ tasks });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoadingTasks: false });
    }
  },

  selectTask: async (taskId) => {
    set({ selectedTaskId: taskId, isLoadingDetails: true, taskDetails: null });
    if (!taskId) return;
    try {
      const [task, subtasks, stages, history, attachments] = await Promise.all([
        tasksApi.get(taskId),
        tasksApi.getSubtasks(taskId),
        tasksApi.getStages(taskId),
        tasksApi.getHistory(taskId),
        tasksApi.getAttachments(taskId),
      ]);

      let comments: Comment[] = [];
      let currentVersionId: number | null = null;
      let documentsMap: Record<number, string> = {};

      if (task.document_set_id) {
        try {
          const docs = await documentsApi.listBySet(task.document_set_id);
          for (const doc of docs) {
            const versions = await documentsApi.listVersions(doc.id);
            for (const v of versions) {
              documentsMap[v.id] = doc.name;
            }
          }
          const mainDoc = docs.find(d => d.document_role === 'main') || docs[0];
          if (mainDoc) {
            const versions = await documentsApi.listVersions(mainDoc.id);
            const currentVersion = versions.find(v => v.is_current);
            if (currentVersion) {
              currentVersionId = currentVersion.id;
              comments = await commentsApi.list(currentVersion.id);
            }
          }
        } catch (e) {
          // ✅ Используем next-intl для лога/ошибки
          console.warn(getT()('tasks.errors.loadCommentsFailed'), e);
        }
      }

      set({
        taskDetails: { task, subtasks, stages, history, attachments, comments, currentVersionId, documentsMap }
      });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoadingDetails: false });
    }
  },

  setTab: (tab) => {
    set({ activeTab: tab, statusFilter: null });
    get().fetchTasks();
  },

  setStatusFilter: (status) => {
    set({ statusFilter: status, activeTab: 'all' });
    get().fetchTasks();
  },

  approveTask: async (taskId, comment) => {
    set({ isSubmitting: true });
    try {
      await tasksApi.approve(taskId, { comment });
      await get().fetchTasks();
      if (get().selectedTaskId === taskId) await get().selectTask(taskId);
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isSubmitting: false });
    }
  },

  rejectTask: async (taskId, comment) => {
    set({ isSubmitting: true });
    try {
      await tasksApi.reject(taskId, { comment });
      await get().fetchTasks();
      if (get().selectedTaskId === taskId) await get().selectTask(taskId);
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isSubmitting: false });
    }
  },

  requestRevision: async (taskId, comment) => {
    set({ isSubmitting: true });
    try {
      await tasksApi.requestRevision(taskId, { comment });
      await get().fetchTasks();
      if (get().selectedTaskId === taskId) await get().selectTask(taskId);
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isSubmitting: false });
    }
  },

  addComment: async (versionId, text, parentCommentId) => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) {
      // ✅ Перевод ошибки
      set({ error: getT()('tasks.errors.unauthorized') });
      return;
    }
    try {
      const newComment = await commentsApi.add(versionId, {
        text_content: text,
        parent_comment_id: parentCommentId,
        block_uuid: '', 
      });
      set((state) => {
        if (state.taskDetails) {
          return {
            taskDetails: {
              ...state.taskDetails,
              comments: [...state.taskDetails.comments, newComment]
            }
          };
        }
        return {};
      });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  resolveComment: async (commentId, isResolved) => {
    try {
      await commentsApi.resolve(commentId, isResolved);
      set((state) => {
        if (state.taskDetails) {
          return {
            taskDetails: {
              ...state.taskDetails,
              comments: state.taskDetails.comments.map(c =>
                c.id === commentId ? { ...c, is_resolved: isResolved } : c
              )
            }
          };
        }
        return {};
      });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  createSubtask: async (parentTaskId, payload) => {
    set({ isSubmitting: true, error: null });
    const currentUserId = getCurrentUserId();
    
    if (!currentUserId) {
      // ✅ Перевод ошибки
      set({ error: getT()('tasks.errors.unauthorized'), isSubmitting: false });
      return;
    }
    
    try {
      const parentTask = await tasksApi.get(parentTaskId);
      const newTaskData: any = {
        parent_task_id: parentTaskId,
        document_set_id: parentTask.document_set_id,
        name: payload.name,
        description: payload.description || '',
        task_type: payload.task_type || TaskType.REVIEW, 
        assignee_id: payload.assignee_id,
        deadline: payload.deadline || undefined,
        initiator_id: currentUserId,
      };
      await tasksApi.create(newTaskData);
      
      if (get().selectedTaskId === parentTaskId) {
        await get().selectTask(parentTaskId);
      }
    } catch (error: any) {
      set({ error: error.message });
      // ✅ Перевод лога
      console.error(getT()('tasks.errors.createSubtaskFailed'), error);
    } finally {
      set({ isSubmitting: false });
    }
  },

  sendForApproval: async (payload) => {
    set({ isSubmitting: true, error: null });
    try {
      const newTask = await tasksApi.create({
        document_set_id: payload.documentSetId,
        name: payload.taskName,
        description: payload.comment,
        task_type: TaskType.APPROVAL,
        assignee_id: payload.participants[0].id,
        deadline: payload.deadline || undefined,
        route_type: payload.routeType
      } as any);

      const docs = await documentsApi.listBySet(payload.documentSetId);
      for (const doc of docs) {
        const versions = await documentsApi.listVersions(doc.id);
        const currentVersion = versions.find(v => v.is_current);
        if (currentVersion) {
          await tasksApi.attachDocument(newTask.id, {
            document_version_id: currentVersion.id,
          } as any);
        }
      }

      for (let i = 0; i < payload.participants.length; i++) {
        await tasksApi.addStage(newTask.id, {
          stage_number: i + 1,
          assignee_id: payload.participants[i].id,
          access_level: payload.participants[i].access,
          comment: ''
        } as any);
      }

      await tasksApi.addHistory(newTask.id, {
        action: 'sent_for_approval',
        comment: payload.comment
      } as any);

      await documentSetsApi.update(payload.documentSetId, {
        approval_status: 'in_approval'
      } as any);

      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isSubmitting: false });
    }
  },
}));