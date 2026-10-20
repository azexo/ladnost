// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/PropertySettings.tsx
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { questionnaireApi } from '@/lib/realApi';

export const PropertySettings = () => {
  // Инициализируем переводы для неймспейса PropertySettings
  const t = useTranslations('PropertySettings');

  const activeSettings = useStore((state) => state.data.activeSettings);
  const closeSettings = useStore((state) => state.data.closeSettings);
  const setId = useStore((state) => state.documentPackage.setId);
  const conditions = useStore((state) => state.data.conditions); // 🆕 Получаем список условий из стора
  const item = activeSettings?.item;

  // 1. Локальное состояние формы
  const [formData, setFormData] = useState<any>({
    name: '',
    identifier: '',
    data_type: 'text',
    text_input_type: 'short',
    options: [],
    value_source: 'user_input',
    default_value: '',
    formula: '',
    format: '',
    hint: '',
    is_required: true,
    hide_in_form: false,
    display_condition_id: null, // 🆕
  });

  // 2. Синхронизация локального состояния с данными из стора при открытии панели
  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        identifier: item.identifier || '',
        data_type: item.data_type || 'text',
        text_input_type: item.text_input_type || 'short',
        options: item.options || [],
        value_source: item.value_source || 'user_input',
        default_value: item.default_value || '',
        formula: item.formula || '',
        format: item.format || '',
        hint: item.hint || '',
        is_required: item.is_required ?? true,
        hide_in_form: item.hide_in_form ?? false,
        display_condition_id: item.display_condition_id || null, // 🆕
      });
    } else {
      setFormData({
        name: '', identifier: '', data_type: 'text', text_input_type: 'short', options: [], value_source: 'user_input',
        default_value: '', formula: '', format: '', hint: '',
        is_required: true, hide_in_form: false,
        display_condition_id: null, // 🆕
      });
    }
  }, [item]);

  const handleChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  // 3. Логика сохранения (Create / Update)
  const handleSave = async () => {
    if (!setId) return;
    
    const dataToSave = {
      ...formData,
      options: (formData.options || []).filter((v: string) => v.trim() !== '')
    };
    
    try {
      if (item?.id) {
        const updatedProp = await questionnaireApi.updateProperty(setId, item.id, dataToSave);
        useStore.setState((state: any) => {
          const mergedProp = { ...item, ...updatedProp };
          return {
            data: {
              ...state.data,
              properties: state.data.properties.map((p: any) =>
                p.id === item.id ? mergedProp : p
              ),
              activeSettings: state.data.activeSettings 
                ? { ...state.data.activeSettings, item: mergedProp } 
                : null,
            },
          };
        });
        useStore.getState().data.recalculateFormulas();
      } else {
        const newProp = await questionnaireApi.addProperty(setId, dataToSave);
        useStore.setState((state: any) => ({
          data: {
            ...state.data,
            properties: [...state.data.properties, newProp],
          },
        }));
      }
      closeSettings();
    } catch (error) {
      console.error('Error saving property:', error);
    }
  };

  const getDataTypeClass = (type: string) => {
    const isSelected = formData.data_type === type;
    return `type-btn flex flex-col items-center justify-center gap-1 px-1.5 py-2 rounded-md border-2 text-[10px] font-semibold text-center transition-all ${
      isSelected ? 'selected border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
    }`;
  };

  const getTextInputTypeClass = (type: string) => {
    const isSelected = formData.text_input_type === type;
    return `px-1.5 py-1.5 rounded-md border text-[10px] font-semibold text-center transition-all ${
      isSelected ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
    }`;
  };

  return (
    <div id="property-settings" className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('main')}
            </label>
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {t('name')} <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {t('identifier')}
                </label>
                <input
                  type="text"
                  value={formData.identifier}
                  onChange={(e) => handleChange('identifier', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {t('hint')}
                </label>
                <input
                  type="text"
                  value={formData.hint}
                  onChange={(e) => handleChange('hint', e.target.value)}
                  placeholder={t('hintPlaceholder')}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {t('dataType')}
                </label>
                <div className="grid grid-cols-4 gap-1">
                  <button type="button" className={getDataTypeClass('text')} onClick={() => handleChange('data_type', 'text')}>
                    <i className="fa-solid fa-font text-sm"></i>
                    <span>{t('types.text')}</span>
                  </button>
                  <button type="button" className={getDataTypeClass('number')} onClick={() => handleChange('data_type', 'number')}>
                    <i className="fa-solid fa-hashtag text-sm"></i>
                    <span>{t('types.number')}</span>
                  </button>
                  <button type="button" className={getDataTypeClass('money')} onClick={() => handleChange('data_type', 'money')}>
                    <i className="fa-solid fa-ruble-sign text-sm"></i>
                    <span>{t('types.money')}</span>
                  </button>
                  <button type="button" className={getDataTypeClass('date')} onClick={() => handleChange('data_type', 'date')}>
                    <i className="fa-regular fa-calendar text-sm"></i>
                    <span>{t('types.date')}</span>
                  </button>
                </div>
              </div>

              {/* Блок выбора формата текста */}
              {formData.data_type === 'text' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    {t('textFormat')}
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    <button type="button" className={getTextInputTypeClass('short')} onClick={() => handleChange('text_input_type', 'short')}>
                      {t('textInputTypes.short')}
                    </button>
                    <button type="button" className={getTextInputTypeClass('long')} onClick={() => handleChange('text_input_type', 'long')}>
                      {t('textInputTypes.long')}
                    </button>
                    <button type="button" className={getTextInputTypeClass('list')} onClick={() => handleChange('text_input_type', 'list')}>
                      {t('textInputTypes.list')}
                    </button>
                  </div>
                </div>
              )}

              {/* Блок ввода списка значений */}
              {formData.data_type === 'text' && formData.text_input_type === 'list' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    {t('availableValues')}
                  </label>
                  <textarea
                    value={(formData.options || []).join('\n')}
                    onChange={(e) => handleChange('options', e.target.value.split('\n'))}
                    placeholder={t('optionsPlaceholder')}
                    rows={4}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('value')}
          </label>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                {t('valueType')}
              </label>
              <select
                value={formData.value_source}
                onChange={(e) => handleChange('value_source', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="user_input">{t('valueSources.user_input')}</option>
                <option value="formula">{t('valueSources.formula')}</option>
                <option value="database">{t('valueSources.database')}</option>
                <option value="readonly">{t('valueSources.readonly')}</option>
              </select>
            </div>
            {formData.value_source === 'formula' ? (
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {t('formula')}
                </label>
                <textarea
                  value={formData.formula}
                  onChange={(e) => handleChange('formula', e.target.value)}
                  placeholder={t('formulaPlaceholder')}
                  rows={4}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {t('defaultValue')}
                </label>
                <input
                  type="text"
                  value={formData.default_value}
                  onChange={(e) => handleChange('default_value', e.target.value)}
                  placeholder={t('defaultValuePlaceholder')}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('parameters')}
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between py-1.5 px-2.5 bg-white border border-slate-200 rounded-md">
              <span className="text-xs font-medium text-slate-700">{t('isRequired')}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_required}
                  onChange={(e) => handleChange('is_required', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-7 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between py-1.5 px-2.5 bg-white border border-slate-200 rounded-md">
              <span className="text-xs font-medium text-slate-700">{t('hideInForm')}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.hide_in_form}
                  onChange={(e) => handleChange('hide_in_form', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-7 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* 🆕 НОВЫЙ БЛОК: УСЛОВНОЕ ОТОБРАЖЕНИЕ */}
        <div className="border-t border-slate-100 pt-3">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('conditions')}
          </label>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                {t('conditionalDisplay')}
              </label>
              <select
                value={formData.display_condition_id || ''}
                onChange={(e) => handleChange('display_condition_id', e.target.value ? Number(e.target.value) : null)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('alwaysDisplay')}</option>
                {conditions.map((cond: any) => (
                  <option key={cond.id} value={cond.id}>{cond.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                {t('conditionDescription')}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('outputFormat')}
          </label>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                {t('displayTemplate')}
              </label>
              <textarea
                value={formData.format}
                onChange={(e) => handleChange('format', e.target.value)}
                placeholder={t('templatePlaceholder')}
                rows={3}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 p-3 border-t border-slate-100 bg-white flex items-center justify-end gap-2">
        <button
          onClick={closeSettings}
          className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
        >
          {t('cancel')}
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-md transition-colors shadow-sm"
        >
          {item?.id ? t('saveChanges') : t('createProperty')}
        </button>
      </div>
    </div>
  );
};