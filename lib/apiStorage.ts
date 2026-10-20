// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// src/lib/apiStorage.ts
import { StateStorage } from 'zustand/middleware';
import { getT } from '@/store/i18nStore'; // Убедитесь, что алиас @/ настроен, или используйте относительный путь

const API_BASE_URL = '/api/v1/storage';
let pendingWrite: { name: string; value: string } | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1000;

export const apiStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/${encodeURIComponent(name)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      return data.value ?? null;
    } catch (e) {
      const t = getT();
      console.warn(`⚠️ ${t('storage.fetchError')}:`, e);
      return null;
    }
  },
  
  setItem: async (name: string, value: string): Promise<void> => {
    const MAX_SIZE_BYTES = 5 * 1024 * 1024;
    if (value && value.length > MAX_SIZE_BYTES) {
      const t = getT();
      console.warn(`⚠️ ${t('storage.sizeLimit')}`);
      return Promise.resolve();
    }
    
    pendingWrite = { name, value };
    if (saveTimeout !== null) return Promise.resolve();
    
    return new Promise((resolve) => {
      saveTimeout = setTimeout(async () => {
        saveTimeout = null; 
        if (!pendingWrite) { resolve(); return; }
        const { name: key, value: val } = pendingWrite;
        pendingWrite = null; 
        
        try {
          const response = await fetch(`${API_BASE_URL}/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ value: val }),
          });
          if (!response.ok) throw new Error('Failed to save');
          resolve();
        } catch (e) {
          const t = getT();
          console.warn(`⚠️ ${t('storage.saveError')}:`, e);
          resolve(); // Возвращаем resolve, чтобы не блокировать работу Zustand
        }
      }, DEBOUNCE_MS);
    });
  },
  
  removeItem: async (name: string): Promise<void> => {
    try {
      await fetch(`${API_BASE_URL}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
    } catch (e) {
      const t = getT();
      console.warn(`⚠️ ${t('storage.deleteError')}:`, e);
    }
  },
};