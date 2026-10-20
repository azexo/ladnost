// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/TableDataInjector.tsx
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl'; // 🆕 Импортируем хук next-intl
import { useStore } from '@/store/useStore';
import { Editor } from '@tiptap/core';
import { pluginManager } from '@/lib/pluginManager'; 
import { DataType } from '@/lib/types';

interface Props {
  editor: Editor | null;
}

const evaluateFormula = (formula: string, context: Record<string, any>) => {
    const payload = { formula, context, result: undefined as any };
    const processed = pluginManager.applyFilters('evaluateFormula', payload);
    return processed.result;
};

// 🆕 Вспомогательная функция: форматирование значения
// (Логика полностью идентична getFormattedValue из useStore)
const getFormattedValue = (prop: any, rawValue: any, context: Record<string, any>) => {
  if (!prop.format) return String(rawValue ?? '');
  const formatStr = prop.format;

  // Проверяем, похож ли формат на формулу (есть функции или математические операторы)
  const isFormula = /[A-ZА-ЯЁa-z_]+\s*\(/.test(formatStr) || /[\+\-\*\/\^\&]/.test(formatStr);

  // Если формат не содержит {value}, возможно это чистая формула, ссылающаяся на identifier
  if (!formatStr.includes('{value}')) {
    if (isFormula) {
      try { return String(evaluateFormula(formatStr, context)); } catch (e) {}
    }
    return formatStr;
  }

  // Если формат содержит {value} и это формула
  if (isFormula) {
    try {
      const valReplacement = rawValue == null ? '""' : (typeof rawValue === 'string' ? `"${rawValue}"` : String(rawValue));
      const evalStr = formatStr.replace(/{value}/g, valReplacement);
      return String(evaluateFormula(evalStr, context));
    } catch (e) {}
  }

  // Фоллбэк: простая строковая замена (для обычных шаблонов типа "{value} руб.")
  return formatStr.replace(/{value}/g, String(rawValue ?? ''));
};

export const TableDataInjector = ({ editor }: Props) => {
  // 🆕 Инициализируем переводы для неймспейса TableDataInjector
  const t = useTranslations('TableDataInjector');

  const mode = useStore((s: any) => s.ui.mode);
  const getTableDataBySectionId = useStore((s: any) => s.data.getTableDataBySectionId);
  const currentTableAnswers = useStore((s: any) => s.data.currentTableAnswers);
  const properties = useStore((s: any) => s.data.properties);
  const currentAnswers = useStore((s: any) => s.data.currentAnswers); // 🆕 Глобальные ответы для контекста
  
  const isProcessingRef = useRef(false);
  const prevDataSnapshotRef = useRef<string>('');

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (mode !== 'edit') return;
    if (isProcessingRef.current) return;

    const currentSnapshot = JSON.stringify(currentTableAnswers);
    const isDataChanged = prevDataSnapshotRef.current !== currentSnapshot;
    
    if (isDataChanged) {
      prevDataSnapshotRef.current = currentSnapshot;
    }

    const doc = editor.state.doc;
    let hasChanges = false;
    const chain = editor.chain();

    // 1. Находим все существующие инъектированные строки
    const existingInjectedRows: { pos: number; sectionId: number | null }[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.attrs.isInjected) {
        existingInjectedRows.push({ pos, sectionId: node.attrs.sectionId });
      }
    });

    // 2. Находим все шаблонные строки
    const templateRows: { pos: number; sectionId: number; node: any }[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.attrs.isTemplate && node.attrs.sectionId) {
        templateRows.push({ pos, sectionId: node.attrs.sectionId, node });
      }
    });

    // Удаляем "сиротские" инъектированные строки
    const validTemplateSectionIds = new Set(templateRows.map(r => r.sectionId));
    const orphanedInjectedRows = existingInjectedRows.filter(
      r => r.sectionId !== null && !validTemplateSectionIds.has(r.sectionId)
    );

    if (orphanedInjectedRows.length > 0) {
      [...orphanedInjectedRows].sort((a, b) => b.pos - a.pos).forEach(({ pos }) => {
        const nodeAtPos = doc.nodeAt(pos);
        if (nodeAtPos) {
          chain.deleteRange({ from: pos, to: pos + nodeAtPos.nodeSize });
          hasChanges = true;
        }
      });
    }

    // 🆕 Формируем глобальный контекст (чтобы формулы таблицы могли ссылаться на обычные свойства)
    const globalContext: Record<string, any> = {};
    properties.forEach((p: any) => {
      if (p.identifier) {
        let val = currentAnswers[p.id];
        if ((p.data_type === DataType.MONEY || p.data_type === DataType.NUMBER) && typeof val === 'string') {
          const num = Number(val);
          if (!isNaN(num)) val = num;
        }
        globalContext[p.identifier] = val !== undefined && val !== null ? val : 0;
      }
    });

    // 3. Проходим по каждой таблице
    templateRows.forEach(({ pos: templatePos, sectionId, node: templateNode }) => {
      const tableData = getTableDataBySectionId(sectionId);
      const dataRows = tableData?.rows;
      const columns = tableData?.columns;
      const existingForSection = existingInjectedRows.filter(r => r.sectionId === sectionId);

      if (!dataRows || dataRows.length === 0) {
        if (existingForSection.length > 0) {
          [...existingForSection].sort((a, b) => b.pos - a.pos).forEach(({ pos }) => {
            const nodeAtPos = doc.nodeAt(pos);
            if (nodeAtPos) {
              chain.deleteRange({ from: pos, to: pos + nodeAtPos.nodeSize });
              hasChanges = true;
            }
          });
        }
        return;
      }

      const colCount = templateNode.childCount;
      const needsUpdate = existingForSection.length !== dataRows.length || isDataChanged;

      if (needsUpdate) {
        [...existingForSection].sort((a, b) => b.pos - a.pos).forEach(({ pos }) => {
          const nodeAtPos = doc.nodeAt(pos);
          if (nodeAtPos) {
            chain.deleteRange({ from: pos, to: pos + nodeAtPos.nodeSize });
            hasChanges = true;
          }
        });

        let insertPos = templatePos + templateNode.nodeSize;

        dataRows.forEach((rowData: any, rowIndex: number) => {
          // 🆕 1. Формируем контекст текущей строки (наследуем глобальные свойства и перезаписываем значениями строки)
          const rowContext: Record<string, any> = { ...globalContext };
          columns.forEach((col: any) => {
            if (col.identifier) {
              let val = rowData.cells?.[col.id];
              if ((col.data_type === DataType.MONEY || col.data_type === DataType.NUMBER) && typeof val === 'string') {
                const num = Number(val);
                if (!isNaN(num)) val = num;
              }
              rowContext[col.identifier] = val !== undefined && val !== null ? val : 0;
            }
          });

          // 🆕 2. Итеративно вычисляем формулы текущей строки (для обработки зависимостей между колонками)
          const MAX_ITERATIONS = 5;
          for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
            let changed = false;
            columns.forEach((col: any) => {
              if (col.formula || col.value_source === 'FORMULA') {
                try {
                  const rawValue = evaluateFormula(col.formula, rowContext);
                  const strNew = String(rawValue);
                  const strOld = String(rowContext[col.identifier]);
                  if (strNew !== strOld) {
                    rowContext[col.identifier] = rawValue;
                    changed = true;
                  }
                } catch (e) {
                  // 🆕 Используем next-intl для локализации лога
                  console.warn(`[TableDataInjector] ${t('formulaError', { identifier: col.identifier })}`, e);
                }
              }
            });
            if (!changed) break;
          }

          // 3. Генерируем содержимое ячеек
          const cells = [];
          for (let i = 0; i < colCount; i++) {
            let rawValue = undefined;
            let targetCol = null;

            templateNode.forEach((cellNode: any, offset: number, cellIndex: number) => {
              if (cellIndex === i) {
                cellNode.descendants((child: any) => {
                  if (child.type.name === 'token' && child.attrs?.sourceId) {
                    const propId = Number(child.attrs.sourceId);
                    const col = columns.find((c: any) => c.id === propId);
                    if (col) {
                      // 🆕 Используем вычисленное значение из rowContext
                      rawValue = rowContext[col.identifier]; 
                      targetCol = col;
                    }
                  }
                });
              }
            });

            let safeText = '\u00A0'; 
            if (targetCol && rawValue !== undefined && rawValue !== null) {
              // 🆕 Применяем форматирование (format)
              const formatted = getFormattedValue(targetCol, rawValue, rowContext);
              safeText = formatted || '\u00A0';
            } else if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
              safeText = String(rawValue);
            }

            const cellJson = {
              type: 'tableCell',
              content: [{ 
                type: 'paragraph', 
                content: [{ type: 'text', text: safeText }]
              }]
            };
            cells.push(cellJson);
          }

          const newRowNode = {
            type: 'tableRow',
            attrs: { isInjected: true, sectionId: sectionId },
            content: cells
          };

          chain.insertContentAt(insertPos, newRowNode);
          hasChanges = true;

          const tempNode = editor.schema.nodeFromJSON(newRowNode);
          insertPos += tempNode.nodeSize;
        });
      }
    });

    if (hasChanges) {
      isProcessingRef.current = true;
      try {
        chain.run();
      } catch (error) {
        // 🆕 Используем next-intl для локализации лога
        console.error(`[TableDataInjector] ${t('criticalError')}`, error);
      }
      setTimeout(() => { isProcessingRef.current = false; }, 100);
    }
  }, [editor, mode, getTableDataBySectionId, currentTableAnswers, properties, currentAnswers, t]); // 🆕 Добавили t в зависимости

  return null;
};