// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/editorExtensions.tsx

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import {  Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useStore } from '@/store/useStore';
import { useNavbarStore } from '@/store/useNavbarStore';
import { useTranslations } from 'next-intl';


declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
    tableRow: {
      setAsTemplate: () => ReturnType;
      unsetAsTemplate: () => ReturnType;
    };
  }
}

// 🆕 УНИВЕРСАЛЬНАЯ ФУНКЦИЯ: Прокрутка и мигание токена/слота в редакторе
export const scrollAndHighlightInEditor = (identifier: string) => {
  // Ищем токен или слот по атрибуту identifier
  const el = document.querySelector(
    `[data-token-identifier="${identifier}"], [data-slot-identifier="${identifier}"]`
  ) as HTMLElement;
  
  if (el) {
    // Плавная прокрутка
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Мигание
    el.classList.add('token-highlight-flash');
    setTimeout(() => {
      el.classList.remove('token-highlight-flash');
    }, 1500);
  }
};

export const processMarkdownPlaceholders = (html: string): string => {
  const state = useStore.getState();
  const properties = state.data.properties || [];

  const formulationIds = new Set<string>();
  state.data.myFormulations?.forEach((f: any) => {
    if (f.identifier) formulationIds.add(f.identifier);
  });
  state.data.setFormulations?.forEach((g: any) => {
    if (g.identifier) formulationIds.add(g.identifier);
  });

  return html.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, identifier) => {
    const prop = properties.find((p: any) => p.identifier === identifier);
    if (prop) {
      const uuid = `tok_${Math.random().toString(36).substr(2, 9)}`;
      // ⚠️ Добавляем \u200B, чтобы тег не был пустым (решение Причины 2)
      return `<span data-token-uuid="${escapeHtml(uuid)}" data-token-source-id="${prop.id}" data-token-identifier="${escapeHtml(identifier)}" data-token-type="property" data-token-label="${escapeHtml(prop.name)}" data-token-value="${escapeHtml(prop.default_value || '')}" data-token-display="compact">\u200B</span>`;
    }
    if (formulationIds.has(identifier)) {
      return `<span data-slot-identifier="${escapeHtml(identifier)}">\u200B</span>`;
    }
    return match;
  });
};

// Вспомогательная функция (если её еще нет в этом файле)
const escapeHtml = (str: string | null | undefined): string => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

// ==========================================
// 1. РАСШИРЕНИЕ: Атрибуты блоков (UUID и Тип)
// ==========================================
export const BlockAttributes = Extension.create({
  name: 'blockAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'listItem', 'blockquote'],
        attributes: {
          blockUuid: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-uuid'),
            renderHTML: (attributes) => {
              if (!attributes.blockUuid) return {};
              return { 'data-block-uuid': attributes.blockUuid };
            }
          },
          blockType: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-type'),
            renderHTML: (attributes) => {
              if (!attributes.blockType) return {};
              return { 'data-block-type': attributes.blockType };
            }
          },
        },
      },
    ];
  },
});

// ==========================================
// 2. РАСШИРЕНИЕ: Якоря (Выделение текста)
// ==========================================
export const AnchorMark = Mark.create({
  name: 'anchor',
  addAttributes() {
    return {
      anchorUuid: { 
        default: null, 
        parseHTML: (element) => element.getAttribute('data-anchor-uuid'), 
        renderHTML: (attributes) => ({ 'data-anchor-uuid': attributes.anchorUuid }) 
      },
      anchorType: { 
        default: 'word', 
        parseHTML: (element) => element.getAttribute('data-anchor-type'), 
        renderHTML: (attributes) => ({ 'data-anchor-type': attributes.anchorType }) 
      },
    };
  },
  parseHTML() { 
    return [{ tag: 'span[data-anchor-uuid]' }]; 
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'bg-yellow-100 text-yellow-800 rounded px-1 border border-yellow-200' }), 0];
  },
});

// ==========================================
// 3. РАСШИРЕНИЕ: Токены (Свойства / Формулировки)
// ==========================================
const TokenComponent = ({ node, updateAttributes }: NodeViewProps) => {
  const mode = useStore((s: any) => s.ui.mode);
  
  // 🆕 ИЗМЕНЕНО: Проверяем именно режим разметки (markup)
  const isMarkupMode = mode === 'markup'; 
  const isClickable = mode === 'markup' || mode === 'edit';
  
  const isCompact = node.attrs.displayMode === 'compact';
  const isProperty = node.attrs.type === 'property';

  // 🆕 ИЗМЕНЕНО: Логика отображения контента
  // В markup: показываем лейбл или лейбл+значение (в зависимости от compact)
  // В остальных режимах: показываем ТОЛЬКО значение (как раньше было в edit)
  const displayContent = isMarkupMode
    ? (isCompact ? node.attrs.label : <>{node.attrs.label}: <strong>{node.attrs.value}</strong></>)
    : (node.attrs.value || node.attrs.label); 

  return (
    <NodeViewWrapper 
      as="span" 
      className="inline align-baseline whitespace-nowrap"
      data-token-identifier={node.attrs.identifier}
      data-token-uuid={node.attrs.uuid}
    >
      <span
        contentEditable={false}
        onClick={(e) => {
          e.stopPropagation();
          if (isClickable && node.attrs.identifier) {
            const type = isProperty ? 'property' : 'formulation';
            const id = isProperty ? node.attrs.sourceId : node.attrs.identifier;
            
            // 1. Переключаем вкладку
            if (isMarkupMode) {
              useStore.getState().ui.setActiveTab(isProperty ? 'properties' : 'formulations');
            }

            // 2. Сигналим боковой панели о необходимости подсветки
            useStore.getState().ui.setHighlightTarget({ type, id });
            setTimeout(() => useStore.getState().ui.setHighlightTarget(null), 2000);
          }
          if (isMarkupMode) {
            updateAttributes({ displayMode: isCompact ? 'full' : 'compact' });
          }
        }}
        className={
          `px-1.5 py-0.5 rounded select-none border transition-colors inline ${
            isMarkupMode
              ? // 🎨 Разноцветные стили ТОЛЬКО для markup
                `cursor-pointer ${
                  isProperty
                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                    : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                }`
              : // ⚪ Серые стили для edit, review, comment, history
                'bg-slate-50 text-slate-800 border-slate-200 cursor-default'
          }`
        }
      >
        {displayContent}
      </span>
    </NodeViewWrapper>
  );
};

export const TokenNode = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      uuid: { 
        default: null, 
        parseHTML: (element) => element.getAttribute('data-token-uuid'), 
        renderHTML: (attributes) => ({ 'data-token-uuid': attributes.uuid }) 
      },
      sourceId: { 
        default: null, 
        parseHTML: (element) => element.getAttribute('data-token-source-id'), 
        renderHTML: (attributes) => { 
          if (!attributes.sourceId) return {}; 
          return { 'data-token-source-id': attributes.sourceId }; 
        } 
      },
      identifier: { 
        default: null, 
        parseHTML: (element) => element.getAttribute('data-token-identifier'), 
        renderHTML: (attributes) => { 
          if (!attributes.identifier) return {}; 
          return { 'data-token-identifier': attributes.identifier }; 
        } 
      },
      type: { 
        default: 'property', 
        parseHTML: (element) => element.getAttribute('data-token-type'), 
        renderHTML: (attributes) => ({ 'data-token-type': attributes.type }) 
      },
      label: { 
        default: '', 
        parseHTML: (element) => element.getAttribute('data-token-label'), 
        renderHTML: (attributes) => ({ 'data-token-label': attributes.label }) 
      },
      value: { 
        default: '', 
        parseHTML: (element) => element.getAttribute('data-token-value'), 
        renderHTML: (attributes) => ({ 'data-token-value': attributes.value }) 
      },
      displayMode: { 
        default: 'compact', 
        parseHTML: (element) => element.getAttribute('data-token-display'), 
        renderHTML: (attributes) => ({ 'data-token-display': attributes.displayMode }) 
      },
    };
  },
  parseHTML() { 
    return [{ tag: 'span[data-token-uuid]' }]; 
  },
  renderHTML({ node, HTMLAttributes }) {
    const displayText = node.attrs.displayMode === 'compact' 
      ? node.attrs.label 
      : `${node.attrs.label}: ${node.attrs.value}`;
    return ['span', mergeAttributes(HTMLAttributes, { class: 'token-node inline align-baseline whitespace-nowrap' }), displayText];
  },
  addNodeView() { 
    return ReactNodeViewRenderer(TokenComponent); 
  },
});

// ==========================================
// 🆕 3.1 РАСШИРЕНИЕ: Слоты для формулировок (Плейсхолдеры)
// ==========================================
const FormulationSlotComponent = ({ node }: NodeViewProps) => {
  const mode = useStore((s: any) => s.ui.mode);
  const isEditMode = mode === 'edit';
  const t = useTranslations('editorExtensions');

  return (
    <NodeViewWrapper 
      as="span" 
      className="inline align-baseline whitespace-nowrap"
      data-slot-identifier={node.attrs.identifier}
    >
      <span
        contentEditable={false}
        onClick={(e) => {
          e.stopPropagation();
          if (mode === 'markup' && node.attrs.identifier) {
            // 1. Переключаем вкладку
            useStore.getState().ui.setActiveTab('formulations');
            // 2. Сигналим боковой панели
            useStore.getState().ui.setHighlightTarget({ 
              type: 'formulation', 
              id: node.attrs.identifier 
            });
            setTimeout(() => useStore.getState().ui.setHighlightTarget(null), 2000);
          }
        }}
        className={`inline px-1 py-0.5 text-[10px] font-mono rounded select-none transition-colors ${
          isEditMode 
            ? 'bg-slate-100 text-slate-500 border border-dashed border-slate-400 cursor-default' 
            : 'bg-transparent text-transparent border border-transparent w-0 p-0 m-0' // Полностью невидим в режиме просмотра
        }`}
        title={t('formulationSlotTitle', { identifier: node.attrs.identifier })}
      >
        {isEditMode ? `[${node.attrs.identifier}]` : '\u200B'}
      </span>
    </NodeViewWrapper>
  );
};

export const FormulationSlot = Node.create({
  name: 'formulationSlot',
  group: 'inline',
  inline: true,
  atom: true, // Неделимая нода
  addAttributes() {
    return {
      identifier: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-slot-identifier'),
        renderHTML: (attributes) => {
          if (!attributes.identifier) return {};
          return { 'data-slot-identifier': attributes.identifier };
        }
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-slot-identifier]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'formulation-slot' }), `\u200B`];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FormulationSlotComponent);
  },
});


// ==========================================
// 4. РАСШИРЕНИЕ: Рецензирование (Track Changes)
// ==========================================
export const trackChangesKey = new PluginKey('trackChanges');

// 🆕 Вынесли атрибуты в функцию с явной типизацией для устранения ошибок TS
const getTrackAttributes = () => ({
  author: { default: 'current_user' },
  date: { default: () => new Date().toISOString() },
  editUuid: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-edit-uuid'),
    renderHTML: (attributes: any) => attributes.editUuid ? { 'data-edit-uuid': attributes.editUuid } : {}
  },
  authorId: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-author-id'),
    renderHTML: (attributes: any) => attributes.authorId ? { 'data-author-id': attributes.authorId } : {}
  },
  // Атрибут для группировки правок
  batchId: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-batch-id'),
    renderHTML: (attributes: any) => attributes.batchId ? { 'data-batch-id': attributes.batchId } : {}
  }
});

export const TrackAddMark = Mark.create({
  name: 'trackAdd',
  addAttributes: getTrackAttributes,
  parseHTML() { return [{ tag: 'span[data-track-add]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-track-add': '',
      class: 'tc-add' // Используем свой класс
    }), 0];
  },
});

export const TrackDeleteMark = Mark.create({
  name: 'trackDelete',
  addAttributes: getTrackAttributes,
  parseHTML() { return [{ tag: 'span[data-track-delete]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-track-delete': '',
      class: 'tc-delete' // Используем свой класс
    }), 0];
  },
});

const getSafeText = (doc: any, from: number, to: number) => {
  try { return doc.textBetween(from, to, ' '); } catch { return ''; }
};

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addStorage() {
    return {
      reviewMode: false,
      currentBatchId: null as string | null,
      lastActionType: null as 'typing' | 'deleting' | 'other' | null,
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    // ✅ ПРАВИЛЬНЫЙ ДОСТУП: this.storage уже содержит объекты, объявленные в addStorage()
    const storage = this.storage; 

    return [
      new Plugin({
        key: trackChangesKey,
        props: {
          // Сбрасываем тип действия при клике мышкой (курсор переместился)
          handleClick() {
            storage.lastActionType = 'other';
            return false;
          },

          handleTextInput(view, from, to, text) {
            if (!storage.reviewMode) return false;
            if (storage.lastActionType !== 'typing') {
              storage.currentBatchId = `batch_${Math.random().toString(36).substr(2, 9)}`;
            }
            storage.lastActionType = 'typing';
            const batchId = storage.currentBatchId;
            const editUuid = `edit_${Math.random().toString(36).substr(2, 9)}`;
            const currentUserId = useNavbarStore.getState().user?.id || null;
            const { state, dispatch } = view;
            const trackAddMarkType = view.state.schema.marks.trackAdd;
            const trackDeleteMarkType = view.state.schema.marks.trackDelete;
            if (!trackAddMarkType || !trackDeleteMarkType) return false;

            const oldText = getSafeText(state.doc, from, to);
            useStore.getState().reviews.upsertLocalEdit(editUuid, batchId, oldText, text);

            const tr = state.tr;
            tr.insertText(text, from, from);
            const insertEnd = from + text.length;
            
            // ✅ ДОБАВЛЯЕМ метку добавления (НЕ стираем trackDelete, если он был)
            tr.addMark(from, insertEnd, trackAddMarkType.create({ editUuid, batchId, authorId: currentUserId }));

            // 🆕 ИСПРАВЛЕНИЕ: Явно убираем метку удаления с только что набранного текста.
            // Это предотвращает наследование trackDelete от соседнего "удаленного" слова.
            tr.removeMark(from, insertEnd, trackDeleteMarkType);

            if (from < to) {
              const shiftedFrom = from + text.length;
              const shiftedTo = to + text.length;
              // ✅ ДОБАВЛЯЕМ метку удаления поверх (НЕ стираем trackAdd)
              tr.addMark(shiftedFrom, shiftedTo, trackDeleteMarkType.create({ editUuid, batchId, authorId: currentUserId }));
            }
            
            tr.setSelection(TextSelection.create(tr.doc, from + text.length));
            if (dispatch) dispatch(tr);
            return true;
          },

          handleKeyDown(view, event) {
            if (!storage.reviewMode) return false;

            // ✅ ИСПРАВЛЕНИЕ: Убираем 'Enter' из списка игнорируемых клавиш
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
              storage.lastActionType = 'other';
              return false;
            }

            // 🆕 НОВАЯ ЛОГИКА ДЛЯ ENTER
            if (event.key === 'Enter') {
              const { state, dispatch } = view;
              const { from, to, empty } = state.selection;

              // Если текст выделен, помечаем его как удаленный перед переносом строки
              if (!empty) {
                const batchId = `batch_${Math.random().toString(36).substr(2, 9)}`;
                const editUuid = `edit_${Math.random().toString(36).substr(2, 9)}`;
                const currentUserId = useNavbarStore.getState().user?.id || null;
                const trackDeleteMarkType = view.state.schema.marks.trackDelete;

                if (!trackDeleteMarkType) return false;

                const oldText = getSafeText(state.doc, from, to);
                useStore.getState().reviews.upsertLocalEdit(editUuid, batchId, oldText, '');

                const tr = state.tr;
                
                // 1. Помечаем выделенный текст как удаленный
                tr.addMark(from, to, trackDeleteMarkType.create({ editUuid, batchId, authorId: currentUserId }));

                // 2. Схлопываем выделение в конец "удаленного" текста
                // Это предотвращает физическое удаление текста стандартным механизмом Enter
                tr.setSelection(TextSelection.create(tr.doc, to));

                if (dispatch) dispatch(tr);
              }

              // Сбрасываем тип действия и возвращаем false, 
              // чтобы ProseMirror стандартно обработал перенос строки (Enter)
              storage.lastActionType = 'other';
              return false;
            }

            // ==========================================
            // Обработка Backspace и Delete (ваш оригинальный код)
            // ==========================================
            if (event.key === 'Backspace' || event.key === 'Delete') {
              if (storage.lastActionType !== 'deleting') {
                storage.currentBatchId = `batch_${Math.random().toString(36).substr(2, 9)}`;
              }
              storage.lastActionType = 'deleting';
              
              const batchId = storage.currentBatchId;
              const editUuid = `edit_${Math.random().toString(36).substr(2, 9)}`;
              const currentUserId = useNavbarStore.getState().user?.id || null;
              
              const { state, dispatch } = view;
              const { from, to, empty } = state.selection;
              
              const trackAddMarkType = view.state.schema.marks.trackAdd;
              const trackDeleteMarkType = view.state.schema.marks.trackDelete;
              
              if (!trackAddMarkType || !trackDeleteMarkType) return false;

              let delFrom = from, delTo = to;
              let newCursorPos = from;

              if (empty) {
                if (event.key === 'Backspace') { 
                  if (from === 0) return false; 
                  delFrom = from - 1; 
                  newCursorPos = delFrom; 
                } else { 
                  if (to === state.doc.content.size) return false; 
                  delTo = to + 1; 
                  newCursorPos = to; 
                }
              } else { 
                newCursorPos = from; 
              }

              const oldText = getSafeText(state.doc, delFrom, delTo);
              const direction = event.key === 'Backspace' ? 'prepend' : 'append';
              
              useStore.getState().reviews.upsertLocalEdit(editUuid, batchId, oldText, '', direction);

              const tr = state.tr;
              // ✅ ДОБАВЛЯЕМ метку удаления. trackAdd СОХРАНЯЕТСЯ, чтобы при Reject мы могли восстановить статус "Новое"
              tr.addMark(delFrom, delTo, trackDeleteMarkType.create({ editUuid, batchId, authorId: currentUserId }));
              tr.setSelection(TextSelection.create(tr.doc, newCursorPos));
              
              if (dispatch) dispatch(tr);
              return true;
            }

            return false;
          },

          handlePaste(view, event, slice) {
            if (!storage.reviewMode) return false;
            storage.currentBatchId = `batch_${Math.random().toString(36).substr(2, 9)}`;
            storage.lastActionType = 'other';
            const batchId = storage.currentBatchId;
            const editUuid = `edit_${Math.random().toString(36).substr(2, 9)}`;
            const currentUserId = useNavbarStore.getState().user?.id || null;
            const { state, dispatch } = view;
            const { from, to } = state.selection;
            const trackAddMarkType = view.state.schema.marks.trackAdd;
            const trackDeleteMarkType = view.state.schema.marks.trackDelete;
            if (!trackAddMarkType || !trackDeleteMarkType) return false;

            const oldText = getSafeText(state.doc, from, to);
            let newText = '';
            try { newText = slice.content.textBetween(0, slice.content.size, ' '); } catch {}
            useStore.getState().reviews.upsertLocalEdit(editUuid, batchId, oldText, newText);

            const tr = state.tr;
            if (from < to) { 
              tr.addMark(from, to, trackDeleteMarkType.create({ editUuid, batchId, authorId: currentUserId })); 
            }
            
            const insertPos = to;
            tr.replace(insertPos, insertPos, slice);
            const insertedSize = slice.content.size;
            
            if (insertedSize > 0) { 
              tr.addMark(insertPos, insertPos + insertedSize, trackAddMarkType.create({ editUuid, batchId, authorId: currentUserId })); 
              // 🆕 ИСПРАВЛЕНИЕ: Убираем trackDelete со вставленного текста
              tr.removeMark(insertPos, insertPos + insertedSize, trackDeleteMarkType);

              tr.setSelection(TextSelection.create(tr.doc, insertPos + insertedSize)); 
            } else { 
              tr.setSelection(TextSelection.create(tr.doc, insertPos)); 
            }
            
            if (dispatch) dispatch(tr);
            return true;
          },

        },
      }),
    ];
  },
});


// ==========================================
// 🆕 7. РАСШИРЕНИЕ: Разрыв страницы (Page Break)
// ==========================================
const PageBreakComponent = ({ node }: NodeViewProps) => {
  const t = useTranslations('editorExtensions');
  return (
    <NodeViewWrapper as="div" className="my-6 select-none">
      <div contentEditable={false} className="page-break-visual">
        <span>{t('pageBreak')}</span>
      </div>
    </NodeViewWrapper>
  );
};

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true, // Неделимая нода
  
  addCommands() {
    return {
      setPageBreak: () => ({ chain }: any) => { 
        return chain().insertContent({ type: this.name }).run();
      },
    };
  },

  // 🆕 ДОБАВЛЯЕМ СОЧЕТАНИЕ КЛАВИШ (Ctrl+Enter / Cmd+Enter)
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
    };
  },

  parseHTML() {
    return [
      { tag: 'hr.page-break' },
      { tag: 'div[data-type="page-break"]' },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['hr', mergeAttributes(HTMLAttributes, {
      class: 'page-break',
      'data-type': 'page-break'
    })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageBreakComponent);
  },
});


const anchorHighlightKey = new PluginKey('anchorHighlight');

function buildDecorations(doc: any): DecorationSet {
  const { mode } = useStore.getState().ui;
  const activeUuid = useStore.getState().comments.activeAnchorUuid;

  if (mode !== 'comment') return DecorationSet.empty;

  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    const anchorMark = node.marks?.find((m: any) => m.type.name === 'anchor');
    if (!anchorMark) return;

    const uuid = anchorMark.attrs.anchorUuid;
    const isActive = uuid === activeUuid;

    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, {
        class: isActive ? 'anchor-hl anchor-hl-active' : 'anchor-hl',
      })
    );
  });

  return DecorationSet.create(doc, decorations);
}

export const AnchorHighlightPlugin = Extension.create({
  name: 'anchorHighlightPlugin',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: anchorHighlightKey,
        state: {
          init(_, editorState) {
            return buildDecorations(editorState.doc);
          },
          apply(tr: Transaction, oldDecorations: DecorationSet, _oldState: any, newState: any) {
            // 🆕 ОТЛАДКА: Смотрим, как плагин реагирует на транзакции
            const isDocChanged = tr.docChanged;
            const hasMeta = !!tr.getMeta('anchorHighlightUpdate');
            const currentDocSize = newState.doc.content.size;
            
            console.log(
              '[DEBUG AnchorHighlight] apply | docChanged:', isDocChanged, 
              '| hasMeta:', hasMeta, 
              '| newDocSize:', currentDocSize
            );

            if (isDocChanged || hasMeta) {
              return buildDecorations(newState.doc);
            }
            
            // 🆕 ЗАЩИТА: Если документ стал очень маленьким (пустым), а декорации старые — сбрасываем их,
            // чтобы ProseMirror не пытался применить старые позиции (9479) к новому документу.
            if (currentDocSize <= 2 && oldDecorations !== DecorationSet.empty) {
               console.warn('[DEBUG AnchorHighlight] ⚠️ Doc is empty, clearing stale decorations to prevent RangeError');
               return DecorationSet.empty;
            }

            return oldDecorations;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
        view(editorView) {
          const unsub = useStore.subscribe((state: any, prev: any) => {
            if (
              state.ui.mode !== prev.ui.mode ||
              state.comments.activeAnchorUuid !== prev.comments.activeAnchorUuid
            ) {
              const tr = editorView.state.tr
                .setMeta('anchorHighlightUpdate', true)
                .setMeta('addToHistory', false);
              editorView.dispatch(tr);
            }
          });
          return {
            destroy() {
              unsub();
            },
          };
        },
      }),
    ];
  },
});

// ==========================================
// УТИЛИТА: Извлечение используемых формулировок (Токенов и Слотов)
// ==========================================
export const extractUsedIdentifiers = (editorInstance: any) => {
	if (!editorInstance) return;
	const json = editorInstance.getJSON();
	const ids = new Set<string | number>();
	
	const findNodes = (node: any) => {
		// 1. Если это уже активированный токен формулировки
		if (node.type === 'token' && node.attrs?.type === 'formulation') {
			if (node.attrs.identifier !== undefined && node.attrs.identifier !== null) {
				ids.add(node.attrs.identifier); // 🆕 Добавляем идентификатор слота
			}
			if (node.attrs.sourceId !== undefined && node.attrs.sourceId !== null) {
				ids.add(node.attrs.sourceId); // Добавляем ID самой формулировки
			}
		}
		
		// 2. 🆕 Если это неактивный слот (плейсхолдер)
		if (node.type === 'formulationSlot') {
			if (node.attrs?.identifier !== undefined && node.attrs?.identifier !== null) {
				ids.add(node.attrs.identifier); // 🆕 Добавляем идентификатор слота
			}
		}
		
		if (node.content) {
			node.content.forEach(findNodes);
		}
	};
	
	findNodes(json);
	useStore.getState().data.setUsedFormulationIds(Array.from(ids));
};



// 1. TABLE (Бордеры)
export const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}), // Сохраняем родительские атрибуты
      bordered: {
        default: false,
        parseHTML: (element) => {
          if (element.getAttribute('data-bordered') === 'true') return true;
          const firstCell = element.querySelector('td, th');
          return firstCell?.classList.contains('bordered') || false;
        },
        renderHTML: () => ({}), 
      },
    };
  },
  
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          let tr = newState.tr;
          let modified = false;
          
          // 🆕 ОТЛАДКА: Логируем размеры документов при каждой транзакции
          const oldSize = oldState.doc.content.size;
          const newSize = newState.doc.content.size;
          if (oldSize !== newSize) {
            console.log('[DEBUG CustomTable] Doc size changed:', oldSize, '->', newSize);
          }

          // ✅ ИСПРАВЛЕНИЕ:遍历 ТОЛЬКО newState.doc. 
          // Использовать pos из oldState для newState — это причина RangeError!
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'table') {
              const isBordered = node.attrs.bordered;
              
              node.descendants((childNode, childPos) => {
                if (childNode.type.name === 'tableCell' || childNode.type.name === 'tableHeader') {
                  if (childNode.attrs.bordered !== isBordered) {
                    // Теперь pos и childPos оба принадлежат newState, позиция валидна!
                    const actualPos = pos + 1 + childPos; 
                    
                    // 🆕 ОТЛАДКА: Если ошибка все же возникнет, мы увидим, какая позиция вызвала её
                    if (actualPos >= newSize) {
                      console.error('[DEBUG CustomTable] ⚠️ CRITICAL: Calculated pos', actualPos, 'is outside doc size', newSize);
                    }

                    tr.setNodeMarkup(actualPos, undefined, {
                      ...childNode.attrs,
                      bordered: isBordered,
                    });
                    modified = true;
                  }
                }
              });
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

// 2. TABLE ROW (Высота строки)
export const CustomTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: element => element.style.height || element.getAttribute('height'),
        renderHTML: attributes => {
          if (!attributes.height) return {};
          return { style: `height: ${attributes.height}` };
        },
      },
      isTemplate: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-is-template') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.isTemplate) return {};
          return { 
            'data-is-template': 'true', 
            class: 'template-row' // Класс для CSS-хаков, если понадобится
          };
        },
      },
      sectionId: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-section-id'),
          renderHTML: (attributes) => {
            if (!attributes.sectionId) return {};
            return { 'data-section-id': attributes.sectionId };
          },
        },
      isInjected: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-is-injected') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.isInjected) return {};
          return { 
            'data-is-injected': 'true', 
            class: 'injected-data-row',
            'contenteditable': 'false' 
          };
        },
      },
    };
  }
});

// 3. TABLE CELL (Вертикальное выравнивание + Бордер)
export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bordered: {
        default: false,
        parseHTML: (element) => element.classList?.contains('bordered') || false,
        renderHTML: (attributes) => {
          if (!attributes.bordered) return {};
          return { class: 'bordered' };
        },
      },
      verticalAlign: {
        default: 'top',
        parseHTML: (element: HTMLElement) => element.style.verticalAlign || element.getAttribute('vertical-align') || 'top',
        renderHTML: (attributes: any) => {
          if (!attributes.verticalAlign || attributes.verticalAlign === 'top') return {};
          return { style: `vertical-align: ${attributes.verticalAlign}` };
        },
      },
    };
  },
});

// 4. TABLE HEADER (Вертикальное выравнивание + Бордер)
export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bordered: {
        default: false,
        parseHTML: (element) => element.classList?.contains('bordered') || false,
        renderHTML: (attributes) => {
          if (!attributes.bordered) return {};
          return { class: 'bordered' };
        },
      },
      verticalAlign: {
        default: 'top',
        parseHTML: (element: HTMLElement) => element.style.verticalAlign || element.getAttribute('vertical-align') || 'top',
        renderHTML: (attributes: any) => {
          if (!attributes.verticalAlign || attributes.verticalAlign === 'top') return {};
          return { style: `vertical-align: ${attributes.verticalAlign}` };
        },
      },
    };
  },
});
