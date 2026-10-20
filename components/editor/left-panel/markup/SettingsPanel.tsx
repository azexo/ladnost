// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/SettingsPanel.tsx
'use client'; // next-intl хуки требуют, чтобы компонент был клиентским

import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { PropertySettings } from './settings/PropertySettings';
import { ConditionSettings } from './settings/ConditionSettings';
import { FormulationSettings } from './settings/FormulationSettings';

export const SettingsPanel = () => {
  // ✅ Подключаем переводы для неймспейса SettingsPanel
  const t = useTranslations('SettingsPanel');

  // ✅ Читаем напрямую из глобального состояния
  const activeSettings = useStore((s) => s.data.activeSettings);
  const closeSettings = useStore((s) => s.data.closeSettings);

  // ✅ Основная защита: если в глобальном состоянии ничего не активировано, просто не рендерим панель
  if (!activeSettings) return null;

  return (
    <div id="settings-panel" className="absolute inset-0 bg-surface z-20 flex flex-col slide-panel">
      {/* Header */}
      <div className="h-11 px-3 border-b border-slate-200 flex items-center gap-2.5 bg-white shrink-0">
        <button
          id="close-settings"
          onClick={closeSettings}
          className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors"
        >
          <i className="fa-solid fa-arrow-left text-xs"></i>
        </button>
        <h2 id="settings-panel-title" className="text-xs font-bold text-slate-800">
          {activeSettings.type === 'property' && t('propertyTitle')}
          {activeSettings.type === 'condition' && t('conditionTitle')}
          {activeSettings.type === 'formulation' && t('formulationTitle')}
          {activeSettings.type === 'formulation_group' && t('formulationGroupTitle')}
        </h2>
      </div>

      {/* Content */}
      {activeSettings.type === 'property' && <PropertySettings />}
      {activeSettings.type === 'condition' && <ConditionSettings />}
      {activeSettings.type === 'formulation' && <FormulationSettings />}
      {activeSettings.type === 'formulation_group' && <FormulationSettings />}
    </div>
  );
};