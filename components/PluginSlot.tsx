// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { pluginComponents } from '../lib/generatedPlugins';

interface PluginSlotProps {
  name: string; // Имя слота, например "dashboard-widget"
  fallback?: React.ReactNode;
  [key: string]: any; // Пропсы для компонента плагина
}

export const PluginSlot: React.FC<PluginSlotProps> = ({ name, fallback, ...props }) => {
  const t = useTranslations('common');
  
  const pluginEntry = pluginComponents[name];
  
  if (!pluginEntry) {
    return <>{fallback}</>;
  }
  
  const PluginComponent = pluginEntry.component;
  
  return (
    <React.Suspense fallback={<div>{t('loadingPlugin')}</div>}>
      <PluginComponent {...props} />
    </React.Suspense>
  );
};