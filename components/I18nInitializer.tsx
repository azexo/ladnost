// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// components/I18nInitializer.tsx
'use client';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useI18nStore } from '@/store/i18nStore';

export function I18nInitializer() {
  const t = useTranslations();
  const setT = useI18nStore(state => state.setT);

  useEffect(() => {
    setT(t);
  }, [t, setT]);

  return null; // Ничего не рендерит, только синхронизирует
}