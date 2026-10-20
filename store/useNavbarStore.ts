// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// store/useNavbarStore.ts
import { create } from 'zustand';
import {
  User, Notification, RegisterPayload, DocumentSetAccess, AccessPayload, UpdateProfilePayload
} from '@/lib/types';
import { tokenUtils } from '@/lib/types';
import { authApi, notificationsApi, documentSetsApi, usersApi } from '@/lib/realApi';
import { getT } from './i18nStore'; // Импортируем геттер функции перевода

interface NavbarState {
  // --- Состояние Аутентификации ---
  user: User | null;
  isAuthLoading: boolean;
  isAuthInitialized: boolean;
  authError: string | null;
  
  // --- Состояние Уведомлений ---
  notifications: Notification[];
  unreadCount: number;
  
  // --- Состояние Доступа (Access) ---
  accessList: DocumentSetAccess[];
  isAccessLoading: boolean;
  accessError: string | null;

  // --- Действия: Аутентификация ---
  initializeAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterPayload) => Promise<boolean>;
  logout: () => void;
  
  // --- Действия: Уведомления ---
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  
  // --- Действия: Доступ ---
  fetchAccess: (setId: number) => Promise<void>;
  grantAccess: (setId: number, data: AccessPayload) => Promise<void>;
  updateAccess: (setId: number, accessId: number, data: Partial<AccessPayload>) => Promise<void>;
  revokeAccess: (setId: number, accessId: number) => Promise<void>;
  updateProfile: (data: UpdateProfilePayload) => Promise<void>;
}

export const useNavbarStore = create<NavbarState>((set, get) => ({
  // Инициализация
  user: null,
  isAuthLoading: false,
  isAuthInitialized: false,
  authError: null,
  notifications: [],
  unreadCount: 0,
  accessList: [],
  isAccessLoading: false,
  accessError: null,

  // === АУТЕНТИФИКАЦИЯ ===
  initializeAuth: async () => {
    set({ isAuthLoading: true, isAuthInitialized: false });
    const token = tokenUtils.getToken();
    if (token) {
      try {
        const user = await authApi.getMe();
        set({ user, isAuthLoading: false, isAuthInitialized: true });
        await get().fetchNotifications();
      } catch (error) {
        get().logout();
      }
    } else {
      set({ isAuthLoading: false, isAuthInitialized: true });
    }
  },

  login: async (email: string, password: string) => {
    set({ isAuthLoading: true, authError: null });
    try {
      await authApi.login(email, password);
      const user = await authApi.getMe();
      set({ user, isAuthLoading: false });
      await get().fetchNotifications();
    } catch (error: any) {
      // Используем getT() для получения функции перевода
      set({ authError: error.message || getT()('navbar.auth.loginError'), isAuthLoading: false });
    }
  },

  register: async (data: RegisterPayload) => {
    set({ isAuthLoading: true, authError: null });
    try {
      await authApi.register(data);
      set({ isAuthLoading: false });
      return true;
    } catch (error: any) {
      set({ authError: error.message || getT()('navbar.auth.registerError'), isAuthLoading: false });
      return false;
    }
  },

  logout: () => {
    tokenUtils.removeToken();
    set({
      user: null,
      isAuthLoading: false,
      isAuthInitialized: true,
      notifications: [],
      unreadCount: 0,
      accessList: [],
      authError: null,
    });
  },

  updateProfile: async (data: UpdateProfilePayload) => {
    try {
      const updatedUser = await usersApi.updateProfile(data);
      set({ user: updatedUser });
    } catch (error: any) {
      throw new Error(error.message || getT()('navbar.auth.updateProfileError'));
    }
  },

  // === УВЕДОМЛЕНИЯ ===
  fetchNotifications: async () => {
    if (!get().user) return;
    try {
      const notifications = await notificationsApi.list();
      const unreadCount = notifications.filter(n => !n.is_read).length;
      set({ notifications, unreadCount });
    } catch (error) {
      console.error(getT()('navbar.notifications.fetchError'), error);
    }
  },

  markAsRead: async (id: number) => {
    try {
      await notificationsApi.markRead(id);
      const notifications = get().notifications.map(n => n.id === id ? { ...n, is_read: true } : n);
      const unreadCount = notifications.filter(n => !n.is_read).length;
      set({ notifications, unreadCount });
    } catch (error) {
      console.error(getT()('navbar.notifications.markReadError'), error);
    }
  },

  markAllAsRead: async () => {
    try {
      await notificationsApi.markAllRead();
      const notifications = get().notifications.map(n => ({ ...n, is_read: true }));
      set({ notifications, unreadCount: 0 });
    } catch (error) {
      console.error(getT()('navbar.notifications.markAllReadError'), error);
    }
  },

  // === ДОСТУП (ACCESS) ===
  fetchAccess: async (setId: number) => {
    set({ isAccessLoading: true, accessError: null });
    try {
      const accessList = await documentSetsApi.getAccess(setId);
      set({ accessList, isAccessLoading: false });
    } catch (error: any) {
      set({ accessError: error.message || getT()('navbar.access.fetchError'), isAccessLoading: false });
    }
  },

  grantAccess: async (setId: number, data: AccessPayload) => {
    try {
      const newAccess = await documentSetsApi.grantAccess(setId, data);
      set((state) => ({ accessList: [...state.accessList, newAccess] }));
    } catch (error: any) {
      set({ accessError: error.message || getT()('navbar.access.grantError') });
      throw error;
    }
  },

  updateAccess: async (setId: number, accessId: number, data: Partial<AccessPayload>) => {
    try {
      const updatedAccess = await documentSetsApi.updateAccess(setId, accessId, data);
      set((state) => ({ accessList: state.accessList.map((a) => (a.id === accessId ? updatedAccess : a)) }));
    } catch (error: any) {
      set({ accessError: error.message || getT()('navbar.access.updateError') });
      throw error;
    }
  },

  revokeAccess: async (setId: number, accessId: number) => {
    try {
      await documentSetsApi.revokeAccess(setId, accessId);
      set((state) => ({ accessList: state.accessList.filter((a) => a.id !== accessId) }));
    } catch (error: any) {
      set({ accessError: error.message || getT()('navbar.access.revokeError') });
      throw error;
    }
  },
}));