// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// store/useStore.ts

import { create } from 'zustand';
import { questionnaireApi, formulationsApi, documentsApi, commentsApi, usersApi, documentSetsApi } from '@/lib/realApi';
import { useNavbarStore } from './useNavbarStore';
import { pluginManager } from '@/lib/pluginManager';
import {
DataType, ValueSource, AnswerItem,
} from '@/lib/types';

const evaluateFormula = (formula: string, context: Record<string, any>) => {
    const payload = { formula, context, result: undefined as any };
    const processed = pluginManager.applyFilters('evaluateFormula', payload);
    return processed.result;
};

let tempIdCounter = -1;
const getTempId = () => tempIdCounter--;

const evaluateRules = (rules: any[], answers: Record<number, any>) => {
  if (!rules || rules.length === 0) return true;
  return rules.every(rule => {
    const answer = answers[rule.property_id];
    const compareValue = rule.compare_value;
    const op = String(rule.operator).toUpperCase();
    switch (op) {
      case '>': return Number(answer) > Number(compareValue);
      case '<': return Number(answer) < Number(compareValue);
      case '>=': return Number(answer) >= Number(compareValue);
      case '<=': return Number(answer) <= Number(compareValue);
      case '=': return String(answer) === String(compareValue);
      case '!=': return String(answer) !== String(compareValue);
      default:
        console.warn(`[evaluateRules] Неизвестный оператор: ${rule.operator}`);
        return true;
    }
  });
};


export const useStore = create<any>((set, get) => {
  let answerSaveTimeout: NodeJS.Timeout | null = null; 
  const syncSlotsWithConditions = () => {
    const state = get();
    const { setFormulations, currentConditions } = state.data;
    const activeIds: string[] = [];
    for (const group of setFormulations) {
      const identifier = group.identifier;
      let activeVariant = null;
      let fallbackVariant = null;
      for (const item of group.variants) {
        const v = item.variant;
        if (v.is_fallback) { fallbackVariant = item; }
        else if (v.condition_id && currentConditions[v.condition_id]) {
          activeVariant = item; break;
        }
      }
      const variantToShow = activeVariant || fallbackVariant;
      if (variantToShow) {
        activeIds.push(identifier);
        const form = variantToShow.formulation;
        if (form) {
          console.log('%c[DEBUG SYNC] 🚀 Активируем слот. Сырой текст из БД:', 'color: teal;', form.text_content);
          const resolvedText = resolveFormulationTemplate(form.text_content || '');
          console.log('%c[DEBUG SYNC] 📝 Передаем в редактор (activateSlot):', 'color: teal; font-weight: bold;', resolvedText);

          state.editor.commands.activateSlot(identifier, {
            sourceId: form.id, type: 'formulation', label: form.name,
            value: resolvedText, displayMode: 'compact'
          });
        }
      } else {
        state.editor.commands.deactivateSlot(identifier);
      }
    }
    set((s: any) => ({ data: { ...s.data, activeFormulationIdentifiers: activeIds } }));
  };

  const removeOrphanedAnchorsFromEditor = () => {
    const handle = get().editor.ref?.current;
    const editorInstance = (handle as any)?._editor; // 🆕 Получаем реальный Tiptap editor
    
    if (!editorInstance || editorInstance.isDestroyed) return;
    
    const state = get();
    // 1. Собираем валидные UUID из стора (комментарии к этому моменту уже загружены)
    const validAnchorUuids = new Set(
      state.comments.items.map((c: any) => c.anchor_uuid).filter(Boolean)
    );

    // 2. Находим сиротские UUID через JSON
    const json = editorInstance.getJSON?.();
    if (!json) return;
    
    const orphanedUuids = new Set<string>();
    const traverse = (node: any) => {
      if (!node) return;
      if (node.marks) {
        node.marks.forEach((m: any) => {
          if (m.type === 'anchor' && m.attrs?.anchorUuid && !validAnchorUuids.has(m.attrs.anchorUuid)) {
            orphanedUuids.add(m.attrs.anchorUuid);
          }
        });
      }
      if (node.content) node.content.forEach(traverse);
    };
    traverse(json);

    if (orphanedUuids.size === 0) {
      console.log('[removeOrphanedAnchors] Сиротских якорей не найдено.');
      return;
    }

    console.log('[removeOrphanedAnchors] Найдено сиротских якорей:', orphanedUuids.size, 'Запуск очистки...');

    // 3. Функция удаления с защитой от null view
    const executeRemoval = () => {
      const freshHandle = get().editor.ref?.current;
      const freshEditor = (freshHandle as any)?._editor; // 🆕 Снова берем реальный editor
      
      if (!freshEditor || freshEditor.isDestroyed) return;
      
      // Теперь проверяем view у РЕАЛЬНОГО экземпляра (оно точно существует, если editor не destroyed)
      if (!freshEditor.view) {
        console.warn('[removeOrphanedAnchors] View ещё не готов, повторная попытка через 50мс...');
        setTimeout(executeRemoval, 50);
        return;
      }

      const { state: editorState, dispatch } = freshEditor.view;
      const tr = editorState.tr;
      let hasChanges = false;

      editorState.doc.descendants((node: any, pos: number) => {
        if (!node.marks) return;
        node.marks.forEach((mark: any) => {
          if (mark.type.name === 'anchor' && orphanedUuids.has(mark.attrs.anchorUuid)) {
            tr.removeMark(pos, pos + node.nodeSize, mark.type);
            hasChanges = true;
          }
        });
      });

      if (hasChanges) {
        dispatch(tr);
        console.log('[DEBUG] ✅ Сиротские якоря успешно удалены из редактора.');
      }
    };

    executeRemoval();
  };

  const extractUsedIdentifiers = () => {
    const editorRef = get().editor.ref?.current;
    if (!editorRef || !editorRef.getJSON) return;
    
    const json = editorRef.getJSON();
    const identifiers = new Set<string>();
    
    // Рекурсивная функция обхода JSON-дерева Tiptap
    const traverse = (node: any) => {
      if (!node) return;
      // Проверяем атрибуты узла (для кастомных Node, например, слотов)
      if (node.attrs?.identifier) identifiers.add(node.attrs.identifier);
      // Проверяем marks (для инлайн-токенов)
      if (node.marks) {
        node.marks.forEach((mark: any) => {
          if (mark.attrs?.identifier) identifiers.add(mark.attrs.identifier);
        });
      }
      // Обходим дочерние элементы
      if (node.content) {
        node.content.forEach(traverse);
      }
    };
    
    traverse(json);
    
    // Сохраняем найденные идентификаторы в стор
    set((s: any) => ({ 
      data: { ...s.data, usedFormulationIds: Array.from(identifiers) } 
    }));
  };  

  const getFormattedValue = (prop: any, rawValue: any, context: Record<string, any>) => {
      if (rawValue === undefined || rawValue === null) return '';

      // 🆕 Хелпер для форматирования чисел с разделителями тысяч
      const formatNumberWithSpaces = (val: any) => {
          if (val === undefined || val === null || val === '') return '';
          let strVal = String(val).replace(/\s/g, '').replace(',', '.');
          const num = Number(strVal);
          if (isNaN(num)) return String(val);
          return num.toLocaleString(process.env.NEXT_FORMAT_LOCALE, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
      };

      const applyMoneyFormat = (val: any) => {
          if (prop.data_type === DataType.MONEY || prop.data_type === DataType.NUMBER) {
              return formatNumberWithSpaces(val);
          }
          return String(val);
      };

      if (!prop.format) {
          return applyMoneyFormat(rawValue);
      }

      const formatStr = prop.format;
      const isFormula = /[A-ZА-ЯЁa-z_]+\s*\(/.test(formatStr) || /[\+\-\*\/\^\&]/.test(formatStr);

      if (!formatStr.includes('{value}')) {
          if (isFormula) {
              try {
                  const res = evaluateFormula(formatStr, context);
                  return applyMoneyFormat(res);
              } catch (e) {
                  console.warn(`[Format] Ошибка вычисления формата как формулы: ${formatStr}`, e);
                  return formatStr;
              }
          }
          return formatStr;
      }

      if (isFormula) {
          try {
              const valReplacement = rawValue == null ? '""' : (typeof rawValue === 'string' ? `"${rawValue}"` : String(rawValue));
              const evalStr = formatStr.replace(/\{value\}/g, valReplacement);
              const res = evaluateFormula(evalStr, context);
              return applyMoneyFormat(res);
          } catch (e) {
              console.warn(`[Format] Ошибка вычисления формулы в формате: ${formatStr}`, e);
              if (prop.data_type === DataType.MONEY || prop.data_type === DataType.NUMBER) {
                  return formatStr.replace(/\{value\}/g, formatNumberWithSpaces(rawValue));
              }
              return formatStr.replace(/\{value\}/g, String(rawValue));
          }
      }

      if (prop.data_type === DataType.MONEY || prop.data_type === DataType.NUMBER) {
          return formatStr.replace(/\{value\}/g, formatNumberWithSpaces(rawValue));
      }

      return formatStr.replace(/\{value\}/g, String(rawValue));
  };

  const recalculateFormulas = () => {
    const state = get();
    const { properties, currentAnswers } = state.data;

    // 🛠️ ОТЛАДКА: Начало группы логов
    console.group('[Formula Engine] 🚀 Запуск пересчета формул');
    console.log('📥 Исходные значения из анкеты (currentAnswers):', { ...currentAnswers });

    // 1. Собираем контекст СЫРЫХ значений для парсера
    const context: Record<string, any> = {};
    properties.forEach((p: any) => {
      if (p.identifier) {
        let val = currentAnswers[p.id];
        if ((p.data_type === DataType.MONEY || p.data_type === DataType.NUMBER) && typeof val === 'string') {
          const num = Number(val);
          if (!isNaN(num)) val = num;
        }
        context[p.identifier] = val !== undefined && val !== null ? val : 0;
      }
    });
    
    console.log('📋 Сформированный контекст для парсера:', { ...context });

    const newAnswers = { ...currentAnswers };
    let hasChanges = false;

    // 2. ИТЕРАТИВНОЕ ВЫЧИСЛЕНИЕ
    const MAX_ITERATIONS = 10;
    let iteration = 0;
    let contextChanged = true;

    while (contextChanged && iteration < MAX_ITERATIONS) {
      console.log(`\n🔄 --- ИТЕРАЦИЯ ${iteration + 1} ---`);
      contextChanged = false;
      iteration++;

      properties.forEach((p: any) => {
        if (p.formula || p.value_source === 'FORMULA') {
          try {
            console.log(`  🧮 Вычисляем [${p.identifier}]: ${p.formula}`);
            const rawValue = evaluateFormula(p.formula, context);
            console.log(`     ➡️ Сырой результат:`, rawValue);
            
            const strNew = String(rawValue);
            const strOld = String(context[p.identifier]);
            
            if (strNew !== strOld) {
              // 🛠️ ОТЛАДКА: Фиксируем факт изменения (каскад сработал)
              console.warn(`  💥 [${p.identifier}] КАСКАД! Значение обновлено: "${strOld}" ➡️ "${strNew}"`);
              context[p.identifier] = rawValue;
              contextChanged = true;
            } else {
              console.log(`     ⏸️ Без изменений (осталось "${strOld}")`);
            }
            
            if (newAnswers[p.id] !== rawValue) {
              newAnswers[p.id] = rawValue;
              hasChanges = true;
            }
          } catch (e) {
            console.error(`  ❌ [${p.identifier}] ОШИБКА вычисления формулы:`, e);
          }
        }
      });
    }

    if (iteration >= MAX_ITERATIONS) {
      console.error('⚠️ [Formula Engine] ДОСТИГНУТ ЛИМИТ ИТЕРАЦИЙ! Проверьте формулы на циклическую зависимость (A зависит от B, B от A).');
    } else {
      console.log(`\n✅ Схождение достигнуто за ${iteration} итераций.`);
    }

    // 3. Форматируем значения для вставки в документ
    console.log('\n🎨 --- ФОРМАТИРОВАНИЕ ДЛЯ РЕДАКТОРА ---');
    properties.forEach((p: any) => {
      const rawValue = context[p.identifier];
      const formattedValue = getFormattedValue(p, rawValue, context);
      
      if (formattedValue !== undefined) {
        // 🛠️ ОТЛАДКА: Показываем, что именно улетает в токен документа
        if (p.formula || p.value_source === 'FORMULA') {
          console.log(`  ✍️ [${p.identifier}] Токен обновлен: "${rawValue}" -> "${formattedValue}"`);
        }
        state.editor.commands.updateTokensBySourceId(p.id, p.name, formattedValue);
      }
    });

    // 4. Обновляем стор
    if (hasChanges) {
      console.log('💾 Сохраняем новые сырые значения в store (currentAnswers).');
      set((s: any) => ({ data: { ...s.data, currentAnswers: newAnswers } }));
    }

    refreshFormulationTokens();

    console.log('🏁 [Formula Engine] Пересчет завершен.');
    console.groupEnd(); // 🛠️ ОТЛАДКА: Закрываем группу логов
  };

  const buildContext = () => {
      const state = get();
      const { properties, currentAnswers } = state.data;
      const context: Record<string, any> = {};
      
      properties.forEach((p: any) => {
          if (p.identifier) {
              let val = currentAnswers[p.id];
              if ((p.data_type === DataType.MONEY || p.data_type === DataType.NUMBER) && typeof val === 'string') {
                  const num = Number(val);
                  if (!isNaN(num)) val = num;
              }
              context[p.identifier] = val !== undefined && val !== null ? val : 0;
          }
      });
      return context;
  };

  // 🆕 ХЕЛПЕР: Резолвинг шаблона формулировки
  const resolveFormulationTemplate = (template: string): string => {
      if (!template) return '';
      console.log('%c[DEBUG FORMULATION] 📥 Исходный шаблон:', 'color: purple; font-weight: bold;', template);
      
      const state = get();
      const { properties } = state.data;
      const context = buildContext();

      // 🆕 ИСПРАВЛЕНИЕ: Регулярка для ДВОЙНЫХ фигурных скобок {{ identifier }} 
      // \s* позволяет игнорировать пробелы внутри скобок (например, {{ penalty_1_day }})
      const regex = /\{\{\s*([a-zA-Z0-9_а-яёА-ЯЁ]+)\s*\}\}/g;

      // 🔍 Логируем все найденные плейсхолдеры
      const matches = [...template.matchAll(regex)];
      console.log('%c[DEBUG FORMULATION] 🔍 Найдены плейсхолдеры в тексте:', 'color: purple;', matches.map(m => m[1]));

      const result = template.replace(regex, (match, identifier) => {
          // 1. Ищем свойство
          const prop = properties.find((p: any) => p.identifier === identifier);
          
          if (!prop) {
              console.warn(`%c[DEBUG FORMULATION] ❌ Свойство с identifier="${identifier}" НЕ НАЙДЕНО в массиве properties!`, 'color: red; font-weight: bold;');
              return match; // Оставляем текст как есть (или можно вернуть '')
          }

          // 2. Получаем сырое значение
          const rawValue = state.data.currentAnswers[prop.id];
          console.log(`%c[DEBUG FORMULATION] 🧩 Обработка {{${identifier}}}:`, 'color: blue;', {
              propId: prop.id,
              rawValue,
              format: prop.format,
              dataType: prop.data_type
          });
          
          if (rawValue === undefined || rawValue === null || rawValue === '') {
              console.log(`%c[DEBUG FORMULATION] ⏩ Значение для {{${identifier}}} пустое. Подставляем пустую строку.`, 'color: orange;');
              return '';
          }

          // 3. Форматируем
          const formatted = getFormattedValue(prop, rawValue, context);
          console.log(`%c[DEBUG FORMULATION] ✅ Итоговая подстановка для {{${identifier}}}:`, 'color: green; font-weight: bold;', formatted);
          return formatted;
      });

      console.log('%c[DEBUG FORMULATION] 📤 ИТОГОВЫЙ ТЕКСТ ПОСЛЕ ЗАМЕН:', 'color: purple; font-weight: bold; background: #f0f0f0; padding: 2px 5px;', result);
      return result;
  };

  const refreshFormulationTokens = () => {
      const state = get();
      const editorRef = state.editor.ref?.current;
      if (!editorRef || editorRef.isDestroyed) return;

      const json = editorRef.getJSON();
      const allForms = state.data.getAllFormulations();

      const traverse = (node: any) => {
          if (!node) return;
          
          // Ищем токены типа 'formulation'
          if (node.type === 'token' && node.attrs?.type === 'formulation' && node.attrs?.sourceId) {
              const formId = node.attrs.sourceId;
              const form = allForms.find((f: any) => f.id === formId);
              
              if (form && form.text_content) {
                  console.log(`%c[DEBUG REFRESH] 🔄 Найден токен формулировки "${form.name}" (ID: ${formId}). Пересчитываем...`, 'color: magenta;');
                  const resolvedValue = resolveFormulationTemplate(form.text_content);
                  console.log(`%c[DEBUG REFRESH] 💉 Вызываем updateTokensBySourceId для ID ${formId} со значением:`, 'color: magenta; font-weight: bold;', resolvedValue);

                  // Обновляем токен в редакторе (обновятся все токены с этим sourceId)
                  editorRef.updateTokensBySourceId(formId, node.attrs.label, resolvedValue);
              }
          }
          
          if (node.content && Array.isArray(node.content)) {
              node.content.forEach(traverse);
          }
      };
      
      traverse(json);
  };

  return {
    ui: {
      mode: 'markup',
      activeTab: 'properties',
      isAddingComment: false,
      isSelectingAnchor: false,
      setMode: (mode: string) => {
        const state = get();

        const accessLevel = state.documentPackage.currentUserAccess;

        // 🆕 ЗАЩИТА: Запрещаем переключаться в режимы, недоступные для текущих прав
        if (accessLevel === 'view' && !['edit', 'history'].includes(mode)) return;
        if (accessLevel === 'comment' && !['comment', 'edit', 'history'].includes(mode)) return;
        if (accessLevel === 'review' && !['review', 'edit', 'history'].includes(mode)) return;

        const prevMode = state.ui.mode;

        const validMarkupTabs = ['properties', 'conditions', 'formulations']; // укажите ваши реальные табы
        let newActiveTab = state.ui.activeTab;

        if (mode === 'markup' && !validMarkupTabs.includes(newActiveTab)) {
          newActiveTab = 'properties'; // Сбрасываем на properties, если таб был "сломан" (например, 'comments')
        }

        const newUi = {
          ...state.ui,
          mode,
          activeTab: newActiveTab, // ✅ Применяем очищенный activeTab
          isAddingComment: false,
          isSelectingAnchor: false,
        };

        const newHistory = { ...state.history };

        if (prevMode === 'history' && mode !== 'history') {
          const activeId = state.documentPackage.activeId;
          if (activeId) {
            state.documentPackage.loadDocumentContent(activeId);
          }
          newHistory.selectedVersionId = null;

          set((s: any) => ({
            reviews: { ...s.reviews, items: [], activeEditUuid: null }
          }));
        } else if (prevMode !== 'history' && mode === 'history') {
          newHistory.selectedVersionId = null;
        }

        set({ ui: newUi, history: newHistory });
      },
      setActiveTab: (tab: string) => set((state: any) => ({ ui: { ...state.ui, activeTab: tab } })),
      setSelectingAnchor: (value: boolean) => set((s: any) => ({ ui: { ...s.ui, isSelectingAnchor: value } })),

      highlightTarget: null as { type: 'property' | 'formulation'; id: string | number } | null,
      setHighlightTarget: (target: any) => set((s: any) => ({ ui: { ...s.ui, highlightTarget: target } })),

    },

    users: {
      items: [] as any[],
      map: {} as Record<number, any>,
      isLoading: false,

      fetchUsers: async () => {
        set((s: any) => ({ users: { ...s.users, isLoading: true } }));
        try {
          const items = await usersApi.listRelated();
          const map: Record<number, any> = {};
          items.forEach((u: any) => { map[u.id] = u; });
          set((s: any) => ({ users: { ...s.users, items, map, isLoading: false } }));
        } catch (e) {
          console.error('Failed to fetch users', e);
          set((s: any) => ({ users: { ...s.users, isLoading: false } }));
        }
      },
    },


    reviews: {
      items: [] as any[],
      activeEditUuid: null as string | null,
      isLoading: false,

      // 🆕 Метод для добавления/обновления правки в реальном времени
      upsertLocalEdit: (editUuid: string, batchId: string, oldText: string, newText: string, direction: 'prepend' | 'append' = 'append') => {
        const currentUserId = useNavbarStore.getState().user?.id || 1;
        set((s: any) => {
          // 🆕 Ищем существующую правку по batchId (а не по editUuid)
          const existingIndex = s.reviews.items.findIndex((i: any) => i.batch_id === batchId);
          
          let editType = 'REPLACEMENT';
          if (newText && !oldText) editType = 'ADD';
          else if (oldText && !newText) editType = 'DELETE';

          if (existingIndex !== -1) {
            // 🆕 ДОПИСЫВАЕМ текст в существующую группу
            const updatedItems = [...s.reviews.items];
            const existing = updatedItems[existingIndex];
            
            let finalOldText = existing.old_text || '';
            let finalNewText = existing.new_text || '';
            
            if (oldText) {
              if (direction === 'prepend') {
                finalOldText = oldText + finalOldText;  // Дописываем В НАЧАЛО
              } else {
                finalOldText += oldText;                // Дописываем В КОНЕЦ
              }
            }
            if (newText) finalNewText += newText;
            
            let finalType = 'REPLACEMENT';
            if (finalNewText && !finalOldText) finalType = 'ADD';
            else if (finalOldText && !finalNewText) finalType = 'DELETE';

            updatedItems[existingIndex] = { 
              ...existing, 
              old_text: finalOldText, 
              new_text: finalNewText, 
              edit_type: finalType,
              // Сохраняем все атомарные UUID, чтобы можно было точечно принять/отклонить в редакторе
              edit_uuids: [...(existing.edit_uuids || [existing.edit_uuid]), editUuid]
            };
            return { reviews: { ...s.reviews, items: updatedItems } };
          } else {
            // 🆕 Создаем новую группу
            const editData = {
              edit_uuid: editUuid, // Первый UUID как основной идентификатор для UI
              edit_uuids: [editUuid], // Массив всех атомарных UUID в этой группе
              batch_id: batchId,
              edit_type: editType,
              old_text: oldText,
              new_text: newText,
              author_id: currentUserId,
              resolution_status: 'PENDING',
              created_at: new Date().toISOString()
            };
            return { reviews: { ...s.reviews, items: [...s.reviews.items, editData] } };
          }
        });
      },

      // 🆕 Метод для синхронизации правок из документа в стор (при загрузке/переключении)
      syncFromEditor: (editorInstance: any) => {
        if (!editorInstance || editorInstance.isDestroyed) return;
        const state = editorInstance.state;
        if (!state || !state.doc) return; 
        const docSize = state.doc.content.size;
        if (docSize <= 2) {
          set((s: any) => ({ reviews: { ...s.reviews, items: [] } }));
          return;
        }

        // 🆕 Группируем по batchId
        const editsMap = new Map<string, { oldText: string, newText: string, authorId: number | null, editUuids: string[] }>();
        
        state.doc.descendants((node: any, pos: number) => {
          node.marks.forEach((mark: any) => {
            if (mark.type.name === 'trackAdd' || mark.type.name === 'trackDelete') {
              const uuid = mark.attrs.editUuid;
              const batchId = mark.attrs.batchId || uuid; // Фоллбэк для старых документов
              const authorId = mark.attrs.authorId; 
              
              if (!editsMap.has(batchId)) {
                editsMap.set(batchId, { oldText: '', newText: '', authorId: null, editUuids: [] });
              }
              const edit = editsMap.get(batchId)!;
              
              if (uuid && !edit.editUuids.includes(uuid)) edit.editUuids.push(uuid);
              if (authorId && !edit.authorId) edit.authorId = authorId; 
              
              const nodeText = node.text || '';
              if (mark.type.name === 'trackAdd') edit.newText += nodeText;
              else edit.oldText += nodeText;
            }
          });
        });

        const fallbackUserId = useNavbarStore.getState().user?.id || null;
        const newItems = Array.from(editsMap.entries()).map(([batchId, data]) => {
          let editType = 'REPLACEMENT';
          if (data.newText && !data.oldText) editType = 'ADD';
          else if (data.oldText && !data.newText) editType = 'DELETE';
          
          return {
            edit_uuid: data.editUuids[0] || `batch_${batchId}`,
            edit_uuids: data.editUuids,
            batch_id: batchId,
            edit_type: editType,
            old_text: data.oldText,
            new_text: data.newText,
            author_id: data.authorId || fallbackUserId, 
            resolution_status: 'PENDING',
            created_at: new Date().toISOString()
          };
        });
        set((s: any) => ({ reviews: { ...s.reviews, items: newItems } }));
      },

      fetchReviews: async (versionId: number) => {
        // В реальном приложении тут будет API. 
        // Пока что просто помечаем как загруженные, т.к. синхронизация идет из редактора
        set((s: any) => ({ reviews: { ...s.reviews, isLoading: false } }));
      },

      setActiveEdit: (uuid: string | null) => {
        set((s: any) => ({ reviews: { ...s.reviews, activeEditUuid: uuid } }));
        const editorRef = get().editor.ref?.current;
        if (uuid && editorRef) editorRef.scrollToEdit(uuid);
      },

      acceptEdit: async (batchId: string) => {
        const state = get();
        if (state.documentPackage.currentUserAccess !== 'owner' && state.documentPackage.currentUserAccess !== 'full') return;

        const editorRef = get().editor.ref?.current;
        if (editorRef) editorRef.acceptEdit(batchId);
        
        set((s: any) => ({
          reviews: { 
            ...s.reviews, 
            items: s.reviews.items.filter((i: any) => i.batch_id !== batchId) 
          }
        }));
      },

      rejectEdit: async (batchId: string) => {
        const state = get();
        if (state.documentPackage.currentUserAccess !== 'owner' && state.documentPackage.currentUserAccess !== 'full') return;

        const editorRef = get().editor.ref?.current;
        if (editorRef) editorRef.rejectEdit(batchId);
        
        set((s: any) => ({
          reviews: { 
            ...s.reviews, 
            items: s.reviews.items.filter((i: any) => i.batch_id !== batchId) 
          }
        }));
      },
    },

    history: {
      selectedVersionId: null as number | null,
      selectVersion: (version: any) => {
        // ✅ Проверяем, является ли выбранная версия текущей
        if (version.is_current) {
          // Сбрасываем selectedVersionId в null.
          // DocumentEditor отследит это изменение и загрузит актуальную версию без diff.
          set((state: any) => ({
            history: { ...state.history, selectedVersionId: null }
          }));
        } else {
          // Если это старая версия, просто запоминаем её ID
          set((state: any) => ({
            history: { ...state.history, selectedVersionId: version.id }
          }));
          get().comments.fetchComments(version.id);
        }
      },
      makeCurrent: async (versionId: number) => {
        const state = get();
        const activeId = state.documentPackage.activeId;
        if (!activeId) return;
        // API создает новую версию на основе выбранной, а старую текущую делает не текущей
        await documentsApi.makeVersionCurrent(activeId, versionId);
        // Загружаем новую текущую версию в редактор
        await state.documentPackage.loadDocumentContent(activeId);
        // Сбрасываем выбор, так как мы теперь смотрим на актуальную версию
        set((s: any) => ({ history: { ...s.history, selectedVersionId: null } }));
      },
    },

    editor: {
      ref: null,
      isReadOnly: false,
      setRef: (ref: any) => set((state: any) => ({ editor: { ...state.editor, ref } })),
      setReadOnly: (readOnly: boolean) => {
        set((state: any) => ({ editor: { ...state.editor, isReadOnly: readOnly } }));
        const editorRef = get().editor.ref?.current;
        if (editorRef?.setEditable) {
          editorRef.setEditable(!readOnly);
        }
      },
      commands: {
        removeAnchorByUuid: (uuid: string) => get().editor.ref?.current?.removeAnchorByUuid?.(uuid), // <-- ДОБАВИТЬ ЭТО
        insertToken: (type: string, sourceId: number | string, label: string, value: string, identifier?: string) => get().editor.ref?.current?.insertToken(type, sourceId, label, value, identifier),
        updateTokensBySourceId: (sourceId: number | string, newLabel: string, newValue?: string) => get().editor.ref?.current?.updateTokensBySourceId(sourceId, newLabel, newValue),
        removeTokensBySourceId: (sourceId: number | string) => get().editor.ref?.current?.removeTokensBySourceId(sourceId),
        toggleReviewMode: () => get().editor.ref?.current?.toggleReviewMode() || false,
        markAnchor: (type?: string) => get().editor.ref?.current?.markSelectionAsAnchor(type),
        setContent: (html: string) => get().editor.ref?.current?.setContent(html),
        setContentJson: (json: any) => get().editor.ref?.current?.setContentJson(json),
        clearAutoSave: () => get().editor.ref?.current?.clearAutoSave(),
        activateSlot: (identifier: string, tokenAttrs: any) => get().editor.ref?.current?.activateSlot(identifier, tokenAttrs),
        deactivateSlot: (identifier: string) => get().editor.ref?.current?.deactivateSlot(identifier),
        insertSlot: (identifier: string) => get().editor.ref?.current?.insertSlot(identifier),
      },
    },
    data: {
      properties: [],
      myFormulations: [] as any[],
      setFormulations: [] as any[],
      conditions: [],
      sections: [] as any[],
      collapsedSections: {} as Record<number, boolean>,
      currentAnswers: {} as Record<number, any>,
      currentTableAnswers: {} as Record<number, Record<number, any>>, 
      currentConditions: {} as Record<number, boolean>,
      activeFormulationIdentifiers: [] as string[],
      conditionLogicsMap: {} as Record<number, { groups: any[], rules: any[] }>,
      isLoading: false,
      activeSettings: null as { type: 'property' | 'condition' | 'formulation' | 'formulation_group'; item: any } | null,
      conditionLogic: null as { groups: any[]; rules: any[] } | null,
      usedFormulationIds: [] as (string | number)[],
      syncFormulationSlots: syncSlotsWithConditions,
      deletedRuleIds: [] as number[],
      deletedGroupIds: [] as number[],
      recalculateFormulas: () => {
        recalculateFormulas();
      },
      setUsedFormulationIds: (ids: (string | number)[]) => set((state: any) => ({ data: { ...state.data, usedFormulationIds: ids } })),
      addSection: async (name: string, isTable: boolean = false) => {
          const state = get();
          const setId = state.documentPackage.setId;
          if (!setId) return;
          try {
              const newSec = await questionnaireApi.addSection(setId, { 
                  name, 
                  sort_order: (state.data.sections.length || 0) + 1,
                  is_table: isTable // 🆕 Передаем признак таблицы
              });
              set((s: any) => ({ data: { ...s.data, sections: [...s.data.sections, newSec] } }));
          } catch (e) { console.error('Failed to add section', e); }
      },
      updateSection: async (id: number, data: { name?: string; is_table?: boolean }) => {
        try {
          // Передаем объект data напрямую в API (бэкенд должен поддерживать частичное обновление)
          const updated = await questionnaireApi.updateSection(id, data as any);
          set((s: any) => ({ 
            data: { 
              ...s.data, 
              sections: s.data.sections.map((sec: any) => sec.id === id ? updated : sec) 
            } 
          }));
        } catch (e) { 
          console.error('Failed to update section', e); 
        }
      },
      deleteSection: async (id: number) => {
        try {
          await questionnaireApi.deleteSection(id);
          set((s: any) => ({
            data: {
              ...s.data,
              sections: s.data.sections.filter((sec: any) => sec.id !== id),
              properties: s.data.properties.map((p: any) => p.section_id === id ? { ...p, section_id: null } : p),
              conditions: s.data.conditions.map((c: any) => c.section_id === id ? { ...c, section_id: null } : c),
            }
          }));
        } catch (e) { console.error('Failed to delete section', e); }
      },
      toggleSectionCollapse: (id: number) => set((s: any) => ({ data: { ...s.data, collapsedSections: { ...s.data.collapsedSections, [id]: !s.data.collapsedSections[id] } } })),
      moveItemToSection: async (itemUid: string, targetSectionId: number | null) => {
        const state = get();
        const setId = state.documentPackage.setId;
        
        const isProp = itemUid.startsWith('prop-');
        const itemId = Number(itemUid.replace(/^(prop|cond)-/, ''));
        
        let newProps = [...state.data.properties];
        let newConds = [...state.data.conditions];
        const allItems = [...newProps, ...newConds];
        
        const targetSectionItems = allItems.filter((i: any) => (i.section_id || null) === (targetSectionId || null));
        const maxSortOrder = targetSectionItems.length > 0 ? Math.max(...targetSectionItems.map((i: any) => i.sort_order || 0)) : 0;
        
        let newSortOrder = maxSortOrder + 1;

        // 1. Обновляем локальное состояние (для мгновенного отклика UI)
        if (isProp) {
          newProps = newProps.map((p: any) => p.id === itemId ? { ...p, section_id: targetSectionId, sort_order: newSortOrder } : p);
        } else {
          newConds = newConds.map((c: any) => c.id === itemId ? { ...c, section_id: targetSectionId, sort_order: newSortOrder } : c);
        }
        
        set((s: any) => ({ data: { ...s.data, properties: newProps, conditions: newConds } }));

        // 2. 🆕 СОХРАНЯЕМ ИЗМЕНЕНИЯ НА БЭКЕНД
        if (setId) {
          try {
            if (isProp) {
              await questionnaireApi.updateProperty(setId, itemId, { 
                section_id: targetSectionId, 
                sort_order: newSortOrder 
              });
            } else {
              await questionnaireApi.updateCondition(setId, itemId, { 
                section_id: targetSectionId, 
                sort_order: newSortOrder 
              });
            }
          } catch (e) {
            console.error('Ошибка сохранения переноса в секцию на бэкенд:', e);
          }
        }
      },
      reorderSections: async (activeId: string, overId: string) => {
          const state = get();
          const setId = state.documentPackage.setId;

          // 1. Пересортировываем секции в памяти
          const activeIdx = Number(activeId.replace('section-', ''));
          const overIdx = Number(overId.replace('section-', ''));
          const sections = [...state.data.sections].sort((a: any, b: any) => a.sort_order - b.sort_order);
          
          const oldIndex = sections.findIndex((sec: any) => sec.id === activeIdx);
          const newIndex = sections.findIndex((sec: any) => sec.id === overIdx);
          
          if (oldIndex === -1 || newIndex === -1) return;
          
          const [moved] = sections.splice(oldIndex, 1);
          sections.splice(newIndex, 0, moved);
          
          // Запоминаем старые sort_order, чтобы найти изменившиеся
          const oldSortOrders = new Map(state.data.sections.map((s: any) => [s.id, s.sort_order]));
          
          sections.forEach((sec: any, idx: number) => { sec.sort_order = idx + 1; });

          // 2. Мгновенно обновляем UI
          set((s: any) => ({ data: { ...s.data, sections } }));

          // 3. 🆕 Сохраняем новый порядок на бэкенд (только изменившиеся)
          if (setId) {
              try {
                  const updatePromises = sections
                      .filter((sec: any) => sec.sort_order !== oldSortOrders.get(sec.id))
                      .map((sec: any) => 
                          questionnaireApi.updateSection(sec.id, { 
                              name: sec.name, 
                              sort_order: sec.sort_order 
                          })
                      );
                  await Promise.all(updatePromises);
              } catch (e) {
                  console.error('Ошибка сохранения порядка секций на бэкенд:', e);
              }
          }
      },
      getTableDataBySectionId: (sectionId: number) => {
          const state = get();
          const columns = state.data.properties.filter((p: any) => p.section_id === sectionId);
          
          const rowIndexes = new Set<number>();
          columns.forEach((col: any) => {
              const tableData = state.data.currentTableAnswers[col.id] || {};
              Object.keys(tableData).forEach((rowIdx) => {
                  // 🆕 Добавляем индекс только если значение не null/undefined
                  if (tableData[rowIdx] !== null && tableData[rowIdx] !== undefined) {
                      rowIndexes.add(Number(rowIdx));
                  }
              });
          });
          
          const rows = Array.from(rowIndexes).sort((a, b) => a - b).map((rowIdx) => {
              const cells: Record<number, any> = {};
              columns.forEach((col: any) => {
                  // 🆕 Фоллбэк на пустую строку вместо null
                  cells[col.id] = state.data.currentTableAnswers[col.id]?.[rowIdx] ?? ''; 
              });
              return { rowIndex: rowIdx, cells };
          });
          
          return { columns, rows };
      },
      updateTableAnswer: (propertyId: number, rowIndex: number, value: any, skipAutoSave: boolean = false) => {
          set((s: any) => {
              const currentTable = { ...s.data.currentTableAnswers };
              
              // Если значения для этой колонки ещё нет, и мы пытаемся удалить — ничего не делаем
              if (!currentTable[propertyId] && (value === null || value === undefined)) {
                  return { data: s.data }; 
              }
              
              if (!currentTable[propertyId]) currentTable[propertyId] = {};
              else currentTable[propertyId] = { ...currentTable[propertyId] }; // Клонируем для иммутабельности

              // 🆕 ГЛАВНОЕ ИЗМЕНЕНИЕ: Если value === null, физически удаляем ключ
              if (value === null || value === undefined) {
                  delete currentTable[propertyId][rowIndex];
                  // Если объект колонки стал полностью пустым, удаляем и его для чистоты
                  if (Object.keys(currentTable[propertyId]).length === 0) {
                      delete currentTable[propertyId];
                  }
              } else {
                  currentTable[propertyId][rowIndex] = value;
              }

              return { data: { ...s.data, currentTableAnswers: currentTable } };
          });

          if (!skipAutoSave) {
              if (answerSaveTimeout) clearTimeout(answerSaveTimeout);
              answerSaveTimeout = setTimeout(async () => {
                  try { await get().data.saveAnswersToApi(); } 
                  catch (e) { console.error('[DEBUG AUTOSAVE] Ошибка сохранения анкеты (таблица)', e); }
              }, 2000);
          }
      },
      updateAnswer: async (propertyId: number, value: any) => {
        const state = get();
        // Сохраняем СЫРОЕ значение от пользователя
        const newAnswers = { ...state.data.currentAnswers, [propertyId]: value };

        const newConditions = { ...state.data.currentConditions };
        let conditionsChanged = false;
        for (const cond of state.data.conditions) {
          const logic = state.data.conditionLogicsMap[cond.id];
          if (!logic) continue;
          // evaluateRules теперь будет работать корректно, так как в newAnswers лежат сырые числа
          const isMet = evaluateRules(logic.rules, newAnswers);
          const wasMet = !!state.data.currentConditions[cond.id];
          if (isMet !== wasMet) { newConditions[cond.id] = isMet; conditionsChanged = true; }
        }

        set({ data: { ...state.data, currentAnswers: newAnswers, currentConditions: newConditions } });

        if (conditionsChanged) { syncSlotsWithConditions(); }

        // 🆕 ПЕРЕРАСЧЕТ ФОРМУЛ И ОБНОВЛЕНИЕ ТОКЕНОВ (с учетом format)
        recalculateFormulas();

        // 🆕 ЗАПУСК АВТОСОХРАНЕНИЯ АНКЕТЫ (Debounce)
        if (answerSaveTimeout) clearTimeout(answerSaveTimeout);
        answerSaveTimeout = setTimeout(async () => {
          try {
            await get().data.saveAnswersToApi();
            console.log('[DEBUG AUTOSAVE] ✅ Анкета сохранена на сервер');
          } catch (e) {
            console.error('[DEBUG AUTOSAVE] Ошибка сохранения анкеты', e);
          }
        }, 2000); // Сохраняем через 2 секунды после последнего ввода
      },
      saveAnswersToApi: async () => {
          const state = get();
          const setId = state.documentPackage.setId;
          if (!setId) return;

          const payload: AnswerItem[] = [];

          // 1. Собираем обычные ответы (row_index = 0)
          Object.entries(state.data.currentAnswers).forEach(([propId, value]) => {
              if (value !== undefined && value !== null) {
                  payload.push({ property_id: Number(propId), row_index: 0, value });
              }
          });

          // 2. Собираем табличные ответы (row_index > 0)
          Object.entries(state.data.currentTableAnswers).forEach(([propId, rows]) => {
              Object.entries(rows as Record<number, any>).forEach(([rowIdx, value]) => {
                  if (value !== undefined && value !== null) {
                      payload.push({ property_id: Number(propId), row_index: Number(rowIdx), value });
                  }
              });
          });

          await questionnaireApi.saveAnswers(setId, payload);
      },
      getAllFormulations: () => {
        const { myFormulations, setFormulations } = get().data;
        const combined: any[] = [...myFormulations];
        setFormulations.forEach((group: any) => {
          if (group.variants) {
            group.variants.forEach((item: any) => {
              const f = item.formulation;
              if (!combined.some((cf: any) => cf.id === f.id)) combined.push(f);
            });
          } else {
            if (!combined.some((cf: any) => cf.id === group.id)) combined.push(group);
          }
        });
        return combined;
      },
      openSettings: async (type: 'property' | 'condition' | 'formulation' | 'formulation_group', id?: number | string) => {
        let item = null;
        if (id) {
          const state = get();
          if (type === 'property') item = state.data.properties.find((p: any) => p.id === id);
          if (type === 'condition') item = state.data.conditions.find((c: any) => c.id === id);
          if (type === 'formulation') {
            item = state.data.myFormulations.find((f: any) => f.id === id)
              || state.data.setFormulations.flatMap((g: any) => g.variants || []).find((v: any) => v.formulation.id === id)?.formulation;
          }
        }
        if (type === 'formulation_group') {
          set((state: any) => ({ data: { ...state.data, activeSettings: { type, item: id }, conditionLogic: null, deletedRuleIds: [], deletedGroupIds: [] } }));
          return;
        }
        if (type === 'condition') {
          const conditionId = id as number;
          if (conditionId) {
            set((state: any) => ({ data: { ...state.data, activeSettings: { type, item }, conditionLogic: null, deletedRuleIds: [], deletedGroupIds: [] } }));
            try {
              let logic = await questionnaireApi.getConditionLogic(conditionId);
              if (logic.groups.length === 0) {
                const rootGroup = await questionnaireApi.addConditionRuleGroup(conditionId, { parent_group_id: null, logical_operator: 'AND' as any });
                logic.groups.push(rootGroup);
              }
              set((state: any) => ({ data: { ...state.data, conditionLogic: logic } }));
            } catch (e) {
              console.error('Failed to load condition logic', e);
              set((state: any) => ({ data: { ...state.data, conditionLogic: { groups: [], rules: [] } } }));
            }
          } else {
            const draftLogic = { groups: [{ id: getTempId(), condition_id: null, parent_group_id: null, logical_operator: 'AND', sort_order: 1 }], rules: [] };
            set((state: any) => ({ data: { ...state.data, activeSettings: { type, item }, conditionLogic: draftLogic, deletedRuleIds: [], deletedGroupIds: [] } }));
          }
        } else {
          set((state: any) => ({ data: { ...state.data, activeSettings: { type, item }, conditionLogic: null, deletedRuleIds: [], deletedGroupIds: [] } }));
        }
      },
      closeSettings: () => set((state: any) => ({ data: { ...state.data, activeSettings: null, conditionLogic: null, deletedRuleIds: [], deletedGroupIds: [] } })),
      reorderItems: async (activeUid: string, overUid: string) => {
        const state = get();
        const findItem = (uid: string) => {
          const isProp = uid.startsWith('prop-');
          const id = Number(uid.replace(/^(prop|cond)-/, ''));
          if (isProp) return state.data.properties.find((p: any) => p.id === id);
          return state.data.conditions.find((c: any) => c.id === id);
        };
        const activeItem = findItem(activeUid);
        const overItem = findItem(overUid);
        if (!activeItem || !overItem) return;
        if (activeItem.section_id !== overItem.section_id) return;
        const sectionId = activeItem.section_id;
        const sectionProps = state.data.properties.filter((p: any) => p.section_id === sectionId);
        const sectionConds = state.data.conditions.filter((c: any) => c.section_id === sectionId);
        const combined = [
          ...sectionProps.map((p: any) => ({ ...p, _type: 'property' })),
          ...sectionConds.map((c: any) => ({ ...c, _type: 'condition' })),
        ].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const oldIndex = combined.findIndex((i: any) => `${i._type === 'property' ? 'prop' : 'cond'}-${i.id}` === activeUid);
        const newIndex = combined.findIndex((i: any) => `${i._type === 'property' ? 'prop' : 'cond'}-${i.id}` === overUid);
        if (oldIndex === -1 || newIndex === -1) return;
        const [moved] = combined.splice(oldIndex, 1);
        combined.splice(newIndex, 0, moved);
        combined.forEach((item, idx) => { item.sort_order = idx + 1; });
        const newProps = state.data.properties.map((p: any) => {
          const updated = combined.find((i: any) => i._type === 'property' && i.id === p.id);
          return updated ? { ...p, sort_order: updated.sort_order } : p;
        });
        const newConds = state.data.conditions.map((c: any) => {
          const updated = combined.find((i: any) => i._type === 'condition' && i.id === c.id);
          return updated ? { ...c, sort_order: updated.sort_order } : c;
        });
        set((s: any) => ({ data: { ...s.data, properties: newProps, conditions: newConds } }));
        const setId = state.documentPackage.setId;
        if (setId) {
          for (const item of combined) {
            if (item._type === 'property') await questionnaireApi.updateProperty(setId, item.id, { sort_order: item.sort_order });
            else await questionnaireApi.updateCondition(setId, item.id, { sort_order: item.sort_order });
          }
        }
      },
      fetchInitialData: async (setId: number) => {
        set((state: any) => ({ data: { ...state.data, isLoading: true } }));
        try {
          const currentUserId = 1;
          
          // 1. Добавляем запрос сохраненных ответов в Promise.all
          const [props, myForms, setForms, conds, secs, savedAnswersRaw] = await Promise.all([
            questionnaireApi.getProperties(setId),
            formulationsApi.listByAuthor(currentUserId),
            formulationsApi.listUsedInSet(setId),
            questionnaireApi.getConditions(setId),
            questionnaireApi.getSections(setId),
            questionnaireApi.getAnswers(setId), // 🆕 ЗАПРОС СОХРАНЕННЫХ ОТВЕТОВ
          ]);
          
          const logics = await Promise.all(conds.map((c: any) => questionnaireApi.getConditionLogic(c.id)));
          const logicsMap: Record<number, any> = {};
          conds.forEach((c: any, idx: number) => { logicsMap[c.id] = logics[idx]; });

          const initialAnswers: Record<number, any> = {};
          const initialTableAnswers: Record<number, Record<number, any>> = {}; 
          
          props.forEach((p: any) => {
            if (p.default_value !== undefined && p.default_value !== null && p.default_value !== '') {
              initialAnswers[p.id] = p.default_value;
            }
          });

          savedAnswersRaw.forEach((item: any) => {
              const propId = item.property_id;
              const rowIdx = item.row_index ?? 0;
              const val = item.value;
              
              // 🆕 Игнорируем null/undefined, чтобы не создавать "строки-призраки" при загрузке
              if (val === null || val === undefined) return; 

              if (rowIdx === 0) {
                  initialAnswers[propId] = val;
              } else {
                  if (!initialTableAnswers[propId]) initialTableAnswers[propId] = {};
                  initialTableAnswers[propId][rowIdx] = val;
              }
          });

          const initialConditions: Record<number, boolean> = {};
          conds.forEach((c: any) => {
            const logic = logicsMap[c.id];
            // Условия теперь будут корректно вычисляться на основе реальных ответов, а не только дефолтных
            initialConditions[c.id] = evaluateRules(logic.rules, initialAnswers);
          });

          set((state: any) => ({
            data: {
              ...state.data, properties: props, myFormulations: myForms, setFormulations: setForms,
              conditions: conds, sections: secs, 
              currentAnswers: initialAnswers,
              currentTableAnswers: initialTableAnswers,
              currentConditions: initialConditions, conditionLogicsMap: logicsMap, isLoading: false
            },
          }));
          
          recalculateFormulas();
          setTimeout(() => syncSlotsWithConditions(), 150);
        } catch (error) {
          console.error('Data fetch error', error);
          set((state: any) => ({ data: { ...state.data, isLoading: false } }));
        }
      },
      addProperty: async (name: string) => {
        const state = get();
        const setId = state.documentPackage.setId;
        if (!setId) return;
        const identifier = name.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').replace(/\s+/g, '_');
        const payload = { 
          name, identifier, data_type: DataType.TEXT as any, is_required: false, hide_in_form: false,
          sort_order: (state.data.properties.length || 0) + 1, value_source: ValueSource.USER_INPUT as any,
          default_value: '' as any,
        };
        try {
          const newProp = await questionnaireApi.addProperty(setId, payload as any);
          set((s: any) => ({ data: { ...s.data, properties: [...s.data.properties, newProp] } }));
          return newProp;
        } catch (error) { console.error('Ошибка при создании свойства:', error); return null; }
      },
      addCondition: async (setId: number, data: any) => {
        const newCond = await questionnaireApi.addCondition(setId, data);
        set((s: any) => ({ data: { ...s.data, conditions: [...s.data.conditions, newCond] } }));
        return newCond;
      },
      updateCondition: async (conditionId: number, data: any) => {
        const state = get();
        const item = state.data.activeSettings?.item;
        if (!item) return;
        const updated = await questionnaireApi.updateCondition(item.document_set_id, conditionId, data);
        set((s: any) => ({
          data: {
            ...s.data,
            conditions: s.data.conditions.map((c: any) => (c.id === conditionId ? updated : c)),
            activeSettings: s.data.activeSettings?.item?.id === conditionId ? { ...s.data.activeSettings, item: updated } : s.data.activeSettings,
          }
        }));
      },
      addConditionRule: async (groupId: number, data: any) => {
        const newRule = { id: getTempId(), group_id: groupId, property_id: data.property_id, operator: data.operator, compare_value: data.compare_value, sort_order: 1 };
        set((s: any) => ({ data: { ...s.data, conditionLogic: { ...s.data.conditionLogic, rules: [...(s.data.conditionLogic?.rules || []), newRule] } } }));
      },
      updateConditionRule: async (ruleId: number, data: any) => {
        set((s: any) => ({ data: { ...s.data, conditionLogic: { ...s.data.conditionLogic, rules: s.data.conditionLogic.rules.map((r: any) => r.id === ruleId ? { ...r, ...data } : r) } } }));
      },
      deleteConditionRule: async (ruleId: number) => {
        set((s: any) => {
          const newDeleted = ruleId > 0 ? [...s.data.deletedRuleIds, ruleId] : s.data.deletedRuleIds;
          return {
            data: {
              ...s.data, deletedRuleIds: newDeleted,
              conditionLogic: { ...s.data.conditionLogic, rules: s.data.conditionLogic.rules.filter((r: any) => r.id !== ruleId) }
            }
          };
        });
      },
      addGroup: async (conditionId: number | null, parentGroupId: number | null) => {
        const newGroup = { id: getTempId(), condition_id: null, parent_group_id: parentGroupId, logical_operator: 'AND', sort_order: 1 };
        set((s: any) => ({ data: { ...s.data, conditionLogic: { ...s.data.conditionLogic, groups: [...(s.data.conditionLogic?.groups || []), newGroup] } } }));
      },
      updateGroupOperator: async (groupId: number, operator: string) => {
        set((s: any) => ({ data: { ...s.data, conditionLogic: { ...s.data.conditionLogic, groups: s.data.conditionLogic.groups.map((g: any) => g.id === groupId ? { ...g, logical_operator: operator } : g) } } }));
      },
      deleteGroup: async (groupId: number) => {
        set((s: any) => {
          const rulesToDelete = s.data.conditionLogic.rules.filter((r: any) => r.group_id === groupId).map((r: any) => r.id).filter((id: number) => id > 0);
          const groupsToDelete = s.data.conditionLogic.groups.filter((g: any) => g.parent_group_id === groupId).map((g: any) => g.id).filter((id: number) => id > 0);
          const newDeletedRules = [...s.data.deletedRuleIds, ...rulesToDelete, ...(groupId > 0 ? [groupId] : [])];
          const newDeletedGroups = [...s.data.deletedGroupIds, ...groupsToDelete];
          return {
            data: {
              ...s.data, deletedRuleIds: newDeletedRules, deletedGroupIds: newDeletedGroups,
              conditionLogic: {
                ...s.data.conditionLogic,
                groups: s.data.conditionLogic.groups.filter((g: any) => g.id !== groupId && g.parent_group_id !== groupId),
                rules: s.data.conditionLogic.rules.filter((r: any) => r.group_id !== groupId),
              }
            }
          };
        });
      },
      flushDraftLogic: async (conditionId: number) => {
        const state = get();
        const logic = state.data.conditionLogic;
        if (!logic || !conditionId) return;
        for (const group of logic.groups) {
          if (group.id < 0) await questionnaireApi.addConditionRuleGroup(conditionId, { parent_group_id: group.parent_group_id, logical_operator: group.logical_operator, sort_order: group.sort_order });
          else await questionnaireApi.updateConditionRuleGroup(group.id, { logical_operator: group.logical_operator, parent_group_id: group.parent_group_id, sort_order: group.sort_order });
        }
        for (const rule of logic.rules) {
          if (rule.id < 0) await questionnaireApi.addConditionRule(conditionId, { group_id: rule.group_id, property_id: rule.property_id, operator: rule.operator, compare_value: rule.compare_value, sort_order: rule.sort_order });
          else await questionnaireApi.updateConditionRule(rule.id, { group_id: rule.group_id, property_id: rule.property_id, operator: rule.operator, compare_value: rule.compare_value, sort_order: rule.sort_order });
        }
        for (const ruleId of state.data.deletedRuleIds) await questionnaireApi.deleteConditionRule(ruleId);
        for (const groupId of state.data.deletedGroupIds) await questionnaireApi.deleteConditionRuleGroup(groupId);
        set((state: any) => ({ data: { ...state.data, conditionLogic: null, deletedRuleIds: [], deletedGroupIds: [] } }));
      },
      reEvaluateConditionsAndSync: async (updatedConditionId?: number) => {
        const state = get();
        if (updatedConditionId) {
          try {
            const newLogic = await questionnaireApi.getConditionLogic(updatedConditionId);
            set((s: any) => ({ data: { ...s.data, conditionLogicsMap: { ...s.data.conditionLogicsMap, [updatedConditionId]: newLogic } } }));
          } catch (e) { console.error('Ошибка при обновлении логики условия:', e); }
        }
        const currentState = get();
        const newConditions = { ...currentState.data.currentConditions };
        for (const cond of currentState.data.conditions) {
          const logic = currentState.data.conditionLogicsMap[cond.id];
          if (!logic) continue;
          const isMet = evaluateRules(logic.rules, currentState.data.currentAnswers);
          newConditions[cond.id] = isMet;
        }
        set((s: any) => ({ data: { ...s.data, currentConditions: newConditions } }));
        syncSlotsWithConditions();
      },
      addFormulationVariant: async (identifier: string, conditionId: number | null, formulationId: number) => {
        const state = get();
        const setId = state.documentPackage.setId;
        if (!setId) return;
        const form = state.data.myFormulations.find((f: any) => f.id === formulationId);
        if (!form) return;
        const variantPayload = { formulation_id: formulationId, formulation_version_id: form.current_version_id || 1001, identifier, is_fallback: false, document_set_id: setId, condition_id: conditionId };
        const newVariant = await questionnaireApi.addUnassignedVariant(variantPayload);
        set((s: any) => {
          const existingGroupIndex = s.data.setFormulations.findIndex((g: any) => g.identifier === identifier);
          const newVariantObj = { variant: newVariant, formulation: form, condition: conditionId ? s.data.conditions.find((c: any) => c.id === conditionId) : null };
          if (existingGroupIndex !== -1) {
            const updatedGroups = [...s.data.setFormulations];
            updatedGroups[existingGroupIndex] = { ...updatedGroups[existingGroupIndex], variants: [...updatedGroups[existingGroupIndex].variants, newVariantObj] };
            return { data: { ...s.data, setFormulations: updatedGroups } };
          } else {
            return { data: { ...s.data, setFormulations: [...s.data.setFormulations, { identifier, variants: [newVariantObj] }] } };
          }
        });
        syncSlotsWithConditions();
      },
      deleteFormulationVariant: async (identifier: string, variantId: number) => {
        try {
          await questionnaireApi.deleteConditionVariant(variantId);
          set((s: any) => {
            const updatedSetFormulations = s.data.setFormulations.map((group: any) => {
              if (group.identifier === identifier) return { ...group, variants: group.variants.filter((v: any) => v.variant.id !== variantId) };
              return group;
            });
            return { data: { ...s.data, setFormulations: updatedSetFormulations } };
          });
          syncSlotsWithConditions();
        } catch (error) { console.error('Ошибка при удалении варианта:', error); }
      },
    },
    comments: {
      items: [] as any[],
      activeAnchorUuid: null as string | null, // Якорь, для которого открыта панель
      activeBlockUuid: null as string | null,
      isLoading: false,
      fetchComments: async (versionId: number) => {
        set((s: any) => ({ comments: { ...s.comments, isLoading: true } }));
        try {
          const items = await commentsApi.list(versionId);
          set((s: any) => ({ comments: { ...s.comments, items, isLoading: false } }));
        } catch (e) {
          console.error('Failed to fetch comments', e);
          set((s: any) => ({ comments: { ...s.comments, isLoading: false } }));
        }
      },
      addComment: async (versionId: number, data: any) => {
        const newComment = await commentsApi.add(versionId, data);
        set((s: any) => ({ comments: { ...s.comments, items: [...s.comments.items, newComment] } }));
        return newComment;
      },
      resolveComment: async (commentId: number, isResolved: boolean) => {
        const updated = await commentsApi.resolve(commentId, isResolved);
        set((s: any) => ({
          comments: {
            ...s.comments,
            items: s.comments.items.map((c: any) => c.id === commentId ? updated : c)
          }
        }));
      },
      setActiveAnchor: (anchorUuid: string | null, blockUuid?: string | null) => set((s: any) => ({
        comments: {
          ...s.comments,
          activeAnchorUuid: anchorUuid,
          activeBlockUuid: blockUuid !== undefined ? blockUuid : s.comments.activeBlockUuid
        }
      })),
    },
    documentPackage: {
      setId: null as number | null,
      documentSetMode: 'template' as 'template' | 'standard' | 'non_standard' | 'file',
      currentUserAccess: 'view' as 'owner' | 'full' | 'review' | 'comment' | 'view',
      items: [] as any[],
      activeId: null as number | null,
      currentVersionId: null as number | null,
      isLoading: false,
      isContentLoading: false,
      documentSet: null as any,
      setDocumentSetMode: (mode: 'template' | 'standard' | 'non_standard' | 'file') => {
        const state = get();
        const accessLevel = state.documentPackage.currentUserAccess;

        // 1. Обновляем режим комплекта в сторе
        set((s: any) => ({
          documentPackage: { ...s.documentPackage, documentSetMode: mode }
        }));

        // 2. Определяем целевой режим UI с учетом прав доступа
        let targetUiMode = state.ui.mode;
        if (accessLevel === 'owner' || accessLevel === 'full') {
          targetUiMode = mode === 'template' ? 'markup' : 'edit';
        } else if (accessLevel === 'review') {
          targetUiMode = 'review';
        } else if (accessLevel === 'comment') {
          targetUiMode = 'comment';
        } else {
          targetUiMode = 'edit'; // Для view
        }

        // 3. Применяем режим, только если он изменился
        if (state.ui.mode !== targetUiMode) {
          get().ui.setMode(targetUiMode);
        }

        // 4. (Опционально) Сохраняем изменение режима в API
        if (state.documentPackage.setId) {
          documentSetsApi.update(state.documentPackage.setId, { mode } as any);
        }
      },
      syncActiveDocumentToStore: () => {
        const state = get();
        const editorRef = state.editor.ref?.current;
        const { activeId } = state.documentPackage;
        if (editorRef && activeId) {
          const currentJson = editorRef.getJSON?.() || {};
          const currentHtml = editorRef.getCleanHTML?.() || '';
          set((s: any) => ({
            documentPackage: {
              ...s.documentPackage,
              items: s.documentPackage.items.map((d: any) =>
                d.id === activeId ? { ...d, contentJson: currentJson, contentHtml: currentHtml } : d
              )
            }
          }));
        }
      },
      saveActiveDocumentToServer: async () => {
        const state = get();
        const { activeId, items } = state.documentPackage;
        const currentDoc = items.find((d: any) => d.id === activeId);

        console.log('[DEBUG SAVE] Attempting to save. activeId:', activeId);

        if (!currentDoc) return;

        if (currentDoc.contentJson === undefined) {
            console.warn('[DEBUG SAVE] Skipped: contentJson is undefined.');
            return;
        }

        const editorRef = state.editor.ref?.current;
        const currentJson = editorRef.getJSON?.() || {};


        // 🆕 Сравниваем с тем, что уже лежит в сторе (которое было получено при последней загрузке/сохранении)
        const isChanged = JSON.stringify(currentJson) !== JSON.stringify(currentDoc.contentJson);

        console.log('[DEBUG SAVE] isChanged:', isChanged, 'currentDoc.contentJson length:', JSON.stringify(currentDoc.contentJson).length);


        if (isChanged) {
          console.log('[DEBUG SAVE] Sending to API...');
          console.log('[DEBUG SAVE] editor doc size at save time:', editorRef?.getJSON?.()?.content?.length);

          // Синхронизируем стор перед отправкой
          state.documentPackage.syncActiveDocumentToStore();
          await documentsApi.updateContent(activeId, currentJson, editorRef?.getCleanHTML?.() || '');
          console.log('[DEBUG SAVE] API call completed');
        }
      },
      loadPackage: async (setId: number) => {
        set((s: any) => ({ documentPackage: { ...s.documentPackage, isLoading: true, setId } }));
        try {
          const docs = await documentsApi.listBySet(setId);
          const docSet = await documentSetsApi.get(setId);
          const accesses = await documentSetsApi.getAccess(setId); // 🆕 Получаем список доступов

          // 🆕 Определяем ID текущего пользователя
          const currentUserId = useNavbarStore.getState().user?.id || 1;

          let accessLevel: 'owner' | 'full' | 'review' | 'comment' | 'view' = 'view';
          if (docSet.owner_id === currentUserId) {
            accessLevel = 'owner';
          } else {
            const userAccess = accesses.find(a => a.user_id === currentUserId);
            if (userAccess) {
              const type = String(userAccess.access_type).toUpperCase();
              if (type === 'EDIT' || type === 'FULL') accessLevel = 'full';
              else if (type === 'REVIEW') accessLevel = 'review';
              else if (type === 'COMMENT') accessLevel = 'comment';
              else accessLevel = 'view';
            }
          }

          const activeId = docs[0]?.id ?? null;
          const newDocSetMode = (docSet.mode as any) || 'template';

          get().editor.setReadOnly(accessLevel === 'view' || newDocSetMode === 'file');

          let defaultUiMode = 'edit'; // Фоллбэк
          if (accessLevel === 'owner' || accessLevel === 'full') {
            // Для полных прав: Разметка (если шаблон) или Редактирование
            defaultUiMode = newDocSetMode === 'template' ? 'markup' : 'edit';
          } else if (accessLevel === 'review') {
            // Для рецензентов сразу открываем Рецензирование
            defaultUiMode = 'review';
          } else if (accessLevel === 'comment') {
            // Для комментаторов сразу открываем Комментирование
            defaultUiMode = 'comment';
          }

          set((s: any) => ({
            documentPackage: {
              ...s.documentPackage,
              items: docs,
              activeId,
              isLoading: false,
              documentSetMode: newDocSetMode,
              currentUserAccess: accessLevel,
              documentSet: docSet
            }
          }));

          get().ui.setMode(defaultUiMode);

          if (activeId) await get().documentPackage.loadDocumentContent(activeId);
        } catch (e) {
          console.error('Package load error', e);
          set((s: any) => ({ documentPackage: { ...s.documentPackage, isLoading: false } }));
        }
      },
      loadDocumentContent: async (docId: number) => {
        const editorRef = get().editor.ref?.current;

        // 🆕 Защита: если редактора нет или он уже уничтожен (например, после навигации назад/вперед) — ничего не делаем
        if (!editorRef || (editorRef as any).isDestroyed) {
          console.warn('[loadDocumentContent] Editor is not available or destroyed. Skipping.');
          return;
        }

        set((s: any) => ({ documentPackage: { ...s.documentPackage, isContentLoading: true } }));

        try {
          let versions: any[] = [];
          try {
            versions = await documentsApi.listVersions(docId);
            console.log('[DEBUG LOAD] Loaded versions for docId:', docId, 'Count:', versions.length);
          } catch (apiError) {
            console.warn('[loadDocumentContent] Failed to load versions, assuming document is empty/new', apiError);
            versions = [];
          }

          // 🆕 Ещё раз проверяем после await — за это время редактор мог быть уничтожен
          if ((editorRef as any).isDestroyed) {
            console.warn('[loadDocumentContent] Editor was destroyed during API call. Aborting.');
            return;
          }

          // Берём текущую версию или первую доступную
          const current = versions.find((v: any) => v.is_current) ?? versions[0];

          if (current) {
            // Проверка на пустой JSON (дефолтный абзац Tiptap)
            const isEmptyJson =
              !current?.content_json ||
              (current.content_json.type === 'doc' &&
                current.content_json.content?.length === 1 &&
                current.content_json.content[0].type === 'paragraph' &&
                !current.content_json.content[0].content);

            // Если JSON пустой, но есть HTML (например, после импорта DOCX), используем HTML
            if (isEmptyJson && (current as any)?.content_html) {
              editorRef.setContent?.((current as any).content_html);
            } else {
              // Иначе используем JSON
              const json = (current?.content_json as any) ?? { type: 'doc', content: [{ type: 'paragraph' }] };
              editorRef.setContentJson?.(json);
            }

            setTimeout(() => extractUsedIdentifiers(), 50); 

            setTimeout(() => {
              if (!(editorRef as any).isDestroyed) {
                get().reviews.syncFromEditor(editorRef);
              }
            }, 50);

            // Обновляем стор, чтобы другие компоненты знали о текущей версии и контенте
            set((s: any) => ({
              documentPackage: {
                ...s.documentPackage,
                currentVersionId: current?.id || null,
                items: s.documentPackage.items.map((d: any) =>
                  d.id === docId 
                    ? { ...d, contentJson: current?.content_json, version_number: current?.version_number ?? 1 } 
                    : d
                ),
              },
            }));

            if (current.id) {
              await get().comments.fetchComments(current.id);
              
              setTimeout(() => {
                removeOrphanedAnchorsFromEditor();
              }, 50);
            }

          } else {
            // 🆕 Версий ещё нет (только что созданный документ) — принудительно очищаем редактор
            const emptyJson = { type: 'doc', content: [{ type: 'paragraph' }] };

            editorRef.setContentJson?.(emptyJson);

            // Обновляем стор, фиксируя пустое состояние
            set((s: any) => ({
              documentPackage: {
                ...s.documentPackage,
                currentVersionId: null,
                items: s.documentPackage.items.map((d: any) =>
                  d.id === docId ? { ...d, contentJson: emptyJson } : d
                ),
              },
            }));

            // Очищаем комментарии и рецензии, чтобы не было «призраков» от прошлого документа
            set((s: any) => ({
              comments: {
                ...s.comments,
                items: [],
                activeAnchorUuid: null,
                activeBlockUuid: null,
              },
              reviews: {
                ...s.reviews,
                items: [],
                activeEditUuid: null,
              },
            }));
          }
        } catch (e) {
          console.error('[loadDocumentContent] Document content load error', e);
        } finally {
          set((s: any) => ({ documentPackage: { ...s.documentPackage, isContentLoading: false } }));
        }
      },
      setActive: async (docId: number, isNew: boolean = false) => {
        const state = get();
        const editorRef = state.editor.ref?.current;

        console.log('[DEBUG setActive] START. docId:', docId, 'isNew:', isNew, 'current activeId:', state.documentPackage.activeId);

        try {
          // 1. Сначала сохраняем текущий активный документ, если он изменился
          if (state.documentPackage.activeId && state.documentPackage.activeId !== docId) {
            console.log('[DEBUG setActive] Saving previous document before switch...');
            await state.documentPackage.saveActiveDocumentToServer();
          }
          // 2. Очищаем таймер автосохранения
          if (editorRef?.clearAutoSave) {
            editorRef.clearAutoSave();
          }
          // 3. Переключаем ID активного документа в сторе
          set((s: any) => ({
            documentPackage: { ...s.documentPackage, activeId: docId }
          }));

          // 4. Загружаем контент нового документа
          if (isNew) {
            // Очищаем автосохранение
            if (editorRef?.clearAutoSave) {
              editorRef.clearAutoSave();
            }
            const emptyJson = { type: 'doc', content: [{ type: 'paragraph' }] };

            console.log('[DEBUG setActive isNew] BEFORE setContentJson, editor doc size:',
                        editorRef?.getJSON?.()?.content?.length);

            // Откладываем установку пустого контента, чтобы редактор точно был готов
            setTimeout(() => {
              const freshEditorRef = get().editor.ref?.current;
              if (freshEditorRef) {
                console.log('[DEBUG setActive isNew] setTimeout(0) fired, setting empty content');
                console.log('[DEBUG setActive isNew] editor.isDestroyed?', (freshEditorRef as any).isDestroyed);
                freshEditorRef.setContentJson(emptyJson);
              }
            }, 0);

            set((s: any) => ({
              documentPackage: {
                ...s.documentPackage,
                currentVersionId: null,
                items: s.documentPackage.items.map((d: any) =>
                  d.id === docId ? { ...d, contentJson: emptyJson } : d
                )
              }
            }));

            set((s: any) => ({
              comments: { ...s.comments, items: [], activeAnchorUuid: null, activeBlockUuid: null },
              reviews: { ...s.reviews, items: [], activeEditUuid: null }
            }));
          } else {
            // Принудительно загружаем контент существующего документа с сервера
            await get().documentPackage.loadDocumentContent(docId);
          }

          // 5. Синхронизируем слоты формул для нового документа
          setTimeout(() => syncSlotsWithConditions(), 150);
        } catch (error) {
          console.error('Error in setActive:', error);
        }
      },
      addDocument: async (name: string) => {
        const { setId, items, currentUserAccess } = get().documentPackage;
        if (!setId || (currentUserAccess !== 'owner' && currentUserAccess !== 'full')) return;
        try {
          const created = await documentsApi.create(setId, {
            name,
            document_role: 'main' as any,
            sort_order: (items.length || 0) + 1
          });
          // 🆕 Используем валидный пустой JSON с абзацем, чтобы избежать ложного срабатывания автосохранения
          const emptyJson = { type: 'doc', content: [{ type: 'paragraph' }] };
          const newDoc = { ...created, contentJson: emptyJson };
          set((s: any) => ({ documentPackage: { ...s.documentPackage, items: [...s.documentPackage.items, newDoc] } }));
          await get().documentPackage.setActive(newDoc.id, true);
        } catch (error) {
          console.error('Critical error adding document:', error);
        }
      },
      renameDocument: async (docId: number, name: string) => {
        if (get().documentPackage.currentUserAccess !== 'owner' && get().documentPackage.currentUserAccess !== 'full') return; // 🆕 Защита
        const updated = await documentsApi.rename(docId, name);
        set((s: any) => ({ documentPackage: { ...s.documentPackage, items: s.documentPackage.items.map((d: any) => d.id === docId ? { ...d, ...updated } : d) } }));
      },
      removeDocument: async (docId: number) => {
        if (get().documentPackage.currentUserAccess !== 'owner' && get().documentPackage.currentUserAccess !== 'full') return; // 🆕 Защита
        await documentsApi.remove(docId);
        set((s: any) => {
          const remaining = s.documentPackage.items.filter((d: any) => d.id !== docId);
          let { activeId } = s.documentPackage;
          // Если удалили текущий документ, переключаемся на первый оставшийся или null
          if (activeId === docId) activeId = remaining[0]?.id ?? null;
          return { documentPackage: { ...s.documentPackage, items: remaining, activeId } };
        });

        const { activeId } = get().documentPackage;
        if (activeId) {
          await get().documentPackage.setActive(activeId);
        } else {
          // 🆕 Если документов в комплекте не осталось, очищаем редактор валидным пустым JSON
          const editorRef = get().editor.ref?.current;
          if (editorRef) {
            editorRef.setContentJson({ type: 'doc', content: [] });
          }
        }
      },
    },
  };
});

useStore.subscribe((state, prevState) => {
  const editorRef = state.editor.ref?.current;
  if (!editorRef?.updateTokensBySourceId) return;
  if (state.data.myFormulations !== prevState.data.myFormulations) {
    state.data.myFormulations.forEach((newForm: any) => {
      const oldForm = prevState.data.myFormulations.find((f: any) => f.id === newForm.id);
      if (oldForm && (oldForm.name !== newForm.name || oldForm.text_content !== newForm.text_content)) {
          editorRef.updateTokensBySourceId(newForm.id, newForm.name, newForm.text_content);
      }
    });
  }
});