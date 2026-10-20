// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/DocumentEditor.tsx
"use client";
import { useEditor, EditorContent } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from 'tiptap-markdown';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Link from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { forwardRef, useImperativeHandle, useState, useRef, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import SelectionMenu from './SelectionMenu';
import TableHoverMenu from './TableHoverMenu';
import { CustomTable, CustomTableRow, CustomTableCell, CustomTableHeader } from './editorExtensions';
import {
PageBreak, BlockAttributes, AnchorMark, TokenNode, FormulationSlot, AnchorHighlightPlugin,
TrackAddMark, TrackDeleteMark, TrackChanges, extractUsedIdentifiers,
} from './editorExtensions';
import { LegalPoint, ClauseRef, LegalNumberingPlugin, recalculatePointsVisibility, ClauseRefDropdown,
ListToLegalPointPlugin, TextNumberToLegalPointPlugin } from './LegalPointsExtension';
import { documentsApi } from '@/lib/realApi';
import { computeDiff } from './diffUtils';
import { TableDataInjector } from './TableDataInjector';
import ConversionModal, { ConversionModalHandle } from './ConversionModal';

const escapeHtml = (str: string | null | undefined): string => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const processMarkdownPlaceholders = (html: string): string => {
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
      return `<span data-token-uuid="${escapeHtml(uuid)}" data-token-source-id="${prop.id}" data-token-identifier="${escapeHtml(identifier)}" data-token-type="property" data-token-label="${escapeHtml(prop.name)}" data-token-value="${escapeHtml(prop.default_value || '')}" data-token-display="compact"></span>`;
    }
    if (formulationIds.has(identifier)) {
      return `<span data-slot-identifier="${escapeHtml(identifier)}"></span>`;
    }
    return match;
  });
};

// ==========================================
// ОСНОВНОЙ КОМПОНЕНТ РЕДАКТОРА
// ==========================================
export interface DocumentEditorHandle {
  insertToken: (type: 'property' | 'formulation', sourceId: number | string, label: string, value: string, identifier?: string) => void;
  updateTokensBySourceId: (sourceId: number | string, newLabel: string, newValue?: string) => void;
  removeTokensBySourceId: (sourceId: number | string) => void;
  markSelectionAsAnchor: (anchorType?: string) => void;
  getHTML: () => string;
  getJSON: () => any;
  getCleanHTML: () => string;
  getCleanJSON: () => any;
  setContent: (html: string) => void;
  refreshUsedIdentifiers: () => void;
  setContentJson: (json: any) => void;
  clearAutoSave: () => void;
  activateSlot: (identifier: string, tokenAttrs: any) => void;
  deactivateSlot: (identifier: string) => void;
  insertSlot: (identifier: string) => void;
  removeAnchorByUuid: (uuid: string) => void;
  acceptEdit: (editUuid: string) => void;
  rejectEdit: (editUuid: string) => void;
  scrollToEdit: (editUuid: string) => void;
}

interface DocumentEditorProps {
  initialHTML?: string;
  documentSetId?: number;
  onTokenClick?: (tokenData: any) => void;
}

const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  ({ initialHTML, documentSetId, onTokenClick }, ref) => {
    // 🆕 Инициализация next-intl
    const t = useTranslations('DocumentEditor');

    const [zoom, setZoom] = useState(100);
    const [docPackageOpen, setDocPackageOpen] = useState(false);
    const [alignDropdownOpen, setAlignDropdownOpen] = useState(false);
    const [blockStyleOpen, setBlockStyleOpen] = useState(false);
    const [clauseRefDropdownOpen, setClauseRefDropdownOpen] = useState(false);
    
    const blockStyleRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const alignDropdownRef = useRef<HTMLDivElement>(null);
    const clauseRefDropdownRef = useRef<HTMLDivElement>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    const { documentPackage } = useStore();
    const mode = useStore((s: any) => s.ui.mode);
    const selectedVersionId = useStore((s: any) => s.history.selectedVersionId);
    const activeDocId = useStore((s: any) => s.documentPackage.activeId);
    const isAddingComment = useStore((s: any) => s.ui.isAddingComment);
    const isSelectingAnchor = useStore((s: any) => s.ui.isSelectingAnchor);
    const activeFormulationIdentifiers = useStore((s: any) => s.data.activeFormulationIdentifiers);
    
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newDocName, setNewDocName] = useState('');
    
    const docSetMode = useStore((s: any) => s.documentPackage.documentSetMode);
    const showFormatting = (mode === 'markup' || mode === 'edit') && docSetMode !== 'standard' && docSetMode !== 'file';
    const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess); 
    const canModifyPackage = currentUserAccess === 'owner' || currentUserAccess === 'full'; 
    const isContentLoading = useStore((s: any) => s.documentPackage.isContentLoading);
    
    const conversionModalRef = useRef<ConversionModalHandle>(null);
    const prevModeRef = useRef(mode);

    const canEditWithKeyboard = useMemo(() => {
      if (currentUserAccess === 'view' || docSetMode === 'file') return false;
      if (mode === 'markup') return docSetMode === 'template' && (currentUserAccess === 'owner' || currentUserAccess === 'full');
      if (mode === 'edit') return (docSetMode === 'template' || docSetMode === 'non_standard') && (currentUserAccess === 'owner' || currentUserAccess === 'full');
      if (mode === 'review') return currentUserAccess === 'review' || currentUserAccess === 'owner' || currentUserAccess === 'full';
      if (mode === 'comment') return false;
      return false;
    }, [mode, docSetMode, currentUserAccess]);

    // 🆕 Перенесено внутрь компонента, так как использует хук t
    const blockStyles = useMemo(() => [
      { id: 'p', label: t('normalText'), className: 'text-sm font-normal text-slate-800' },
      { id: 'h1', label: t('heading1'), className: 'text-3xl font-bold text-slate-900' },
      { id: 'h2', label: t('heading2'), className: 'text-2xl font-bold text-slate-900' },
      { id: 'h3', label: t('heading3'), className: 'text-xl font-semibold text-slate-900' },
      { id: 'h4', label: t('heading4'), className: 'text-lg font-semibold text-slate-900' },
      { id: 'h5', label: t('heading5'), className: 'text-base font-semibold text-slate-900' },
      { id: 'h6', label: t('heading6'), className: 'text-sm font-semibold text-slate-700 uppercase tracking-wide' },
    ], [t]);

    const getCleanHTML = () => {
      if (!editor) return '';
      let html = editor.getHTML();
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      const reviews = useStore.getState().reviews.items;
      const statusMap = new Map<string, string>();
      reviews.forEach((r: any) => {
          if (r.edit_uuid) statusMap.set(r.edit_uuid, r.resolution_status || 'PENDING');
      });
      tempDiv.querySelectorAll('[data-track-add]').forEach(node => {
          const uuid = node.getAttribute('data-edit-uuid') || '';
          const status = statusMap.get(uuid) || 'PENDING';
          if (status === 'REJECTED') node.remove();
          else {
              const textNode = document.createTextNode(node.textContent || '');
              node.replaceWith(textNode);
          }
      });
      tempDiv.querySelectorAll('[data-track-delete]').forEach(node => {
          const uuid = node.getAttribute('data-edit-uuid') || '';
          const status = statusMap.get(uuid) || 'PENDING';
          if (status === 'ACCEPTED' || status === 'PENDING') node.remove();
          else {
              const textNode = document.createTextNode(node.textContent || '');
              node.replaceWith(textNode);
          }
      });
      tempDiv.querySelectorAll('[data-anchor-uuid]').forEach(node => {
          const textNode = document.createTextNode(node.textContent || '');
          node.replaceWith(textNode);
      });
      tempDiv.querySelectorAll('.token-node').forEach(node => {
        const value = node.getAttribute('data-token-value') || node.getAttribute('data-token-label') || node.textContent;
        const textNode = document.createTextNode(value || '');
        node.replaceWith(textNode);
      });
      tempDiv.querySelectorAll('formulation-slot, .formulation-slot').forEach(node => { node.remove(); });
      tempDiv.querySelectorAll('tr[data-is-template="true"]').forEach(row => { row.remove(); });
      return tempDiv.innerHTML;
    };

    const getCleanJSON = () => {
      if (!editor) return {};
      const json = editor.getJSON();
      const clonedJson = JSON.parse(JSON.stringify(json));
      const cleanNode = (node: any) => {
        if (!node) return;
        if (node.type === 'tableRow' && node.attrs?.isInjected) return;
        if (node.marks && Array.isArray(node.marks)) {
          node.marks = node.marks.filter((m: any) => m.type !== 'trackAdd' && m.type !== 'trackDelete');
          if (node.marks.length === 0) delete node.marks;
        }
        if (node.content && Array.isArray(node.content)) node.content.forEach(cleanNode);
      };
      cleanNode(clonedJson);
      return clonedJson;
    };

    const triggerAutoSave = () => {
      const state = useStore.getState();
      if (state.ui.mode === 'history') return; 
      const activeDoc = state.documentPackage.items.find((d: any) => d.id === state.documentPackage.activeId);
      if (activeDoc && activeDoc.is_newly_created) return; 
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        const currentState = useStore.getState();
        if (currentState.ui.mode === 'history') return; 
        currentState.documentPackage.saveActiveDocumentToServer();
      }, 5000);
    };

    const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editor) return;
      if (!canEditWithKeyboard) {
        e.target.value = ''; 
        return;
      }
      const state = useStore.getState();
      if (state.documentPackage.items.length === 0) {
        const newDocName = file.name.replace(/\.[^/.]+$/, ""); 
        await state.documentPackage.addDocument(newDocName);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      conversionModalRef.current?.start(file.name);
      const formData = new FormData();
      formData.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          conversionModalRef.current?.updateProgress(percentComplete);
        }
      };
      const timeoutId = setTimeout(() => { xhr.abort(); }, 300_000);
      xhr.onload = async () => {
        clearTimeout(timeoutId);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.markdown) editor.commands.setContent(data.markdown); 
            if (data.warnings && data.warnings.length > 0) {
              // 🆕 Использование i18n для алерта
              alert(t('uploadSuccessWithWarnings', { warnings: data.warnings.join('\n') }));
            }
            const currentState = useStore.getState();
            await currentState.documentPackage.saveActiveDocumentToServer(); 
            conversionModalRef.current?.finish(); 
          } catch (error) {
            conversionModalRef.current?.finish('Ошибка обработки результата конвертации');
          }
        } else {
          let msg = `Сервер вернул ошибку ${xhr.status}`;
          try {
            const errData = JSON.parse(xhr.responseText);
            if (errData.error) msg = errData.error;
          } catch (e) {}
          conversionModalRef.current?.finish(msg);
        }
      };
      xhr.onerror = () => {
        clearTimeout(timeoutId);
        conversionModalRef.current?.finish('Не удалось связаться с сервером. Проверьте подключение к сети.');
      };
      xhr.onabort = () => {
        clearTimeout(timeoutId);
        conversionModalRef.current?.finish('Конвертация заняла слишком долго (>300 сек). Попробуйте файл меньшего размера.');
      };
      xhr.open('POST', '/backend/to-md', true);
      xhr.send(formData);
      e.target.value = ''; 
    };

    const handleDownloadDocx = async () => {
      if (!editor) return;
      const state = useStore.getState();
      state.data.syncFormulationSlots();
      extractUsedIdentifiers(editor);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
      const html = getCleanHTML();
      const activeDoc = state.documentPackage.items.find((d: any) => d.id === state.documentPackage.activeId);
      const fileName = activeDoc?.name || 'document';
      try {
        const response = await fetch('/backend/export-docx', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, fileName }),
        });
        if (!response.ok) throw new Error('Ошибка экспорта');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${fileName}.docx`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
      } catch (error) { console.error('Ошибка при конвертации в DOCX:', error); }
    };

    const handleDownloadPdf = async () => {
      if (!editor) return;
      const state = useStore.getState();
      state.data.syncFormulationSlots();
      extractUsedIdentifiers(editor);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
      const html = getCleanHTML();
      const activeDoc = state.documentPackage.items.find((d: any) => d.id === state.documentPackage.activeId);
      const fileName = activeDoc?.name || 'document';
      try {
        const response = await fetch('/backend/export-pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, fileName }),
        });
        if (!response.ok) throw new Error('Ошибка экспорта');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${fileName}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
      } catch (error) { console.error('Ошибка при конвертации в PDF:', error); }
    };

    const editor = useEditor({
      extensions: [
        AnchorHighlightPlugin,
        StarterKit.configure({ orderedList: false }),
        Markdown.configure({ html: true, transformCopiedText: true, transformPastedText: true }),
        Underline, Highlight, TextStyle,
        Color.configure({ types: [TextStyle.name, 'heading'] }),
        Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-blue-600 underline cursor-pointer' } }),
        Image.configure({ inline: true, allowBase64: true }),
        CustomTable.configure({ resizable: true }), CustomTableRow, CustomTableHeader, CustomTableCell,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        BlockAttributes, AnchorMark, TokenNode, FormulationSlot, PageBreak,
        TrackAddMark, TrackDeleteMark, TrackChanges,
        LegalPoint, ClauseRef, LegalNumberingPlugin,
        ListToLegalPointPlugin, TextNumberToLegalPointPlugin,
      ],
      content: initialHTML,
      onCreate: ({ editor }) => { 
        extractUsedIdentifiers(editor);
        setTimeout(() => { useStore.getState().reviews.syncFromEditor(editor); }, 150); 
      },
      onUpdate: ({ editor }) => {
        extractUsedIdentifiers(editor);
        recalculatePointsVisibility(editor); 
        triggerAutoSave();
      },
      editorProps: {
        attributes: { 
          class: `tiptap focus:outline-none min-h-[500px] text-gray-800 leading-relaxed ${isSelectingAnchor ? 'cursor-crosshair' : ''}` 
        },
        transformPastedText: (text: string) => processMarkdownPlaceholders(text),
        transformPastedHTML: (html: string) => {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          tempDiv.querySelectorAll('*').forEach((el) => {
            const styleAttr = el.getAttribute('style');
            if (styleAttr) {
              const match = styleAttr.match(/text-align\s*:\s*([^;]+)/i);
              if (match) el.setAttribute('style', `text-align: ${match[1].trim()};`);
              else el.removeAttribute('style');
            }
          });
          return tempDiv.innerHTML;
        },
        handleClick: (view, pos, event) => {
          const target = event.target as HTMLElement;
          if (target.closest('.token-node')) {
            const tokenEl = target.closest('.token-node') as HTMLElement;
            const tokenData = {
              uuid: tokenEl.getAttribute('data-token-uuid'), sourceId: tokenEl.getAttribute('data-token-source-id'),
              identifier: tokenEl.getAttribute('data-token-identifier'), type: tokenEl.getAttribute('data-token-type'),
              label: tokenEl.getAttribute('data-token-label'), value: tokenEl.getAttribute('data-token-value'),
            };
            if (onTokenClick) onTokenClick(tokenData);
            return true;
          }
          const anchorEl = target.closest('[data-anchor-uuid]');
          if (anchorEl) {
            const anchorUuid = anchorEl.getAttribute('data-anchor-uuid');
            if (anchorUuid) {
              useStore.getState().comments.setActiveAnchor(anchorUuid);
              const state = useStore.getState();
              const targetComment = state.comments.items.find((c: any) => c.anchor_uuid === anchorUuid);
              if (targetComment && state.ui.mode === 'comment') {
                setTimeout(() => {
                  const commentEl = document.getElementById(`comment-card-${targetComment.id}`);
                  if (commentEl) commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 150);
              }
            }
            return true;
          }
          return false;
        },
        handleDOMEvents: {
          copy: (view, event: any) => {
            const { from, to } = view.state.selection;
            const plainText = view.state.doc.textBetween(from, to, '\n', '');
            if (event.clipboardData) {
              event.clipboardData.clearData();
              event.clipboardData.setData('text/plain', plainText);
            }
            event.preventDefault();
            return true; 
          },
        },
      },
    });

    useEffect(() => {
      if (editor && scrollContainerRef.current) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
        });
      }
    }, [editor]);

    useEffect(() => {
      if (!editor) return;
      const handleMouseUp = () => {
        const state = useStore.getState();
        if (state.ui.isAddingComment && !editor.state.selection.empty) {
          const anchorUuid = `anc_${Math.random().toString(36).substr(2, 9)}`;
          const { $from } = editor.state.selection;
          const blockNode = $from.node();
          const blockUuid = blockNode.attrs?.blockUuid || `block_${Math.random().toString(36).substr(2, 9)}`;
          editor.chain().setMark('anchor', { anchorUuid, anchorType: 'comment' }).run();
          const { state: newState, dispatch } = editor.view;
          const tr = newState.tr;
          tr.setSelection(TextSelection.create(tr.doc, newState.selection.to));
          tr.setMeta('addToHistory', false);
          dispatch(tr);
          editor.view.dom.blur();
          state.comments.setActiveAnchor(anchorUuid, blockUuid);
          state.ui.setSelectingAnchor(false);
          state.ui.setActiveTab('comments');
          setTimeout(() => { document.getElementById('new-comment-textarea')?.focus(); }, 60);
        }
      };
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }, [editor]);

    useEffect(() => { if (editor) { recalculatePointsVisibility(editor); } }, [editor, activeFormulationIdentifiers]);    

    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        const wrapper = document.getElementById('doc-package-wrapper');
        if (wrapper && !wrapper.contains(e.target as HTMLElement)) setDocPackageOpen(false);
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
      const handleClickOutsideAlign = (e: MouseEvent) => {
        if (alignDropdownRef.current && !alignDropdownRef.current.contains(e.target as HTMLElement)) setAlignDropdownOpen(false);
      };
      document.addEventListener('mousedown', handleClickOutsideAlign);
      return () => document.removeEventListener('mousedown', handleClickOutsideAlign);
    }, []);

    useEffect(() => {
      const handleClickOutsideBlockStyle = (e: MouseEvent) => {
        if (blockStyleRef.current && !blockStyleRef.current.contains(e.target as HTMLElement)) setBlockStyleOpen(false);
      };
      document.addEventListener('mousedown', handleClickOutsideBlockStyle);
      return () => document.removeEventListener('mousedown', handleClickOutsideBlockStyle);
    }, []);

    useEffect(() => {
      const handleClickOutsideClauseRef = (e: MouseEvent) => {
        if (clauseRefDropdownRef.current && !clauseRefDropdownRef.current.contains(e.target as HTMLElement)) setClauseRefDropdownOpen(false);
      };
      document.addEventListener('mousedown', handleClickOutsideClauseRef);
      return () => document.removeEventListener('mousedown', handleClickOutsideClauseRef);
    }, []);

    useEffect(() => {
      if (!editor || !activeDocId || mode === 'history') return;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      const state = useStore.getState();
      const activeDoc = state.documentPackage.items.find((d: any) => d.id === activeDocId);
      if (activeDoc) {
          if (!activeDoc.contentJson) {
              state.documentPackage.loadDocumentContent(activeDocId);
              return; 
          }
          const jsonToSet = activeDoc.contentJson;
          editor.commands.setContent(jsonToSet, { emitUpdate: false });
          extractUsedIdentifiers(editor);
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
          });
          try { editor.commands.focus('start'); } catch (e) { /* ignore */ }
      }
    }, [activeDocId, editor]);

    useEffect(() => {
      if (!editor) return;
      const storage = editor.storage as any;
      if (!storage.trackChanges) {
        storage.trackChanges = { reviewMode: false, currentEditUuid: null, lastActionTime: 0 };
      }
      const isReview = mode === 'review';
      if (storage.trackChanges.reviewMode !== isReview) {
        storage.trackChanges.reviewMode = isReview;
        if (!isReview) storage.trackChanges.currentEditUuid = null;
      }
      editor.setEditable(canEditWithKeyboard);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (mode === 'history' && prevModeRef.current !== 'history') {
        useStore.getState().documentPackage.saveActiveDocumentToServer();
      }
      prevModeRef.current = mode;
      if (mode === 'history') {
        const loadHistoryData = async () => {
          const state = useStore.getState();
          const activeId = state.documentPackage.activeId;
          if (!activeId) return;
          const versions = await documentsApi.listVersions(activeId);
          let targetVersion = null;
          if (state.history.selectedVersionId) {
            targetVersion = versions.find(v => v.id === state.history.selectedVersionId);
            const current = versions.find(v => v.is_current);
            if (targetVersion && current) {
              const diffedJson = computeDiff(targetVersion.content_json, current.content_json);
              editor.commands.setContent(diffedJson, { emitUpdate: false });
              extractUsedIdentifiers(editor);
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            }
          } else {
            targetVersion = versions.find(v => v.is_current) || versions[0];
            if (targetVersion && editor && !editor.isDestroyed) {
              const json = (targetVersion.content_json as any) ?? {};
              editor.commands.setContent(json, { emitUpdate: false });
              extractUsedIdentifiers(editor);
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            }
          }
          if (targetVersion) state.comments.fetchComments(targetVersion.id);
          setTimeout(() => { useStore.getState().reviews.syncFromEditor(editor); }, 50);
        };
        loadHistoryData();
      }
    }, [mode, selectedVersionId, editor, activeDocId, canEditWithKeyboard]);

    useImperativeHandle(ref, () => ({
      _editor: editor,
      acceptEdit: (batchId: string) => {
        if (!editor || editor.isDestroyed) return;
        const { state, dispatch } = editor.view;
        const tr = state.tr;
        const rangesToDelete: { from: number, to: number }[] = [];
        state.doc.descendants((node, pos) => {
          const addMark = node.marks.find(m => m.type.name === 'trackAdd' && m.attrs.batchId === batchId);
          if (addMark) tr.removeMark(pos, pos + node.nodeSize, addMark.type);
          const delMark = node.marks.find(m => m.type.name === 'trackDelete' && m.attrs.batchId === batchId);
          if (delMark) rangesToDelete.push({ from: pos, to: pos + node.nodeSize });
        });
        rangesToDelete.sort((a, b) => b.from - a.from).forEach(range => { tr.delete(range.from, range.to); });
        dispatch(tr);
      },
      rejectEdit: (batchId: string) => {
        if (!editor || editor.isDestroyed) return;
        const { state, dispatch } = editor.view;
        const tr = state.tr;
        const rangesToDelete: { from: number, to: number }[] = [];
        state.doc.descendants((node, pos) => {
          const addMark = node.marks.find(m => m.type.name === 'trackAdd' && m.attrs.batchId === batchId);
          if (addMark) rangesToDelete.push({ from: pos, to: pos + node.nodeSize });
          const delMark = node.marks.find(m => m.type.name === 'trackDelete' && m.attrs.batchId === batchId);
          if (delMark) tr.removeMark(pos, pos + node.nodeSize, delMark.type);
        });
        rangesToDelete.sort((a, b) => b.from - a.from).forEach(range => { tr.delete(range.from, range.to); });
        dispatch(tr);
      },
      scrollToEdit: (editUuid: string) => {
        const el = document.querySelector(`[data-edit-uuid="${editUuid}"]`);
        if (el) {
          document.querySelectorAll('.active-review-highlight').forEach(e => e.classList.remove('active-review-highlight'));
          document.querySelectorAll(`[data-edit-uuid="${editUuid}"]`).forEach(e => e.classList.add('active-review-highlight'));
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },
      removeAnchorByUuid: (uuid: string) => {
        if (!editor || editor.isDestroyed) return;
        const { state, dispatch } = editor.view;
        const tr = state.tr;
        let changed = false;
        state.doc.descendants((node, pos) => {
          const mark = node.marks.find(m => m.type.name === 'anchor' && m.attrs.anchorUuid === uuid);
          if (mark) {
            tr.removeMark(pos, pos + node.nodeSize, mark.type);
            changed = true;
          }
        });
        if (changed) dispatch(tr);
      },
      insertToken: (type, sourceId, label, value, identifier) => {
        if (editor) {
          editor.chain().focus().insertContent({
            type: 'token',
            attrs: { uuid: `tok_${Math.random().toString(36).substr(2, 9)}`, sourceId, identifier, type, label, value, displayMode: 'compact' },
          }).run();
        }
      },
      insertSlot: (identifier: string) => {
        if (editor) {
          editor.chain().focus().insertContent({ type: 'formulationSlot', attrs: { identifier } }).run();
        }
      },
      updateTokensBySourceId: (sourceId, newLabel, newValue) => {
        if (!editor || editor.isDestroyed) return;
        try {
          const { state, dispatch } = editor.view;
          const tr = state.tr;
          let hasChanges = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'token' && node.attrs.sourceId == sourceId) {
              const newAttrs = { ...node.attrs, label: newLabel, ...(newValue !== undefined ? { value: newValue } : {}) };
              tr.setNodeMarkup(pos, undefined, newAttrs);
              hasChanges = true;
            }
          });
          if (hasChanges) dispatch(tr);
        } catch (e) { console.error('[DEBUG updateTokensBySourceId] Error updating tokens for sourceId:', sourceId, e); }
      },
      removeTokensBySourceId: (sourceId) => {
        if (!editor || editor.isDestroyed) return;
        const { state, dispatch } = editor.view;
        const tr = state.tr;
        let hasChanges = false;
        const nodesToRemove: { from: number, to: number }[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'token' && node.attrs.sourceId == sourceId) {
            nodesToRemove.push({ from: pos, to: pos + node.nodeSize });
          }
        });
        nodesToRemove.sort((a, b) => b.from - a.from).forEach(({ from, to }) => {
          tr.delete(from, to);
          hasChanges = true;
        });
        if (hasChanges) dispatch(tr);
      },
      activateSlot: (identifier: string, tokenAttrs: any) => {
          if (!editor || editor.isDestroyed) return;
          const { state, dispatch } = editor.view;
          const tr = state.tr;
          let hasChanges = false;
          const slotsToActivate: { from: number, to: number }[] = [];
          state.doc.descendants((node, pos) => {
              if (node.attrs.identifier === identifier) {
                  if (node.type.name === 'formulationSlot') {
                      slotsToActivate.push({ from: pos, to: pos + node.nodeSize });
                  } else if (node.type.name === 'token' && node.attrs.type === 'formulation') {
                      if (node.attrs.value !== tokenAttrs.value || node.attrs.label !== tokenAttrs.label || node.attrs.sourceId !== tokenAttrs.sourceId) {
                          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...tokenAttrs });
                          hasChanges = true;
                      }
                  }
              }
          });
          slotsToActivate.sort((a, b) => b.from - a.from).forEach(({ from, to }) => {
              const tokenNode = state.schema.nodes.token.create({ 
                  uuid: `tok_${Math.random().toString(36).substr(2, 9)}`, 
                  ...tokenAttrs, 
                  identifier 
              });
              tr.replaceWith(from, to, tokenNode);
              hasChanges = true;
          });
          if (hasChanges) dispatch(tr);
      },
      deactivateSlot: (identifier: string) => {
          if (!editor || editor.isDestroyed) return;
          const { state, dispatch } = editor.view;
          const tr = state.tr;
          let hasChanges = false;
          const tokensToDeactivate: { from: number, to: number }[] = [];
          state.doc.descendants((node, pos) => {
              if (node.attrs.identifier === identifier) {
                  if (node.type.name === 'token' && node.attrs.type === 'formulation') {
                      tokensToDeactivate.push({ from: pos, to: pos + node.nodeSize });
                  }
              }
          });
          tokensToDeactivate.sort((a, b) => b.from - a.from).forEach(({ from, to }) => {
              const slotNode = state.schema.nodes.formulationSlot.create({ identifier });
              tr.replaceWith(from, to, slotNode);
              hasChanges = true;
          });
          if (hasChanges) dispatch(tr);
      },
      markSelectionAsAnchor: (anchorType = 'word') => {
        if (editor && !editor.state.selection.empty) {
          editor.chain().focus().setMark('anchor', { anchorUuid: `anc_${Math.random().toString(36).substr(2, 9)}`, anchorType }).run();
        }
      },
      getHTML: () => editor?.getHTML() || '',
      getJSON: () => editor?.getJSON() || {},
      getCleanHTML,
      getCleanJSON,
      setContent: (html: string) => { if (editor) { editor.commands.setContent(html || ''); } },
      refreshUsedIdentifiers: () => { if (editor) { extractUsedIdentifiers(editor); } },
      setContentJson: (json: any) => {
        if (editor && !editor.isDestroyed) {
          try {
            const isEmpty = !json || !json.content || json.content.length === 0;
            const validJson = (json && json.type === 'doc' && !isEmpty) 
              ? json 
              : { type: 'doc', content: [{ type: 'paragraph' }] };
            editor.commands.setContent(validJson, { emitUpdate: false });
            extractUsedIdentifiers(editor);
            requestAnimationFrame(() => {
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            });
            setTimeout(() => {
              if (!editor.isDestroyed) useStore.getState().reviews.syncFromEditor(editor);
            }, 50);
            setTimeout(() => {
              if (!editor.isDestroyed) useStore.getState().data.recalculateFormulas();
            }, 150); 
          } catch (e) {
            console.error('[DEBUG setContentJson] CRITICAL ERROR during setContent:', e);
          }
        }
      },
      clearAutoSave: () => {
        if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
      },
    }));

    const activeDoc = documentPackage.items.find((d: any) => d.id === documentPackage.activeId);
    
    const getActiveAlign = () => {
      if (editor?.isActive({ textAlign: 'center' })) return 'center';
      if (editor?.isActive({ textAlign: 'right' })) return 'right';
      if (editor?.isActive({ textAlign: 'justify' })) return 'justify';
      return 'left';
    };

    const getActiveBlockStyle = () => {
      if (editor?.isActive('heading', { level: 1 })) return 'h1';
      if (editor?.isActive('heading', { level: 2 })) return 'h2';
      if (editor?.isActive('heading', { level: 3 })) return 'h3';
      if (editor?.isActive('heading', { level: 4 })) return 'h4';
      if (editor?.isActive('heading', { level: 5 })) return 'h5';
      if (editor?.isActive('heading', { level: 6 })) return 'h6';
      if (editor?.isActive('blockquote')) return 'quote';
      if (editor?.isActive('codeBlock')) return 'code';
      return 'p';
    };

    return (
      <section id="right-panel" className="flex-1 flex flex-col bg-slate-100 min-w-0">
        {/* Toolbar */}
        <div className="h-11 bg-white border-b border-slate-200 flex items-center px-3 justify-between shrink-0 shadow-sm z-10 gap-3">
          <div className="flex items-center gap-1.5 min-w-0 shrink-0 relative" id="doc-package-wrapper">
            <div className="flex items-center gap-0 min-w-0">
              <button id="doc-package-btn" onClick={() => setDocPackageOpen(!docPackageOpen)} className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors group max-w-[200px] min-w-0" title={t('documentsInPackage')}>
                <i className="fa-solid fa-layer-group text-primary-500 text-[11px] shrink-0"></i>
                <span className="text-xs font-semibold text-slate-700 truncate" id="doc-package-current">{activeDoc?.name || t('documentNotSelected')}</span>
                <i className="fa-solid fa-chevron-down text-slate-400 text-[9px] shrink-0 group-hover:text-slate-600 transition-colors" id="doc-package-chevron"></i>
              </button>
              <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-medium ml-1 shrink-0">
                v{activeDoc?.version_number ?? '-'}
              </span>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {canModifyPackage && canEditWithKeyboard && (
                <button title={t('uploadDocument')} onClick={() => fileInputRef.current?.click()} className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:bg-green-50 hover:text-green-600 transition-colors">
                  <i className="fa-solid fa-upload text-[11px]"></i>
                </button>
              )}
              <input type="file" ref={fileInputRef} accept=".docx,.pdf,.rtf" className="hidden" onChange={handleUploadDocument} />
              <button title={t('downloadDocx')} onClick={handleDownloadDocx} className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:bg-green-50 hover:text-green-600 transition-colors">
                <i className="fa-solid fa-file-word text-[11px]"></i>
              </button>
              <button title={t('downloadPdf')} onClick={handleDownloadPdf} className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:bg-green-50 hover:text-green-600 transition-colors">
                <i className="fa-solid fa-file-pdf text-[11px]"></i>
              </button>
            </div>
            {docPackageOpen && (
              <div id="doc-package-dropdown" className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-[200] overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('documentsInPackage')}</span>
                  <span className="text-[10px] text-slate-400">{t('documentsCount', { count: documentPackage.items.length })}</span>
                </div>
                <div className="py-1 max-h-80 overflow-auto">
                  {documentPackage.items.map((doc: any) => {
                    const isActive = doc.id === documentPackage.activeId;
                    const isRenaming = renamingId === doc.id;
                    return (
                      <div key={doc.id} className={`doc-package-item group flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors text-left ${isActive ? 'bg-slate-50' : ''}`}>
                        <i className={`fa-solid ${doc.document_role === 'main' ? 'fa-file-contract text-primary-500' : 'fa-file-lines text-slate-400'} text-xs shrink-0`}></i>
                        <div className="flex-1 min-w-0">
                          {isRenaming ? (
                            <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={async () => { if (renameValue.trim()) { await documentPackage.renameDocument(doc.id, renameValue.trim()); } setRenamingId(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenamingId(null); }} className="w-full text-xs font-semibold text-slate-800 border-b border-primary-400 outline-none bg-transparent" />
                          ) : (
                            <button onClick={() => documentPackage.setActive(doc.id)} className="w-full text-left">
                              <div className="text-xs font-semibold text-slate-800 truncate">{doc.name}</div>
                              <div className="text-[10px] text-slate-400">{doc.document_role === 'main' ? t('roleMain') : t('roleAppendix')} · v{doc.version_number ?? 1}</div>
                            </button>
                          )}
                        </div>
                        {isActive && !isRenaming && (<i className="fa-solid fa-check text-primary-500 text-[10px] shrink-0"></i>)}
                        {!isRenaming && canModifyPackage && (
                          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                            <button title={t('rename')} onClick={(e) => { e.stopPropagation(); setRenamingId(doc.id); setRenameValue(doc.name); }} className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-800"><i className="fa-solid fa-pencil text-[10px]"></i></button>
                            <button title={t('delete')} onClick={async (e) => { e.stopPropagation(); if (confirm(t('confirmDelete', { name: doc.name }))) { await documentPackage.removeDocument(doc.id); } }} className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:bg-red-100 hover:text-red-600"><i className="fa-solid fa-trash text-[10px]"></i></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {canModifyPackage && (
                  <div className="px-3 py-2 border-t border-slate-100">
                    {isCreating ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus value={newDocName} onChange={(e) => setNewDocName(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && newDocName.trim()) { await documentPackage.addDocument(newDocName.trim()); setNewDocName(''); setIsCreating(false); } if (e.key === 'Escape') { setNewDocName(''); setIsCreating(false); } }} placeholder={t('documentName')} className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-primary-400" />
                        <button onClick={() => { setNewDocName(''); setIsCreating(false); }} className="text-xs text-slate-500 hover:text-slate-800">{t('cancel')}</button>
                      </div>
                    ) : (
                      <button onClick={() => setIsCreating(true)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-primary-600 hover:bg-primary-50 text-xs font-semibold transition-colors"><i className="fa-solid fa-plus text-[10px]"></i> {t('addDocumentToPackage')}</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {canEditWithKeyboard && (
            <div className="flex items-center gap-0.5 px-2">
              <button 
                onClick={() => editor?.chain().focus().undo().run()} 
                disabled={!editor?.can().undo()} 
                className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" 
                title={t('undo')}
              >
                <i className="fa-solid fa-rotate-left text-xs"></i>
              </button>
              <button 
                onClick={() => editor?.chain().focus().redo().run()} 
                disabled={!editor?.can().redo()} 
                className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" 
                title={t('redo')}
              >
                <i className="fa-solid fa-rotate-right text-xs"></i>
              </button>
            </div>
          )}

          {canEditWithKeyboard && showFormatting && (
            <div className="w-px h-4 bg-slate-200"></div>
          )}

          {/* Блок форматирования */}
          <div className={`flex items-center gap-0.5 border-x border-slate-200 px-3 mx-1 flex-1 justify-center ${!showFormatting ? 'hidden' : ''}`}>
            <div className="relative" ref={blockStyleRef}>
              <button onClick={() => setBlockStyleOpen(!blockStyleOpen)} className={`h-7 px-2 rounded flex items-center justify-center gap-1.5 transition-colors min-w-[130px] ${blockStyleOpen ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`} title={t('blockStyles')}>
                <span className="text-xs font-medium truncate">{blockStyles.find(b => b.id === getActiveBlockStyle())?.label || t('normalText')}</span>
                <i className="fa-solid fa-chevron-down text-[8px] text-slate-400"></i>
              </button>
              {blockStyleOpen && (
                <div className="absolute top-full left-0 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1.5">
                  {blockStyles.map((style) => {
                    const isActive = getActiveBlockStyle() === style.id;
                    return (
                      <button
                        key={style.id}
                        onClick={() => {
                          if (!editor) return;
                          const chain = editor.chain().focus();
                          if (style.id === 'p') chain.setParagraph().run();
                          else if (style.id === 'h1') chain.toggleHeading({ level: 1 }).run();
                          else if (style.id === 'h2') chain.toggleHeading({ level: 2 }).run();
                          else if (style.id === 'h3') chain.toggleHeading({ level: 3 }).run();
                          else if (style.id === 'h4') chain.toggleHeading({ level: 4 }).run();
                          else if (style.id === 'h5') chain.toggleHeading({ level: 5 }).run();
                          else if (style.id === 'h6') chain.toggleHeading({ level: 6 }).run();
                          else if (style.id === 'quote') chain.toggleBlockquote().run();
                          else if (style.id === 'code') chain.toggleCodeBlock().run();
                          setBlockStyleOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-100 transition-colors ${isActive ? 'bg-slate-50 text-primary-600' : 'text-slate-700'}`}
                      >
                        <div className={`flex-1 ${style.className}`}>{style.label}</div>
                        {isActive && <i className="fa-solid fa-check text-primary-500 text-[10px] shrink-0"></i>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-slate-200 mx-1"></div>
            <button onClick={() => editor?.chain().focus().toggleBold().run()} className={`w-6 h-6 rounded flex items-center justify-center font-bold text-xs transition-colors ${editor?.isActive('bold') ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`} title={t('bold')}>B</button>
            <button onClick={() => editor?.chain().focus().toggleItalic().run()} className={`w-6 h-6 rounded flex items-center justify-center italic text-xs transition-colors ${editor?.isActive('italic') ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`} title={t('italic')}>I</button>
            <button onClick={() => editor?.chain().focus().toggleUnderline().run()} className={`w-6 h-6 rounded flex items-center justify-center underline text-xs transition-colors ${editor?.isActive('underline') ? 'bg-slate-200 text-slate-900' : 'text-slate-700 hover:bg-slate-100'}`} title={t('underline')}>U</button>
            <button onClick={() => editor?.chain().focus().toggleHighlight().run()} className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${editor?.isActive('highlight') ? 'bg-yellow-200 text-yellow-800' : 'text-slate-700 hover:bg-slate-100'}`} title={t('highlight')}><i className="fa-solid fa-highlighter text-yellow-500 text-xs"></i></button>
            <button onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title={t('clearFormatting')}>
              <i className="fa-solid fa-eraser text-xs"></i>
            </button>
            <div className="w-px h-4 bg-slate-200 mx-1"></div>
            <button onClick={() => {
              if (!editor) return;
              const previousUrl = editor.getAttributes('link').href;
              const url = window.prompt(t('enterUrl'), previousUrl || 'https://');
              if (url === null) return;
              if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }} className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${editor?.isActive('link') ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`} title={t('link')}>
              <i className="fa-solid fa-link text-xs"></i>
            </button>
            <button onClick={() => { editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }} className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title={t('insertTable')}>
              <i className="fa-solid fa-table text-xs"></i>
            </button>
            <button onClick={() => editor?.chain().focus().setPageBreak().run()} className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title={t('pageBreak')}>
              <i className="fa-solid fa-grip-lines text-xs"></i> 
            </button>
            <div className="w-px h-4 bg-slate-200 mx-1"></div>
            <div className="relative" ref={alignDropdownRef}>
               <button onClick={() => setAlignDropdownOpen(!alignDropdownOpen)} className={`h-7 px-1.5 rounded flex items-center justify-center transition-colors ${alignDropdownOpen ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`} title={t('alignment')}>
                 <i className={`fa-solid fa-align-${getActiveAlign()} text-xs`}></i>
                 <i className="fa-solid fa-chevron-down text-[8px] ml-1.5 text-slate-400"></i>
               </button>
               {alignDropdownOpen && (
                 <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                   <button onClick={() => { editor?.chain().focus().setTextAlign('left').run(); setAlignDropdownOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-100 transition-colors ${getActiveAlign() === 'left' ? 'text-primary-600 font-semibold' : 'text-slate-700'}`}>
                     <i className="fa-solid fa-align-left w-4 text-center"></i> {t('alignLeft')}
                   </button>
                   <button onClick={() => { editor?.chain().focus().setTextAlign('center').run(); setAlignDropdownOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-100 transition-colors ${getActiveAlign() === 'center' ? 'text-primary-600 font-semibold' : 'text-slate-700'}`}>
                     <i className="fa-solid fa-align-center w-4 text-center"></i> {t('alignCenter')}
                   </button>
                   <button onClick={() => { editor?.chain().focus().setTextAlign('right').run(); setAlignDropdownOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-100 transition-colors ${getActiveAlign() === 'right' ? 'text-primary-600 font-semibold' : 'text-slate-700'}`}>
                     <i className="fa-solid fa-align-right w-4 text-center"></i> {t('alignRight')}
                   </button>
                   <button onClick={() => { editor?.chain().focus().setTextAlign('justify').run(); setAlignDropdownOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-100 transition-colors ${getActiveAlign() === 'justify' ? 'text-primary-600 font-semibold' : 'text-slate-700'}`}>
                     <i className="fa-solid fa-align-justify w-4 text-center"></i> {t('alignJustify')}
                   </button>
                 </div>
               )}
            </div>
            <div className="w-px h-4 bg-slate-200 mx-1"></div>
            <button onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${editor?.isActive('bulletList') ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`} title={t('bulletList')}><i className="fa-solid fa-list-ul text-xs"></i></button>
            <button onClick={() => editor?.chain().focus().insertNextLegalPoint().run()} className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title={t('insertPoint')}>
              <i className="fa-solid fa-list-ol text-xs"></i>
            </button>
            <button onClick={() => editor?.chain().focus().outdentLegalPoint().run()} className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title={t('outdent')}>
              <i className="fa-solid fa-outdent text-xs"></i>
            </button>
            <button onClick={() => editor?.chain().focus().indentLegalPoint().run()} className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title={t('indent')}>
              <i className="fa-solid fa-indent text-xs"></i>
            </button>
            <div className="relative" ref={clauseRefDropdownRef}>
              <button 
                onClick={() => setClauseRefDropdownOpen(!clauseRefDropdownOpen)}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${clauseRefDropdownOpen ? 'bg-slate-200 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`} 
                title={t('insertCrossRef')}
              >
                <i className="fa-solid fa-link text-xs text-indigo-500"></i>
              </button>
              <ClauseRefDropdown 
                editor={editor} 
                isOpen={clauseRefDropdownOpen} 
                onClose={() => setClauseRefDropdownOpen(false)} 
              />
            </div>
          </div>
          <div className="flex items-center gap-0.5 text-slate-600 shrink-0">
            <button className="w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center" onClick={() => setZoom(z => Math.max(50, z - 10))}><i className="fa-solid fa-minus text-[10px]"></i></button>
            <span className="text-[11px] font-medium w-10 text-center">{zoom}%</span>
            <button className="w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center" onClick={() => setZoom(z => Math.min(200, z + 10))}><i className="fa-solid fa-plus text-[10px]"></i></button>
          </div>
        </div>
        
        {/* Canvas */}
        <div 
          ref={scrollContainerRef} 
          className={`flex-1 bg-slate-100 p-8 flex justify-center relative ${
            isContentLoading ? 'overflow-hidden' : 'overflow-auto'
          }`}
        >
          {isSelectingAnchor && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg z-50 animate-pulse pointer-events-none">
              {t('selectTextForComment')}
            </div>
          )}
          {isContentLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-40 flex flex-col items-center justify-center gap-3 transition-opacity">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <span className="text-sm font-medium text-slate-600">{t('loadingDocument')}</span>
            </div>
          )}
          <div 
            id="document-canvas" 
            ref={canvasRef} 
            className={`relative bg-white shadow-md rounded-sm min-h-[1123px] p-10 text-slate-800 text-sm leading-relaxed transition-all origin-top mode-${mode} ${!activeDoc ? 'hidden' : ''} ${mode === 'history' ? 'history-mode' : ''} ${mode === 'review' ? 'review-mode' : ''} ${mode === 'comment' ? 'comment-mode' : ''}`} 
            style={{ width: 794, fontFamily: "'Times New Roman', Times, serif", height: "max-content", transform: `scale(${zoom / 100})` }}
          >
            <EditorContent editor={editor} />
            {editor && <TableDataInjector editor={editor} />}
            {mode === 'markup' && docSetMode === 'template' && <SelectionMenu editor={editor} containerRef={canvasRef} />}
          </div>
          {!activeDoc && (
            <div className="flex flex-col items-center justify-center w-full h-full text-slate-400 py-20">
              <i className="fa-solid fa-folder-open text-6xl mb-4 text-slate-300"></i>
              <p className="text-lg font-semibold text-slate-500">{t('noDocumentsInPackage')}</p>
              <p className="text-sm text-slate-400 mt-2">{t('addFirstDocumentToStart')}</p>
              {canModifyPackage && (
                <button 
                  onClick={() => setDocPackageOpen(true)} 
                  className="mt-6 px-5 py-2.5 bg-primary-500 text-white text-sm font-semibold rounded-lg hover:bg-primary-600 transition-colors shadow-md"
                >
                  <i className="fa-solid fa-plus mr-2"></i> {t('addDocument')}
                </button>
              )}
            </div>
          )}
        </div>
        {editor && canEditWithKeyboard && <TableHoverMenu editor={editor} />}
        <ConversionModal ref={conversionModalRef} />
      </section>
    );
  }
);

DocumentEditor.displayName = 'DocumentEditor';
export default DocumentEditor;