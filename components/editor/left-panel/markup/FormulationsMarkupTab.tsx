// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/FormulationsMarkupTab.tsx
import { useStore } from '@/store/useStore';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl'; // 🆕 Импортируем хук для переводов
import { scrollAndHighlightInEditor } from '@/components/editor/editorExtensions';

interface FormulationsMarkupTabProps {
  // Допускаем передачу строкового идентификатора для открытия группы
  openSettingsPanel: (type: string, id?: number | string) => void;
}

export const FormulationsMarkupTab = ({ openSettingsPanel }: FormulationsMarkupTabProps) => {
  // 🆕 Получаем функции перевода для неймспейса FormulationsMarkupTab
  const t = useTranslations('FormulationsMarkupTab');

  // Получаем сгруппированные формулировки из стора
  const formulationGroups = useStore((state) => state.data.setFormulations);
  
  // 🆕 Получаем список идентификаторов, которые фактически вставлены в документ
  // (теперь extractUsedIdentifiers корректно собирает identifier как из слотов, так и из токенов)
  const usedFormulationIds = useStore((state) => state.data.usedFormulationIds);
  
  // 🆕 Фильтруем группы: оставляем только те, для которых в документе есть слот с данным identifier
  // Карточка будет видна в панели, даже если сам слот в документе сейчас "схлопнут" (деактивирован)
  const filteredGroups = formulationGroups.filter((group: any) => {
    return usedFormulationIds.includes(group.identifier);
  });

  const highlightTarget = useStore((s: any) => s.ui.highlightTarget);

  useEffect(() => {
    if (highlightTarget && highlightTarget.type === 'formulation') {
      const cardEl = document.getElementById(`form-card-${highlightTarget.id}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardEl.classList.add('card-highlight-flash');
        setTimeout(() => cardEl.classList.remove('card-highlight-flash'), 1500);
      }
    }
  }, [highlightTarget]);

  return (
    <div id="content-formulations-markup" className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredGroups.map((group: any) => {
          // Находим fallback вариант для превью (или берем первый, если fallback нет)
          const fallbackVariant = group.variants.find((v: any) => v.variant.is_fallback) || group.variants[0];
          const fallbackForm = fallbackVariant?.formulation;

          return (
            <div
              key={group.identifier}
              id={`form-card-${group.identifier}`}
              className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:border-primary-300 hover:shadow-md transition-all cursor-pointer group"
              onClick={() => {
                openSettingsPanel('formulation_group', group.identifier);
                // 🆕 Клик по карточке -> прокрутка редактора
                scrollAndHighlightInEditor(group.identifier);
              }}
            >
              {/* Заголовок карточки с идентификатором слота */}
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    {`{{${group.identifier}}}`}
                  </span>
                </div>
                {/* 🆕 Используем t() с передачей count для автоматического склонения */}
                <span className="text-[10px] text-slate-400 font-medium">
                  {t('variantsCount', { count: group.variants.length })}
                </span>
              </div>
              
              {/* Тело карточки с информацией о Fallback формулировке */}
              <div className="p-3">
                {fallbackForm ? (
                  <>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="text-[11px] font-semibold text-slate-800 truncate">
                        {fallbackForm.name}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 leading-relaxed truncate mb-2">
                      {fallbackForm.text_content}
                    </div>
                    {/* Блок с аватаром, именем и email автора */}
                    <div className="flex items-center gap-1.5">
                      {fallbackForm.author_avatar && (
                        <img 
                          src={fallbackForm.author_avatar} 
                          className="w-6 h-6 rounded-full object-cover" 
                          // 🆕 Переводим alt-текст
                          alt={t('avatarAlt')} 
                        />
                      )}
                      <div className="flex flex-col leading-tight">
                        <span className="text-[10px] text-slate-600 font-medium">
                          {fallbackForm.author_name}
                        </span>
                        <span className="text-[9px] text-slate-400">
                          {fallbackForm.author_email}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  // 🆕 Переводим текст-заглушку
                  <div className="text-[11px] text-slate-400 italic">
                    {t('noBaseFormulation')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        
        {/* 🆕 Переводим текст пустого состояния */}
        {filteredGroups.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-8">
            {t('noUsedFormulations')}
          </div>
        )}
      </div>
    </div>
  );
};