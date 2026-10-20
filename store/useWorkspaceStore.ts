// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// store/useWorkspaceStore.ts
import { create } from 'zustand';
import { Workspace, Subscription } from '@/lib/types';
import { workspacesApi, billingApi } from '@/lib/realApi';
import { pluginManager } from '@/lib/pluginManager';
import { getT } from './i18nStore'; // Импортируем геттер функции перевода

interface WorkspaceState {
  currentWorkspace: Workspace | null;
  currentSubscription: Subscription | null;
  workspaces: Workspace[];
  isInitializing: boolean;
  fetchMyWorkspaces: () => Promise<void>;
  setCurrentWorkspace: (ws: Workspace) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  currentWorkspace: null,
  currentSubscription: null,
  workspaces: [],
  isInitializing: true,
  
  fetchMyWorkspaces: async () => {
    const t = getT(); // Получаем актуальную функцию перевода
    
    console.log(`[WorkspaceStore] ${t('workspace.fetchStart')}`);
    
    try {
      const workspaces = await workspacesApi.getMy();
      console.log(`[WorkspaceStore] ${t('workspace.fetchSuccess', { count: workspaces.length })}`);
      set({ workspaces });

      if (workspaces.length > 0 && !get().currentWorkspace) {
        const savedId = localStorage.getItem('active_workspace_id');
        const ws = workspaces.find(w => w.id === Number(savedId)) || workspaces[0];
        
        console.log(`[WorkspaceStore] ${t('workspace.setCurrentStart', { 
          id: ws.id, 
          savedId: savedId || 'null' 
        })}`);
        
        await get().setCurrentWorkspace(ws);
      } else {
        console.log(`[WorkspaceStore] ${t('workspace.noWorkspacesOrAlreadySet')}`);
        set({ isInitializing: false });
      }
    } catch (error) {
      console.error(`[WorkspaceStore] ${t('workspace.fetchError')}:`, error);
      set({ isInitializing: false }); 
    }
  },
  
  setCurrentWorkspace: async (ws: Workspace) => {
    const t = getT();
    
    console.log(`[WorkspaceStore] ${t('workspace.switching', { id: ws.id })}`);
    localStorage.setItem('active_workspace_id', String(ws.id));
    
    let sub: Subscription | null = null;
    
    try {
      console.log(`[WorkspaceStore] ${t('workspace.requestingSub', { id: ws.id })}`);
      sub = await billingApi.getWorkspaceSubscription(ws.id);
      
      console.log(`[WorkspaceStore] ${t('workspace.subReceived', { 
        status: sub?.status || 'null', 
        expiresAt: sub?.expires_at || 'null' 
      })}`);
    } catch (e) {
      console.warn(`[WorkspaceStore] ${t('workspace.subError')}:`, e);
      sub = null; 
    }

    pluginManager.emit('workspace:changed', ws);
    console.log(`[WorkspaceStore] ${t('workspace.atomicUpdate')}`);
    
    set({ 
      currentWorkspace: ws, 
      currentSubscription: sub,
      isInitializing: false 
    });
  },
}));