// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/FormulationsMarkupTab.tsx -> FormulationSettings.tsx
import { Fragment, useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { formulationsApi, questionnaireApi } from '@/lib/realApi';

// 🆕 Кастомный компонент для выбора формулировки в 2 этапа (как в SelectionMenu)
interface FormulationPickerProps {
  value: number | null | '';
  onChange: (id: number) => void;
  allFormulations: any[];
  types: any[];
  placeholder?: string;
}

const FormulationPicker = ({ value, onChange, allFormulations, types, placeholder }: FormulationPickerProps) => {
  const t = useTranslations('FormulationSettings');
  const resolvedPlaceholder = placeholder || t('selectFormulation');
  
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'type' | 'list'>('type');
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const selectedFormulation = allFormulations.find(f => f.id === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        resetState();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resetState = () => {
    setStep('type');
    setSearch('');
    setSelectedTypeId(null);
  };

  const filteredFormulations = allFormulations.filter(f => {
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase());
    if (step === 'list' && selectedTypeId !== null) {
      return matchesSearch && f.type_id === selectedTypeId;
    }
    return matchesSearch;
  });

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-2 py-1.5 border border-emerald-200 bg-white rounded-md text-[11px] text-left focus:outline-none focus:ring-1 focus:ring-emerald-400 flex items-center justify-between gap-2 hover:border-emerald-300 transition-colors"
      >
        <span className="truncate text-slate-700">
          {selectedFormulation ? selectedFormulation.name : <span className="text-slate-400">{resolvedPlaceholder}</span>}
        </span>
        <i className={`fa-solid fa-chevron-down text-[9px] text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden right-0">
          {step === 'type' ? (
            <div className="flex flex-col">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                {t('selectType')}
              </div>
              <div className="overflow-y-auto max-h-60">
                {types.length === 0 && <div className="px-3 py-4 text-xs text-slate-400 italic text-center">{t('noTypesAvailable')}</div>}
                {types.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => {
                      setSelectedTypeId(type.id);
                      setStep('list');
                      setSearch('');
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors w-full"
                  >
                    <span className="truncate">{type.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <span>{types.find(t => t.id === selectedTypeId)?.name || t('formulations')}</span>
                <button type="button" onClick={() => { setStep('type'); setSearch(''); setSelectedTypeId(null); }} className="text-[10px] text-slate-400 hover:text-slate-700 flex items-center gap-1">
                  <i className="fa-solid fa-arrow-left text-[8px]"></i> {t('back')}
                </button>
              </div>
              <div className="px-2 py-2 border-b border-slate-100 bg-white">
                <input 
                  type="text" 
                  placeholder={t('search')} 
                  value={search} 
                  onChange={(e) => setSearch(e.target.value)} 
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors" 
                  autoFocus 
                />
              </div>
              <div className="overflow-y-auto max-h-60">
                {filteredFormulations.length === 0 && <div className="px-3 py-4 text-xs text-slate-400 italic text-center">{t('nothingFound')}</div>}
                {filteredFormulations.map((item: any) => (
                  <button 
                    key={item.id} 
                    type="button"
                    onClick={() => {
                      onChange(item.id);
                      setIsOpen(false);
                      resetState();
                    }} 
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors w-full ${item.id === value ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span className="truncate">{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const FormulationSettings = () => {
  const t = useTranslations('FormulationSettings');
  
  const activeSettings = useStore((state) => state.data.activeSettings);
  const setFormulations = useStore((state) => state.data.setFormulations);
  const conditions = useStore((state) => state.data.conditions);
  const getAllFormulations = useStore((state) => state.data.getAllFormulations);
  const addFormulationVariant = useStore((state) => state.data.addFormulationVariant);
  const deleteFormulationVariant = useStore((state) => state.data.deleteFormulationVariant);
  const addCondition = useStore((state) => state.data.addCondition);
  const openSettings = useStore((state) => state.data.openSettings);

  const identifier = activeSettings?.item as string;
  const currentGroup = setFormulations.find((g: any) => g.identifier === identifier);
  const allFormulations = getAllFormulations();

  const [types, setTypes] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newConditionId, setNewConditionId] = useState<string | number>('new');
  const [newFormulationId, setNewFormulationId] = useState<number | ''>('');

  useEffect(() => {
    formulationsApi.getTypes().then(setTypes);
  }, []);

  if (!currentGroup) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        {t('groupNotFound')}
      </div>
    );
  }

  // Сортировка: fallback всегда сверху
  const sortedVariants = [...currentGroup.variants].sort((a, b) => {
    if (a.variant.is_fallback) return -1;
    if (b.variant.is_fallback) return 1;
    return 0;
  });

  const handleConditionChange = async (variantId: number, newConditionId: string) => {
    const conditionId = newConditionId === '' ? null : Number(newConditionId);
    try {
      await questionnaireApi.updateConditionVariant(variantId, { condition_id: conditionId });
      useStore.setState((s: any) => {
        const updatedSetFormulations = s.data.setFormulations.map((group: any) => {
          if (group.identifier === identifier) {
            return {
              ...group,
              variants: group.variants.map((v: any) => {
                if (v.variant.id === variantId) {
                  const newConditionObj = conditionId ? s.data.conditions.find((c: any) => c.id === conditionId) : null;
                  return { 
                    ...v, 
                    variant: { ...v.variant, condition_id: conditionId },
                    condition: newConditionObj
                  };
                }
                return v;
              }),
            };
          }
          return group;
        });
        return { data: { ...s.data, setFormulations: updatedSetFormulations } };
      });
      useStore.getState().data.syncFormulationSlots();
    } catch (error) {
      console.error('Ошибка при обновлении условия варианта:', error);
    }
  };

  const handleFormulationChange = async (variantId: number, newFormulationId: number) => {
    const newForm = allFormulations.find((f: any) => f.id === newFormulationId);
    if (!newForm) return;
    try {
      const updatedVariant = await questionnaireApi.updateConditionVariant(variantId, {
        formulation_id: newFormulationId,
        formulation_version_id: newForm.current_version_id || 1001,
      });
      useStore.setState((s: any) => {
        const updatedSetFormulations = s.data.setFormulations.map((group: any) => {
          return {
            ...group,
            variants: group.variants.map((v: any) => {
              if (v.variant.id === variantId) {
                return {
                  ...v,
                  variant: { ...v.variant, ...updatedVariant },
                  formulation: newForm,
                };
              }
              return v;
            }),
          };
        });
        return { data: { ...s.data, setFormulations: updatedSetFormulations } };
      });
    } catch (error) {
      console.error('Ошибка при обновлении формулировки варианта:', error);
    }
  };

  const handleToggleFallback = async (variantId: number, makeFallback: boolean) => {
    const currentFallback = currentGroup.variants.find((v: any) => v.variant.is_fallback);
    try {
      if (makeFallback) {
        await questionnaireApi.updateConditionVariant(variantId, { is_fallback: true });
        if (currentFallback && currentFallback.variant.id !== variantId) {
          await questionnaireApi.updateConditionVariant(currentFallback.variant.id, { is_fallback: false });
        }
      } else {
        await questionnaireApi.updateConditionVariant(variantId, { is_fallback: false });
      }
      useStore.setState((s: any) => {
        const updatedSetFormulations = s.data.setFormulations.map((group: any) => {
          if (group.identifier === identifier) {
            return {
              ...group,
              variants: group.variants.map((v: any) => {
                if (v.variant.id === variantId) {
                  return { ...v, variant: { ...v.variant, is_fallback: makeFallback } };
                }
                if (makeFallback && currentFallback && v.variant.id === currentFallback.variant.id) {
                  return { ...v, variant: { ...v.variant, is_fallback: false } };
                }
                return v;
              }),
            };
          }
          return group;
        });
        return { data: { ...s.data, setFormulations: updatedSetFormulations } };
      });
    } catch (error) {
      console.error('Ошибка при обновлении fallback статуса:', error);
    }
  };

  const handleSaveNewVariant = async () => {
    if (!newFormulationId) return;
    let conditionIdToSave: number | null = null;
    if (newConditionId === 'new') {
      const setId = useStore.getState().documentPackage.setId;
      if (setId) {
        const newCond = await addCondition(setId, { name: 'Новое условие', is_enabled_default: false });
        conditionIdToSave = newCond.id;
      }
    } else if (newConditionId !== '') {
      conditionIdToSave = Number(newConditionId);
    }
    await addFormulationVariant(identifier, conditionIdToSave, Number(newFormulationId));
    setIsAdding(false);
    setNewConditionId('new');
    setNewFormulationId('');
  };

  return (
    <div id="formulation-settings" className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              {`{{${currentGroup.identifier}}}`}
            </label>
            <span className="text-[10px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full border border-primary-200">
              {t('variantsCount', { count: currentGroup.variants.length })}
            </span>
          </div>
          
          <div className="space-y-2">
            <div className="priority-badge pl-1">
              <i className="fa-solid fa-arrow-down-1-9 text-[9px]"></i>
              <span>{t('checkOrder')}</span>
            </div>
            
            {sortedVariants.map((item: any, index: number) => {
              const isFallback = item.variant.is_fallback;
              const currentConditionId = item.variant.condition_id;
              return (
                <Fragment key={item.variant.id}>
                  {index > 0 && (
                    <div className="flex items-center gap-2 px-1">
                      <div className="w-4 border-t border-dashed border-slate-300"></div>
                      <span className="text-[10px] text-slate-400 font-medium">{t('elseIf')}</span>
                      <div className="flex-1 border-t border-dashed border-slate-300"></div>
                    </div>
                  )}
                  <div className={`clause-variant-card ${isFallback ? 'always' : 'conditional'} p-3 space-y-2`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isFallback ? 'bg-blue-400' : 'bg-emerald-400'}`}></div>
                      <div className="flex-1">
                        {isFallback ? (
                          <>
                            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">{t('always')}</span>
                            <span className="text-[10px] text-blue-400 ml-1">{t('alwaysFallback')}</span>
                          </>
                        ) : (
                          <label className="block text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">
                            {t('condition')}
                          </label>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-0.5 shrink-0 self-start">
                        <button 
                          onClick={() => handleToggleFallback(item.variant.id, !isFallback)}
                          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] transition-colors ${isFallback ? 'bg-blue-100 text-blue-500' : 'hover:bg-blue-100 text-slate-300 hover:text-blue-500'}`} 
                          title={isFallback ? t('makeConditional') : t('makeAlways')}
                        >
                          <i className="fa-solid fa-infinity"></i>
                        </button>
                        {!isFallback && (
                          <button 
                            onClick={() => deleteFormulationVariant(identifier, item.variant.id)}
                            className="w-5 h-5 rounded flex items-center justify-center hover:bg-red-100 text-slate-300 hover:text-red-400 text-[10px]" 
                            title={t('delete')}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {!isFallback && (
                      <div className="flex items-center gap-1.5">
                        <select 
                          className="flex-1 px-2 py-1 border border-emerald-200 bg-white rounded-md text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          value={currentConditionId || ''}
                          onChange={(e) => handleConditionChange(item.variant.id, e.target.value)}
                        >
                          <option value="" disabled>{t('selectCondition')}</option>
                          {conditions.map((cond: any) => (
                            <option key={cond.id} value={cond.id}>{cond.name}</option>
                          ))}
                        </select>
                        {currentConditionId && (
                          <button 
                            onClick={() => openSettings('condition', currentConditionId)}
                            className="w-6 h-6 rounded flex items-center justify-center hover:bg-emerald-100 text-slate-400 hover:text-emerald-600 text-[10px] transition-colors shrink-0"
                            title={t('editCondition')}
                          >
                            <i className="fa-solid fa-pen-to-square"></i>
                          </button>
                        )}
                      </div>
                    )}
                    
                    <FormulationPicker 
                      value={item.formulation.id} 
                      onChange={(id) => handleFormulationChange(item.variant.id, id)} 
                      allFormulations={allFormulations} 
                      types={types} 
                    />
                  </div>
                </Fragment>
              );
            })}
            
            {isAdding ? (
              <div className="p-3 border-2 border-emerald-300 bg-emerald-50 rounded-lg space-y-2 animate-in fade-in">
                <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">
                  {t('newConditionalVariant')}
                </div>
                <select 
                  className="w-full px-2 py-1 border border-emerald-200 bg-white rounded-md text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  value={newConditionId}
                  onChange={(e) => setNewConditionId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                >
                  <option value="new">{t('newCondition')}</option>
                  {conditions.map((cond: any) => (
                    <option key={cond.id} value={cond.id}>{cond.name}</option>
                  ))}
                </select>
                <FormulationPicker 
                  value={newFormulationId} 
                  onChange={(id) => setNewFormulationId(id)} 
                  allFormulations={allFormulations} 
                  types={types} 
                />
                <div className="flex gap-2 pt-1">
                  <button 
                    onClick={handleSaveNewVariant}
                    disabled={!newFormulationId}
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[11px] font-semibold rounded-md transition-colors"
                  >
                    {t('add')}
                  </button>
                  <button 
                    onClick={() => {
                      setIsAdding(false);
                      setNewConditionId('new');
                      setNewFormulationId('');
                    }}
                    className="px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-md transition-colors"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setIsAdding(true)}
                className="w-full py-2 border-2 border-dashed border-slate-200 hover:border-emerald-300 text-slate-400 hover:text-emerald-600 text-[11px] font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5"
              >
                <i className="fa-solid fa-plus text-[10px]"></i> 
                {t('addConditionalVariant')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};