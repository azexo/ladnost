// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// store/i18nStore.ts
import { create } from 'zustand';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

interface I18nState {
  t: TranslateFn | null;
  setT: (t: TranslateFn) => void;
}

// Отдельный стор для хранения функции перевода
export const useI18nStore = create<I18nState>((set) => ({
  t: null,
  setT: (t) => set({ t }),
}));

// Геттер для использования внутри других сторов (вне React-компонентов)
export const getT = (): TranslateFn => {
  const t = useI18nStore.getState().t;
  // Фоллбек, если вдруг вызвали до инициализации (вернет просто ключ)
  return t || ((key: string) => key); 
};