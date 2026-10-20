// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

"use client";
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { useStore } from '@/store/useStore';
import { useTranslations } from 'next-intl'; // Импортируем хук next-intl

interface TableHoverMenuProps {
  editor: Editor;
}

/**
 * Компонент управления таблицей, появляющийся при наведении мыши.
 * Полностью поддерживает вложенные таблицы.
 */
const TableHoverMenu = ({ editor }: TableHoverMenuProps) => {
  // Инициализируем переводы для неймспейса TableHoverMenu
  const t = useTranslations('TableHoverMenu');

  const [hoveredIndices, setHoveredIndices] = useState<{
    table: HTMLTableElement;
    rowIdx: number;
    cellIdx: number;
  } | null>(null);
  
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  // ==========================================
  // ХЕЛПЕР: ВЫПОЛНЕНИЕ КОМАНДЫ БЕЗ ПРОКРУТКИ
  // ==========================================
  const runWithoutScroll = useCallback((callback: () => void) => {
    // Находим ближайший скроллируемый контейнер редактора
    let scrollContainer: HTMLElement | null = editor.view.dom.parentElement;
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const isScrollableY =
        (overflowY === 'auto' || overflowY === 'scroll') &&
        scrollContainer.scrollHeight > scrollContainer.clientHeight;
      const isScrollableX =
        (overflowX === 'auto' || overflowX === 'scroll') &&
        scrollContainer.scrollWidth > scrollContainer.clientWidth;

      if (isScrollableY || isScrollableX) break;
      scrollContainer = scrollContainer.parentElement;
    }

    const savedWindowScrollY = window.scrollY;
    const savedWindowScrollX = window.scrollX;
    const savedContainerScrollTop = scrollContainer?.scrollTop ?? 0;
    const savedContainerScrollLeft = scrollContainer?.scrollLeft ?? 0;

    callback();

    // Восстанавливаем позицию скролла после обновления DOM
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = savedContainerScrollTop;
          scrollContainer.scrollLeft = savedContainerScrollLeft;
        }
        if (
          Math.abs(window.scrollY - savedWindowScrollY) > 1 ||
          Math.abs(window.scrollX - savedWindowScrollX) > 1
        ) {
          window.scrollTo(savedWindowScrollX, savedWindowScrollY);
        }
      });
    });
  }, [editor]);

  // ==========================================
  // ОТСЛЕЖИВАНИЕ НАВЕДЕНИЯ МЫШИ
  // ==========================================
  useEffect(() => {
    if (!editor) return;

    const dom = editor.view.dom;
    const controlsId = 'table-hover-controls-root';

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const cell = target.closest('td, th') as HTMLTableCellElement | null;
      const row = target.closest('tr') as HTMLTableRowElement | null;
      const table = target.closest('table') as HTMLTableElement | null;

      if (table && row && cell) {
        const rowIdx = Array.from(table.rows).indexOf(row);
        const cellsInRow = Array.from(row.children).filter(
          (c) => c.tagName === 'TD' || c.tagName === 'TH'
        );
        const cellIdx = cellsInRow.indexOf(cell);

        setHoveredIndices((prev) => {
          if (
            prev &&
            prev.table === table &&
            prev.rowIdx === rowIdx &&
            prev.cellIdx === cellIdx
          ) {
            return prev;
          }
          return { table, rowIdx, cellIdx };
        });
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement;
      const controlsRoot = document.getElementById(controlsId);

      if (
        !relatedTarget ||
        (!dom.contains(relatedTarget) && !controlsRoot?.contains(relatedTarget))
      ) {
        setHoveredIndices(null);
      }
    };

    dom.addEventListener('mousemove', handleMouseMove);
    dom.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      dom.removeEventListener('mousemove', handleMouseMove);
      dom.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [editor]);

  // ==========================================
  // ПЕРЕОБНОВЛЕНИЕ ПРИ ИЗМЕНЕНИИ КОНТЕНТА
  // ==========================================
  useEffect(() => {
    if (!editor) return;
    editor.on('update', forceUpdate);
    return () => {
      editor.off('update', forceUpdate);
    };
  }, [editor, forceUpdate]);

  // ==========================================
  // СКРОЛЛ / РЕСАЙЗ / ЗУМ
  // ==========================================
  useEffect(() => {
    window.addEventListener('scroll', forceUpdate, true);
    window.addEventListener('resize', forceUpdate);
    return () => {
      window.removeEventListener('scroll', forceUpdate, true);
      window.removeEventListener('resize', forceUpdate);
    };
  }, [forceUpdate]);

  // ==========================================
  // ПОЛУЧЕНИЕ АКТУАЛЬНЫХ DOM-ЭЛЕМЕНТОВ
  // ==========================================
  let hoveredTable: HTMLTableElement | null = null;
  let hoveredRow: HTMLTableRowElement | null = null;
  let hoveredCell: HTMLTableCellElement | null = null;

  if (hoveredIndices) {
    const { table, rowIdx, cellIdx } = hoveredIndices;
    if (document.contains(table)) {
      hoveredTable = table;
      if (hoveredTable.rows[rowIdx]) {
        hoveredRow = hoveredTable.rows[rowIdx];
        const cells = Array.from(hoveredRow.children).filter(
          (c) => c.tagName === 'TD' || c.tagName === 'TH'
        );
        if (cells[cellIdx]) {
          hoveredCell = cells[cellIdx] as HTMLTableCellElement;
        }
      }
    }
  }

  if (!hoveredTable) return null;

  const isTemplateRow = hoveredRow?.getAttribute('data-is-template') === 'true';
  
  console.log(
    '%c[DEBUG HoverMenu Render]', 'color: blue; font-weight: bold;',
    'isTemplateRow:', isTemplateRow,
    '| DOM attr:', hoveredRow?.getAttribute('data-is-template'),
    '| Row exists in DOM?', document.contains(hoveredRow)
  );

  const rowRect = hoveredRow ? hoveredRow.getBoundingClientRect() : null;
  const tableRect = hoveredTable.getBoundingClientRect();

  // ==========================================
  // ГРАНИЦЫ КОЛОНКИ
  // ==========================================
  let colBox: { left: number; width: number; top: number } | null = null;
  if (hoveredCell && hoveredTable) {
    const row = hoveredCell.parentElement as HTMLTableRowElement;
    if (row) {
      const cellsInRow = Array.from(row.children).filter(
        (c) => c.tagName === 'TD' || c.tagName === 'TH'
      );
      const colIndex = cellsInRow.indexOf(hoveredCell);

      if (colIndex !== -1) {
        let minLeft = Infinity;
        let maxRight = -Infinity;
        let minTop = Infinity;
        const rows = Array.from(hoveredTable.rows);

        for (const r of rows) {
          const cells = Array.from(r.children).filter(
            (c) => c.tagName === 'TD' || c.tagName === 'TH'
          );
          const cell = cells[colIndex] as HTMLElement | undefined;
          if (cell) {
            const rect = cell.getBoundingClientRect();
            // 🆕 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ:
            // Игнорируем невидимые ячейки (скрытые строки, display: none, или ячейки с нулевым размером).
            // Иначе их координаты (0, 0) ломают расчет minLeft и minTop.
            if (rect.width > 0 && rect.height > 0) {
              if (rect.left < minLeft) minLeft = rect.left;
              if (rect.right > maxRight) maxRight = rect.right;
              if (rect.top < minTop) minTop = rect.top;
            }
          }
        }

        if (minLeft !== Infinity) {
          colBox = {
            left: Math.floor(minLeft),
            width: Math.ceil(maxRight - minLeft),
            top: Math.floor(minTop),
          };
        }
      }
    }
  }

  // ==========================================
  // ХЕЛПЕРЫ ПРОСМИР (УСТОЙЧИВЫ К ВЛОЖЕННОСТИ)
  // ==========================================
  const getRowNodePos = (row: HTMLTableRowElement) => {
    try {
      const domPos = editor.view.posAtDOM(row, 0);
      const $pos = editor.state.doc.resolve(domPos);
      for (let d = $pos.depth; d >= 0; d--) {
        if ($pos.node(d).type.name === 'tableRow') {
          return { pos: $pos.before(d), node: $pos.node(d) };
        }
      }
    } catch (e) {
      console.warn('getRowNodePos error:', e);
    }
    return null;
  };

  const getCellNodePos = (cell: HTMLTableCellElement) => {
    try {
      const domPos = editor.view.posAtDOM(cell, 0);
      const $pos = editor.state.doc.resolve(domPos);
      for (let d = $pos.depth; d >= 0; d--) {
        const nodeName = $pos.node(d).type.name;
        if (nodeName === 'tableCell' || nodeName === 'tableHeader') {
          return $pos.before(d);
        }
      }
    } catch (e) {
      console.warn('getCellNodePos error:', e);
    }
    return -1;
  };

  const findTablePos = () => {
    try {
      if (!hoveredCell && !hoveredRow) return -1;
      const domEl = hoveredCell || hoveredRow!;
      const domPos = editor.view.posAtDOM(domEl, 0);
      const $pos = editor.state.doc.resolve(domPos);
      for (let d = $pos.depth; d >= 0; d--) {
        if ($pos.node(d).type.name === 'table') {
          return $pos.before(d);
        }
      }
    } catch {
      // ignore
    }
    return -1;
  };

  const restoreSelection = (tr: any, originalSelection: any) => {
    try {
      const mappedFrom = tr.mapping.map(originalSelection.from);
      const mappedTo = tr.mapping.map(originalSelection.to);
      const $from = tr.doc.resolve(mappedFrom);
      const $to = tr.doc.resolve(mappedTo);
      tr.setSelection(TextSelection.between($from, $to));
    } catch {
      // Если позиция стала невалидной, оставляем текущее выделение
    }
  };

  const updateHoveredRowHeight = (delta: number) => {
    if (!hoveredRow) return;
    const rowInfo = getRowNodePos(hoveredRow);
    if (!rowInfo) return;

    const { pos: rowNodePos, node: rowNode } = rowInfo;
    const currentHeight = parseInt(rowNode.attrs.height?.replace('px', '') || '40', 10) || 40;
    const newHeight = Math.max(20, Math.min(300, currentHeight + delta));

    runWithoutScroll(() => {
      editor.chain().focus().command(({ tr, dispatch }) => {
        if (!dispatch) return true;
        tr.setNodeMarkup(rowNodePos, null, {
          ...rowNode.attrs,
          height: `${newHeight}px`,
        });
        dispatch(tr);
        return true;
      }).run();
    });
  };

  // Безопасное применение bordered к новым ячейкам (работает для вложенных таблиц)
  const applyBorderedToNewCells = (tr: any, tablePos: number, targetIndex: number, type: 'row' | 'col') => {
    const tableNode = tr.doc.nodeAt(tablePos);
    if (!tableNode) return tr;

    if (type === 'row') {
      let currentRowIndex = 0;
      tableNode.forEach((rowNode: any, rowOffset: number) => {
        if (currentRowIndex === targetIndex + 1) {
          rowNode.forEach((cellNode: any, cellOffset: number) => {
            const cellPos = tablePos + 1 + rowOffset + 1 + cellOffset;
            tr.setNodeMarkup(cellPos, null, { ...cellNode.attrs, bordered: true });
          });
        }
        currentRowIndex++;
      });
    } else {
      tableNode.forEach((rowNode: any, rowOffset: number) => {
        const newCellIndex = targetIndex + 1;
        if (rowNode.childCount > newCellIndex) {
          let cellOffset = 0;
          for (let i = 0; i < newCellIndex; i++) cellOffset += rowNode.child(i).nodeSize;
          const cellPos = tablePos + 1 + rowOffset + 1 + cellOffset;
          const cellNode = rowNode.child(newCellIndex);
          tr.setNodeMarkup(cellPos, null, { ...cellNode.attrs, bordered: true });
        }
      });
    }
    return tr;
  };

  // ==========================================
  // ОБЩИЙ ОБРАБОТЧИК MOUSEDOWN — предотвращает потерю фокуса
  // ==========================================
  const handlePanelMouseDown = (e: React.MouseEvent) => {
    // Предотвращаем уход фокуса с редактора при клике на панели
    e.preventDefault();
  };

  // ==========================================
  // РЕНДЕР ЧЕРЕЗ PORTAL
  // ==========================================
  return createPortal(
    <div
      id="table-hover-controls-root"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* 1. ПАНЕЛЬ УПРАВЛЕНИЯ СТРОКОЙ */}
      {rowRect && (
        <div
          onMouseDown={handlePanelMouseDown}
          style={{
            position: 'fixed',
            top: rowRect.top,
            right: window.innerWidth - rowRect.left - 1,
            pointerEvents: 'auto',
          }}
          className="flex flex-col items-center justify-center gap-1 bg-white border border-slate-200 rounded-lg shadow-lg p-1"
        >
          <button
            onClick={() => {
              if (!hoveredRow) return;
              const rowInfo = getRowNodePos(hoveredRow);
              if (!rowInfo) return;

              const originalSelection = editor.state.selection;
              runWithoutScroll(() => {
                editor.chain()
                  .setTextSelection(rowInfo.pos + 1)
                  .deleteRow()
                  .command(({ tr, dispatch }) => {
                    if (!dispatch) return true;
                    restoreSelection(tr, originalSelection);
                    return true;
                  })
                  .focus()
                  .run();
              });
            }}
            title={t('deleteRow')}
            className="w-4 h-4 rounded flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
          >
            <i className="fa-solid fa-trash text-[10px]"></i>
          </button>
          <button
            onClick={() => {
              if (!hoveredRow) return;
              const rowInfo = getRowNodePos(hoveredRow);
              if (!rowInfo) return;

              const tablePos = findTablePos();
              const tableNode = tablePos !== -1 ? editor.state.doc.nodeAt(tablePos) : null;
              const isBordered = tableNode?.attrs.bordered || false;
              const originalSelection = editor.state.selection;

              runWithoutScroll(() => {
                editor.chain()
                  .setTextSelection(rowInfo.pos + 1)
                  .addRowAfter()
                  .command(({ tr, dispatch }) => {
                    if (!dispatch) return true;
                    if (isBordered && tablePos !== -1) {
                      applyBorderedToNewCells(tr, tablePos, hoveredIndices!.rowIdx, 'row');
                    }
                    restoreSelection(tr, originalSelection);
                    return true;
                  })
                  .focus()
                  .run();
              });
            }}
            title={t('addRowBelow')}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <i className="fa-solid fa-plus text-[10px]"></i>
          </button>
          <button
            onClick={() => {
              if (!hoveredRow) return;
              const rowInfo = getRowNodePos(hoveredRow);
              if (!rowInfo) return;

              const isCurrentlyTemplate = rowInfo.node.attrs.isTemplate;

              // 🆕 ИСПОЛЬЗУЕМ ПРЯМУЮ ТРАНЗАКЦИЮ ВМЕСТО chain(), чтобы избежать проблем с выделением
              if (isCurrentlyTemplate) {
                // Снимаем статус шаблона
                const { tr } = editor.state;
                tr.setNodeMarkup(rowInfo.pos, null, {
                  ...rowInfo.node.attrs,
                  isTemplate: false,
                  sectionId: null
                });
                editor.view.dispatch(tr);
              } else {
                // Устанавливаем статус шаблона и ищем sectionId
                let detectedSectionId: number | null = null;
                rowInfo.node.descendants((child: any) => {
                  if (child.type.name === 'token' && child.attrs.sourceId) {
                    const prop = useStore.getState().data.properties.find(
                      (p: any) => p.id === Number(child.attrs.sourceId)
                    );
                    if (prop?.section_id) {
                      detectedSectionId = prop.section_id;
                    }
                  }
                });

                const { tr } = editor.state;
                tr.setNodeMarkup(rowInfo.pos, null, {
                  ...rowInfo.node.attrs,
                  isTemplate: true,
                  sectionId: detectedSectionId
                });
                editor.view.dispatch(tr);
              }
            }}
            title={isTemplateRow ? t('removeTemplateStatus') : t('makeTemplate')}
            className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
              isTemplateRow 
                ? 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm' 
                : 'text-indigo-500 hover:bg-indigo-50'
            }`}
          >
            <i className="fa-solid fa-table-list text-[10px]"></i>
          </button>
          <div className="flex flex-col items-center gap-0.5 mt-1">
            <button
              onClick={() => updateHoveredRowHeight(10)}
              className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100"
              title={t('increaseHeight')}
            >
              <i className="fa-solid fa-chevron-up text-[8px]"></i>
            </button>
            <button
              onClick={() => updateHoveredRowHeight(-10)}
              className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100"
              title={t('decreaseHeight')}
            >
              <i className="fa-solid fa-chevron-down text-[8px]"></i>
            </button>
          </div>
        </div>
      )}

      {/* 2. ПАНЕЛЬ УПРАВЛЕНИЯ КОЛОНКОЙ */}
      {colBox && (
        <div
          style={{
            position: 'fixed',
            left: colBox.left,
            bottom: window.innerHeight - colBox.top - 1,
            width: colBox.width,
            pointerEvents: 'none',
            display: 'flex',
            justifyContent: 'flex-start',
          }}
        >
          <div
            onMouseDown={handlePanelMouseDown}
            className="flex items-center justify-center gap-1 bg-white border border-slate-200 rounded-lg shadow-lg p-1 pointer-events-auto"
          >
            <button
              onClick={() => {
                if (!hoveredCell) return;
                const cellNodePos = getCellNodePos(hoveredCell);
                if (cellNodePos === -1) return;

                const originalSelection = editor.state.selection;
                runWithoutScroll(() => {
                  editor.chain()
                    .setTextSelection(cellNodePos + 1)
                    .deleteColumn()
                    .command(({ tr, dispatch }) => {
                      if (!dispatch) return true;
                      restoreSelection(tr, originalSelection);
                      return true;
                    })
                    .focus()
                    .run();
                });
              }}
              title={t('deleteColumn')}
              className="w-4 h-4 rounded flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
            >
              <i className="fa-solid fa-trash text-[10px]"></i>
            </button>
            <button
              onClick={() => {
                if (!hoveredCell) return;
                const cellNodePos = getCellNodePos(hoveredCell);
                if (cellNodePos === -1) return;

                const tablePos = findTablePos();
                const tableNode = tablePos !== -1 ? editor.state.doc.nodeAt(tablePos) : null;
                const isBordered = tableNode?.attrs.bordered || false;
                const originalSelection = editor.state.selection;

                runWithoutScroll(() => {
                  editor.chain()
                    .setTextSelection(cellNodePos + 1)
                    .addColumnAfter()
                    .command(({ tr, dispatch }) => {
                      if (!dispatch) return true;
                      if (isBordered && tablePos !== -1) {
                        applyBorderedToNewCells(tr, tablePos, hoveredIndices!.cellIdx, 'col');
                      }
                      restoreSelection(tr, originalSelection);
                      return true;
                    })
                    .focus()
                    .run();
                });
              }}
              title={t('addColumnRight')}
              className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <i className="fa-solid fa-plus text-[10px]"></i>
            </button>
          </div>
        </div>
      )}

      {/* 3. ПАНЕЛЬ УПРАВЛЕНИЯ ТАБЛИЦЕЙ */}
      {tableRect && (
        <div
          onMouseDown={handlePanelMouseDown}
          style={{
            position: 'fixed',
            right: window.innerWidth - tableRect.right,
            bottom: window.innerHeight - tableRect.top - 1,
            pointerEvents: 'auto',
          }}
          className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg shadow-lg p-1"
        >
          <button
            onClick={() => runWithoutScroll(() => editor.chain().focus().mergeCells().run())}
            disabled={!editor.can().mergeCells()}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t('mergeCells')}
          >
            <i className="fa-solid fa-object-group text-[11px]"></i>
          </button>
          <button
            onClick={() => runWithoutScroll(() => editor.chain().focus().splitCell().run())}
            disabled={!editor.can().splitCell()}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t('splitCells')}
          >
            <i className="fa-solid fa-object-ungroup text-[11px]"></i>
          </button>
          <button
            onClick={() => {
              runWithoutScroll(() => {
                const cellAttrs = editor.getAttributes('tableCell');
                const headerAttrs = editor.getAttributes('tableHeader');
                const currentAlign = headerAttrs.verticalAlign || cellAttrs.verticalAlign || 'top';
                const nextAlign = currentAlign === 'top' ? 'middle' : currentAlign === 'middle' ? 'bottom' : 'top';
                
                editor.chain().focus().updateAttributes('tableCell', { verticalAlign: nextAlign }).run();
                editor.chain().focus().updateAttributes('tableHeader', { verticalAlign: nextAlign }).run();
              });
            }}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
            title={t('verticalAlign')}
          >
            <i className="fa-solid fa-arrows-up-down text-[11px]"></i>
          </button>
          
          {/* ПЕРЕКЛЮЧАТЕЛЬ БОРДЕРА ДЛЯ НАВЕДЕННОЙ ТАБЛИЦЫ */}
          <button
            onClick={() => {
              runWithoutScroll(() => {
                const tablePos = findTablePos();
                if (tablePos === -1) return;
                
                const tableNode = editor.state.doc.nodeAt(tablePos);
                if (!tableNode) return;
                
                const isBordered = tableNode.attrs.bordered || false;
                
                editor.chain().focus().command(({ tr, dispatch }) => {
                  if (!dispatch) return true;
                  tr.setNodeMarkup(tablePos, null, {
                    ...tableNode.attrs,
                    bordered: !isBordered,
                  });
                  return true;
                }).run();
              });
            }}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
            title={t('toggleBorder')}
          >
            <i className="fa-solid fa-border-all text-[11px]"></i>
          </button>
          <button
            onClick={() => {
              if (hoveredTable) {
                const htmlContent = hoveredTable.outerHTML;
                const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
                const textBlob = new Blob([htmlContent], { type: 'text/plain' });
                const clipboardItem = new ClipboardItem({
                  'text/html': htmlBlob,
                  'text/plain': textBlob,
                });
                navigator.clipboard.write([clipboardItem]).catch((err) => console.error(t('copyTableError'), err));
              }
            }}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
            title={t('copyTable')}
          >
            <i className="fa-solid fa-copy text-[11px]"></i>
          </button>
          <button
            onClick={() => {
              runWithoutScroll(() => {
                const tablePos = findTablePos();
                if (tablePos === -1) return;
                
                const tableNode = editor.state.doc.nodeAt(tablePos);
                if (!tableNode) return;
                
                editor.chain().focus().command(({ tr, dispatch }) => {
                  if (!dispatch) return true;
                  // Удаляем узел именно той таблицы, над которой мышь
                  tr.delete(tablePos, tablePos + tableNode.nodeSize);
                  return true;
                }).run();
              });
            }}
            className="w-4 h-4 rounded flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors"
            title={t('deleteTable')}
          >
            <i className="fa-solid fa-xmark text-[11px]"></i>
          </button>
        </div>
      )}
    </div>,
    document.body
  );
};

export default TableHoverMenu;