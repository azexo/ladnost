// components/TableDataInjector.tsx
// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
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

const getFormattedValue = (prop: any, rawValue: any, context: Record<string, any>) => {
  if (!prop.format) return String(rawValue ?? '');
  const formatStr = prop.format;
  const isFormula = /[A-ZА-ЯЁa-z_]+\s*\(/.test(formatStr) || /[\+\-\*\/\^\&]/.test(formatStr);
  if (!formatStr.includes('{value}')) {
    if (isFormula) {
      try { return String(evaluateFormula(formatStr, context)); } catch (e) {}
    }
    return formatStr;
  }
  if (isFormula) {
    try {
      const valReplacement = rawValue == null ? '""' : (typeof rawValue === 'string' ? `"${rawValue}"` : String(rawValue));
      const evalStr = formatStr.replace(/{value}/g, valReplacement);
      return String(evaluateFormula(evalStr, context));
    } catch (e) {}
  }
  return formatStr.replace(/{value}/g, String(rawValue ?? ''));
};

export const TableDataInjector = ({ editor }: Props) => {
  const t = useTranslations('TableDataInjector');
  const mode = useStore((s: any) => s.ui.mode);
  // 🆕 Используем новый метод
  const getTableDataBySectionIdentifier = useStore((s: any) => s.data.getTableDataBySectionIdentifier);
  const currentTableAnswers = useStore((s: any) => s.data.currentTableAnswers);
  const properties = useStore((s: any) => s.data.properties);
  const currentAnswers = useStore((s: any) => s.data.currentAnswers);

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

    // 1. Находим все существующие инъектированные строки (по sectionIdentifier)
    const existingInjectedRows: { pos: number; sectionIdentifier: string | null }[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.attrs.isInjected) {
        existingInjectedRows.push({ 
          pos, 
          sectionIdentifier: node.attrs.sectionIdentifier || null 
        });
      }
    });

    // 2. Находим все шаблонные строки (по sectionIdentifier)
    const templateRows: { pos: number; sectionIdentifier: string; node: any }[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.attrs.isTemplate && node.attrs.sectionIdentifier) {
        templateRows.push({ 
          pos, 
          sectionIdentifier: node.attrs.sectionIdentifier, 
          node 
        });
      }
    });

    // Удаляем "сиротские" инъектированные строки
    const validTemplateIdentifiers = new Set(templateRows.map(r => r.sectionIdentifier));
    const orphanedInjectedRows = existingInjectedRows.filter(
      r => r.sectionIdentifier === null || !validTemplateIdentifiers.has(r.sectionIdentifier)
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

    // 🆕 Формируем глобальный контекст (по identifier свойств)
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

    // 3. Проходим по каждой шаблонной строке
    templateRows.forEach(({ pos: templatePos, sectionIdentifier, node: templateNode }) => {
      // 🆕 Получаем данные по идентификатору секции (имени)
      const tableData = getTableDataBySectionIdentifier(sectionIdentifier);
      const dataRows = tableData?.rows;
      const columns = tableData?.columns;
      const existingForSection = existingInjectedRows.filter(
        r => r.sectionIdentifier === sectionIdentifier
      );

      // ==========================================
      // 🆕 КЕЙС 1: СЕКЦИИ НЕТ ВООБЩЕ В STORE
      // Удаляем саму шаблонную строку + все её инъектированные строки
      // ==========================================
      if (!tableData) {
        const positionsToDelete: number[] = [templatePos];
        existingForSection.forEach(r => positionsToDelete.push(r.pos));

        // Сортируем по убыванию, чтобы удалять с конца и не ломать позиции
        positionsToDelete.sort((a, b) => b - a);

        positionsToDelete.forEach(pos => {
          const nodeAtPos = doc.nodeAt(pos);
          if (nodeAtPos) {
            chain.deleteRange({ from: pos, to: pos + nodeAtPos.nodeSize });
            hasChanges = true;
          }
        });

        console.warn(
          `[TableDataInjector] Секция "${sectionIdentifier}" не найдена в store. ` +
          `Шаблонная строка и ${existingForSection.length} инъектированных строк удалены.`
        );
        return;
      }

      // ==========================================
      // КЕЙС 2: СЕКЦИЯ ЕСТЬ, НО В НЕЙ НЕТ ДАННЫХ
      // Удаляем только инъектированные строки, шаблон оставляем
      // ==========================================
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

      // ==========================================
      // КЕЙС 3: СЕКЦИЯ ЕСТЬ И ДАННЫЕ ЕСТЬ
      // Обновляем инъектированные строки
      // ==========================================
      const colCount = templateNode.childCount;
      const needsUpdate = existingForSection.length !== dataRows.length || isDataChanged;

      if (needsUpdate) {
        // Удаляем старые инъектированные строки для этой секции
        [...existingForSection].sort((a, b) => b.pos - a.pos).forEach(({ pos }) => {
          const nodeAtPos = doc.nodeAt(pos);
          if (nodeAtPos) {
            chain.deleteRange({ from: pos, to: pos + nodeAtPos.nodeSize });
            hasChanges = true;
          }
        });

        let insertPos = templatePos + templateNode.nodeSize;

        dataRows.forEach((rowData: any, rowIndex: number) => {
          // 1. Формируем контекст текущей строки (по identifier)
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

          // 2. Итеративно вычисляем формулы
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
                  if (child.type.name === 'token' && child.attrs?.identifier) {
                    const tokenIdentifier = child.attrs.identifier;
                    const col = columns.find((c: any) => c.identifier === tokenIdentifier);
                    if (col) {
                      rawValue = rowContext[col.identifier];
                      targetCol = col;
                    }
                  }
                });
              }
            });

            let safeText = '\u00A0';
            if (targetCol && rawValue !== undefined && rawValue !== null) {
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

          // 4. Создаём инъектированную строку с sectionIdentifier
          const newRowNode = {
            type: 'tableRow',
            attrs: {
              isInjected: true,
              sectionIdentifier: sectionIdentifier
            },
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
        console.error(`[TableDataInjector] ${t('criticalError')}`, error);
      }
      setTimeout(() => { isProcessingRef.current = false; }, 100);
    }
  }, [editor, mode, getTableDataBySectionIdentifier, currentTableAnswers, properties, currentAnswers, t]);

  return null;
};