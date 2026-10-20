// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/MarkupView.tsx
import React from 'react';
import { useTranslations } from 'next-intl';
import { PropertiesTab } from '../markup/PropertiesTab';
import { FormulationsMarkupTab } from '../markup/FormulationsMarkupTab';
import { SettingsPanel } from '../markup/SettingsPanel';
import { useStore } from '@/store/useStore';

interface MarkupViewProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const MarkupView: React.FC<MarkupViewProps> = ({ activeTab, setActiveTab }) => {
  // ✅ Инициализируем next-intl с неймспейсом 'MarkupView'
  const t = useTranslations('MarkupView');
  
  const activeSettings = useStore((s) => s.data.activeSettings);
  const openSettings = useStore((s) => s.data.openSettings);
  const closeSettings = useStore((s) => s.data.closeSettings);
  const currentMarkupTab = activeTab || 'properties';

  // ✅ ИСПРАВЛЕНИЕ 1: Расширяем типы, чтобы поддержать 'formulation_group' и строковые идентификаторы (токены)
  const openSettingsPanel = (
    type: 'property' | 'condition' | 'formulation' | 'formulation_group',
    id?: number | string
  ) => {
    openSettings(type as any, id);
  };

  return (
    <div id="markup-view" className="flex flex-col absolute inset-0 bg-surface">
      {/* Шапка с табами */}
      <div className="flex border-b border-slate-200 shrink-0 bg-white px-2 pt-4">
        <button
          id="tab-properties"
          onClick={() => setActiveTab('properties')}
          className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-colors ${
            currentMarkupTab === 'properties'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t('propertiesTab')}
        </button>
        <button
          id="tab-formulations-markup"
          onClick={() => setActiveTab('formulations')}
          className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-colors ${
            currentMarkupTab === 'formulations'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {t('formulationsTab')}
        </button>
      </div>

      {/* Контент табов */}
      {/* ✅ ИСПРАВЛЕНИЕ 2: Приводим типы, чтобы TypeScript не ругался на расширенную сигнатуру */}
      {currentMarkupTab === 'properties' && <PropertiesTab openSettingsPanel={openSettingsPanel as any} />}
      {currentMarkupTab === 'formulations' && <FormulationsMarkupTab openSettingsPanel={openSettingsPanel as any} />}

      {/* Рендерим панель настроек */}
      {activeSettings && (
        <SettingsPanel />
      )}
    </div>
  );
};