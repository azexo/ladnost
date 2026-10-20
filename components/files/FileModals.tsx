// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl'; // Импортируем хук next-intl
import { useFilesStore } from '@/store/useFilesStore';
import type { SelectedItem } from '@/store/useFilesStore';
import { useNavbarStore } from '@/store/useNavbarStore';
import { DocumentSetMode, Folder, AccessType } from '@/lib/types';
import { foldersApi, usersApi } from '@/lib/realApi';
import UserEmailInput from '@/components/UserEmailInput';

// ============ Общие типы ============
export interface ContextMenuState {
  x: number;
  y: number;
  id: number;
  type: 'folder' | 'documentSet';
  isTrash?: boolean;
}
export interface RenameModalState {
  id: number;
  type: 'folder' | 'documentSet';
  name: string;
}
export interface MoveModalState {
  items: SelectedItem[];
}
export interface CreateModalState {
  type: 'folder' | 'documentSet';
}

// ============ CONTEXT MENU ============
export function ContextMenu() {
  const t = useTranslations('FileModals.contextMenu');
  const router = useRouter();
  const { user } = useNavbarStore();
  const currentUserId = user?.id;
  
  const {
    contextMenu, setContextMenu, setRenameModal, setMoveModal, view,
    folders, documentSets, trashFolders, trashDocumentSets,
    navigateToFolder, trashItem, cloneDocumentSet, showNotification,
    restoreItem, permanentlyDeleteItem, setCloneTemplateModal,
    setFolderAccessModal 
  } = useFilesStore();

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  const item = contextMenu.type === 'folder'
    ? folders.find(f => f.id === contextMenu.id) || trashFolders?.find(f => f.id === contextMenu.id)
    : documentSets.find(d => d.id === contextMenu.id) || trashDocumentSets?.find(d => d.id === contextMenu.id);

  const isOwner = item?.owner_id === currentUserId;

  if (contextMenu.type === 'folder' && !isOwner) return null;
  if ((contextMenu.isTrash || view === 'trash') && !isOwner) return null;

  if (contextMenu.isTrash || view === 'trash') {
    return (
      <div ref={menuRef} className="context-menu bg-white border border-slate-200 rounded-xl shadow-2xl w-56 py-1.5 overflow-hidden fixed z-[400]" style={{ top: contextMenu.y, left: contextMenu.x }}>
        <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={() => { restoreItem(contextMenu.id, contextMenu.type); setContextMenu(null); }}>
          <i className="fa-solid fa-rotate-left text-slate-400 w-4 text-center text-[11px]"></i> {t('restore')}
        </button>
        <div className="border-t border-slate-100 my-1 mx-3"></div>
        <button className="ctx-item w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2.5 transition-colors" onClick={() => { permanentlyDeleteItem(contextMenu.id, contextMenu.type); setContextMenu(null); }}>
          <i className="fa-solid fa-trash-can w-4 text-center text-[11px]"></i> {t('permanentlyDelete')}
        </button>
      </div>
    );
  }

  const handleOpen = () => {
    if (contextMenu.type === 'folder') {
      const folder = folders.find(f => f.id === contextMenu.id);
      navigateToFolder(contextMenu.id, folder?.name || '');
    } else {
      const ds = documentSets.find(d => d.id === contextMenu.id);
      if (ds && ds.mode === DocumentSetMode.TEMPLATE && ds.owner_id !== currentUserId) {
        setCloneTemplateModal({ id: ds.id, defaultName: ds.name });
      } else {
        router.push(`/editor/${contextMenu.id}`);
      }
    }
    setContextMenu(null);
  };

  const handleRename = () => {
    const name = contextMenu.type === 'folder'
      ? folders.find(f => f.id === contextMenu.id)?.name || ''
      : documentSets.find(d => d.id === contextMenu.id)?.name || '';
    setRenameModal({ id: contextMenu.id, type: contextMenu.type, name });
    setContextMenu(null);
  };

  const handleMove = () => {
    setMoveModal({ items: [{ id: contextMenu.id, type: contextMenu.type }] });
    setContextMenu(null);
  };

  const handleTrash = () => {
    trashItem(contextMenu.id, contextMenu.type);
    setContextMenu(null);
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}/editor/${contextMenu.id}`;
    navigator.clipboard.writeText(link).then(() => {
      showNotification(t('linkCopied'));
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = link;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showNotification(t('linkCopied'));
    });
    setContextMenu(null);
  };

  const handleClone = async () => {
    const ds = documentSets.find(d => d.id === contextMenu.id);
    const defaultName = ds ? `${ds.name} ${t('copySuffix')}` : t('defaultCopyName');
    const newName = window.prompt(t('cloneDocumentSetNamePrompt'), defaultName);
    if (newName && newName.trim()) {
      await cloneDocumentSet(contextMenu.id, newName.trim());
      showNotification(t('documentSetCloned'));
    }
    setContextMenu(null);
  };

  const handleFolderAccess = () => {
    const folder = folders.find(f => f.id === contextMenu.id);
    if (folder) {
      setFolderAccessModal({ folderId: folder.id, folderName: folder.name });
    }
    setContextMenu(null);
  };

  return (
    <div ref={menuRef} className="context-menu bg-white border border-slate-200 rounded-xl shadow-2xl w-56 py-1.5 overflow-hidden fixed z-[400]" style={{ top: contextMenu.y, left: contextMenu.x }}>
      {/* ОПЕРАЦИИ МОДИФИКАЦИИ: Доступны только владельцу */}
      {isOwner && (
        <>
          <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={handleRename}>
            <i className="fa-solid fa-pen text-slate-400 w-4 text-center text-[11px]"></i> {t('rename')}
          </button>
          <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={handleMove}>
            <i className="fa-solid fa-folder-arrow-down text-slate-400 w-4 text-center text-[11px]"></i> {t('move')}
          </button>
          {/* Кнопка настройки доступа ТОЛЬКО ДЛЯ ПАПКИ */}
          {contextMenu.type === 'folder' && (
            <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={handleFolderAccess}>
              <i className="fa-solid fa-user-gear text-slate-400 w-4 text-center text-[11px]"></i> {t('configureAccess')}
            </button>
          )}
        </>
      )}
      {/* ДЕЙСТВИЯ ДЛЯ КОМПЛЕКТОВ (ДОКУМЕНТОВ) */}
      {contextMenu.type === 'documentSet' && (
        <>
          <div className="border-t border-slate-100 my-1 mx-3"></div>
          <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={handleOpen}>
            <i className="fa-solid fa-arrow-up-right-from-square text-slate-400 w-4 text-center text-[11px]"></i> {t('open')}
          </button>
          <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={handleCopyLink}>
            <i className="fa-solid fa-link text-slate-400 w-4 text-center text-[11px]"></i> {t('copyLink')}
          </button>
          {isOwner && (
            <button className="ctx-item w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors" onClick={handleClone}>
              <i className="fa-solid fa-copy text-slate-400 w-4 text-center text-[11px]"></i> {t('cloneDocumentSet')}
            </button>
          )}
        </>
      )}
      {/* УДАЛЕНИЕ В КОРЗИНУ: Доступно только владельцу */}
      {isOwner && (
        <>
          <div className="border-t border-slate-100 my-1 mx-3"></div>
          <button className="ctx-item w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2.5 transition-colors" onClick={handleTrash}>
            <i className="fa-solid fa-trash-can w-4 text-center text-[11px]"></i> {t('moveToTrash')}
          </button>
        </>
      )}
    </div>
  );
}

// ============ RENAME MODAL ============
export function RenameModal() {
  const t = useTranslations('FileModals.renameModal');
  const { renameModal, setRenameModal, renameItem, showNotification } = useFilesStore();

  if (!renameModal) return null;

  const handleSubmit = () => {
    const input = document.getElementById('rename-input') as HTMLInputElement;
    if (input.value && input.value !== renameModal.name) {
      renameItem(renameModal.id, renameModal.type, input.value);
      showNotification(t('success'));
    }
    setRenameModal(null);
  };

  return (
    <div className="modal-overlay fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">{t('title')}</h2>
          <button onClick={() => setRenameModal(null)} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
            <i className="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
        <div className="px-6 py-5">
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t('newNameLabel')}</label>
          <input type="text" defaultValue={renameModal.name} id="rename-input" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" />
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={() => setRenameModal(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('cancel')}</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">{t('save')}</button>
        </div>
      </div>
    </div>
  );
}

// ============ MOVE MODAL ============
export function MoveModal() {
  const t = useTranslations('FileModals.moveModal');
  const { moveModal, setMoveModal, batchAction } = useFilesStore();
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: number | null; name: string }[]>([{ id: null, name: t('myFiles') }]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (moveModal) {
      setCurrentFolderId(null);
      setBreadcrumbs([{ id: null, name: t('myFiles') }]);
    }
  }, [moveModal, t]);

  useEffect(() => {
    if (!moveModal) return;
    const fetchFolders = async () => {
      setIsLoading(true);
      try {
        const fetchedFolders = await foldersApi.list(currentFolderId === null ? undefined : currentFolderId);
        setFolders(fetchedFolders);
      } catch (error) {
        console.error('Failed to fetch folders for move modal:', error);
        setFolders([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchFolders();
  }, [currentFolderId, moveModal]);

  if (!moveModal) return null;

  const handleEnterFolder = (folderId: number, folderName: string) => {
    setCurrentFolderId(folderId);
    setBreadcrumbs((prev) => [...prev, { id: folderId, name: folderName }]);
  };

  const handleNavigateToBreadcrumb = (index: number) => {
    const target = breadcrumbs[index];
    setCurrentFolderId(target.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleMove = () => {
    batchAction('move', currentFolderId, moveModal.items);
    setMoveModal(null);
  };

  const isMovingFolderIntoItself = moveModal.items.some(item => {
    if (item.type === 'folder') {
      return breadcrumbs.some(b => b.id === item.id) || currentFolderId === item.id;
    }
    return false;
  });

  return (
    <div className="modal-overlay fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-bold text-slate-800">{t('title')}</h2>
          <button onClick={() => setMoveModal(null)} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
            <i className="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1 text-xs text-slate-500 overflow-x-auto flex-shrink-0">
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.id ?? 'root'} className="flex items-center gap-1 flex-shrink-0">
              {index > 0 && <i className="fa-solid fa-chevron-right text-[9px] text-slate-300"></i>}
              <button onClick={() => handleNavigateToBreadcrumb(index)} className={`hover:text-primary-600 transition-colors font-medium ${index === breadcrumbs.length - 1 ? 'text-slate-800 cursor-default' : 'text-slate-500'}`} disabled={index === breadcrumbs.length - 1}>
                {crumb.name}
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-4 overflow-y-auto flex-grow space-y-1">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-400">{t('loading')}</div>
          ) : folders.length > 0 ? (
            folders.map((folder) => (
              <div key={folder.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-transparent hover:border-primary-200 transition-all" onClick={() => handleEnterFolder(folder.id, folder.name)}>
                <i className="fa-solid fa-folder text-amber-400"></i>
                <span className="text-sm text-slate-700 font-medium flex-grow">{folder.name}</span>
                <i className="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs text-slate-400">{t('noSubfolders')}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 flex-shrink-0">
          <button onClick={() => setMoveModal(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('cancel')}</button>
          <button onClick={handleMove} disabled={isMovingFolderIntoItself} title={isMovingFolderIntoItself ? t('cannotMoveIntoItself') : ''} className="px-4 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {t('moveHere')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ CREATE MODAL ============
export function CreateModal() {
  const t = useTranslations('FileModals.createModal');
  const { createModal, setCreateModal, createFolder, createDocumentSet, showNotification } = useFilesStore();

  if (!createModal) return null;

  const isFolder = createModal.type === 'folder';
  const title = isFolder ? t('newFolder') : t('newTemplate');
  const placeholder = isFolder ? t('folderNamePlaceholder') : t('templateNamePlaceholder');

  const handleSubmit = async () => {
    const input = document.getElementById('create-input') as HTMLInputElement;
    if (input.value && input.value.trim()) {
      if (isFolder) {
        await createFolder(input.value.trim());
        showNotification(t('folderCreated'));
      } else {
        await createDocumentSet(input.value.trim());
        showNotification(t('documentSetCreated'));
      }
    }
    setCreateModal(null);
  };

  return (
    <div className="modal-overlay fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          <button onClick={() => setCreateModal(null)} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
            <i className="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
        <div className="px-6 py-5">
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t('nameLabel')}</label>
          <input type="text" id="create-input" placeholder={placeholder} autoFocus className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }} />
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={() => setCreateModal(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('cancel')}</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">{t('create')}</button>
        </div>
      </div>
    </div>
  );
}

// ============ CLONE TEMPLATE MODAL ============
export function CloneTemplateModal() {
  const t = useTranslations('FileModals.cloneTemplateModal');
  const { cloneTemplateModal, setCloneTemplateModal, cloneTemplateAsStandard } = useFilesStore();
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: number | null; name: string }[]>([{ id: null, name: t('myFiles') }]);
  const [isLoading, setIsLoading] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (cloneTemplateModal) {
      setNewName(cloneTemplateModal.defaultName + ' ' + t('copySuffix'));
      setCurrentFolderId(null);
      setBreadcrumbs([{ id: null, name: t('myFiles') }]);
    }
  }, [cloneTemplateModal, t]);

  useEffect(() => {
    if (!cloneTemplateModal) return;
    const fetchFolders = async () => {
      setIsLoading(true);
      try {
        const fetchedFolders = await foldersApi.list(currentFolderId === null ? undefined : currentFolderId);
        setFolders(fetchedFolders);
      } catch (error) {
        console.error('Failed to fetch folders for clone modal:', error);
        setFolders([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchFolders();
  }, [currentFolderId, cloneTemplateModal]);

  if (!cloneTemplateModal) return null;

  const handleEnterFolder = (folderId: number, folderName: string) => {
    setCurrentFolderId(folderId);
    setBreadcrumbs((prev) => [...prev, { id: folderId, name: folderName }]);
  };

  const handleNavigateToBreadcrumb = (index: number) => {
    const target = breadcrumbs[index];
    setCurrentFolderId(target.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleSubmit = async () => {
    if (!newName.trim()) return;
    await cloneTemplateAsStandard(cloneTemplateModal.id, newName.trim(), currentFolderId);
    setCloneTemplateModal(null);
  };

  return (
    <div className="modal-overlay fixed inset-0 bg-black/30 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-bold text-slate-800">{t('title')}</h2>
          <button onClick={() => setCloneTemplateModal(null)} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
            <i className="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
        <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">{t('newNameLabel')}</label>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" autoFocus />
        </div>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1 text-xs text-slate-500 overflow-x-auto flex-shrink-0">
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.id ?? 'root'} className="flex items-center gap-1 flex-shrink-0">
              {index > 0 && <i className="fa-solid fa-chevron-right text-[9px] text-slate-300"></i>}
              <button onClick={() => handleNavigateToBreadcrumb(index)} className={`hover:text-primary-600 transition-colors font-medium ${index === breadcrumbs.length - 1 ? 'text-slate-800 cursor-default' : 'text-slate-500'}`} disabled={index === breadcrumbs.length - 1}>
                {crumb.name}
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-4 overflow-y-auto flex-grow space-y-1">
          <div className="text-xs font-semibold text-slate-500 mb-2 px-1">{t('selectFolder')}</div>
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-400">{t('loading')}</div>
          ) : folders.length > 0 ? (
            folders.map((folder) => (
              <div key={folder.id} className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border border-transparent hover:bg-slate-50 hover:border-primary-200 transition-all" onClick={() => handleEnterFolder(folder.id, folder.name)}>
                <i className="fa-solid fa-folder text-amber-400"></i>
                <span className="text-sm text-slate-700 font-medium flex-grow">{folder.name}</span>
                <i className="fa-solid fa-chevron-right text-[10px] text-slate-300"></i>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs text-slate-400">{t('noSubfolders')}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 flex-shrink-0">
          <button onClick={() => setCloneTemplateModal(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('cancel')}</button>
          <button onClick={handleSubmit} disabled={!newName.trim()} className="px-4 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{t('clone')}</button>
        </div>
      </div>
    </div>
  );
}

// ============ FOLDER ACCESS MODAL ============
export function FolderAccessModal() {
  const t = useTranslations('FileModals.folderAccessModal');
  const { folderAccessModal, setFolderAccessModal, showNotification } = useFilesStore();
  const [accessList, setAccessList] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newAccessEmail, setNewAccessEmail] = useState('');
  const [newAccessType, setNewAccessType] = useState<AccessType>(AccessType.VIEW);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (folderAccessModal) {
      fetchAccess();
      usersApi.listRelated().then(setAllUsers);
    }
  }, [folderAccessModal]);

  const fetchAccess = async () => {
    if (!folderAccessModal) return;
    setIsLoading(true);
    try {
      const data = await foldersApi.getFolderAccess(folderAccessModal.folderId);
      setAccessList(data);
    } catch (error) { console.error(error); }
    finally { setIsLoading(false); }
  };

  const handleGrantAccess = async () => {
    const email = newAccessEmail.toLowerCase().trim();
    if (!email) return;
    let foundUser = allUsers.find(u => u.email.toLowerCase() === email);
    if (!foundUser) {
      try {
        foundUser = await usersApi.invite(email);
        setAllUsers(prev => [...prev, foundUser!]);
      } catch (e) { alert(t('inviteError')); return; }
    }
    setIsSubmitting(true);
    try {
      await foldersApi.grantFolderAccess(folderAccessModal!.folderId, { user_id: foundUser.id, access_type: newAccessType });
      setNewAccessEmail('');
      await fetchAccess();
      showNotification(t('accessGranted'));
    } catch (error: any) { alert(error.message || t('grantAccessError')); }
    finally { setIsSubmitting(false); }
  };

  const handleUpdateAccess = async (userId: number, newType: AccessType) => {
    try {
      await foldersApi.grantFolderAccess(folderAccessModal!.folderId, { user_id: userId, access_type: newType });
      await fetchAccess();
      showNotification(t('accessUpdated'));
    } catch (error: any) { alert(error.message || t('updateAccessError')); }
  };

  const handleRevokeAccess = async (userId: number) => {
    if (!confirm(t('revokeAccessConfirm'))) return;
    try {
      await foldersApi.revokeFolderAccess(folderAccessModal!.folderId, userId);
      await fetchAccess();
      showNotification(t('accessRevoked'));
    } catch (error: any) { alert(error.message || t('revokeAccessError')); }
  };

  if (!folderAccessModal) return null;

  return (
    <div className="modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] items-center justify-center p-4 flex" onClick={() => setFolderAccessModal(null)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t('title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('subtitle', { name: folderAccessModal.folderName })}</p>
          </div>
          <button onClick={() => setFolderAccessModal(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"> <i className="fa-solid fa-xmark"></i> </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex gap-2">
            <div className="flex-1">
              <UserEmailInput value={newAccessEmail} onChange={setNewAccessEmail} placeholder={t('invitePlaceholder')} />
            </div>
            <select value={newAccessType} onChange={(e) => setNewAccessType(e.target.value as AccessType)} className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500">
              <option value={AccessType.FULL}>{t('accessFull')}</option>
              <option value={AccessType.REVIEW}>{t('accessReview')}</option>
              <option value={AccessType.COMMENT}>{t('accessComment')}</option>
              <option value={AccessType.VIEW}>{t('accessView')}</option>
            </select>
            <button onClick={handleGrantAccess} disabled={isSubmitting} className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors">{t('invite')}</button>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('user')}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('email')}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('accessType')}</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500">{t('term')}</th>
                  <th className="px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i> {t('loading')}</td></tr>
                ) : accessList.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">{t('emptyList')}</td></tr>
                ) : (
                  accessList.map((access) => {
                    const isOwnerAccess = access.access_type === AccessType.OWNER;
                    return (
                      <tr key={access.user_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <img src={access.avatar_url || '/default-avatar.svg'} className="w-6 h-6 rounded-full object-cover" alt="" />
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">
                                {access.last_name} {access.first_name}
                              </span>
                              {isOwnerAccess && (
                                <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-semibold">{t('owner')}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{access.email || '-'}</td>
                        <td className="px-4 py-2.5">
                          {isOwnerAccess ? (
                            <span className="text-[11px] font-semibold text-primary-600">{t('accessFull')}</span>
                          ) : (
                            <select value={access.access_type} onChange={(e) => handleUpdateAccess(access.user_id, e.target.value as AccessType)} className="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500">
                              <option value={AccessType.FULL}>{t('accessFull')}</option>
                              <option value={AccessType.REVIEW}>{t('accessReview')}</option>
                              <option value={AccessType.COMMENT}>{t('accessComment')}</option>
                              <option value={AccessType.VIEW}>{t('accessView')}</option>
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400">{t('indefinitely')}</td>
                        <td className="px-4 py-2.5 text-right">
                          {!isOwnerAccess && (
                            <button onClick={() => handleRevokeAccess(access.user_id)} className="text-slate-300 hover:text-red-500 transition-colors" title={t('revokeAccess')}>
                              <i className="fa-solid fa-trash text-xs"></i>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
          <button onClick={() => setFolderAccessModal(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('close')}</button>
        </div>
      </div>
    </div>
  );
}