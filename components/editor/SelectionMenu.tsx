// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/react';
import { useStore } from '@/store/useStore';
import { useNavbarStore } from '@/store/useNavbarStore';
import { formulationsApi, questionnaireApi } from '@/lib/realApi';
import { DataType, ValueSource } from '@/lib/types';

interface Props {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLElement | null>;
}

export default function SelectionMenu({ editor, containerRef }: Props) {
  const t = useTranslations('SelectionMenu');
  
  const { data, editor: editorBridge, documentPackage } = useStore();
  const currentUser = useNavbarStore((state) => state.user);
  
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [openPicker, setOpenPicker] = useState<null | 'property' | 'formulation' | 'formulation_type'>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const [isTextSelected, setIsTextSelected] = useState(false);
  
  const [isNewFormulationModalOpen, setIsNewFormulationModalOpen] = useState(false);
  const [newFormulationName, setNewFormulationName] = useState('');
  const [newFormulationText, setNewFormulationText] = useState('');
  const [types, setTypes] = useState<any[]>([]);
  const [newFormulationTypeId, setNewFormulationTypeId] = useState<number | null>(null);
  const [selectedFormulationTypeId, setSelectedFormulationTypeId] = useState<number | null>(null);
  
  const [isNewPropertyModalOpen, setIsNewPropertyModalOpen] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState('');
  
  const [selectedText, setSelectedText] = useState('');
  const [fromPos, setFromPos] = useState<number | null>(null);
  const [toPos, setToPos] = useState<number | null>(null);
  
  const ignoreBlurRef = useRef(false);
  const ignoreSelectionUpdateRef = useRef(false);
  const MAX_ITEMS = 50;
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { setIsMounted(true); }, []);
  
  useEffect(() => {
    formulationsApi.getTypes().then(setTypes);
  }, []);

  useEffect(() => {
    if (!editor) return;
    
    const showMenu = () => {
      const { selection } = editor.state;
      const { view } = editor;
      setIsTextSelected(!selection.empty);
      setFromPos(selection.from);
      setToPos(selection.to);
      
      if (selection.empty) {
        const coords = view.coordsAtPos(selection.from);
        setPos({ top: coords.top + 20, left: coords.right + 8 });
      } else {
        const domSelection = window.getSelection();
        if (domSelection && domSelection.rangeCount > 0) {
          const rect = domSelection.getRangeAt(0).getBoundingClientRect();
          setPos({ top: rect.bottom + 8, left: Math.max(0, rect.right - 180) });
        }
      }
      setVisible(true);
      setOpenPicker(null);
      setSelectedFormulationTypeId(null);
    };

    const hideMenu = () => { 
      setVisible(false); 
      setOpenPicker(null); 
      setSearchQuery(''); 
      setSelectedFormulationTypeId(null); 
    };

    const dom = editor.view.dom;
    
    const onClick = () => { setTimeout(() => { showMenu(); }, 0); };
    
    const onKeyDown = (e: KeyboardEvent) => {
      const isNavigationOrTyping = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) || e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key);
      if (isNavigationOrTyping) { hideMenu(); ignoreSelectionUpdateRef.current = true; }
    };
    
    const onSelectionUpdate = () => {
      if (ignoreSelectionUpdateRef.current) { ignoreSelectionUpdateRef.current = false; return; }
      if (!editor.isFocused) { hideMenu(); return; }
      showMenu();
    };
    
    const onBlur = () => { if (ignoreBlurRef.current) { ignoreBlurRef.current = false; return; } hideMenu(); };
    const onTransaction = ({ transaction }: any) => { if (transaction.docChanged) { hideMenu(); ignoreSelectionUpdateRef.current = true; } };

    dom.addEventListener('click', onClick);
    dom.addEventListener('keydown', onKeyDown);
    editor.on('selectionUpdate', onSelectionUpdate);
    editor.on('blur', onBlur);
    editor.on('transaction', onTransaction);

    return () => {
      dom.removeEventListener('click', onClick);
      dom.removeEventListener('keydown', onKeyDown);
      editor.off('selectionUpdate', onSelectionUpdate);
      editor.off('blur', onBlur);
      editor.off('transaction', onTransaction);
    };
  }, [editor, containerRef]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setOpenPicker(null);
        setSearchQuery('');
        setSelectedFormulationTypeId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // ==========================================
  // 🛠 ОБРАБОТКА ВЫБОРА ИЗ МЕНЮ
  // ==========================================
  const handlePick = async (type: 'property' | 'formulation', item: any) => {
    if (!editor) return;
    const from = fromPos ?? editor.state.selection.from;
    const to = toPos ?? editor.state.selection.to;
    
    if (type === 'property') {
      editor.chain().focus().insertContentAt({ from, to }, {
        type: 'token',
        attrs: {
          uuid: `tok_${Math.random().toString(36).substr(2, 9)}`,
          sourceId: item.id,
          identifier: item.identifier,
          type: 'property',
          label: item.name ?? item.identifier,
          value: item.default_value ?? '',
          displayMode: 'compact'
        }
      }).run();
      useStore.getState().data.recalculateFormulas();
    } else {
      const identifier = `formulation_${item.id}`;
      editor.chain().focus().insertContentAt({ from, to }, {
        type: 'formulationSlot',
        attrs: { identifier }
      }).run();
      
      const existingGroup = data.setFormulations.find((g: any) => g.identifier === identifier);
      if (!existingGroup) {
        const setId = documentPackage.setId;
        if (!setId) return;
        const versionId = item.current_version_id;
        if (!versionId) {
          console.error(`[SelectionMenu] Не удалось получить current_version_id для формулировки ID: ${item.id}`);
          return; 
        }
        try {
          const variantPayload = { 
            formulation_id: item.id, 
            formulation_version_id: versionId, 
            identifier: identifier, 
            is_fallback: true, 
            document_set_id: setId 
          };
          const newVariant = await questionnaireApi.addUnassignedVariant(variantPayload);
          useStore.setState((s: any) => {
            const existingGroupIndex = s.data.setFormulations.findIndex((g: any) => g.identifier === identifier);
            const newVariantObj = { 
              variant: newVariant, 
              formulation: { 
                ...item, 
                text_content: item.text_content, 
                author_name: item.author_name || t('unknown'), 
                author_avatar: item.author_avatar || '' 
              }, 
              condition: null 
            };
            if (existingGroupIndex !== -1) {
              const updatedGroups = [...s.data.setFormulations];
              updatedGroups[existingGroupIndex] = { 
                ...updatedGroups[existingGroupIndex], 
                variants: [...updatedGroups[existingGroupIndex].variants, newVariantObj] 
              };
              return { data: { ...s.data, setFormulations: updatedGroups } };
            } else {
              return { data: { ...s.data, setFormulations: [...s.data.setFormulations, { identifier: identifier, variants: [newVariantObj] }] } };
            }
          });
        } catch (error) { 
          console.error('Ошибка при интеграции формулировки:', error); 
        }
      }
      useStore.getState().data.syncFormulationSlots();
    }
    setOpenPicker(null);
    setVisible(false);
    setSearchQuery('');
    setSelectedFormulationTypeId(null);
  };

  // ==========================================
  // 🛠 СОЗДАНИЕ НОВОЙ ФОРМУЛИРОВКИ
  // ==========================================
  const handleCreateFormulation = async () => {
    if (!newFormulationName.trim() || !newFormulationText.trim() || !newFormulationTypeId) return;
    
    const authorName = currentUser 
      ? `${currentUser.first_name} ${currentUser.last_name}` 
      : t('unknown');
    const authorAvatar = currentUser?.avatar_url || '/default-avatar.svg';
    
    try {
      const newForm = await formulationsApi.create({ name: newFormulationName.trim(), type_id: newFormulationTypeId } as any);
      const newVer = await formulationsApi.createVersion(newForm.id, { text_content: newFormulationText } as any);
      
      // Исправлено затенение переменной t -> type
      const typeName = types.find(type => type.id === newFormulationTypeId)?.name || t('noType');
      
      const formWithAuthor = {
        ...newForm,
        type_name: typeName,
        text_content: newFormulationText,
        author_name: authorName,
        author_avatar: authorAvatar
      };
      
      useStore.setState((s: any) => ({ data: { ...s.data, myFormulations: [...s.data.myFormulations, formWithAuthor] } }));
      
      if (editor) {
        const from = fromPos ?? editor.state.selection.from;
        const to = toPos ?? editor.state.selection.to;
        editor.chain().focus().insertContentAt({ from, to }, {
          type: 'formulationSlot',
          attrs: { identifier: `formulation_${newForm.id}` }
        }).run();
      }
      
      const setId = documentPackage.setId;
      if (setId) {
        const variantPayload = { 
          formulation_id: newForm.id, 
          formulation_version_id: newVer.id, 
          identifier: `formulation_${newForm.id}`, 
          is_fallback: true, 
          document_set_id: setId 
        };
        const newVariant = await questionnaireApi.addUnassignedVariant(variantPayload);
        useStore.setState((s: any) => ({
          data: {
            ...s.data,
            setFormulations: [...s.data.setFormulations, {
              identifier: newVariant.identifier,
              variants: [{
                variant: newVariant,
                formulation: formWithAuthor,
                condition: null
              }]
            }]
          }
        }));
        useStore.getState().data.syncFormulationSlots();
      }
      
      setIsNewFormulationModalOpen(false);
      setNewFormulationName('');
      setNewFormulationText('');
      setNewFormulationTypeId(null);
      setSelectedText('');
      setFromPos(null); 
      setToPos(null);
    } catch (error) { 
      console.error('Ошибка при создании формулировки:', error); 
    }
  };

  // ==========================================
  // СОЗДАНИЕ НОВОГО СВОЙСТВА
  // ==========================================
  const handleCreateProperty = async () => {
    if (!newPropertyName.trim()) return;
    try {
      const state = useStore.getState();
      const setId = state.documentPackage.setId;
      if (!setId) return;
      
      const identifier = newPropertyName.trim().toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').replace(/\s+/g, '_');
      const payload = {
        name: newPropertyName.trim(), 
        identifier, 
        data_type: DataType.TEXT as any, 
        is_required: false, 
        hide_in_form: false,
        sort_order: (state.data.properties.length || 0) + 1, 
        value_source: ValueSource.USER_INPUT as any,
        default_value: '',
      };
      
      const newProp = await questionnaireApi.addProperty(setId, payload as any);
      useStore.setState((s: any) => ({ data: { ...s.data, properties: [...s.data.properties, newProp] } }));
      
      if (editor) {
        const from = fromPos ?? editor.state.selection.from;
        const to = toPos ?? editor.state.selection.to;
        editor.chain().focus().insertContentAt({ from, to }, {
          type: 'token',
          attrs: {
            uuid: `tok_${Math.random().toString(36).substr(2, 9)}`,
            sourceId: newProp.id,
            identifier: newProp.identifier,
            type: 'property',
            label: newProp.name,
            value: newProp.default_value || '',
            displayMode: 'compact'
          }
        }).run();
        useStore.getState().data.recalculateFormulas();
      }
      
      setIsNewPropertyModalOpen(false);
      setNewPropertyName('');
      setSelectedText('');
      setFromPos(null);
      setToPos(null);
    } catch (error) { 
      console.error('Ошибка при создании свойства:', error); 
    }
  };

  if (!isMounted) return null;
  if (!visible && !isNewFormulationModalOpen && !isNewPropertyModalOpen) return null;

  const rawItems = (openPicker === 'property' ? data.properties : openPicker === 'formulation' ? data.myFormulations : []) || [];
  const filteredItems = rawItems.filter((item: any) => {
    const query = searchQuery.toLowerCase();
    const matchesQuery = item.name?.toLowerCase().includes(query) || item.identifier?.toLowerCase().includes(query);
    if (openPicker === 'formulation' && selectedFormulationTypeId !== null) {
      return matchesQuery && item.type_id === selectedFormulationTypeId;
    }
    return matchesQuery;
  });

  const displayItems = filteredItems.slice(0, MAX_ITEMS);
  const hasMore = filteredItems.length > MAX_ITEMS;

  return createPortal(
    <>
      {visible && (
        <div
          ref={menuRef}
          onMouseDown={(e) => {
            ignoreBlurRef.current = true;
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') { e.preventDefault(); }
          }}
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
          style={{ top: pos.top, left: pos.left, fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}
        >
          {openPicker === null ? (
            <div className="flex flex-col py-1 min-w-[180px]">
              <button onClick={() => { setOpenPicker('property'); setSearchQuery(''); }} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors">
                <i className="fa-solid fa-tag text-blue-500 text-[10px]"></i> {t('selectProperty')}
              </button>
              <button onClick={() => { setOpenPicker('formulation_type'); setSearchQuery(''); }} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors">
                <i className="fa-solid fa-cube text-purple-500 text-[10px]"></i> {t('selectFormulation')}
              </button>
              <div className="border-t border-slate-100 my-1"></div>
              <button onClick={() => {
                if (!editor) return;
                const domSelection = window.getSelection();
                const text = domSelection && domSelection.rangeCount > 0 ? domSelection.toString() : '';
                setSelectedText(text);
                setNewPropertyName(text);
                setFromPos(editor.state.selection.from);
                setToPos(editor.state.selection.to);
                setIsNewPropertyModalOpen(true);
                setVisible(false);
              }} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors">
                <i className="fa-solid fa-tag text-blue-500 text-[10px]"></i> {t('newProperty')}
              </button>
              <button onClick={() => {
                if (!editor) return;
                const domSelection = window.getSelection();
                const text = domSelection && domSelection.rangeCount > 0 ? domSelection.toString() : '';
                setSelectedText(text);
                setNewFormulationText(text);
                setFromPos(editor.state.selection.from);
                setToPos(editor.state.selection.to);
                setIsNewFormulationModalOpen(true);
                setVisible(false);
              }} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors">
                <i className="fa-solid fa-cube text-purple-500 text-[10px]"></i> {t('newFormulation')}
              </button>
            </div>
          ) : openPicker === 'formulation_type' ? (
            <div className="flex flex-col min-w-[240px] w-[280px]">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                {t('selectType')}
              </div>
              <div className="overflow-y-auto max-h-60" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                {types.length === 0 && <div className="px-3 py-4 text-xs text-slate-400 italic text-center">{t('noAvailableTypes')}</div>}
                {types.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setSelectedFormulationTypeId(type.id);
                      setOpenPicker('formulation');
                      setSearchQuery('');
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors w-full"
                  >
                    <span className="truncate">{type.name}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { setOpenPicker(null); setSearchQuery(''); }} className="px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-700 text-left border-t border-slate-100 transition-colors bg-slate-50 hover:bg-slate-100">
                {t('back')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col min-w-[240px] w-[280px]">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50">
                {openPicker === 'property' ? t('properties') : (types.find(type => type.id === selectedFormulationTypeId)?.name || t('formulations'))}
              </div>
              <div className="px-2 py-2 border-b border-slate-100 bg-white">
                <input
                  type="text"
                  placeholder={t('searchByName')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
                  autoFocus
                />
              </div>
              <div className="overflow-y-auto max-h-60" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                {displayItems.length === 0 && <div className="px-3 py-4 text-xs text-slate-400 italic text-center">{t('nothingFound')}</div>}
                {displayItems.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      handlePick(openPicker as 'property' | 'formulation', item);
                      setSelectedFormulationTypeId(null);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 text-left transition-colors w-full"
                  >
                    <span className="truncate">{item.name}</span>
                    {item.identifier && <span className="text-[10px] text-slate-400 ml-auto shrink-0">{item.identifier}</span>}
                  </button>
                ))}
                {hasMore && <div className="px-3 py-2 text-[10px] text-slate-400 italic text-center border-t border-slate-100 bg-slate-50 sticky bottom-0">
                  {t('refineQuery', { shown: MAX_ITEMS, total: filteredItems.length })}
                </div>}
              </div>
              <button
                onClick={() => {
                  if (openPicker === 'formulation') {
                    setOpenPicker('formulation_type');
                    setSelectedFormulationTypeId(null);
                  } else {
                    setOpenPicker(null);
                  }
                  setSearchQuery('');
                }}
                className="px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-700 text-left border-t border-slate-100 transition-colors bg-slate-50 hover:bg-slate-100"
              >
                {t('back')}
              </button>
            </div>
          )}
        </div>
      )}

      {isNewFormulationModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={() => setIsNewFormulationModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-800">{t('newFormulation')}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{t('enterNameTypeAndText')}</p>
              </div>
              <button onClick={() => setIsNewFormulationModalOpen(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('formulationType')} <span className="text-red-500">*</span></label>
                <select 
                  value={newFormulationTypeId || ''} 
                  onChange={(e) => setNewFormulationTypeId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow"
                >
                  <option value="">{t('selectTypePlaceholder')}</option>
                  {types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('formulationName')} <span className="text-red-500">*</span></label>
                <input type="text" placeholder={t('exampleFormulationName')} value={newFormulationName} onChange={(e) => setNewFormulationName(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('formulationText')} <span className="text-red-500">*</span></label>
                <textarea 
                  value={newFormulationText} 
                  onChange={(e) => setNewFormulationText(e.target.value)} 
                  placeholder={t('enterFormulationText')} 
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow min-h-[120px] resize-y" 
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
              <button onClick={() => {
                setIsNewFormulationModalOpen(false);
                setNewFormulationTypeId(null);
              }} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('cancel')}</button>
              <button onClick={handleCreateFormulation} disabled={!newFormulationName.trim() || !newFormulationText.trim() || !newFormulationTypeId} className="px-5 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"><i className="fa-solid fa-check text-[11px]"></i> {t('create')}</button>
            </div>
          </div>
        </div>
      )}

      {isNewPropertyModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] flex items-center justify-center p-4" onClick={() => setIsNewPropertyModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-800">{t('newProperty')}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{t('enterPropertyName')}</p>
              </div>
              <button onClick={() => setIsNewPropertyModalOpen(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('propertyName')} <span className="text-red-500">*</span></label>
                <input type="text" placeholder={t('examplePropertyName')} value={newPropertyName} onChange={(e) => setNewPropertyName(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" autoFocus />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
              <button onClick={() => setIsNewPropertyModalOpen(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">{t('cancel')}</button>
              <button onClick={handleCreateProperty} disabled={!newPropertyName.trim()} className="px-5 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"><i className="fa-solid fa-check text-[11px]"></i> {t('create')}</button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}