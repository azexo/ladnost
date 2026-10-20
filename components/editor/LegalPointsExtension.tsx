// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/LegalPointsExtension.tsx
import { Extension, Node, mergeAttributes, Editor, InputRule } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { useStore } from '@/store/useStore';
import { getT } from '@/store/i18nStore'; // 🆕 Импортируем геттер для использования вне React
import { useTranslations } from 'next-intl'; // 🆕 Импортируем хук для React-компонентов
import { Plugin, PluginKey } from 'prosemirror-state';
import React, { useState, useEffect, useRef } from 'react';

// ==========================================
// ТИПЫ И КОМАНДЫ
// ==========================================
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    legalPoints: {
      insertNextLegalPoint: () => ReturnType;
      indentLegalPoint: () => ReturnType;
      outdentLegalPoint: () => ReturnType;
      toggleLegalPointVisibility: (uuid: string, isVisible: boolean) => ReturnType;
      insertClauseRef: (targetUuid: string) => ReturnType;
    };
  }
}

// ==========================================
// 1. НОДА: Пункт документа (Абсолютно прозрачная стилизация)
// ==========================================
export const LegalPoint = Node.create({
  name: 'legalPoint',
  group: 'inline',
  inline: true,
  atom: true, 
  defining: true,
  addAttributes() {
    return {
      uuid: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-point-uuid'),
        renderHTML: (a) => ({ 'data-point-uuid': a.uuid })
      },
      level: {
        default: 1,
        parseHTML: (el) => parseInt(el.getAttribute('data-level') || '1'),
        renderHTML: (a) => ({ 'data-level': a.level })
      },
      number: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-number'),
        renderHTML: (a) => ({ 'data-number': a.number })
      },
      isVisible: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-is-visible') !== 'false',
        renderHTML: (a) => ({ 'data-is-visible': a.isVisible })
      }
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-point-uuid]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const number = node.attrs.number || '';
    return ['span', mergeAttributes(HTMLAttributes, {
      class: 'legal-point-inline',
      style: !node.attrs.isVisible ? 'display: none;' : ''
    }), number ? `${number}. ` : ''];
  },
  addNodeView() {
    return ({ node }) => {
      const isVisible = node.attrs.isVisible;
      const number = node.attrs.number || '';
      const level = node.attrs.level || 1;

      const dom = document.createElement('span');
      dom.className = 'legal-point-inline inline';
      dom.style.display = isVisible ? 'inline' : 'none';
      dom.setAttribute('data-point-uuid', node.attrs.uuid);
      dom.setAttribute('data-level', String(level));
      dom.setAttribute('data-number', number);
      dom.setAttribute('data-is-visible', String(isVisible));

      const numberEl = document.createElement('span');
      numberEl.contentEditable = 'false';
      numberEl.className = 'inline';
      numberEl.textContent = number ? `${number}.` : '';
      numberEl.style.marginRight = '4px'; 
      dom.appendChild(numberEl);

      return { dom };
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\d+.\s$/,
        handler: ({ range, chain }) => {
          chain()
            .deleteRange(range) 
            .insertContent({    
              type: 'legalPoint',
              attrs: {
                uuid: `pt_${Math.random().toString(36).substring(2, 11)}`,
                level: 1,
                isVisible: true
              }
            })
            .run();
        }
      })
    ];
  },
  addCommands() {
    return {
      insertNextLegalPoint: () => ({ editor, chain }) => {
        const { state } = editor;
        const { $from } = state.selection;
        
        let blockDepth = $from.depth;
        while (blockDepth > 0 && !$from.node(blockDepth).type.isBlock) {
          blockDepth--;
        }
        
        const insertPos = $from.start(blockDepth);
        const currentLevel = editor.getAttributes(this.name).level || 1;

        return chain().insertContentAt(insertPos, {
          type: this.name,
          attrs: {
            uuid: `pt_${Math.random().toString(36).substring(2, 11)}`,
            level: currentLevel,
            isVisible: true
          }
        }).run();
      },
      indentLegalPoint: () => ({ state, dispatch }) => {
        const { $from } = state.selection;
        let blockDepth = $from.depth;
        while (blockDepth > 0 && !$from.node(blockDepth).type.isBlock) {
          blockDepth--;
        }
        const blockPos = $from.before(blockDepth);
        const blockNode = $from.node(blockDepth);
        let targetPos: number | null = null;
        let targetNode: any = null;

        blockNode.descendants((node, offset) => {
          if (node.type.name === 'legalPoint') {
            const absPos = blockPos + offset + 1;
            if ($from.pos >= absPos) {
              targetPos = absPos;
              targetNode = node;
            }
          }
        });

        if (targetNode && targetPos !== null) {
          const currentLevel = targetNode.attrs.level || 1;
          if (currentLevel < 10 && dispatch) {
            dispatch(state.tr.setNodeMarkup(targetPos, undefined, {
              ...targetNode.attrs,
              level: currentLevel + 1
            }));
            return true;
          }
        }
        return false;
      },
      outdentLegalPoint: () => ({ state, dispatch }) => {
        const { $from } = state.selection;
        let blockDepth = $from.depth;
        while (blockDepth > 0 && !$from.node(blockDepth).type.isBlock) {
          blockDepth--;
        }
        const blockPos = $from.before(blockDepth);
        const blockNode = $from.node(blockDepth);
        let targetPos: number | null = null;
        let targetNode: any = null;

        blockNode.descendants((node, offset) => {
          if (node.type.name === 'legalPoint') {
            const absPos = blockPos + offset + 1;
            if ($from.pos >= absPos) {
              targetPos = absPos;
              targetNode = node;
            }
          }
        });

        if (targetNode && targetPos !== null) {
          const currentLevel = targetNode.attrs.level || 1;
          if (currentLevel > 1 && dispatch) {
            dispatch(state.tr.setNodeMarkup(targetPos, undefined, {
              ...targetNode.attrs,
              level: currentLevel - 1
            }));
            return true;
          }
        }
        return false;
      },
      toggleLegalPointVisibility: (uuid: string, isVisible: boolean) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.uuid === uuid) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, isVisible });
            }
          });
        }
        return true;
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      'Tab': () => this.editor.commands.indentLegalPoint(),
      'Shift-Tab': () => this.editor.commands.outdentLegalPoint(),
      'Enter': () => {
        const { state } = this.editor; 
        const { $from } = state.selection;
        const blockNode = $from.node($from.depth);
        let hasLegalPoint = false;
        let level = 1;

        blockNode.descendants(node => {
          if (node.type.name === 'legalPoint') {
            hasLegalPoint = true;
            level = node.attrs.level || 1;
          }
        });

        if (hasLegalPoint) {
          const isBlockEmpty = !blockNode.textContent || blockNode.textContent.trim() === '';
          if (isBlockEmpty) {
            let legalPointPos = null;
            blockNode.descendants((node, offset) => {
              if (node.type.name === 'legalPoint') {
                legalPointPos = $from.start($from.depth) + offset;
              }
            });
            if (legalPointPos !== null) {
              const tr = state.tr.delete(legalPointPos, legalPointPos + 1); 
              this.editor.view.dispatch(tr);
              return true; 
            }
          } else {
            return this.editor.chain()
              .splitBlock() 
              .insertContent({ 
                type: 'legalPoint',
                attrs: {
                  uuid: `pt_${Math.random().toString(36).substring(2, 11)}`,
                  level: level, 
                  isVisible: true
                }
              })
              .run();
          }
        }
        return false; 
      }
    };
  }
});

// ==========================================
// 2. НОДА: Ссылка на пункт (Перекрестная ссылка)
// ==========================================
const ClauseRefComponent = ({ node }: NodeViewProps) => {
  // 🆕 Используем хук next-intl для React-компонента
  const t = useTranslations('LegalPointsExtension');

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        contentEditable={false}
        data-target-uuid={node.attrs.targetUuid}
        data-display-text={node.attrs.displayText}
        className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-medium cursor-pointer hover:bg-indigo-100 transition-colors inline align-baseline"
        onClick={(e) => {
          e.preventDefault();
          const targetEl = document.querySelector(`[data-point-uuid="${node.attrs.targetUuid}"]`);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add('bg-yellow-100');
            setTimeout(() => targetEl.classList.remove('bg-yellow-100'), 1500);
          }
        }}
      >
        {node.attrs.displayText || t('clauseRefFallback')}
      </span>
    </NodeViewWrapper>
  );
};

export const ClauseRef = Node.create({
  name: 'clauseRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      targetUuid: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target-uuid'),
        renderHTML: (attributes) => ({ 'data-target-uuid': attributes.targetUuid })
      },
      displayText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-display-text'),
        renderHTML: (attributes) => ({ 'data-display-text': attributes.displayText })
      }
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-target-uuid]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      class: 'clause-ref',
    }), node.attrs.displayText];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ClauseRefComponent);
  },
  addCommands() {
    return {
      insertClauseRef: (targetUuid: string) => ({ chain }) => {
        return chain().insertContent({
          type: this.name,
          attrs: { targetUuid, displayText: '...' }
        }).run();
      }
    };
  }
});

// ==========================================
// 3. ПЛАГИН: Автоматическая нумерация и обновление ссылок
// ==========================================
const numberingKey = new PluginKey('legalNumbering');
export const LegalNumberingPlugin = Extension.create({
  name: 'legalNumbering',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: numberingKey,
        appendTransaction(transactions, oldState, newState) {
          const hasDocChanges = transactions.some(tr => tr.docChanged);
          if (!hasDocChanges) return null;

          // 🆕 Получаем функцию перевода для использования вне React
          const t = getT(); 
          let tr = newState.tr;
          let modified = false;
          const counters = new Array(20).fill(0);
          const numberMap = new Map<string, string>();

          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'legalPoint') {
              const isVisible = node.attrs.isVisible;
              const level = node.attrs.level - 1;
              if (isVisible && level >= 0 && level < counters.length) {
                counters[level]++;
                for (let i = level + 1; i < counters.length; i++) {
                  counters[i] = 0;
                }
                const numStr = counters.slice(0, level + 1).join('.');
                if (node.attrs.number !== numStr) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: numStr });
                  modified = true;
                }
                numberMap.set(node.attrs.uuid, numStr);
              }
            }
          });

          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'clauseRef') {
              const targetId = node.attrs.targetUuid;
              const actualNumber = numberMap.get(targetId);
              
              // 🆕 Используем переводы с интерполяцией
              let newText = actualNumber 
                ? t('clauseRefText', { number: actualNumber }) 
                : t('clauseRefHidden');

              if (node.attrs.displayText !== newText) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, displayText: newText });
                modified = true;
              }
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

// ==========================================
// 4. УТИЛИТА: Оценка видимости пунктов (Интеграция со слотами)
// ==========================================
export const recalculatePointsVisibility = (editor: Editor | null) => {
  if (!editor) return;
  const { state, dispatch } = editor.view;
  const tr = state.tr;
  let modified = false;
  const activeIds: string[] = useStore.getState().data.activeFormulationIdentifiers || [];

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'legalPoint') {
      const $pos = state.doc.resolve(pos);
      let blockDepth = $pos.depth;
      while (blockDepth > 0 && !$pos.node(blockDepth).type.isBlock) {
        blockDepth--;
      }
      const blockPos = $pos.before(blockDepth);
      const blockNode = $pos.node(blockDepth);
      let hasSlots = false;
      let hasActiveSlots = false;

      blockNode.descendants((child) => {
        if (child.type.name === 'formulationSlot') {
          hasSlots = true;
          const identifier = child.attrs.identifier as string;
          if (identifier && activeIds.includes(identifier)) {
            hasActiveSlots = true;
          }
        }
      });

      const shouldBeVisible = !hasSlots || hasActiveSlots;
      const currentVisibility = node.attrs.isVisible as boolean | undefined;
      if (currentVisibility !== shouldBeVisible) {
        tr.setNodeMarkup(pos, null, {
          ...node.attrs,
          isVisible: shouldBeVisible
        });
        modified = true;
      }

      const blockCurrentVisibility = blockNode.attrs.isVisible !== false;
      if (blockCurrentVisibility !== shouldBeVisible) {
        tr.setNodeMarkup(blockPos, null, {
          ...blockNode.attrs,
          isVisible: shouldBeVisible
        });
        modified = true;
      }
    }
  });

  if (modified) {
    dispatch(tr);
  }
};

// ==========================================
// 5. ПЛАГИН: Конвертация текстовых номеров в legalPoint
// ==========================================
const textNumberKey = new PluginKey('textNumberToLegalPoint');
export const TextNumberToLegalPointPlugin = Extension.create({
  name: 'textNumberToLegalPoint',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: textNumberKey,
        appendTransaction(transactions, oldState, newState) {
          const hasDocChanges = transactions.some(tr => tr.docChanged);
          if (!hasDocChanges) return null;

          const tr = newState.tr;
          let modified = false;
          const numberPattern = /^(\d+(?:\.\d+)*)\.\s/;
          const toConvert: { pos: number; matchLen: number; level: number }[] = [];

          newState.doc.descendants((node, pos) => {
            if (!node.isBlock) return; 
            if (node.type.name === 'codeBlock') return;

            let hasLP = false;
            node.descendants(c => {
              if (c.type.name === 'legalPoint') hasLP = true;
            });
            if (hasLP) return;

            const first = node.firstChild;
            if (!first || !first.isText) return;
            const m = (first.text || '').match(numberPattern);
            if (!m) return;

            const level = m[1].split('.').length;
            toConvert.push({ pos, matchLen: m[0].length, level });
          });

          for (let i = toConvert.length - 1; i >= 0; i--) {
            const { pos, matchLen, level } = toConvert[i];
            const textStart = pos + 1; 

            const lp = newState.schema.nodes.legalPoint.create({
              uuid: `pt_${Math.random().toString(36).substring(2, 11)}`,
              level,
              isVisible: true,
            });

            tr.delete(textStart, textStart + matchLen);
            tr.insert(textStart, lp);
            modified = true;
          }
          return modified ? tr : null;
        },
      }),
    ];
  },
});

const listToLegalPointKey = new PluginKey('listToLegalPoint');
export const ListToLegalPointPlugin = Extension.create({
  name: 'listToLegalPoint',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: listToLegalPointKey,
        appendTransaction(transactions, oldState, newState) {
          const hasDocChanges = transactions.some(tr => tr.docChanged);
          if (!hasDocChanges) return null;

          let hasOrderedLists = false;
          newState.doc.descendants(node => {
            if (node.type.name === 'orderedList') {
              hasOrderedLists = true;
              return false; 
            }
          });
          if (!hasOrderedLists) return null;

          const tr = newState.tr;
          const listsToReplace: { node: any; pos: number }[] = [];

          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'orderedList') {
              listsToReplace.push({ node, pos });
            }
          });

          for (let i = listsToReplace.length - 1; i >= 0; i--) {
            const { node: listNode, pos: listPos } = listsToReplace[i];
            const newParagraphs: any[] = [];

            const processListItem = (itemNode: any, level: number) => {
              itemNode.content.forEach((child: any) => {
                if (child.type.name === 'orderedList') {
                  child.content.forEach((nestedItem: any) => {
                    if (nestedItem.type.name === 'listItem') {
                      processListItem(nestedItem, level + 1);
                    }
                  });
                } else if (child.isBlock) {
                  const legalPt = newState.schema.nodes.legalPoint.create({
                    uuid: `pt_${Math.random().toString(36).substring(2, 11)}`,
                    level: level,
                    isVisible: true
                  });
                  const contentArray = [legalPt, ...child.content.content];
                  const newPara = newState.schema.nodes.paragraph.create(
                    child.attrs, 
                    contentArray
                  );
                  newParagraphs.push(newPara);
                }
              });
            };

            listNode.content.forEach((itemNode: any) => {
              if (itemNode.type.name === 'listItem') {
                processListItem(itemNode, 1);
              }
            });

            if (newParagraphs.length > 0) {
              tr.replaceWith(listPos, listPos + listNode.nodeSize, newParagraphs);
            } else {
              tr.delete(listPos, listPos + listNode.nodeSize);
            }
          }
          return tr;
        },
      }),
    ];
  },
});

// ==========================================
// 🆕 КОМПОНЕНТ ДРОПДАУНА ПЕРЕКРЕСТНЫХ ССЫЛОК
// ==========================================
interface ClauseRefDropdownProps {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ClauseRefDropdown = ({ editor, isOpen, onClose }: ClauseRefDropdownProps) => {
  // 🆕 Используем хук next-intl
  const t = useTranslations('LegalPointsExtension');
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    } else if (!isOpen) {
      setSearch('');
    }
  }, [isOpen]);

  if (!isOpen || !editor) return null;

  const points: { uuid: string; number: string; text: string; level: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'legalPoint') {
      const isVisible = node.attrs.isVisible !== false;
      if (isVisible) {
        const $pos = editor.state.doc.resolve(pos);
        let blockText = '';
        for (let d = $pos.depth; d > 0; d--) {
          const parent = $pos.node(d);
          if (parent.type.isBlock) {
            blockText = parent.textContent.trim();
            break;
          }
        }
        points.push({
          uuid: node.attrs.uuid,
          number: node.attrs.number || '',
          text: blockText || node.textContent.trim() || t('dropdownEmptyPoint'), // 🆕 Перевод
          level: node.attrs.level || 1,
        });
      }
    }
  });

  const searchLower = search.toLowerCase();
  const filteredPoints = points.filter(p =>
    p.number.toLowerCase().includes(searchLower) ||
    p.text.toLowerCase().includes(searchLower)
  );

  const handleSelect = (uuid: string) => {
    if (!editor) return;
    editor.chain().focus().insertClauseRef(uuid).run();
    onClose();
  };

  return (
    <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-[100] flex flex-col max-h-96 overflow-hidden">
      {/* Блок поиска */}
      <div className="p-2 border-b border-slate-100 bg-slate-50/50">
        <div className="relative">
          <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
          <input
            ref={inputRef}
            type="text"
            placeholder={t('dropdownSearchPlaceholder')} // 🆕 Перевод
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-100 bg-white transition-all"
          />
        </div>
      </div>

      {/* Список пунктов */}
      <div className="overflow-y-auto flex-1 py-1 custom-scrollbar">
        {filteredPoints.length === 0 ? (
          <div className="px-3 py-6 text-xs text-slate-400 text-center flex flex-col items-center gap-1.5">
            <i className="fa-solid fa-folder-open text-slate-300 text-lg"></i>
            {/* 🆕 Переводы */}
            <span>{search ? t('dropdownNoResults') : t('dropdownNoPoints')}</span>
          </div>
        ) : (
          filteredPoints.map(p => (
            <button
              key={p.uuid}
              onClick={() => handleSelect(p.uuid)}
              className="w-full text-left px-3 py-2 hover:bg-primary-50 transition-colors flex flex-col gap-1 border-b border-slate-50 last:border-0 group"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded group-hover:bg-primary-100 transition-colors">
                  {/* 🆕 Перевод префикса */}
                  {t('pointPrefix')} {p.number}
                </span>
                <span className="text-[10px] text-slate-400 flex gap-0.5">
                  {Array.from({ length: p.level }).map((_, i) => (
                    <span key={i} className="w-1 h-1 rounded-full bg-slate-300"></span>
                  ))}
                </span>
              </div>
              <span className="text-xs text-slate-700 truncate leading-snug">
                {p.text}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Футер со статистикой */}
      <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-400 flex justify-between">
        {/* 🆕 Переводы с интерполяцией */}
        <span>{t('dropdownTotalPoints', { count: points.length })}</span>
        <span>{t('dropdownFoundPoints', { count: filteredPoints.length })}</span>
      </div>
    </div>
  );
};