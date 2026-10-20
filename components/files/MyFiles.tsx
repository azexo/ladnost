// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/MyFiles.tsx
"use client";
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useFilesStore } from '@/store/useFilesStore';
import { ContextMenu, RenameModal, MoveModal, CreateModal, CloneTemplateModal, FolderAccessModal } from '@/components/files/FileModals';
import { FilesTable } from '@/components/files/FilesTable';
import ConversionModal, { ConversionModalHandle } from '@/components/editor/ConversionModal';

export default function MyFiles() {
  const t = useTranslations('MyFiles');
  
  const {
    folders, documentSets, trashFolders, trashDocumentSets, sharedFolders, sharedDocumentSets, users, breadcrumbs,
    isLoading, notification, view, commentsCount,
    init, fetchData, fetchTrashData, fetchSharedData, navigateToFolder,
    getUserById, setContextMenu, setMoveModal, showNotification, setView, batchPermanentDelete,
    setCreateModal, uploadAndCreateNonStandardSet,
    currentFolderId,
    rootFolders,
  } = useFilesStore();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversionModalRef = useRef<ConversionModalHandle>(null);

  useEffect(() => {
    init();
  }, [init]);

  const currentFolders = view === 'trash' ? trashFolders : view === 'shared' ? sharedFolders : folders;
  const currentDocumentSets = view === 'trash' ? trashDocumentSets : view === 'shared' ? sharedDocumentSets : documentSets;

  const handleOpenMyFiles = () => {
    if (view !== 'files') {
      setView('files');
      fetchData();
    }
  };

  const handleOpenTrash = () => {
    if (view !== 'trash') {
      setView('trash');
      fetchTrashData();
    }
  };

  const handleOpenShared = () => {
    if (view !== 'shared') {
      setView('shared');
      fetchSharedData();
    }
  };

  const handleClearTrash = () => {
    if (window.confirm(t('confirmClearTrash'))) {
      const allItems = [
        ...trashFolders.map(f => ({ id: f.id, type: 'folder' as const })),
        ...trashDocumentSets.map(ds => ({ id: ds.id, type: 'documentSet' as const }))
      ];
      if (allItems.length > 0) {
        batchPermanentDelete(allItems);
      } else {
        showNotification(t('trashIsEmpty'));
      }
    }
  };

  const handleCreateFolder = () => setCreateModal({ type: 'folder' });
  const handleCreateDocumentSet = () => setCreateModal({ type: 'documentSet' });
  const handleFileUploadClick = () => fileInputRef.current?.click();
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadAndCreateNonStandardSet(file, conversionModalRef);
    }
    e.target.value = '';
  };

  return (
    <>
      <main id="main-workspace" className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside id="left-sidebar" className="w-56 border-r border-slate-200 bg-surface flex flex-col shrink-0 py-3 px-2 gap-1 overflow-y-auto">
          <div className="px-2 mb-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {t('workspace')}
            </span>
          </div>
          <div className={`sidebar-item ${view === 'files' ? 'active' : ''}`} onClick={handleOpenMyFiles}>
            <i className="fa-solid fa-folder-open w-4 text-center text-primary-500"></i>
            <span>{t('myFiles')}</span>
          </div>
          <div className={`sidebar-item ${view === 'shared' ? 'active' : ''}`} onClick={handleOpenShared}>
            <i className="fa-solid fa-share-nodes w-4 text-center text-slate-400"></i>
            <span>{t('shared')}</span>
          </div>
          <div className="sidebar-item" onClick={() => showNotification(t('recentInDev'))}>
            <i className="fa-solid fa-clock-rotate-left w-4 text-center text-slate-400"></i>
            <span>{t('recent')}</span>
          </div>
          <div className="sidebar-item" onClick={() => showNotification(t('favoritesInDev'))}>
            <i className="fa-regular fa-star w-4 text-center text-slate-400"></i>
            <span>{t('favorites')}</span>
          </div>
          <div className="px-2 mt-3 mb-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('folders')}</span>
          </div>
          {rootFolders.length > 0 ? (
            rootFolders.map(folder => (
              <div 
                key={folder.id} 
                className={`sidebar-item ${currentFolderId === folder.id ? 'active' : ''}`} 
                onClick={() => { 
                  handleOpenMyFiles(); 
                  navigateToFolder(folder.id, folder.name); 
                }}
              >
                <i className="fa-solid fa-folder w-4 text-center text-amber-400"></i>
                <span className="truncate">{folder.name}</span>
              </div>
            ))
          ) : (
            <div className="px-2 text-xs text-slate-400">{t('noFolders')}</div>
          )}
          <div className="mt-auto pt-4 border-t border-slate-200 mx-1">
            <div className={`sidebar-item ${view === 'trash' ? 'active' : ''}`} onClick={handleOpenTrash}>
              <i className="fa-solid fa-trash-can w-4 text-center text-slate-400"></i>
              <span>{t('trash')}</span>
            </div>
          </div>
        </aside>
        
        {/* Content Area */}
        <section id="content-area" className="flex-1 flex flex-col overflow-hidden bg-slate-50">
          {/* TOP BAR */}
          <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              {/* 🆕 Хлебные крошки для "Мои файлы" и "Общий доступ" */}
              {(view === 'files' || view === 'shared') ? (
                breadcrumbs.map((crumb, index) => (
                  <div key={crumb.id ?? 'root'} className="flex items-center gap-1.5">
                    {index > 0 && (
                      <i className="fa-solid fa-chevron-right text-[10px] breadcrumb-sep"></i>
                    )}
                    <span
                      className={`text-xs font-medium cursor-pointer transition-colors ${
                        index === breadcrumbs.length - 1
                          ? 'text-slate-800 font-semibold'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                      onClick={() => navigateToFolder(crumb.id, crumb.name)}
                    >
                      {crumb.name}
                    </span>
                  </div>
                ))
              ) : view === 'trash' ? (
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-2">
                  <i className="fa-solid fa-trash-can text-slate-400"></i> {t('trash')}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* 🆕 Поиск для "Мои файлы" и "Общий доступ" */}
              {(view === 'files' || view === 'shared') ? (
                <>
                  <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input
                      type="text"
                      placeholder={t('searchPlaceholder')}
                      className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-52 transition-shadow"
                    />
                  </div>
                  {/* Кнопки создания только в "Мои файлы" */}
                  {view === 'files' && (
                    <div className="flex items-center gap-2">
                      <button onClick={handleCreateFolder} className="h-8 px-3 flex items-center gap-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm">
                        <i className="fa-solid fa-folder-plus text-[11px]"></i> {t('newFolder')}
                      </button>
                      <button onClick={handleCreateDocumentSet} className="h-8 px-3 flex items-center gap-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm">
                        <i className="fa-solid fa-file-lines text-[11px]"></i> {t('newTemplate')}
                      </button>
                      <input type="file" ref={fileInputRef} accept=".docx,.pdf,.rtf" className="hidden" onChange={handleFileChange} />
                      <button onClick={handleFileUploadClick} className="h-8 px-3 flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors shadow-sm">
                        <i className="fa-solid fa-upload text-[11px]"></i> {t('uploadFile')}
                      </button>
                    </div>
                  )}
                </>
              ) : view === 'trash' ? (
                <button onClick={handleClearTrash} className="h-8 px-3 flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors shadow-sm">
                  <i className="fa-solid fa-trash-can text-[11px]"></i> {t('clearTrash')}
                </button>
              ) : null}
            </div>
          </div>
          
          {/* Переиспользуемая таблица */}
          <FilesTable
            folders={currentFolders}
            documentSets={currentDocumentSets}
            isLoading={isLoading}
            isTrashView={view === 'trash'}
            isSharedView={view === 'shared'}
            commentsCount={commentsCount}
          />
        </section>
      </main>
      
      <ConversionModal ref={conversionModalRef} />
      
      {/* ============ Уведомление ============ */}
      {notification && (
        <div className="fixed bottom-6 right-6 bg-slate-800 text-white px-4 py-2.5 rounded-xl shadow-lg z-[500] text-xs font-medium flex items-center gap-2 animate-fade-in">
          <i className="fa-solid fa-circle-check text-green-400"></i>
          {notification}
        </div>
      )}
      
      {/* ============ Модальные окна через Portal ============ */}
      {typeof document !== 'undefined' && createPortal(
        <>
          <ContextMenu />
          <RenameModal />
          <MoveModal />
          <CreateModal />
          <CloneTemplateModal />
          <FolderAccessModal />
        </>,
        document.body
      )}
    </>
  );
}