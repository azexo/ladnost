// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// src/lib/idbStorage.ts
import { StateStorage } from 'zustand/middleware';
import { getT } from '@/store/i18nStore'; 

let dbPromise: Promise<IDBDatabase> | null = null;

export const getDb = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error(getT()('idb.serverError')));
  }
  
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('zustand-builder-db', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('keyval')) {
          db.createObjectStore('keyval');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
};

let pendingWrite: { name: string; value: string } | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1000;

export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readonly');
        const store = transaction.objectStore('keyval');
        const request = store.get(name);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn(getT()('idb.readError'), e);
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    
    const MAX_SIZE_BYTES = 100 * 1024 * 1024; 
    if (value && value.length > MAX_SIZE_BYTES) {
      const sizeInMb = (value.length / 1024 / 1024).toFixed(2);
      // Передаем параметр size для интерполяции в next-intl
      console.warn(getT()('idb.skipSaveSize', { size: sizeInMb }));
      return Promise.resolve();
    }

    pendingWrite = { name, value };
    if (saveTimeout !== null) return Promise.resolve();
    
    return new Promise((resolve) => {
      saveTimeout = setTimeout(async () => {
        saveTimeout = null; 
        if (!pendingWrite) { resolve(); return; }
        
        const { name: dbName, value: dbValue } = pendingWrite;
        pendingWrite = null; 
        
        try {
          const db = await getDb();
          const transaction = db.transaction('keyval', 'readwrite');
          const store = transaction.objectStore('keyval');
          const request = store.put(dbValue, dbName);
          
          request.onsuccess = () => resolve();
          request.onerror = () => { 
            console.warn(getT()('idb.writeError')); 
            resolve(); 
          };
        } catch (e) {
          console.warn(getT()('idb.exception'), e);
          resolve();
        }
      }, DEBOUNCE_MS);
    });
  },

  removeItem: async (name: string): Promise<void> => {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    try {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readwrite');
        const store = transaction.objectStore('keyval');
        const request = store.delete(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn(getT()('idb.deleteError'), e);
      return Promise.resolve();
    }
  },
};

/**
 * Экспорт всех данных из IndexedDB в JSON-файл
 */
export async function exportBackup(filename = 'zustand-backup.json') {
  if (typeof indexedDB === 'undefined') return;
  const db = await getDb();
  const tx = db.transaction('keyval', 'readonly');
  const store = tx.objectStore('keyval');

  // Получаем все ключи и значения параллельно
  const [keys, values] = await Promise.all([
    new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    new Promise<any[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  ]);

  // Собираем в единый объект
  const backupData: Record<string, any> = {};
  keys.forEach((key, index) => {
    backupData[String(key)] = values[index];
  });

  // Создаем Blob и инициируем скачивание
  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Импорт данных из JSON-файла обратно в IndexedDB
 */
export async function importBackup(file: File) {
  if (typeof indexedDB === 'undefined') return;
  const text = await file.text();
  const data = JSON.parse(text);
  const db = await getDb();
  const tx = db.transaction('keyval', 'readwrite');
  const store = tx.objectStore('keyval');

  // Опционально: очистить текущее хранилище перед восстановлением
  // await new Promise<void>(res => { store.clear().onsuccess = () => res(); });

  // Записываем данные обратно
  for (const [key, value] of Object.entries(data)) {
    await new Promise<void>((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  
  console.log(getT()('idb.backupRestored'));
}