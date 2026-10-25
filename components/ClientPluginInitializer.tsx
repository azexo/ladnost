// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// components/ClientPluginInitializer.tsx
'use client';

import { initializePluginLogics } from '@/lib/generatedPluginLogics';

// Флаг, чтобы избежать повторной инициализации при StrictMode или ре-рендерах
let isInitialized = false;

export function ClientPluginInitializer() {
  if (!isInitialized) {
    console.log('%c[ClientPluginInitializer] 🚀 Инициализация плагинов в БРАУЗЕРЕ...', 'color: green; font-weight: bold;');
    initializePluginLogics();
    isInitialized = true;
  }
  
  // Компонент ничего не рендерит в DOM
  return null; 
}