// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// ConditionSettings.tsx
import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import React from 'react';
import { useTranslations } from 'next-intl';

// ==========================================
// Рекурсивный компонент для отрисовки дерева логики
// ==========================================
const LogicGroup = ({ groupId, isRoot = false }: { groupId: number; isRoot?: boolean }) => {
  const t = useTranslations('ConditionSettings');
  
  const conditionLogic = useStore((s) => s.data.conditionLogic);
  const properties = useStore((s) => s.data.properties);
  const activeSettings = useStore((s) => s.data.activeSettings);
  const updateRule = useStore((s) => s.data.updateConditionRule);
  const deleteRule = useStore((s) => s.data.deleteConditionRule);
  const addRule = useStore((s) => s.data.addConditionRule);
  const addGroup = useStore((s) => s.data.addGroup);
  const updateGroupOperator = useStore((s) => s.data.updateGroupOperator);
  const deleteGroup = useStore((s) => s.data.deleteGroup);
  
  const group = conditionLogic?.groups.find((g: any) => g.id === groupId);
  const rules = conditionLogic?.rules.filter((r: any) => r.group_id === groupId) || [];
  const childGroups = conditionLogic?.groups.filter((g: any) => g.parent_group_id === groupId) || [];
  
  if (!group && !isRoot) return null;

  // Определяем тему (синяя для AND/Root, янтарная для OR)
  const isOrTheme = !isRoot && group?.logical_operator === 'OR';
  const themeColor = isOrTheme ? 'amber' : 'primary';

  // Классы для обертки группы
  const groupWrapperClass = isRoot
    ? 'logic-group py-2.5 pl-2 space-y-2'
    : `logic-group${isOrTheme ? '-or' : ''} py-2.5 pl-2 space-y-2 ml-1`;

  // Цвета для иконок и текста заголовка
  const headerIconColor = isOrTheme ? 'text-amber-300' : 'text-blue-300';
  const headerTextColor = isOrTheme ? 'text-amber-500' : 'text-blue-400';
  const focusRingColor = isOrTheme ? 'focus:ring-amber-400' : 'focus:ring-primary-400';

  return (
    <div className={groupWrapperClass}>
      {/* Header группы */}
      <div className="group-header flex items-center gap-1.5">
        <i className={`fa-solid fa-code ${headerIconColor} text-[10px]`}></i>
        
        {/* Переключатель AND / OR */}
        <div className="logic-connector ml-1">
          <button
            className={group?.logical_operator === 'AND' ? 'active-and' : ''}
            onClick={() => group && updateGroupOperator(group.id, 'AND')}
          >
            {t('and')}
          </button>
          <button
            className={group?.logical_operator === 'OR' ? 'active-or' : ''}
            onClick={() => group && updateGroupOperator(group.id, 'OR')}
          >
            {t('or')}
          </button>
        </div>
        
        {/* Кнопки управления группой (только для вложенных) */}
        {!isRoot && group && (
          <div className="ml-auto flex items-center gap-0.5">
            <button 
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-100 text-slate-300 hover:text-red-400 text-[10px] transition-colors" 
              title={t('deleteGroupTooltip')}
              onClick={() => deleteGroup(group.id)}
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        )}
      </div>
      
      {/* Правила и вложенные группы */}
      <div className="space-y-2">
        {rules.map((rule: any, index: number) => {
          const selectedProp = properties.find((p: any) => p.id === rule.property_id);
          const hasOptions = selectedProp?.options && selectedProp.options.length > 0;
          
          return (
            <React.Fragment key={rule.id}>
              {/* Само правило */}
              <div className="logic-rule p-2 flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <select
                    className={`flex-1 min-w-0 px-1.5 py-1 border border-slate-200 rounded-md text-[11px] bg-white focus:outline-none focus:ring-1 ${focusRingColor} text-slate-700`}
                    value={rule.property_id ?? ''}
                    onChange={(e) => updateRule(rule.id, { property_id: Number(e.target.value), compare_value: '' })} 
                  >
                    <option value="">{t('selectProperty')}</option>
                    {properties.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  
                  <select
                    className={`w-12 px-1 py-1 border border-slate-200 rounded-md text-[11px] bg-white focus:outline-none focus:ring-1 ${focusRingColor} text-slate-700 shrink-0`}
                    value={rule.operator ?? '='}
                    onChange={(e) => updateRule(rule.id, { operator: e.target.value })}
                  >
                    <option value="=">=</option>
                    <option value="!=">≠</option>
                    <option value={">"}>&gt;</option>
                    <option value={"<"}>&lt;</option>
                    <option value={">="}>≥</option>
                    <option value={"<="}>≤</option>
                  </select>
                  
                  {/* ЗНАЧЕНИЕ: Select если есть options, иначе Input */}
                  {hasOptions ? (
                    <select
                      className={`flex-1 min-w-0 px-1.5 py-1 border border-slate-200 rounded-md text-[11px] bg-white focus:outline-none focus:ring-1 ${focusRingColor} text-slate-700`}
                      value={rule.compare_value ?? ''}
                      onChange={(e) => updateRule(rule.id, { compare_value: e.target.value })}
                    >
                      <option value="">{t('selectValue')}</option>
                      {selectedProp.options.map((opt: string, idx: number) => (
                        <option key={idx} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className={`w-14 px-1.5 py-1 border border-slate-200 rounded-md text-[11px] bg-white focus:outline-none focus:ring-1 ${focusRingColor} text-slate-700 shrink-0`}
                      value={rule.compare_value || ''}
                      onChange={(e) => updateRule(rule.id, { compare_value: e.target.value })}
                      placeholder={t('emptyPlaceholder')}
                    />
                  )}
                </div>
                
                {/* Кнопки действий правила */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button 
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-100 text-slate-300 hover:text-red-400 text-[10px] transition-colors" 
                    title={t('deleteTooltip')}
                    onClick={() => deleteRule(rule.id)}
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
              
              {/* Визуальный коннектор-линия между элементами */}
              {index < rules.length - 1 && (
                <div className="group-connector-wrap flex items-center gap-2 py-1">
                  <div className={`connector-line flex-1 h-px ${isOrTheme ? 'bg-amber-200' : 'bg-blue-200'}`}></div>
                </div>
              )}
            </React.Fragment>
          );
        })}
        
        {/* Вложенные группы */}
        {childGroups.map((cg: any, index: number) => (
          <React.Fragment key={cg.id}>
            {rules.length > 0 && index === 0 && (
               <div className="group-connector-wrap flex items-center gap-2 py-1">
                  <div className={`connector-line flex-1 h-px ${isOrTheme ? 'bg-amber-200' : 'bg-blue-200'}`}></div>
               </div>
            )}
            <LogicGroup groupId={cg.id} />
            {index < childGroups.length - 1 && (
              <div className="group-connector-wrap flex items-center gap-2 py-1">
                <div className={`connector-line flex-1 h-px ${isOrTheme ? 'bg-amber-200' : 'bg-blue-200'}`}></div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      
      {/* Нижние кнопки добавления */}
      {group && (
        isRoot ? (
          <div className="flex items-center gap-1.5 pt-2">
            <button
              onClick={() => addRule(group.id, { property_id: properties[0]?.id ?? null, operator: '=', compare_value: '' })}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md border border-primary-200 transition-colors"
            >
              <i className="fa-solid fa-plus text-[9px]"></i> {t('addRule')}
            </button>
            <button
              onClick={() => addGroup(activeSettings?.item?.id ?? null, group.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-md border border-amber-200 transition-colors"
            >
              <i className="fa-solid fa-object-group text-[9px]"></i> {t('addGroup')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => addRule(group.id, { property_id: properties[0]?.id ?? null, operator: '=', compare_value: '' })}
            className="w-full py-1.5 border border-dashed border-amber-200 hover:border-amber-400 text-amber-500 hover:text-amber-600 text-[10px] font-semibold rounded-md transition-all flex items-center justify-center gap-1 bg-amber-50/50 hover:bg-amber-50 mt-2"
          >
            <i className="fa-solid fa-plus text-[9px]"></i> {t('addRuleToGroup')}
          </button>
        )
      )}
    </div>
  );
};

// ==========================================
// Основная панель настроек условия
// ==========================================
export const ConditionSettings = () => {
  const t = useTranslations('ConditionSettings');
  
  const activeSettings = useStore((state) => state.data.activeSettings);
  
  if (!activeSettings) {
    return null;
  }

  const reEvaluateConditionsAndSync = useStore((s) => s.data.reEvaluateConditionsAndSync);
  const conditionLogic = useStore((state) => state.data.conditionLogic);
  const addCondition = useStore((s) => s.data.addCondition);
  const updateCondition = useStore((s) => s.data.updateCondition);
  const flushDraftLogic = useStore((s) => s.data.flushDraftLogic);
  const closeSettings = useStore((s) => s.data.closeSettings);

  const item = activeSettings?.item;
  const isEditing = !!item;
  
  const [name, setName] = useState(item?.name || '');
  const [isEnabledDefault, setIsEnabledDefault] = useState(!!item?.is_enabled_default);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setName(item.name || '');
      setIsEnabledDefault(!!item.is_enabled_default);
    } else {
      setName('');
      setIsEnabledDefault(false);
    }
  }, [item]);

  const handleSave = async () => {
    if (!name.trim()) return;
    const payload = { name, is_enabled_default: isEnabledDefault };
    
    const setId = useStore.getState().documentPackage.setId;
    if (!setId) return;
    
    setIsSaving(true);
    try {
      let conditionId = item?.id;
      if (isEditing) {
        await updateCondition(conditionId, payload);
        await flushDraftLogic(conditionId); 
      } else {
        const newCond = await addCondition(setId, payload);
        conditionId = newCond.id;
        await flushDraftLogic(conditionId);
      }
      
      await reEvaluateConditionsAndSync(conditionId);
      closeSettings();
    } catch (err) {
      console.error('Failed to save condition', err);
    } finally {
      setIsSaving(false);
    }
  };

  const rootGroup = conditionLogic?.groups.find((g: any) => g.parent_group_id == null);
  const isLoadingLogic = conditionLogic === null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 1. Название */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            {t('conditionNameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('conditionNamePlaceholder')}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* 2. Включено по умолчанию */}
        <div className="flex items-center justify-between py-1.5 px-2.5 bg-white border border-slate-200 rounded-md">
          <span className="text-xs font-medium text-slate-700">{t('enabledByDefault')}</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabledDefault}
              onChange={(e) => setIsEnabledDefault(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-7 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-primary-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
          </label>
        </div>

        {/* 3. Логика применения */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              {t('applicationLogic')}
            </label>
          </div>
          <div className="min-h-[100px]">
            {isLoadingLogic ? (
              <div className="flex flex-col items-center justify-center h-20 text-slate-400 text-xs">
                <i className="fa-solid fa-spinner fa-spin text-slate-300 text-lg mb-1"></i>
                {t('loadingLogic')}
              </div>
            ) : rootGroup ? (
              <LogicGroup groupId={rootGroup.id} isRoot={true} />
            ) : (
              <div className="flex flex-col items-center justify-center h-20 text-amber-500 text-xs">
                <i className="fa-solid fa-triangle-exclamation text-lg mb-1"></i>
                {t('failedToLoadLogic')}
              </div>
            )}
          </div>
        </div>

        {/* Предупреждение */}
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2">
          <i className="fa-solid fa-triangle-exclamation text-amber-500 text-[11px] mt-0.5 shrink-0"></i>
          <p className="text-[10px] text-amber-700 leading-relaxed">
            {t('warningText')}
          </p>
        </div>
      </div>

      {/* 4. КНОПКИ СОХРАНЕНИЯ */}
      <div className="shrink-0 p-3 border-t border-slate-100 bg-white flex items-center justify-end gap-2">
        <button
          onClick={closeSettings}
          disabled={isSaving}
          className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
        >
          {t('cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || isSaving}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-md transition-colors shadow-sm disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <i className="fa-solid fa-spinner fa-spin mr-1"></i>
              {t('saving')}
            </>
          ) : isEditing ? (
            t('save')
          ) : (
            t('createCondition')
          )}
        </button>
      </div>
    </div>
  );
};