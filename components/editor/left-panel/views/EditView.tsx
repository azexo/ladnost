// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useStore } from '@/store/useStore';
import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl'; // Импортируем хук next-intl
import { scrollAndHighlightInEditor } from '@/components/editor/editorExtensions';
import { DataType } from '@/lib/types';

const generateYaml = (props: any[], answers: Record<number, any>, tableAnswers: Record<number, Record<number, any>>, secs: any[]) => {
  let yamlStr = "properties:\n";
  const tableSectionIds = new Set(secs.filter(s => s.is_table).map(s => s.id));
  const flatProps = props.filter(p => !p.section_id || !tableSectionIds.has(p.section_id));
  const tableProps = props.filter(p => p.section_id && tableSectionIds.has(p.section_id));

  flatProps.forEach(p => {
    const rawAnswer = answers[p.id] ?? p.default_value ?? '';
    const safeAnswer = String(rawAnswer).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const safeName = String(p.name).replace(/"/g, '\\"');
    const safeHint = p.hint ? String(p.hint).replace(/"/g, '\\"') : null;
    
    yamlStr += `  - identifier: "${p.identifier}"\n`;
    yamlStr += `    name: "${safeName}"\n`;
    yamlStr += `    hint: ${safeHint !== null ? `"${safeHint}"` : 'null'}\n`;
    yamlStr += `    answer: "${safeAnswer}"\n`;
  });

  if (tableProps.length > 0) {
    yamlStr += "\ntables:\n";
    const tableSections = secs.filter(s => s.is_table && tableProps.some(p => p.section_id === s.id));
    
    tableSections.forEach(sec => {
      yamlStr += `  - section_name: "${sec.name.replace(/"/g, '\\"')}"\n`;
      yamlStr += `    rows:\n`;
      const cols = tableProps.filter(p => p.section_id === sec.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const rowIndices = new Set<number>();
      
      cols.forEach(col => {
        if (tableAnswers[col.id]) {
          Object.keys(tableAnswers[col.id]).forEach(rIdx => rowIndices.add(Number(rIdx)));
        }
      });
      
      const sortedRows = Array.from(rowIndices).sort((a, b) => a - b);
      if (sortedRows.length === 0) {
        yamlStr += `      []\n`;
      } else {
        sortedRows.forEach(rIdx => {
          yamlStr += `      - row_index: ${rIdx}\n`;
          yamlStr += `        cells:\n`;
          cols.forEach(col => {
            const rawAnswer = tableAnswers[col.id]?.[rIdx] ?? '';
            const safeAnswer = String(rawAnswer).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
            yamlStr += `          - identifier: "${col.identifier}"\n`;
            yamlStr += `            answer: "${safeAnswer}"\n`;
          });
        });
      }
    });
  }
  return yamlStr;
};

const parseYaml = (yamlStr: string) => {
  console.log('%c[YAML PARSER] 🔍 Начало парсинга...', 'color: blue; font-weight: bold;');
  const flatResults: Record<string, any> = {};
  const tableResults: Record<string, { row_index: number, cells: Record<string, any> }[]> = {};
  const lines = yamlStr.split('\n');
  
  let currentSection: 'properties' | 'tables' | null = null;
  let currentTable: { section_name: string, rows: any[] } | null = null;
  let currentRow: { row_index: number, cells: Record<string, any> } | null = null;
  let currentProp: { identifier: string, answer: string } | null = null;
  let currentCell: { identifier: string, answer: string } | null = null;

  const unescape = (str: string) => {
    str = str.trim();
    if (str.startsWith('"') && str.endsWith('"')) str = str.slice(1, -1);
    return str.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'properties:') {
      currentSection = 'properties';
      currentTable = null;
      continue;
    }
    if (trimmed === 'tables:') {
      currentSection = 'tables';
      currentProp = null;
      continue;
    }

    if (currentSection === 'properties') {
      if (trimmed.startsWith('- identifier:')) {
        if (currentProp) flatResults[currentProp.identifier] = currentProp.answer;
        currentProp = { identifier: unescape(trimmed.substring('- identifier:'.length)), answer: '' };
      } else if (trimmed.startsWith('answer:') && currentProp) {
        currentProp.answer = unescape(trimmed.substring('answer:'.length));
      }
    } else if (currentSection === 'tables') {
      if (trimmed.startsWith('- section_name:')) {
        if (currentCell && currentRow) currentRow.cells[currentCell.identifier] = currentCell.answer;
        if (currentRow && currentTable) currentTable.rows.push(currentRow);
        if (currentTable) tableResults[currentTable.section_name] = currentTable.rows;
        currentTable = { section_name: unescape(trimmed.substring('- section_name:'.length)), rows: [] };
        currentRow = null;
        currentCell = null;
      } else if (trimmed.startsWith('- row_index:') && currentTable) {
        if (currentCell && currentRow) currentRow.cells[currentCell.identifier] = currentCell.answer;
        if (currentRow) currentTable.rows.push(currentRow);
        const rIdxStr = trimmed.substring('- row_index:'.length).trim();
        const rIdx = parseInt(rIdxStr, 10);
        currentRow = { row_index: isNaN(rIdx) ? 0 : rIdx, cells: {} };
        currentCell = null;
      } else if (trimmed.startsWith('- identifier:') && currentRow) {
        if (currentCell) currentRow.cells[currentCell.identifier] = currentCell.answer;
        currentCell = { identifier: unescape(trimmed.substring('- identifier:'.length)), answer: '' };
      } else if (trimmed.startsWith('answer:') && currentCell) {
        currentCell.answer = unescape(trimmed.substring('answer:'.length));
      }
    }
  }

  if (currentSection === 'properties' && currentProp) {
    flatResults[currentProp.identifier] = currentProp.answer;
  }
  if (currentSection === 'tables') {
    if (currentCell && currentRow) currentRow.cells[currentCell.identifier] = currentCell.answer;
    if (currentRow && currentTable) currentTable.rows.push(currentRow);
    if (currentTable) tableResults[currentTable.section_name] = currentTable.rows;
  }

  console.log('%c[YAML PARSER] ✅ Парсинг завершен.', 'color: green; font-weight: bold;', {
    flatCount: Object.keys(flatResults).length,
    tableCount: Object.keys(tableResults).length
  });

  return { flatResults, tableResults };
};

const debounce = (func: Function, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const EditView = () => {
  // Инициализация переводов для неймспейса EditView
  const t = useTranslations('EditView');

  const {
    properties,
    sections,
    collapsedSections,
    toggleSectionCollapse,
    currentAnswers,
    currentConditions,
    currentTableAnswers,
    updateAnswer,
    getTableDataBySectionId,
    updateTableAnswer,
  } = useStore((s: any) => s.data);

  const [isYamlModalOpen, setIsYamlModalOpen] = useState(false);
  const [yamlText, setYamlText] = useState('');
  const [activeTableSectionId, setActiveTableSectionId] = useState<number | null>(null);
  const highlightTarget = useStore((s: any) => s.ui.highlightTarget);

  const visibleProperties = useMemo(() => {
    return properties.filter((p: any) => {
      if (p.hide_in_form) return false;
      if (p.display_condition_id) {
        return currentConditions[p.display_condition_id] === true;
      }
      return true;
    });
  }, [properties, currentConditions]);

  const groupedProperties = useMemo(() => {
    const groups: Record<string, any[]> = { '0': [] };
    sections.forEach((sec: any) => {
      groups[String(sec.id)] = [];
    });
    visibleProperties.forEach((prop: any) => {
      const secId = prop.section_id ? String(prop.section_id) : '0';
      if (!groups[secId]) groups[secId] = [];
      groups[secId].push(prop);
    });
    Object.keys(groups).forEach(key => {
      groups[key].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    });
    return groups;
  }, [visibleProperties, sections]);

  const requiredProps = visibleProperties.filter((p: any) => p.is_required);
  const requiredCount = requiredProps.length;
  const filledCount = requiredProps.filter((p: any) => {
    const val = currentAnswers[p.id];
    return val !== undefined && val !== null && String(val).trim() !== '';
  }).length;
  
  const progress = requiredCount > 0 ? (filledCount / requiredCount) * 100 : 100;
  const sortedSections = [...sections].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

  const debouncedHighlight = useMemo(() =>
    debounce((identifier: string) => {
      scrollAndHighlightInEditor(identifier);
    }, 300),
  []);

  const renderField = (prop: any) => {
    const value = currentAnswers[prop.id] ?? prop.default_value ?? '';
    const baseInputClass = "w-full px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow";
    const inputType = String(prop.text_input_type || 'SHORT').toUpperCase();

    const handleChange = (newValue: any) => {
      updateAnswer(prop.id, newValue);
      if (prop.identifier) {
        debouncedHighlight(prop.identifier);
      }
    };

    if (inputType === 'LIST') {
      if (prop.options && Array.isArray(prop.options) && prop.options.length > 0) {
        return (
          <div className="flex flex-col gap-2 py-1">
            {prop.options.map((opt: any, idx: number) => {
              const optValue = typeof opt === 'object' ? (opt.value ?? opt.id) : opt;
              const optLabel = typeof opt === 'object' ? (opt.label ?? opt.name) : opt;
              return (
                <label key={idx} className="flex items-center space-x-2 cursor-pointer group">
                  <input
                    type="radio"
                    name={`radio-group-${prop.id}`}
                    value={optValue}
                    checked={String(value) === String(optValue)}
                    onChange={(e) => handleChange(e.target.value)}
                    className="w-4 h-4 text-primary-600 bg-gray-100 border-gray-300 focus:ring-primary-500 focus:ring-2"
                  />
                  <span className="text-xs text-slate-700 group-hover:text-slate-900 transition-colors">
                    {optLabel}
                  </span>
                </label>
              );
            })}
          </div>
        );
      }
    }

    if (prop.data_type === DataType.MONEY) {
      return (
        <div className="relative">
          <input
            type="number"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={prop.placeholder || ''}
            className={`${baseInputClass} pl-3 pr-7`}
          />
          <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
            <span className="text-slate-400 text-xs">₽</span>
          </div>
        </div>
      );
    }

    if (prop.data_type === 'date' || prop.data_type === 'DATE') {
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className={baseInputClass}
        />
      );
    }

    if (prop.data_type === 'boolean' || prop.data_type === 'BOOLEAN') {
      return (
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleChange(e.target.checked)}
            className="w-4 h-4 text-primary-600 bg-gray-100 border-gray-300 rounded focus:ring-primary-500"
          />
          <span className="text-xs text-slate-700">{t('yes')}</span>
        </label>
      );
    }

    if (inputType === 'LONG' || inputType === 'TEXTAREA' || inputType === 'PARAGRAPH') {
      return (
        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={prop.placeholder || ''}
          rows={3}
          className={`${baseInputClass} resize-y min-h-[60px]`}
        />
      );
    }

    return (
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={prop.placeholder || ''}
        className={baseInputClass}
      />
    );
  };

  const renderTableCell = (prop: any, rowIndex: number, value: any, onChange: (val: any) => void) => {
    const baseInputClass = "w-full px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow";
    const inputType = String(prop.text_input_type || 'SHORT').toUpperCase();
    const safeValue = value == null ? '' : String(value);

    if (inputType === 'LIST' && prop.options && Array.isArray(prop.options) && prop.options.length > 0) {
      return (
        <select
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        >
          <option value="">—</option>
          {prop.options.map((opt: any, idx: number) => {
            const optValue = typeof opt === 'object' ? (opt.value ?? opt.id) : opt;
            const optLabel = typeof opt === 'object' ? (opt.label ?? opt.name) : opt;
            return <option key={idx} value={optValue}>{optLabel}</option>;
          })}
        </select>
      );
    }

    if (prop.data_type === DataType.MONEY || prop.data_type === DataType.NUMBER) {
      return (
        <div className="relative">
          <input
            type="number"
            value={safeValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={prop.placeholder || ''}
            className={`${baseInputClass} ${prop.data_type === DataType.MONEY ? 'pr-6' : ''}`}
          />
          {(prop.data_type === DataType.MONEY) && (
            <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
              <span className="text-slate-400 text-[10px]">₽</span>
            </div>
          )}
        </div>
      );
    }

    if (prop.data_type === 'date' || prop.data_type === 'DATE') {
      return (
        <input
          type="date"
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        />
      );
    }

    if (prop.data_type === 'boolean' || prop.data_type === 'BOOLEAN') {
      return (
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 text-primary-600 bg-gray-100 border-gray-300 rounded focus:ring-primary-500"
          />
        </div>
      );
    }

    return (
      <input
        type="text"
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={prop.placeholder || ''}
        className={baseInputClass}
      />
    );
  };

  const renderSection = (sectionId: string, title: string) => {
    const props = groupedProperties[sectionId];
    if (!props || props.length === 0) return null;
    const collapseId = sectionId === '0' ? 0 : Number(sectionId);
    const isCollapsed = !!collapsedSections[collapseId];

    return (
      <div key={sectionId} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => toggleSectionCollapse(collapseId)}
          className="w-full flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        >
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{title}</h3>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {!isCollapsed && (
          <div className="p-3 space-y-4 border-t border-slate-100">
            {props.map((prop: any) => (
              <div key={prop.id} data-prop-id={prop.id} className="scroll-mt-20">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {prop.name} {prop.is_required && <span className="text-red-500">*</span>}
                </label>
                {renderField(prop)}
                {prop.hint && (
                  <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed">
                    {prop.hint}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderTableSection = (sectionId: string, section: any) => {
    const props = groupedProperties[sectionId];
    if (!props || props.length === 0) return null;
    const collapseId = Number(sectionId);
    const isCollapsed = !!collapsedSections[collapseId];

    const tableData = getTableDataBySectionId(section.id);
    const rowCount = tableData.rows.length;

    return (
      <div key={sectionId} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => toggleSectionCollapse(collapseId)}
          className="w-full flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{section.name}</h3>
            <span className="text-[10px] font-semibold text-primary-600 bg-primary-50 p-1 rounded">
              <i className="fa-solid fa-table text-[9px]"></i>
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {!isCollapsed && (
          <div className="p-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setActiveTableSectionId(section.id)}
              className="w-full flex items-center justify-center gap-2 p-2 bg-primary-50 hover:bg-primary-100 border border-primary-200 text-primary-700 text-xs font-semibold rounded-lg transition-colors"
            >
              <i className="fa-solid fa-table-cells text-sm"></i>
              {t('editTable')}
              {rowCount > 0 && (
                <span className="text-[10px] font-medium text-primary-500 ml-1">
                  ({t('rowsCount', { count: rowCount })})
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  const activeTableSection = useMemo(() => {
    if (activeTableSectionId === null) return null;
    return sections.find((s: any) => s.id === activeTableSectionId) || null;
  }, [activeTableSectionId, sections]);

  const activeTableColumns = useMemo(() => {
    if (!activeTableSection) return [];
    return groupedProperties[String(activeTableSection.id)] || [];
  }, [activeTableSection, groupedProperties]);

  const activeTableData = useMemo(() => {
    if (!activeTableSection) return { columns: [], rows: [] };
    return getTableDataBySectionId(activeTableSection.id);
  }, [activeTableSection, currentTableAnswers]);

  const handleAddTableRow = () => {
    if (!activeTableSection) return;
    const rows = activeTableData.rows;
    const existingIndexes = rows.map((r: any) => r.rowIndex);
    let newRowIdx = 1;
    while (existingIndexes.includes(newRowIdx)) newRowIdx++;

    activeTableColumns.forEach((col: any) => {
      updateTableAnswer(col.id, newRowIdx, '', true);
    });
  };

  const handleDeleteTableRow = (rowIndex: number) => {
    if (!activeTableSection) return;
    activeTableColumns.forEach((col: any) => {
      updateTableAnswer(col.id, rowIndex, null, true);
    });
  };

  const handleCloseTableModal = async () => {
    try {
      await useStore.getState().data.saveAnswersToApi();
      setActiveTableSectionId(null);
    } catch (e) {
      console.error('[DEBUG SAVE] Ошибка сохранения таблицы:', e);
    }
  };

  useEffect(() => {
    if (activeTableSectionId === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseTableModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTableSectionId]);

  useEffect(() => {
    if (highlightTarget && highlightTarget.type === 'property') {
      const el = document.querySelector(`[data-prop-id="${highlightTarget.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('card-highlight-flash');
        setTimeout(() => {
          el.classList.remove('card-highlight-flash');
        }, 1500);
      }
    }
  }, [highlightTarget]);

  return (
    <div id="edit-view" className="flex flex-col absolute inset-0 bg-surface">
      {/* ШАПКА ПАНЕЛИ */}
      <div className="p-4 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold text-slate-800">{t('title')}</h2>
          
          {/* КНОПКА РЕДАКТИРОВАНИЯ YAML */}
          <button
            type="button"
            onClick={() => {
              setYamlText(generateYaml(visibleProperties, currentAnswers, currentTableAnswers, sections));
              setIsYamlModalOpen(true);
            }}
            className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-slate-100 rounded-md transition-colors"
            title={t('yamlEditTooltip')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
        
        <div className="flex justify-between text-[11px] font-medium text-slate-500 mb-1.5">
          <span>{t('progress')}</span>
          <span className="text-primary-600 font-semibold">
            {t('progressText', { filledCount, requiredCount })}
          </span>
        </div>
        
        <div className="w-full bg-slate-100 rounded-full h-1.5">
          <div
            className="bg-green-500 h-1.5 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* СПИСОК СЕКЦИЙ */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 pb-32">
        {sortedSections.map((sec: any) => {
          if (sec.is_table) {
            return renderTableSection(String(sec.id), sec);
          }
          return renderSection(String(sec.id), sec.name);
        })}
        {renderSection('0', t('noSection'))}
      </div>

      {/* МОДАЛЬНОЕ ОКНО YAML ЧЕРЕЗ ПОРТАЛ */}
      {isYamlModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg overflow-hidden shadow-xl w-full max-w-2xl h-[85vh] flex flex-col m-4">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-800">{t('yamlEditTitle')}</h3>
              <button
                onClick={() => setIsYamlModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <textarea
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                className="min-h-[60vh] w-full h-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder={t('yamlPlaceholder')}
                spellCheck={false}
              />
            </div>
            <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50">
              <p className="text-[11px] text-slate-500">
                {t.rich('yamlHint', { 
                  code: (chunks) => <code className="px-1 py-0.5 bg-slate-200 rounded text-primary-700">{chunks}</code> 
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsYamlModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    console.group('%c[YAML EDITOR] 🚀 Начало обработки YAML', 'color: purple; font-weight: bold;');
                    console.log('📥 Исходный текст YAML:', yamlText);
                    
                    const { flatResults, tableResults } = parseYaml(yamlText);
                    console.log('📦 Результат парсинга:', { flatResults, tableResults });

                    visibleProperties.forEach((p: any) => {
                      if (flatResults[p.identifier] !== undefined) {
                        updateAnswer(p.id, flatResults[p.identifier]);
                      }
                    });

                    const storeState = useStore.getState();
                    const allTableSections = storeState.data.sections.filter((s: any) => s.is_table);
                    allTableSections.forEach((sec: any) => {
                      const tableProps = storeState.data.properties.filter((p: any) => p.section_id === sec.id);
                      if (tableProps.length === 0) return;

                      const existingRowIndices = new Set<number>();
                      tableProps.forEach((col: any) => {
                        const rowData = storeState.data.currentTableAnswers[col.id];
                        if (rowData) {
                          Object.keys(rowData).forEach((rIdx) => existingRowIndices.add(Number(rIdx)));
                        }
                      });

                      const newYamlRows = tableResults[sec.name] || [];
                      const newYamlRowIndices = new Set(newYamlRows.map((r: any) => r.row_index));

                      existingRowIndices.forEach((rIdx) => {
                        if (!newYamlRowIndices.has(rIdx)) {
                          tableProps.forEach((col: any) => {
                            updateTableAnswer(col.id, rIdx, null, true);
                          });
                        }
                      });

                      newYamlRows.forEach((row: any) => {
                        tableProps.forEach((col: any) => {
                          const cellData = row.cells[col.identifier];
                          if (cellData !== undefined) {
                            updateTableAnswer(col.id, row.row_index, cellData, true);
                          } else {
                            updateTableAnswer(col.id, row.row_index, null, true);
                          }
                        });
                      });
                    });

                    useStore.getState().data.saveAnswersToApi();
                    setIsYamlModalOpen(false);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700 transition-colors shadow-sm"
                >
                  {t('fillForm')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ТАБЛИЦЫ */}
      {activeTableSectionId !== null && activeTableSection && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => handleCloseTableModal()}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Шапка модалки */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center">
                  <i className="fa-solid fa-table-cells text-primary-600"></i>
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">{activeTableSection.name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('columnsCount', { count: activeTableColumns.length })} · {t('rowsCount', { count: activeTableData.rows.length })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleCloseTableModal()}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Тело таблицы */}
            <div className="flex-1 overflow-auto bg-slate-50">
              {activeTableColumns.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                    <i className="fa-solid fa-table-cells-slash text-slate-400 text-xl"></i>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{t('noColumns')}</p>
                  <p className="text-xs text-slate-500 mt-1">{t('noColumnsHint')}</p>
                </div>
              ) : (
                <div className="p-4">
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="sticky left-0 bg-slate-50 z-10 text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-12 border-r border-slate-200">
                              #
                            </th>
                            {activeTableColumns.map((col: any) => (
                              <th
                                key={col.id}
                                className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-700 uppercase tracking-wider min-w-[160px] border-r border-slate-100 last:border-r-0"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate">{col.name}</span>
                                  {col.is_required && <span className="text-red-500">*</span>}
                                </div>
                                {col.hint && (
                                  <div className="text-[10px] font-normal normal-case text-slate-400 mt-0.5 tracking-normal">
                                    {col.hint}
                                  </div>
                                )}
                              </th>
                            ))}
                            <th className="w-10 px-2 py-2.5"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeTableData.rows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={activeTableColumns.length + 2}
                                className="px-4 py-10 text-center text-slate-400"
                              >
                                <div className="flex flex-col items-center gap-2">
                                  <i className="fa-solid fa-inbox text-2xl text-slate-300"></i>
                                  <span className="text-xs">{t('tableEmpty')}</span>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            activeTableData.rows
                              .sort((a: any, b: any) => a.rowIndex - b.rowIndex)
                              .map((row: any, displayIdx: number) => (
                                <tr key={row.rowIndex} className="hover:bg-slate-50/60 group">
                                  <td className="sticky left-0 bg-white group-hover:bg-slate-50/60 px-3 py-2 text-slate-400 font-semibold border-r border-slate-200">
                                    {displayIdx + 1}
                                  </td>
                                  {activeTableColumns.map((col: any, colIdx: number) => (
                                    <td key={col.id} className="px-2 py-1.5 border-r border-slate-100 last:border-r-0">
                                      {renderTableCell(
                                        col,
                                        row.rowIndex,
                                        row.cells[col.id],
                                        (val) => updateTableAnswer(col.id, row.rowIndex, val, true)
                                      )}
                                    </td>
                                  ))}
                                  <td className="px-2 py-1.5 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTableRow(row.rowIndex)}
                                      className="w-7 h-7 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center"
                                      title={t('deleteRow')}
                                    >
                                      <i className="fa-solid fa-trash text-xs"></i>
                                    </button>
                                  </td>
                                </tr>
                              ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Футер модалки */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <i className="fa-solid fa-circle-info text-slate-400"></i>
                {t('autoSaveHint')}
              </p>
              <div className="flex items-center gap-2">
                {activeTableColumns.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAddTableRow}
                    className="px-3 py-2 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-plus text-[10px]"></i>
                    {t('addRow')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await useStore.getState().data.saveAnswersToApi();
                      setActiveTableSectionId(null);
                    } catch (e) {
                      console.error('[DEBUG SAVE] Ошибка сохранения таблицы:', e);
                      alert(t('saveError'));
                    }
                  }}
                  className="px-4 py-2 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm"
                >
                  {t('done')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};