// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/FilesTable.tsx
"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFilesStore } from '@/store/useFilesStore';
import { useNavbarStore } from '@/store/useNavbarStore';
import { DocumentSetMode, ApprovalStatus, Folder, DocumentSet } from '@/lib/types';

interface FilesTableProps {
  folders: Folder[];
  documentSets: DocumentSet[];
  isLoading: boolean;
  isTrashView?: boolean;
  isSharedView?: boolean;
  commentsCount?: Record<number, number>;
}

export function FilesTable({ folders, documentSets, isLoading, isTrashView = false, isSharedView = false, commentsCount = {} }: FilesTableProps) {
  const t = useTranslations('FilesTable');
  const router = useRouter();
  const { user } = useNavbarStore();
  const currentUserId = user?.id;
  
  const {
    selectedItems, toggleSelection, clearSelection, getUserById,
    navigateToFolder, setContextMenu, setMoveModal, batchAction, batchRestore, batchPermanentDelete, setCloneTemplateModal,
    downloadDocumentSetArchive
  } = useFilesStore();

  const [filter, setFilter] = useState<'all' | 'template' | 'standard' | 'non_standard'>('all');
  
  const filteredDocumentSets = documentSets.filter(ds => {
    if (isTrashView) return true; // В корзине не фильтруем по режимам
    if (filter === 'all') return true;
    if (filter === 'template') return ds.mode === DocumentSetMode.TEMPLATE;
    if (filter === 'standard') return ds.mode === DocumentSetMode.STANDARD;
    if (filter === 'non_standard') return ds.mode === DocumentSetMode.NON_STANDARD;
    return true;
  });

  // 🆕 Для "Общего доступа" показываем только чужие файлы
  const displayFolders = isSharedView
    ? folders.filter(f => f.owner_id !== currentUserId)
    : folders;
    
  const displayDocumentSets = isSharedView
    ? filteredDocumentSets.filter(ds => ds.owner_id !== currentUserId)
    : filteredDocumentSets;

  // 🆕 В "Общем доступе" все отображаемые объекты считаются доступными для действий
  const ownedFolders = isSharedView
    ? displayFolders
    : displayFolders.filter(f => f.owner_id === currentUserId);
    
  const ownedDocumentSets = isSharedView
    ? displayDocumentSets
    : displayDocumentSets.filter(ds => ds.owner_id === currentUserId);

  const totalOwned = ownedFolders.length + ownedDocumentSets.length;
  const totalObjects = displayFolders.length + displayDocumentSets.length;

  const handleRowClick = (id: number, type: 'folder' | 'documentSet', name: string) => {
    if (isTrashView) return; // В корзине переходы запрещены
    if (type === 'folder') {
      navigateToFolder(id, name);
    } else {
      const ds = documentSets.find(d => d.id === id);
      if (!ds) return;
      if (ds.mode === DocumentSetMode.FILE) {
        downloadDocumentSetArchive(ds.id, ds.name);
        return; 
      }
      if (ds.mode === DocumentSetMode.TEMPLATE && ds.owner_id !== currentUserId) {
        setCloneTemplateModal({ id: ds.id, defaultName: ds.name });
      } else {
        router.push(`/editor/${id}`);
      }
    }
  };

  const handleOpenMenu = (e: React.MouseEvent, id: number, type: 'folder' | 'documentSet') => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 224;
    const menuHeight = 280;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    setContextMenu({ x, y, id, type, isTrash: isTrashView });
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      clearSelection();
      ownedFolders.forEach(f => toggleSelection(f.id, 'folder'));
      ownedDocumentSets.forEach(ds => toggleSelection(ds.id, 'documentSet'));
    } else {
      clearSelection();
    }
  };

  const isAllSelected = totalOwned > 0 && selectedItems.length === totalOwned;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(process.env.NEXT_FORMAT_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + date.toLocaleTimeString(process.env.NEXT_FORMAT_LOCALE, { hour: '2-digit', minute: '2-digit' });
  };

  const getApprovalBadge = (status: ApprovalStatus) => {
    switch (status) {
      case ApprovalStatus.IN_APPROVAL: return <span className="stage-badge bg-amber-50 text-amber-700 border border-amber-100"><i className="fa-solid fa-clock text-[9px]"></i> {t('statusInApproval')}</span>;
      case ApprovalStatus.APPROVED: return <span className="stage-badge bg-green-50 text-green-700 border border-green-100"><i className="fa-solid fa-circle-check text-[9px]"></i> {t('statusApproved')}</span>;
      case ApprovalStatus.DRAFT: return <span className="stage-badge bg-slate-100 text-slate-500"><i className="fa-solid fa-pen-nib text-[9px]"></i> {t('statusDraft')}</span>;
      case ApprovalStatus.REJECTED: return <span className="stage-badge bg-red-50 text-red-600 border border-red-100"><i className="fa-solid fa-circle-xmark text-[9px]"></i> {t('statusRejected')}</span>;
      default: return null;
    }
  };

  const getModeLabel = (mode: DocumentSetMode) => {
    switch (mode) {
      case DocumentSetMode.TEMPLATE: return t('modeTemplate');
      case DocumentSetMode.STANDARD: return t('modeStandard');
      case DocumentSetMode.NON_STANDARD: return t('modeNonStandard');
      case DocumentSetMode.FILE: return t('modeFile');
      default: return '';
    }
  };

  return (
    <>
      {/* TABLE HEADER STATS */}
      <div className="px-6 py-3 flex items-center gap-4 shrink-0">
        <span className="text-xs text-slate-500 font-medium">
          {t('total')} <span className="font-semibold text-slate-700">{totalObjects} {t('objects')}</span>
        </span>
        
        {/* 🆕 Фильтры режимов работают везде, кроме Корзины */}
        {!isTrashView && (
          <>
            <span className="text-slate-200">|</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setFilter('all')} className={`text-xs font-semibold pb-0.5 transition-colors border-b-2 ${filter === 'all' ? 'text-primary-600 border-primary-600' : 'text-slate-400 hover:text-slate-700 border-transparent'}`}>{t('filterAll')}</button>
              <button onClick={() => setFilter('template')} className={`text-xs font-medium pb-0.5 transition-colors border-b-2 ${filter === 'template' ? 'text-primary-600 border-primary-600' : 'text-slate-400 hover:text-slate-700 border-transparent'}`}>{t('filterTemplate')}</button>
              <button onClick={() => setFilter('standard')} className={`text-xs font-medium pb-0.5 transition-colors border-b-2 ${filter === 'standard' ? 'text-primary-600 border-primary-600' : 'text-slate-400 hover:text-slate-700 border-transparent'}`}>{t('filterStandard')}</button>
              <button onClick={() => setFilter('non_standard')} className={`text-xs font-medium pb-0.5 transition-colors border-b-2 ${filter === 'non_standard' ? 'text-primary-600 border-primary-600' : 'text-slate-400 hover:text-slate-700 border-transparent'}`}>{t('filterNonStandard')}</button>
            </div>
          </>
        )}
        
        {/* 🆕 Массовые действия работают везде */}
        {selectedItems.length > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">{selectedItems.length} {t('selected')}</span>
            {isTrashView ? (
              <>
                <button onClick={() => batchRestore()} className="text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors">
                  <i className="fa-solid fa-rotate-left text-[11px] mr-1"></i> {t('restore')}
                </button>
                <button onClick={() => batchPermanentDelete()} className="text-xs px-2.5 py-1 bg-red-50 border border-red-200 rounded-lg text-red-600 hover:bg-red-100 transition-colors">
                  <i className="fa-solid fa-trash text-[11px] mr-1"></i> {t('deleteForever')}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setMoveModal({ items: selectedItems })} className="text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors">
                  <i className="fa-solid fa-arrow-right-from-bracket text-[11px] mr-1"></i> {t('move')}
                </button>
                <button onClick={() => batchAction('trash')} className="text-xs px-2.5 py-1 bg-red-50 border border-red-200 rounded-lg text-red-600 hover:bg-red-100 transition-colors">
                  <i className="fa-solid fa-trash text-[11px] mr-1"></i> {t('moveToTrash')}
                </button>
              </>
            )}
          </div>
        ) : <div className="ml-auto"></div>}
      </div>

      {/* FILE TABLE */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm" id="files-table">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="w-10 px-4 py-3">
                  {!isSharedView && (
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                      className="w-3.5 h-3.5 accent-primary-600 rounded cursor-pointer"
                    />
                  )}
                </th>
                <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('columnName')}</th>
                <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('columnDate')}</th>
                <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('columnAuthor')}</th>
                {!isTrashView && <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('columnStage')}</th>}
                <th className="text-left px-3 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{t('columnComment')}</th>
                <th className="w-10 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody id="table-body" className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">{t('loading')}</td></tr>
              ) : (
                <>
                  {displayFolders.map(folder => {
                    const owner = getUserById(folder.owner_id);
                    const isSelected = selectedItems.some(i => i.id === folder.id && i.type === 'folder');
                    const isOwner = isSharedView || folder.owner_id === currentUserId;
                    return (
                      <tr
                        key={`folder-${folder.id}`}
                        className={`table-row group ${isSelected ? 'bg-primary-50' : ''}`}
                        onContextMenu={(e) => isOwner && handleOpenMenu(e, folder.id, 'folder')}
                      >
                        <td className="px-4 py-3">
                          {isOwner && !isSharedView && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelection(folder.id, 'folder')}
                              className="w-3.5 h-3.5 accent-primary-600 rounded cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0"><i className="fa-solid fa-folder text-amber-400 text-sm"></i></div>
                            <div className={`text-sm font-semibold ${isTrashView ? 'text-slate-500' : 'text-slate-800 hover:text-primary-600'} transition-colors ${!isTrashView ? 'cursor-pointer' : ''}`} onClick={() => handleRowClick(folder.id, 'folder', folder.name)}>
                              {folder.name}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">{formatDate(folder.updated_at)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <img src={owner?.avatar_url || '/default-avatar.svg'} className="w-5 h-5 rounded-full object-cover" alt="" />
                            <span className="text-xs text-slate-600">{owner ? `${owner.last_name} ${owner.first_name}` : t('unknownAuthor')}</span>
                          </div>
                        </td>
                        {!isTrashView && <td className="px-3 py-3"><span className="stage-badge bg-slate-100 text-slate-500"><i className="fa-solid fa-folder text-[9px]"></i> {t('stageFolder')}</span></td>}
                        <td className="px-3 py-3 text-xs text-slate-400">—</td>
                        <td className="px-3 py-3">
                          {isOwner && (
                            <button type="button" onClick={(e) => handleOpenMenu(e, folder.id, 'folder')} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-100 hover:text-slate-600 transition-all">
                              <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {displayDocumentSets.map(ds => {
                    const owner = getUserById(ds.owner_id);
                    const isSelected = selectedItems.some(i => i.id === ds.id && i.type === 'documentSet');
                    const isOwner = isSharedView || ds.owner_id === currentUserId;
                    return (
                      <tr
                        key={`ds-${ds.id}`}
                        className={`table-row group ${isSelected ? 'bg-primary-50' : ''}`}
                        onContextMenu={(e) => (isTrashView ? isOwner : true) && handleOpenMenu(e, ds.id, 'documentSet')}
                      >
                        <td className="px-4 py-3">
                          {isOwner && !isSharedView && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelection(ds.id, 'documentSet')}
                              className="w-3.5 h-3.5 accent-primary-600 rounded cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0"><i className="fa-solid fa-file-lines text-primary-500 text-sm"></i></div>
                            <div>
                              <div className={`text-sm font-semibold ${isTrashView ? 'text-slate-500' : 'text-slate-800 hover:text-primary-600'} transition-colors ${!isTrashView ? 'cursor-pointer' : ''}`} onClick={() => handleRowClick(ds.id, 'documentSet', ds.name)}>
                                {ds.name}
                              </div>
                              {!isTrashView && <div className="text-[11px] text-slate-400 mt-0.5">{getModeLabel(ds.mode)}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">{formatDate(ds.updated_at)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <img src={owner?.avatar_url || '/default-avatar.svg'} className="w-5 h-5 rounded-full object-cover" alt="" />
                            <span className="text-xs text-slate-600">{owner ? `${owner.last_name} ${owner.first_name}` : t('unknownAuthor')}</span>
                          </div>
                        </td>
                        {!isTrashView && <td className="px-3 py-3">{getApprovalBadge(ds.approval_status)}</td>}
                        <td className="px-3 py-3 text-xs">
                          {commentsCount[ds.id] ? (
                            <span className="flex items-center gap-1 text-blue-500 font-medium cursor-pointer hover:underline">
                              <i className="fa-regular fa-comment-dots text-[11px]"></i> {commentsCount[ds.id]}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {(!isTrashView || isOwner) && (
                            <button type="button" onClick={(e) => handleOpenMenu(e, ds.id, 'documentSet')} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-100 hover:text-slate-600 transition-all">
                              <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {displayFolders.length === 0 && displayDocumentSets.length === 0 && !isLoading && (
                    <tr><td colSpan={7} className="text-center py-10 text-slate-400">{isTrashView ? t('emptyTrash') : isSharedView ? t('emptyShared') : t('emptyDefault')}</td></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}