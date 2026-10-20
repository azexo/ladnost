// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useEffect, useState, Fragment } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTasksStore, getTaskStatusLabels } from '@/store/useTasksStore';
import { TaskStatus, StageStatus, HistoryAction, Task, User } from '@/lib/types';
import { tasksApi } from '@/lib/realApi';
import { useNavbarStore } from '@/store/useNavbarStore';

// Вспомогательные функции для стилизации статусов
const getStatusBadgeClasses = (status: string) => {
    switch (status) {
        case TaskStatus.PENDING: return 'bg-slate-100 text-slate-600 border-slate-200';
        case TaskStatus.IN_REVIEW: return 'bg-amber-50 text-amber-700 border-amber-100';
        case TaskStatus.APPROVED: return 'bg-green-50 text-green-700 border-green-100';
        case TaskStatus.NEEDS_REVISION: return 'bg-purple-50 text-purple-700 border-purple-100';
        case TaskStatus.REJECTED: return 'bg-red-50 text-red-700 border-red-100';
        case TaskStatus.COMPLETED: return 'bg-green-50 text-green-700 border-green-100';
        default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
};

const getStatusIcon = (status: string) => {
    switch (status) {
        case TaskStatus.PENDING: return 'fa-hourglass-half';
        case TaskStatus.IN_REVIEW: return 'fa-clock';
        case TaskStatus.APPROVED: return 'fa-circle-check';
        case TaskStatus.NEEDS_REVISION: return 'fa-rotate';
        case TaskStatus.REJECTED: return 'fa-circle-xmark';
        case TaskStatus.COMPLETED: return 'fa-circle-check';
        default: return 'fa-circle-dot';
    }
};

export default function Tasks() {
    const t = useTranslations('tasks');
    
    const {
        tasks, usersMap, selectedTaskId, taskDetails, activeTab, statusFilter,
        isLoadingTasks, isLoadingDetails, isSubmitting,
        initialize, selectTask, setTab, setStatusFilter,
        approveTask, rejectTask, requestRevision, addComment, resubmitTask, withdrawTask
    } = useTasksStore();
    
    const currentUserId = useNavbarStore(state => state.user?.id);
    const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
    const [subtasksMap, setSubtasksMap] = useState<Record<number, Task[]>>({});
    const [activePanelTab, setActivePanelTab] = useState<'details' | 'comments' | 'route' | 'history'>('details');
    const [newCommentText, setNewCommentText] = useState('');
    const [replyingTo, setReplyingTo] = useState<number | null>(null);
    const [replyText, setReplyText] = useState('');

    useEffect(() => {
        initialize();
    }, [initialize]);

    const mySubtask = taskDetails?.subtasks.find(
        sub => sub.assignee_id === currentUserId && sub.status === TaskStatus.IN_REVIEW
    );
    const isInitiator = taskDetails?.task?.initiator_id === currentUserId;
    const taskStatus = taskDetails?.task?.status;

    const toggleExpand = async (taskId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const newExpanded = new Set(expandedTasks);
        if (newExpanded.has(taskId)) {
            newExpanded.delete(taskId);
        } else {
            newExpanded.add(taskId);
            if (!subtasksMap[taskId]) {
                const subs = await tasksApi.getSubtasks(taskId);
                setSubtasksMap(prev => ({ ...prev, [taskId]: subs }));
            }
        }
        setExpandedTasks(newExpanded);
    };

    const handleAddComment = async () => {
        if (!newCommentText.trim() || !taskDetails?.currentVersionId) return;
        await addComment(taskDetails.currentVersionId, newCommentText);
        setNewCommentText('');
    };

    const handleReply = async (parentId: number) => {
        if (!replyText.trim() || !taskDetails?.currentVersionId) return;
        await addComment(taskDetails.currentVersionId, replyText, parentId);
        setReplyText('');
        setReplyingTo(null);
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString(process.env.NEXT_FORMAT_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatDateTime = (dateStr?: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString(process.env.NEXT_FORMAT_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
            d.toLocaleTimeString(process.env.NEXT_FORMAT_LOCALE, { hour: '2-digit', minute: '2-digit' });
    };

    const getUser = (id: number): User | undefined => usersMap[id];

    const getTabLabel = () => {
        if (activeTab === 'my') return t('sidebar.my');
        if (activeTab === 'assigned_by_me') return t('sidebar.assignedByMe');
        return t('sidebar.all');
    };

    return (
        <>
            {/* ===== MAIN LAYOUT ===== */}
            <main id="main-workspace" className="flex-1 flex overflow-hidden">
                {/* LEFT SIDEBAR */}
                <aside id="left-sidebar" className="w-56 border-r border-slate-200 bg-white flex flex-col shrink-0 py-3 px-2 gap-1 overflow-y-auto">
                    <div className="px-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('sidebar.title')}</span>
                    </div>
                    <div className={`sidebar-item ${activeTab === 'all' && !statusFilter ? 'active' : ''}`} onClick={() => { setTab('all'); setStatusFilter(null); }}>
                        <i className="fa-solid fa-list-check w-4 text-center text-primary-500"></i>
                        <span>{t('sidebar.all')}</span>
                    </div>
                    <div className={`sidebar-item ${activeTab === 'my' ? 'active' : ''}`} onClick={() => setTab('my')}>
                        <i className="fa-solid fa-user w-4 text-center text-slate-400"></i>
                        <span>{t('sidebar.my')}</span>
                    </div>
                    <div className={`sidebar-item ${activeTab === 'assigned_by_me' ? 'active' : ''}`} onClick={() => setTab('assigned_by_me')}>
                        <i className="fa-solid fa-paper-plane w-4 text-center text-slate-400"></i>
                        <span>{t('sidebar.assignedByMe')}</span>
                    </div>
                    <div className="px-2 mt-3 mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('sidebar.statusTitle')}</span>
                    </div>
                    <div className={`sidebar-item ${statusFilter === TaskStatus.IN_REVIEW ? 'active' : ''}`} onClick={() => setStatusFilter(TaskStatus.IN_REVIEW)}>
                        <i className="fa-solid fa-clock w-4 text-center text-amber-400"></i>
                        <span>{t('sidebar.inReview')}</span>
                    </div>
                    <div className={`sidebar-item ${statusFilter === TaskStatus.NEEDS_REVISION ? 'active' : ''}`} onClick={() => setStatusFilter(TaskStatus.NEEDS_REVISION)}>
                        <i className="fa-solid fa-rotate w-4 text-center text-purple-400"></i>
                        <span>{t('sidebar.needsRevision')}</span>
                    </div>
                    <div className={`sidebar-item ${statusFilter === TaskStatus.COMPLETED ? 'active' : ''}`} onClick={() => setStatusFilter(TaskStatus.COMPLETED)}>
                        <i className="fa-solid fa-circle-check w-4 text-center text-green-500"></i>
                        <span>{t('sidebar.completed')}</span>
                    </div>
                </aside>

                {/* CONTENT AREA */}
                <section id="content-area" className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                    {/* TOP BAR */}
                    <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4 shrink-0">
                        <div className="flex items-center gap-1.5 text-sm min-w-0">
                            <span className="text-slate-800 font-semibold text-xs">{getTabLabel()}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="relative">
                                <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                <input type="text" placeholder={t('topbar.searchPlaceholder')} className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-52 transition-shadow" />
                            </div>
                            <button className="h-8 px-3 flex items-center gap-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm">
                                <i className="fa-solid fa-plus text-[11px]"></i> {t('topbar.newTask')}
                            </button>
                        </div>
                    </div>

                    {/* FILTER TABS */}
                    <div className="bg-white border-b border-slate-100 px-6 flex items-center gap-0 shrink-0">
                        <button className={`filter-tab ${activeTab === 'all' && !statusFilter ? 'active' : ''}`} onClick={() => { setTab('all'); setStatusFilter(null); }}>{t('tabs.all')}</button>
                        <button className={`filter-tab ${activeTab === 'my' ? 'active' : ''}`} onClick={() => setTab('my')}>{t('tabs.incoming')}</button>
                        <button className={`filter-tab ${activeTab === 'assigned_by_me' ? 'active' : ''}`} onClick={() => setTab('assigned_by_me')}>{t('tabs.outgoing')}</button>
                        <button className={`filter-tab ${statusFilter === TaskStatus.IN_REVIEW ? 'active' : ''}`} onClick={() => setStatusFilter(TaskStatus.IN_REVIEW)}>{t('tabs.inReview')}</button>
                        <button className={`filter-tab ${statusFilter === TaskStatus.COMPLETED ? 'active' : ''}`} onClick={() => setStatusFilter(TaskStatus.COMPLETED)}>{t('tabs.completed')}</button>
                    </div>

                    {/* TASK TABLE */}
                    <div className="flex-1 overflow-auto px-6 py-6">
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                                    <tr>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('table.task')}</th>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-36">{t('table.status')}</th>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-48">{t('table.assignee')}</th>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-36">{t('table.deadline')}</th>
                                        <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-42">{t('table.updatedAt')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {isLoadingTasks ? (
                                        <tr><td colSpan={6} className="text-center py-10 text-slate-400">{t('table.loading')}</td></tr>
                                    ) : tasks.length === 0 ? (
                                        <tr><td colSpan={6} className="text-center py-10 text-slate-400">{t('table.empty')}</td></tr>
                                    ) : (
                                        tasks.map(task => {
                                            const user = getUser(task.assignee_id);
                                            const isExpired = task.deadline
                                                ? (new Date(task.deadline) < new Date() && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.APPROVED)
                                                : false;
                                            return (
                                                <Fragment key={task.id}>
                                                    <tr className="task-row cursor-pointer group hover:bg-slate-50" onClick={() => selectTask(task.id)}>
                                                        <td className="px-3 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <button onClick={(e) => toggleExpand(task.id, e)} className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all shrink-0">
                                                                    <i className={`fa-solid fa-chevron-right text-[10px] transition-transform duration-200 ${expandedTasks.has(task.id) ? 'rotate-90' : ''}`}></i>
                                                                </button>
                                                                <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                                                    <i className="fa-solid fa-file-contract text-primary-500 text-xs"></i>
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="text-sm font-semibold text-slate-800 group-hover:text-primary-600 transition-colors truncate">{task.name}</div>
                                                                    <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[200px]">{task.description || t('table.noDescription')}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <span className={`stage-badge ${getStatusBadgeClasses(task.status)} border`}>
                                                                <i className={`fa-solid ${getStatusIcon(task.status)} text-[9px]`}></i> {getTaskStatusLabels()[task.status]}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <div className="flex items-center gap-1.5">
                                                                <img src={user?.avatar_url || '/default-avatar.svg'} className="w-5 h-5 rounded-full object-cover" />
                                                                <span className="text-xs text-slate-600">{user ? `${user.last_name} ${user.first_name}` : t('table.notAssigned')}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <span className={`text-xs font-semibold flex items-center gap-1 ${isExpired ? 'text-red-600' : 'text-slate-500'}`}>
                                                                <i className={`fa-solid ${isExpired ? 'fa-circle-exclamation' : 'fa-calendar'} text-[10px]`}></i> {formatDate(task.deadline)}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(task.updated_at)}</td>
                                                    </tr>
                                                    {/* Подзадачи */}
                                                    {expandedTasks.has(task.id) && subtasksMap[task.id]?.map((sub: Task) => {
                                                        const subUser = getUser(sub.assignee_id);
                                                        return (
                                                            <tr key={sub.id} className="task-row subtask-row cursor-pointer group hover:bg-slate-50 bg-slate-50/50" onClick={() => selectTask(sub.id)}>
                                                                <td className="px-3 py-2.5">
                                                                    <div className="flex items-center gap-2 pl-7">
                                                                        <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"><i className="fa-regular fa-circle-dot text-slate-300 text-[10px]"></i></div>
                                                                        <div className="w-6 h-6 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0"><i className="fa-solid fa-pen text-purple-400 text-[10px]"></i></div>
                                                                        <div className="min-w-0">
                                                                            <div className="text-xs font-semibold text-slate-700 group-hover:text-primary-600 transition-colors">{sub.name}</div>
                                                                            <div className="text-[10px] text-slate-400 mt-0.5">{t('table.subtask')}</div>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2.5">
                                                                    <span className={`stage-badge ${getStatusBadgeClasses(sub.status)} border`}>
                                                                        <i className={`fa-solid ${getStatusIcon(sub.status)} text-[9px]`}></i> {getTaskStatusLabels()[sub.status]}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2.5">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <img src={subUser?.avatar_url || '/default-avatar.svg'} className="w-5 h-5 rounded-full object-cover" />
                                                                        <span className="text-xs text-slate-600">{subUser ? `${subUser.last_name} ${subUser.first_name}` : '-'}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2.5 text-xs text-slate-500">{formatDate(sub.deadline)}</td>
                                                                <td className="px-3 py-2.5 text-xs text-slate-500">{formatDateTime(sub.updated_at)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </Fragment>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </main>

            {/* ===== PANEL OVERLAY ===== */}
            {selectedTaskId && (
                <div className="fixed inset-0 bg-black/20 z-40 transition-opacity" onClick={() => selectTask(null)}></div>
            )}

            {/* ===== TASK DETAIL PANEL ===== */}
            {selectedTaskId && (
                <div className="fixed right-0 top-0 h-full w-[600px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 transform transition-transform duration-300">
                    {/* Лоадер при загрузке деталей задачи */}
                    {isLoadingDetails || !taskDetails?.task ? (
                        <div className="flex h-full w-full items-center justify-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
                        </div>
                    ) : (
                        <>
                            {/* Panel Header */}
                            <div className="shrink-0 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between bg-white">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                        <i className="fa-solid fa-file-contract text-primary-500 text-sm"></i>
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-sm font-bold text-slate-800 truncate">{taskDetails.task.name}</h2>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            <span className={`stage-badge ${getStatusBadgeClasses(taskDetails.task.status)} border`}>
                                                <i className={`fa-solid ${getStatusIcon(taskDetails.task.status)} text-[9px]`}></i> {getTaskStatusLabels()[taskDetails.task.status]}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 ml-3">
                                    <button onClick={() => selectTask(null)} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
                                        <i className="fa-solid fa-xmark text-sm"></i>
                                    </button>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="shrink-0 px-5 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center gap-1.5 flex-wrap">
                                {/* ✅ БЛОК ИСПОЛНИТЕЛЯ (Согласование) */}
                                {mySubtask && (
                                    <>
                                    <button className="action-btn bg-green-600 hover:bg-green-700 text-white shadow-sm" 
                                            onClick={() => approveTask(mySubtask.id)}>
                                        <i className="fa-solid fa-circle-check text-xs"></i> {t('panel.actions.approve')}
                                    </button>
                                    <button className="action-btn bg-white border border-slate-200 hover:bg-amber-50 hover:border-amber-200 text-amber-700" 
                                            onClick={() => requestRevision(mySubtask.id)}>
                                        <i className="fa-solid fa-rotate-left text-xs"></i> {t('panel.actions.requestRevision')}
                                    </button>
                                    <button className="action-btn bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 text-red-600" 
                                            onClick={() => rejectTask(mySubtask.id)}>
                                        <i className="fa-solid fa-circle-xmark text-xs"></i> {t('panel.actions.reject')}
                                    </button>
                                    </>
                                )}
                                {/* ✅ БЛОК ИНИЦИАТОРА (Управление процессом) */}
                                {isInitiator && taskStatus === TaskStatus.NEEDS_REVISION && (
                                    <button className="action-btn bg-blue-600 hover:bg-blue-700 text-white shadow-sm" 
                                            onClick={() => resubmitTask(taskDetails!.task!.id)}>
                                    <i className="fa-solid fa-paper-plane text-xs"></i> {t('panel.actions.resubmit')}
                                    </button>
                                )}
                                {isInitiator && (taskStatus === TaskStatus.IN_REVIEW || taskStatus === TaskStatus.NEEDS_REVISION) && (
                                    <button className="action-btn bg-white border border-slate-200 hover:bg-slate-100 text-slate-600" 
                                            onClick={() => withdrawTask(taskDetails!.task!.id)}>
                                    <i className="fa-solid fa-ban text-xs"></i> {t('panel.actions.withdraw')}
                                    </button>
                                )}
                            </div>

                            {/* Tabs */}
                            <div className="shrink-0 px-5 flex items-center border-b border-slate-100 bg-white gap-0">
                                <button className={`tab-btn ${activePanelTab === 'details' ? 'active' : ''}`} onClick={() => setActivePanelTab('details')}>{t('panel.tabs.details')}</button>
                                <button className={`tab-btn ${activePanelTab === 'comments' ? 'active' : ''}`} onClick={() => setActivePanelTab('comments')}>
                                    {t('panel.tabs.comments')}
                                    <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 bg-blue-100 text-blue-600 rounded-full text-[9px] font-bold">{taskDetails.comments.length}</span>
                                </button>
                                <button className={`tab-btn ${activePanelTab === 'route' ? 'active' : ''}`} onClick={() => setActivePanelTab('route')}>{t('panel.tabs.route')}</button>
                                <button className={`tab-btn ${activePanelTab === 'history' ? 'active' : ''}`} onClick={() => setActivePanelTab('history')}>{t('panel.tabs.history')}</button>
                            </div>

                            {/* Tab: Details */}
                            {activePanelTab === 'details' && (
                                <div className="tab-content active px-5 py-4 gap-0 overflow-y-auto flex-1">
                                    <div className="info-row">
                                        <span className="info-label"><i className="fa-solid fa-user text-slate-300 mr-1.5"></i>{t('panel.details.author')}</span>
                                        <div className="info-value flex items-center gap-2">
                                            <img src={getUser(taskDetails.task.initiator_id)?.avatar_url || '/default-avatar.svg'} className="w-6 h-6 rounded-full object-cover" />
                                            <span>{getUser(taskDetails.task.initiator_id)?.first_name} {getUser(taskDetails.task.initiator_id)?.last_name}</span>
                                        </div>
                                    </div>
                                    <div className="info-row">
                                        <span className="info-label"><i className="fa-solid fa-user-check text-slate-300 mr-1.5"></i>{t('panel.details.assignee')}</span>
                                        <div className="info-value flex items-center gap-2">
                                            <img src={getUser(taskDetails.task.assignee_id)?.avatar_url || '/default-avatar.svg'} className="w-6 h-6 rounded-full object-cover" />
                                            <span>{getUser(taskDetails.task.assignee_id)?.first_name} {getUser(taskDetails.task.assignee_id)?.last_name}</span>
                                        </div>
                                    </div>
                                    <div className="info-row">
                                        <span className="info-label"><i className="fa-solid fa-calendar text-slate-300 mr-1.5"></i>{t('panel.details.deadline')}</span>
                                        <div className="info-value flex items-center gap-2">
                                            <span className="text-red-600 font-semibold flex items-center gap-1.5">
                                                <i className="fa-solid fa-circle-exclamation text-[11px]"></i> {formatDate(taskDetails.task.deadline)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="info-row">
                                        <span className="info-label"><i className="fa-solid fa-align-left text-slate-300 mr-1.5"></i>{t('panel.details.description')}</span>
                                        <div className="info-value text-slate-600 leading-relaxed text-[13px]">
                                            {taskDetails.task.description || t('panel.details.noDescription')}
                                        </div>
                                    </div>
                                    {/* Прикрепленные документы */}
                                    <div className="mt-6">
                                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">{t('panel.details.attachmentsTitle')}</div>
                                        <div className="space-y-2">
                                            {taskDetails.attachments.length > 0 ? (
                                                taskDetails.attachments.map(att => (
                                                    <Link 
                                                        key={att.id} 
                                                        href={`/editor/${taskDetails.task?.document_set_id}`} 
                                                        className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-primary-300 hover:bg-blue-50/30 cursor-pointer transition-all group"
                                                    >
                                                        <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                                                            <i className="fa-solid fa-file-word text-blue-500 text-base"></i>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-semibold text-slate-700 group-hover:text-primary-600 transition-colors truncate">
                                                                {taskDetails.documentsMap?.[att.document_version_id] || t('panel.details.document')}
                                                            </div>
                                                            <div className="text-[11px] text-slate-400 mt-0.5">{t('panel.details.updated')} {formatDate(att.created_at)}</div>
                                                        </div>
                                                    </Link>
                                                ))
                                            ) : (
                                                <div className="text-xs text-slate-400 italic py-2">{t('panel.details.noAttachments')}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab: Comments */}
                            {activePanelTab === 'comments' && (
                                <div className="tab-content px-5 py-4 gap-0 overflow-y-auto flex-col flex-1">
                                    {/* Заголовок секции комментариев */}
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-xs font-semibold text-slate-500">
                                            {t('panel.comments.titleCount', { count: taskDetails.comments.length })}
                                        </span>
                                    </div>
                                    {/* Форма добавления главного комментария */}
                                    <div className="flex items-start gap-2.5 mb-6">
                                        <img 
                                            src={getUser(1)?.avatar_url || '/default-avatar.svg'} 
                                            className="w-8 h-8 rounded-full object-cover shrink-0" 
                                            alt="Avatar" 
                                        />
                                        <div className="flex-1">
                                            <textarea 
                                                value={newCommentText} 
                                                onChange={e => setNewCommentText(e.target.value)} 
                                                className="w-full p-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none transition-shadow" 
                                                rows={2} 
                                                placeholder={t('panel.comments.placeholder')}
                                            ></textarea>
                                            <div className="flex items-center justify-end mt-2 gap-2">
                                                <button 
                                                    onClick={handleAddComment} 
                                                    disabled={!newCommentText.trim()} 
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <i className="fa-solid fa-paper-plane text-[10px]"></i> {t('panel.comments.send')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Список комментариев (Древовидная структура) */}
                                    <div className="space-y-5">
                                        {(() => {
                                            const rootComments = taskDetails.comments.filter(c => !c.parent_comment_id);
                                            return rootComments.map(comment => {
                                                const author = getUser(comment.author_id);
                                                const replies = taskDetails.comments.filter(c => c.parent_comment_id === comment.id);
                                                return (
                                                    <div key={comment.id} className="group">
                                                        {/* Родительский комментарий */}
                                                        <div className="flex items-start gap-2.5">
                                                            <img 
                                                                src={author?.avatar_url || '/default-avatar.svg'} 
                                                                className="w-8 h-8 rounded-full object-cover shrink-0" 
                                                                alt="Avatar" 
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                                                    <span className="text-xs font-semibold text-slate-800">
                                                                        {author?.first_name} {author?.last_name}
                                                                    </span>
                                                                    {author?.email && (
                                                                        <span className="text-[10px] text-slate-400">
                                                                            {author.email}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] text-slate-400 ml-auto">
                                                                        {formatDateTime(comment.created_at)}
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                                                                    {comment.text_content}
                                                                </p>
                                                                {/* Кнопки "Ответить" и счетчик ответов */}
                                                                <div className="flex items-center gap-3 mt-1.5">
                                                                    <button
                                                                        onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                                                                        className="text-[11px] text-slate-400 hover:text-primary-600 font-semibold transition-colors"
                                                                    >
                                                                        {t('panel.comments.reply')}
                                                                    </button>
                                                                    {replies.length > 0 && (
                                                                        <span className="text-[11px] text-slate-400 font-medium">
                                                                            {t('panel.comments.repliesCount', { count: replies.length })}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {/* Поле ввода ответа */}
                                                                {replyingTo === comment.id && (
                                                                    <div className="mt-3 flex items-start gap-2.5">
                                                                        <img 
                                                                            src={getUser(1)?.avatar_url || '/default-avatar.svg'} 
                                                                            className="w-6 h-6 rounded-full object-cover shrink-0" 
                                                                            alt="Avatar" 
                                                                        />
                                                                        <div className="flex-1">
                                                                            <textarea
                                                                                value={replyText}
                                                                                onChange={e => setReplyText(e.target.value)}
                                                                                className="w-full p-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none transition-shadow"
                                                                                rows={2}
                                                                                placeholder={t('panel.comments.replyPlaceholder')}
                                                                                autoFocus
                                                                            ></textarea>
                                                                            <div className="flex items-center justify-end mt-1.5 gap-2">
                                                                                <button 
                                                                                    onClick={() => setReplyingTo(null)} 
                                                                                    className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                                                                                >
                                                                                    {t('panel.comments.cancel')}
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleReply(comment.id)}
                                                                                    disabled={!replyText.trim()}
                                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                                >
                                                                                    {t('panel.comments.reply')}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {/* Вложенные ответы */}
                                                        {replies.length > 0 && (
                                                            <div className="mt-3 pl-8 border-l-2 border-slate-100 ml-3 space-y-3">
                                                                {replies.map(reply => {
                                                                    const replyAuthor = getUser(reply.author_id);
                                                                    return (
                                                                        <div key={reply.id} className="flex items-start gap-2.5">
                                                                            <img 
                                                                                src={replyAuthor?.avatar_url || '/default-avatar.svg'} 
                                                                                className="w-6 h-6 rounded-full object-cover shrink-0" 
                                                                                alt="Avatar" 
                                                                            />
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                                                                    <span className="text-xs font-semibold text-slate-800">
                                                                                        {replyAuthor?.first_name} {replyAuthor?.last_name}
                                                                                    </span>
                                                                                    {replyAuthor?.email && (
                                                                                        <span className="text-[10px] text-slate-400">
                                                                                            {replyAuthor.email}
                                                                                        </span>
                                                                                    )}
                                                                                    <span className="text-[10px] text-slate-400">·</span>
                                                                                    <span className="text-[10px] text-slate-400 ml-auto">
                                                                                        {formatDateTime(reply.created_at)}
                                                                                    </span>
                                                                                </div>
                                                                                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                                                                                    {reply.text_content}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>
                            )}

                            {/* Tab: Route */}
                            {activePanelTab === 'route' && (
                                <div className="tab-content px-5 py-4 gap-0 overflow-y-auto flex-col flex-1">
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('panel.route.title')}</span>
                                    </div>
                                    <div className="space-y-3 relative z-10">
                                        {taskDetails.stages.map((stage, idx: number) => {
                                            const stageUser = getUser(stage.assignee_id);
                                            let stepClass = 'bg-slate-50 border-slate-200 opacity-55';
                                            let iconClass = 'bg-slate-300';
                                            let statusText = t('panel.route.notStarted');
                                            let statusBadgeClass = 'bg-slate-100 text-slate-500 border-slate-200';
                                            let statusIcon = 'fa-file-circle-plus';
                                            
                                            if (stage.status === StageStatus.APPROVED) {
                                                stepClass = 'bg-green-50 border-green-100';
                                                iconClass = 'bg-green-500';
                                                statusText = t('panel.route.approved', { date: formatDateTime(stage.completed_at) });
                                                statusBadgeClass = 'bg-green-100 text-green-700 border-green-200';
                                                statusIcon = 'fa-circle-check';
                                            } else if (stage.status === StageStatus.IN_PROGRESS) {
                                                stepClass = 'bg-amber-50 border-amber-200 shadow-sm';
                                                iconClass = 'bg-amber-400';
                                                statusText = t('panel.route.awaitingDecision');
                                                statusBadgeClass = 'bg-amber-100 text-amber-700 border-amber-200';
                                                statusIcon = 'fa-clock';
                                            } else if (stage.status === StageStatus.NEEDS_REVISION) {
                                                stepClass = 'bg-purple-50 border-purple-200'; iconClass = 'bg-purple-500';
                                                statusText = t('panel.route.returned');
                                                statusBadgeClass = 'bg-purple-100 text-purple-700 border-purple-200'; statusIcon = 'fa-rotate-left';
                                            } else if (stage.status === StageStatus.REJECTED) {
                                                stepClass = 'bg-red-50 border-red-100'; iconClass = 'bg-red-500';
                                                statusText = t('panel.route.rejected');
                                                statusBadgeClass = 'bg-red-100 text-red-700 border-red-200'; statusIcon = 'fa-circle-xmark';
                                            } else if (stage.status === StageStatus.CANCELED) {
                                                stepClass = 'bg-slate-100 border-slate-200 opacity-60'; iconClass = 'bg-slate-400';
                                                statusText = t('panel.route.canceled');
                                                statusBadgeClass = 'bg-slate-200 text-slate-600 border-slate-300'; statusIcon = 'fa-ban';
                                            }
                                            return (
                                                <div key={stage.id} className={`flex items-center gap-3 p-3 rounded-xl border ${stepClass}`}>
                                                    <div className={`w-9 h-9 rounded-full ${iconClass} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                                                        {stage.status === StageStatus.APPROVED ? <i className="fa-solid fa-check text-xs"></i> : idx + 1}
                                                    </div>
                                                    <img src={stageUser?.avatar_url || '/default-avatar.svg'} className="w-8 h-8 rounded-full object-cover shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-semibold text-slate-800">{stageUser?.first_name} {stageUser?.last_name}</div>
                                                        <div className="text-[10px] text-slate-400">{stageUser?.email}</div>
                                                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">{statusText}</div>
                                                    </div>
                                                    <div className="shrink-0">
                                                        <span className={`stage-badge ${statusBadgeClass} border text-[10px]`}>
                                                            <i className={`fa-solid ${statusIcon} text-[9px]`}></i> {stage.status === StageStatus.APPROVED ? t('panel.route.approvedShort') : stage.status === StageStatus.IN_PROGRESS ? t('panel.route.awaiting') : t('panel.route.notStarted')}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Tab: History */}
                            {activePanelTab === 'history' && (
                                <div className="tab-content px-5 py-4 gap-0 flex-1">
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">{t('panel.history.title')}</div>
                                    <div className="space-y-0">
                                        {taskDetails.history.map((h, idx: number) => {
                                            const hUser = getUser(h.user_id);
                                            let actionText = t('panel.history.action');
                                            let badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
                                            let badgeIcon = 'fa-circle-dot';
                                            
                                            if (h.action === HistoryAction.APPROVED) { actionText = t('panel.history.approved'); badgeClass = 'bg-green-50 text-green-700 border-green-100'; badgeIcon = 'fa-circle-check'; }
                                            else if (h.action === HistoryAction.SENT_FOR_APPROVAL) { actionText = t('panel.history.sentForApproval'); badgeClass = 'bg-blue-50 text-blue-700 border-blue-100'; badgeIcon = 'fa-paper-plane'; }
                                            else if (h.action === HistoryAction.CREATED) { actionText = t('panel.history.created'); badgeClass = 'bg-slate-100 text-slate-600 border-slate-200'; badgeIcon = 'fa-file-circle-plus'; }
                                            else if (h.action === HistoryAction.REJECTED) { actionText = t('panel.history.rejected'); badgeClass = 'bg-red-50 text-red-700 border-red-100'; badgeIcon = 'fa-circle-xmark'; }
                                            else if (h.action === HistoryAction.NEEDS_REVISION) { actionText = t('panel.history.needsRevision'); badgeClass = 'bg-purple-50 text-purple-700 border-purple-100'; badgeIcon = 'fa-rotate'; }
                                            
                                            return (
                                                <div key={h.id} className="flex gap-3 pb-4">
                                                    <div className="shrink-0 flex flex-col items-center gap-1">
                                                        <img src={hUser?.avatar_url || '/default-avatar.svg'} className="w-7 h-7 rounded-full object-cover" />
                                                        {idx < taskDetails.history.length - 1 && <div className="w-px flex-1 bg-slate-100"></div>}
                                                    </div>
                                                    <div className="flex-1 pb-2 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-xs font-semibold text-slate-700">{hUser?.first_name} {hUser?.last_name}</span>
                                                            <span className="text-[10px] text-slate-400">{formatDateTime(h.created_at)}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            <span className={`stage-badge ${badgeClass} border text-[10px]`}><i className={`fa-solid ${badgeIcon} text-[9px]`}></i> {actionText}</span>
                                                        </div>
                                                        {h.comment && (
                                                            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 leading-relaxed">{h.comment}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
}