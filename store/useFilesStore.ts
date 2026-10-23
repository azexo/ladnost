// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand';
import { ContextMenuState, RenameModalState, MoveModalState, CreateModalState } from '@/components/files/FileModals';
import { foldersApi, documentSetsApi, documentsApi, usersApi, trashApi } from '@/lib/realApi';
import { Folder, DocumentSet, User } from '@/lib/types';
import { parseMarkdownToTiptap } from '@/lib/templateImport';
import { getT } from '@/store/i18nStore';

export interface SelectedItem {
  id: number;
  type: 'folder' | 'documentSet';
}

export interface BreadcrumbItem {
  id: number | null;
  name: string;
}

export interface ConversionModalRefLike {
  current: {
    start: (name: string) => void;
    updateProgress: (percent: number) => void;
    finish: (message?: string) => void;
  } | null;
}

interface FilesState {
  // === STATE ===
  currentFolderId: number | null;
  folders: Folder[];
  documentSets: DocumentSet[];
  users: User[];
  selectedItems: SelectedItem[];
  breadcrumbs: BreadcrumbItem[];
  isLoading: boolean;
  commentsCount: Record<number, number>;
  view: 'files' | 'trash' | 'shared';
  trashFolders: Folder[];
  trashDocumentSets: DocumentSet[];
  sharedFolders: Folder[];
  sharedDocumentSets: DocumentSet[];
  rootFolders: Folder[];
  folderAccessModal: { folderId: number; folderName: string } | null;
  setFolderAccessModal: (state: { folderId: number; folderName: string } | null) => void;
  fetchRootFolders: () => Promise<void>;
  cloneTemplateModal: { id: number; defaultName: string } | null;
  setCloneTemplateModal: (state: { id: number; defaultName: string } | null) => void;
  cloneTemplateAsStandard: (id: number, newName: string, targetFolderId: number | null) => Promise<void>;
  downloadDocumentSetArchive: (id: number, name: string) => Promise<void>;
  
  // === ACTIONS ===
  init: () => Promise<void>;
  fetchData: () => Promise<void>;
  navigateToFolder: (folderId: number | null, folderName: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  createDocumentSet: (name: string) => Promise<void>;
  renameItem: (id: number, type: 'folder' | 'documentSet', newName: string) => Promise<void>;
  moveItem: (id: number, type: 'folder' | 'documentSet', targetFolderId: number | null) => Promise<void>;
  trashItem: (id: number, type: 'folder' | 'documentSet') => Promise<void>;
  cloneDocumentSet: (id: number, newName?: string) => Promise<void>;
  toggleSelection: (id: number, type: 'folder' | 'documentSet') => void;
  selectAll: () => void;
  clearSelection: () => void;
  batchAction: (action: 'trash' | 'move' | 'favorite', targetFolderId?: number | null, customItems?: SelectedItem[]) => Promise<void>;
  getUserById: (id: number) => User | undefined;
  uploadAndCreateNonStandardSet: (file: File, modalRef?: ConversionModalRefLike) => Promise<void>;
  
  contextMenu: ContextMenuState | null;
  renameModal: RenameModalState | null;
  moveModal: MoveModalState | null;
  createModal: CreateModalState | null;
  notification: string | null;
  
  setContextMenu: (state: ContextMenuState | null) => void;
  setRenameModal: (state: RenameModalState | null) => void;
  setMoveModal: (state: MoveModalState | null) => void;
  setCreateModal: (state: CreateModalState | null) => void;
  showNotification: (message: string) => void;
  
  setView: (view: 'files' | 'trash' | 'shared') => void;
  fetchTrashData: () => Promise<void>;
  fetchSharedData: () => Promise<void>;
  restoreItem: (id: number, type: 'folder' | 'documentSet') => Promise<void>;
  permanentlyDeleteItem: (id: number, type: 'folder' | 'documentSet') => Promise<void>;
  batchRestore: (customItems?: SelectedItem[]) => Promise<void>;
  batchPermanentDelete: (customItems?: SelectedItem[]) => Promise<void>;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  currentFolderId: null,
  folders: [],
  documentSets: [],
  users: [],
  selectedItems: [],
  // Используем getT() для получения перевода вне React-компонентов
  breadcrumbs: [{ id: null, name: 'files.breadcrumbs.myFiles' }], 
  isLoading: false,
  commentsCount: {},
  view: 'files',
  trashFolders: [],
  trashDocumentSets: [],
  sharedFolders: [],
  sharedDocumentSets: [],
  contextMenu: null,
  renameModal: null,
  moveModal: null,
  createModal: null,
  notification: null,
  rootFolders: [],
  cloneTemplateModal: null,
  folderAccessModal: null,

  setFolderAccessModal: (state) => set({ folderAccessModal: state }),
  setCloneTemplateModal: (state) => set({ cloneTemplateModal: state }),

  downloadDocumentSetArchive: async (id, name) => {
    set({ isLoading: true });
    try {
      const blob = await documentsApi.downloadArchive(id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      get().showNotification(getT()('files.notifications.archiveDownloaded'));
    } catch (error: any) {
      console.error('Failed to download archive:', error);
      get().showNotification(error.message || getT()('files.notifications.archiveDownloadError'));
    } finally {
      set({ isLoading: false });
    }
  },

  fetchRootFolders: async () => {
    try {
      const rootFolders = await foldersApi.list();
      set({ rootFolders });
    } catch (error) {
      console.error('Failed to fetch root folders:', error);
    }
  },

  setContextMenu: (state) => set({ contextMenu: state }),
  setRenameModal: (state) => set({ renameModal: state }),
  setMoveModal: (state) => set({ moveModal: state }),
  setCreateModal: (state) => set({ createModal: state }),

  showNotification: (message: string) => {
    set({ notification: message });
    setTimeout(() => set({ notification: null }), 2500);
  },

  cloneTemplateAsStandard: async (id, newName, targetFolderId) => {
    try {
      await documentSetsApi.cloneAsStandard(id, newName, targetFolderId);
      await get().fetchData();
      get().showNotification(getT()('files.notifications.templateCloned'));
    } catch (error) {
      console.error('Failed to clone template:', error);
      get().showNotification(getT()('files.notifications.templateCloneError'));
    }
  },

  uploadAndCreateNonStandardSet: async (file: File, modalRef?: ConversionModalRefLike) => {
    const fileName = file.name.replace(/\.[^/.]+$/, '');
    set({ isLoading: true });
    
    modalRef?.current?.start(fileName);
    
    const formData = new FormData();
    formData.append('file', file);
    
    const xhr = new XMLHttpRequest();
    
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        modalRef?.current?.updateProgress(percentComplete);
      }
    };
    
    const timeoutId = setTimeout(() => {
      xhr.abort();
    }, 300_000);
    
    xhr.onload = async () => {
      clearTimeout(timeoutId);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data.markdown) {
            throw new Error(getT()('files.errors.noMarkdown'));
          }
          
          const { json: contentJson, html: contentHtml } = parseMarkdownToTiptap(data.markdown);
          
          const newSet = await documentSetsApi.create({
            name: fileName,
            folder_id: get().currentFolderId ?? undefined,
            mode: 'non_standard' as any
          });
          
          const newDoc = await documentsApi.create(newSet.id, { 
            name: fileName, 
            document_role: 'main' as any 
          });
          
          await documentsApi.updateContent(newDoc.id, contentJson, contentHtml);
          await documentsApi.uploadSourceFile(newDoc.id, file);
          
          await get().fetchData();
          
          if (data.warnings && data.warnings.length > 0) {
            console.warn('[UPLOAD WARNINGS]', data.warnings);
            modalRef?.current?.finish(getT()('files.notifications.uploadedWithWarnings', { warnings: data.warnings.join('\n') }));
          } else {
            modalRef?.current?.finish();
          }
          
          get().showNotification(getT()('files.notifications.setCreated', { name: fileName }));
        } catch (error: any) {
          console.error('Ошибка при обработке результата:', error);
          modalRef?.current?.finish(error.message || getT()('files.errors.conversionError'));
          get().showNotification(error.message || getT()('files.notifications.fileUploadError'));
        }
      } else {
        let msg = getT()('files.errors.serverError', { status: xhr.status });
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData.error) msg = errData.error;
        } catch (e) {}
        modalRef?.current?.finish(msg);
        get().showNotification(msg);
      }
      set({ isLoading: false });
    };
    
    xhr.onerror = () => {
      clearTimeout(timeoutId);
      const msg = getT()('files.errors.networkError');
      modalRef?.current?.finish(msg);
      get().showNotification(msg);
      set({ isLoading: false });
    };
    
    xhr.onabort = () => {
      clearTimeout(timeoutId);
      const msg = getT()('files.errors.timeoutError');
      modalRef?.current?.finish(msg);
      get().showNotification(msg);
      set({ isLoading: false });
    };
    
    xhr.open('POST', '/backend/to-md', true);
    xhr.send(formData);
  },

  setView: (view) => {
    const t = getT();
    let rootName = t('files.breadcrumbs.myFiles');
    if (view === 'shared') rootName = t('files.breadcrumbs.shared');
    if (view === 'trash') rootName = t('files.breadcrumbs.trash');

    set({
      view,
      currentFolderId: null,
      breadcrumbs: [{ id: null, name: rootName }],
      selectedItems: []
    });
  },

  fetchTrashData: async () => {
    set({ isLoading: true });
    try {
      const data = await trashApi.get();
      const setIds = data.document_sets.map(ds => ds.id);
      const commentsCount = await documentSetsApi.getCommentsCounts(setIds);
      set({ trashFolders: data.folders, trashDocumentSets: data.document_sets, commentsCount, selectedItems: [] });
    } catch (error) {
      console.error('Failed to fetch trash data:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchSharedData: async () => {
    set({ isLoading: true });
    try {
      const { currentFolderId } = get();
      const allFolders = await foldersApi.listShared();
      const folders = allFolders.filter(f => {
        if (currentFolderId === null) return f.parent_id === undefined || f.parent_id === null;
        return f.parent_id === currentFolderId;
      });
      
      const allSets = await documentSetsApi.listShared();
      const documentSets = allSets.filter(s => {
        if (currentFolderId === null) return s.folder_id === undefined || s.folder_id === null;
        return s.folder_id === currentFolderId;
      });
      
      const setIds = documentSets.map((ds: DocumentSet) => ds.id);
      const commentsCount = await documentSetsApi.getCommentsCounts(setIds);
      set({ sharedFolders: folders, sharedDocumentSets: documentSets, commentsCount, selectedItems: [] });
    } catch (error) {
      console.error('Failed to fetch shared data:', error);
      set({ sharedFolders: [], sharedDocumentSets: [] });
    } finally {
      set({ isLoading: false });
    }
  },

  restoreItem: async (id, type) => {
    try {
      if (type === 'folder') await foldersApi.restore(id);
      else await documentSetsApi.restore(id);
      await get().fetchTrashData();
      get().showNotification(getT()('files.notifications.itemRestored'));
    } catch (error) {
      console.error('Failed to restore item:', error);
    }
  },

  permanentlyDeleteItem: async (id, type) => {
    try {
      if (type === 'folder') await foldersApi.permanentDelete(id);
      else await documentSetsApi.permanentDelete(id);
      await get().fetchTrashData();
      get().showNotification(getT()('files.notifications.itemDeleted'));
    } catch (error) {
      console.error('Failed to permanently delete item:', error);
    }
  },

  batchRestore: async (customItems) => {
    const itemsToProcess = customItems && customItems.length > 0 ? customItems : get().selectedItems;
    if (itemsToProcess.length === 0) return;
    try {
      for (const item of itemsToProcess) {
        if (item.type === 'folder') await foldersApi.restore(item.id);
        else await documentSetsApi.restore(item.id);
      }
      set({ selectedItems: [] });
      await get().fetchTrashData();
      get().showNotification(getT()('files.notifications.itemsRestored'));
    } catch (error) {
      console.error('Failed to batch restore:', error);
    }
  },

  batchPermanentDelete: async (customItems) => {
    const itemsToProcess = customItems && customItems.length > 0 ? customItems : get().selectedItems;
    if (itemsToProcess.length === 0) return;
    try {
      for (const item of itemsToProcess) {
        if (item.type === 'folder') await foldersApi.permanentDelete(item.id);
        else await documentSetsApi.permanentDelete(item.id);
      }
      set({ selectedItems: [] });
      await get().fetchTrashData();
      get().showNotification(getT()('files.notifications.itemsDeleted'));
    } catch (error) {
      console.error('Failed to batch permanent delete:', error);
    }
  },

  init: async () => {
    try {
      const users = await usersApi.listRelated();
      set({ users });
      await get().fetchRootFolders();
      await get().fetchData();
      
      // 🆕 Обновляем только корневую хлебную крошку с правильным переводом, 
      // не сбрасывая всю навигацию, если мы находимся в подпапке
      const t = getT();
      const { breadcrumbs, view } = get();
      
      if (breadcrumbs.length > 0) {
        // Определяем правильное имя для корневой крошки в зависимости от view
        const rootName = view === 'shared' ? t('files.breadcrumbs.shared') : 
                        view === 'trash' ? t('files.breadcrumbs.trash') : 
                        t('files.breadcrumbs.myFiles');
                        
        // Обновляем имя корневой крошки, если оно изменилось (например, при смене языка)
        if (breadcrumbs[0].name !== rootName) {
          const updatedBreadcrumbs = [...breadcrumbs];
          updatedBreadcrumbs[0] = { ...updatedBreadcrumbs[0], name: rootName };
          set({ breadcrumbs: updatedBreadcrumbs });
        }
      } else {
        // На случай, если breadcrumbs пуст (хотя это не должно происходить)
        const rootName = view === 'shared' ? t('files.breadcrumbs.shared') : t('files.breadcrumbs.myFiles');
        set({ breadcrumbs: [{ id: null, name: rootName }] });
      }
    } catch (error) {
      console.error('Failed to init store:', error);
    }
  },

  fetchData: async () => {
    set({ isLoading: true });
    try {
      const { currentFolderId } = get();
      const folders = await foldersApi.list(currentFolderId === null ? undefined : currentFolderId);
      const allSets = await documentSetsApi.list();
      const documentSets = allSets.filter(s => {
        if (currentFolderId === null) return s.folder_id === undefined || s.folder_id === null;
        return s.folder_id === currentFolderId;
      });
      const setIds = documentSets.map(ds => ds.id);
      const commentsCount = await documentSetsApi.getCommentsCounts(setIds);
      set({ folders, documentSets, commentsCount, selectedItems: [] });
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  navigateToFolder: async (folderId: number | null, folderName: string) => {
    const { breadcrumbs, view } = get();
    const t = getT();
    
    if (folderId === null) {
      const rootName = view === 'shared' ? t('files.breadcrumbs.shared') : t('files.breadcrumbs.myFiles');
      set({
        currentFolderId: null,
        breadcrumbs: [{ id: null, name: rootName }]
      });
    } else {
      const existingIndex = breadcrumbs.findIndex(b => b.id === folderId);
      let newBreadcrumbs: BreadcrumbItem[];
      if (existingIndex !== -1) {
        newBreadcrumbs = breadcrumbs.slice(0, existingIndex + 1);
      } else {
        newBreadcrumbs = [...breadcrumbs, { id: folderId, name: folderName }];
      }
      set({
        currentFolderId: folderId,
        breadcrumbs: newBreadcrumbs
      });
    }
    
    if (view === 'shared') {
      await get().fetchSharedData();
    } else {
      await get().fetchData();
    }
  },

  createFolder: async (name: string) => {
    const { currentFolderId } = get();
    try {
      await foldersApi.create({
        name,
        parent_id: currentFolderId === null ? undefined : currentFolderId
      });
      await get().fetchData();
      await get().fetchRootFolders();
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  },

  createDocumentSet: async (name: string) => {
    const { currentFolderId } = get();
    try {
      const newSet = await documentSetsApi.create({
        name,
        folder_id: currentFolderId === null ? undefined : currentFolderId
      });
      if (newSet && newSet.id) {
        await documentsApi.create(newSet.id, { name });
      }
      await get().fetchData();
    } catch (error) {
      console.error('Failed to create document set:', error);
    }
  },

  renameItem: async (id, type, newName) => {
    try {
      if (type === 'folder') {
        await foldersApi.update(id, { name: newName });
      } else {
        await documentSetsApi.update(id, { name: newName });
      }
      await get().fetchData();
      await get().fetchRootFolders();
    } catch (error) {
      console.error('Failed to rename item:', error);
    }
  },

  moveItem: async (id, type, targetFolderId) => {
    try {
      if (type === 'folder') {
        await foldersApi.update(id, { parent_id: targetFolderId === null ? undefined : targetFolderId });
      } else {
        await documentSetsApi.move(id, targetFolderId === null ? 0 : targetFolderId);
      }
      await get().fetchData();
      await get().fetchRootFolders();
    } catch (error) {
      console.error('Failed to move item:', error);
    }
  },

  trashItem: async (id, type) => {
    try {
      if (type === 'folder') {
        await foldersApi.delete(id);
      } else {
        await documentSetsApi.trash(id);
      }
      await get().fetchData();
      await get().fetchRootFolders();
    } catch (error) {
      console.error('Failed to trash item:', error);
    }
  },

  cloneDocumentSet: async (id, newName) => {
    try {
      await documentSetsApi.clone(id, newName);
      await get().fetchData();
    } catch (error) {
      console.error('Failed to clone document set:', error);
    }
  },

  toggleSelection: (id, type) => {
    const { selectedItems } = get();
    const exists = selectedItems.find(item => item.id === id && item.type === type);
    if (exists) {
      set({ selectedItems: selectedItems.filter(item => !(item.id === id && item.type === type)) });
    } else {
      set({ selectedItems: [...selectedItems, { id, type }] });
    }
  },

  selectAll: () => {
    const { folders, documentSets } = get();
    const allItems: SelectedItem[] = [
      ...folders.map(f => ({ id: f.id, type: 'folder' as const })),
      ...documentSets.map(ds => ({ id: ds.id, type: 'documentSet' as const }))
    ];
    set({ selectedItems: allItems });
  },

  clearSelection: () => set({ selectedItems: [] }),

  batchAction: async (action, targetFolderId, customItems) => {
    const { selectedItems } = get();
    const itemsToProcess = customItems && customItems.length > 0 ? customItems : selectedItems;
    if (itemsToProcess.length === 0) return;
    try {
      const dsIds = itemsToProcess.filter(i => i.type === 'documentSet').map(i => i.id);
      if (dsIds.length > 0 && action !== 'favorite') {
        await documentSetsApi.batchAction({
          ids: dsIds,
          action: action as 'trash' | 'move',
          folder_id: targetFolderId === null ? undefined : targetFolderId
        });
      }
      for (const item of itemsToProcess) {
        if (item.type === 'folder') {
          if (action === 'trash') await foldersApi.delete(item.id);
          if (action === 'move') await foldersApi.update(item.id, { parent_id: targetFolderId === null ? undefined : targetFolderId });
        }
        if (item.type === 'documentSet' && action === 'favorite') {
          await documentSetsApi.update(item.id, { is_favorite: true });
        }
      }
      set({ selectedItems: [] });
      await get().fetchData();
    } catch (error) {
      console.error('Failed to perform batch action:', error);
    }
  },

  getUserById: (id) => {
    return get().users.find(u => u.id === id);
  }
}));