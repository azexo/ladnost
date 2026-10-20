// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// lib/templateImport.ts
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Link from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { templateImportApi, documentsApi } from '@/lib/realApi';
import {
    BlockAttributes, AnchorMark, TokenNode, FormulationSlot, PageBreak,
    CustomTable, CustomTableRow, CustomTableCell, CustomTableHeader
} from '@/components/editor/editorExtensions';
import {
    LegalPoint,
    ClauseRef,
    LegalNumberingPlugin,
    TextNumberToLegalPointPlugin,
    ListToLegalPointPlugin
} from '@/components/editor/LegalPointsExtension';
import type { PropertyOut, VariantOut, SectionOut } from '@/lib/types';
import { getT } from '@/store/i18nStore'; // <-- Импортируем геттер для использования вне React

type LogFunction = (message: string) => void;

// ============================================================================
// УТИЛИТЫ
// ============================================================================
/**
 * Корректное экранирование HTML-сущностей (включая кавычки).
 */
const escapeHtml = (str: string | null | undefined): string => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// ============================================================================
// ВАЛИДАЦИЯ РАСПАРСЕННОГО ШАБЛОНА
// ============================================================================
function validateParsedTemplate(
    json: any,
    originalMd: string,
    properties: PropertyOut[],
    variants: VariantOut[],
    sections: SectionOut[],
    onLog: LogFunction
) {
    const t = getT(); // Получаем функцию перевода

    onLog(t('templateImport.validation.startAnalysis'));
    
    let tokenCount = 0;
    let slotCount = 0;
    let tableCount = 0;
    let dynamicTableCount = 0;
    let templateRowCount = 0;
    
    const foundTokens = new Set<string>();
    const foundSlots = new Set<string>();
    const errors: string[] = [];
    const warnings: string[] = [];

    const walk = (node: any) => {
        if (!node) return;

        if (node.type === 'token') {
            tokenCount++;
            const identifier = node.attrs?.identifier;
            if (!identifier) {
                errors.push(t('templateImport.validation.tokenWithoutId', { uuid: node.attrs?.uuid || 'отсутствует' }));
            } else {
                foundTokens.add(identifier);
                const prop = properties.find(p => p.identifier === identifier);
                if (!prop) {
                    errors.push(t('templateImport.validation.tokenNotFoundInProps', { identifier }));
                } else {
                    if (!node.attrs?.type) warnings.push(t('templateImport.validation.tokenMissingType', { identifier }));
                    if (!node.attrs?.label) warnings.push(t('templateImport.validation.tokenMissingLabel', { identifier }));
                }
            }
        }

        if (node.type === 'formulationSlot') {
            slotCount++;
            const identifier = node.attrs?.slotIdentifier || node.attrs?.identifier;
            if (!identifier) {
                errors.push(t('templateImport.validation.slotWithoutId'));
            } else {
                foundSlots.add(identifier);
                const variant = variants.find(v => v.identifier === identifier);
                if (!variant) {
                    errors.push(t('templateImport.validation.slotNotFoundInVariants', { identifier }));
                }
            }
        }

        if (node.type === 'table' || node.type === 'customTable') {
            tableCount++;
            if (node.attrs?.isDynamic) {
                dynamicTableCount++;
            }
        }

        if (node.type === 'tableRow' || node.type === 'customTableRow') {
            if (node.attrs?.isTemplate) {
                templateRowCount++;
                let hasTokenInRow = false;
                const checkRowForTokens = (child: any) => {
                    if (child?.type === 'token') hasTokenInRow = true;
                    if (child?.content) child.content.forEach(checkRowForTokens);
                };
                if (node.content) node.content.forEach(checkRowForTokens);
                if (!hasTokenInRow) {
                    warnings.push(t('templateImport.validation.templateRowNoTokens'));
                }
            }
        }

        if (node.content && Array.isArray(node.content)) {
            node.content.forEach(walk);
        }
    };
    walk(json);

    const mdPlaceholders = originalMd.match(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g) || [];
    const mdPlaceholderCount = mdPlaceholders.length;
    const totalParsedEntities = tokenCount + slotCount;

    if (mdPlaceholderCount !== totalParsedEntities) {
        warnings.push(t('templateImport.validation.placeholderMismatch', {
            mdCount: mdPlaceholderCount,
            total: totalParsedEntities,
            tokens: tokenCount,
            slots: slotCount
        }));
    }

    const unusedProperties = properties.filter(p => !foundTokens.has(p.identifier));
    const unusedVariants = variants.filter(v => !foundSlots.has(v.identifier));

    if (unusedProperties.length > 0) {
        warnings.push(t('templateImport.validation.unusedProperties', { 
            list: unusedProperties.map(p => p.identifier).join(', ') 
        }));
    }

    if (unusedVariants.length > 0) {
        warnings.push(t('templateImport.validation.unusedVariants', { 
            list: unusedVariants.map(v => v.identifier).join(', ') 
        }));
    }

    onLog(t('templateImport.validation.statsTitle'));
    onLog(t('templateImport.validation.statsTokens', { count: tokenCount }));
    onLog(t('templateImport.validation.statsSlots', { count: slotCount }));
    onLog(t('templateImport.validation.statsTables', { total: tableCount, dynamic: dynamicTableCount }));
    onLog(t('templateImport.validation.statsTemplateRows', { count: templateRowCount }));
    onLog(t('templateImport.validation.statsMdPlaceholders', { count: mdPlaceholderCount }));

    if (errors.length > 0) {
        onLog(t('templateImport.validation.errorsTitle', { count: errors.length }));
        errors.forEach(e => onLog(`   - ${e}`));
    } else {
        onLog(t('templateImport.validation.errorsNone'));
    }

    if (warnings.length > 0) {
        onLog(t('templateImport.validation.warningsTitle', { count: warnings.length }));
        warnings.forEach(w => onLog(`   - ${w}`));
    } else {
        onLog(t('templateImport.validation.warningsNone'));
    }

    onLog(t('templateImport.validation.analysisComplete'));
}

// ============================================================================
// ПОДГОТОВКА MARKDOWN: ЗАМЕНА ПЛЕЙСХОЛДЕРОВ НА HTML-ТЕГИ
// ============================================================================
function prepareMarkdownForTiptap(
    markdown: string,
    properties: PropertyOut[],
    variants: VariantOut[],
    sections: SectionOut[],
    onLog: LogFunction
): string {
    if (!markdown) return ''; // Исправлена опечатка r eturn
    
    const t = getT(); // Получаем функцию перевода

    type BlockType = 'table' | 'list' | 'quote' | 'heading' | 'code' | 'hr' | 'paragraph';
    const getBlockType = (line: string, inCodeBlock: boolean): { type: BlockType, inCodeBlock: boolean } => {
        const trimmed = line.trim();
        if (inCodeBlock) {
            if (trimmed.startsWith('```')) return { type: 'code', inCodeBlock: false };
            return { type: 'code', inCodeBlock: true };
        }
        if (trimmed.startsWith('```')) return { type: 'code', inCodeBlock: true };
        if (/^\|/.test(trimmed)) return { type: 'table', inCodeBlock: false }; 
        if (/^([-*+]|\d+\.)\s/.test(trimmed)) return { type: 'list', inCodeBlock: false }; 
        if (/^>/.test(trimmed)) return { type: 'quote', inCodeBlock: false }; 
        if (/^#{1,6}\s/.test(trimmed)) return { type: 'heading', inCodeBlock: false }; 
        if (/^(---|\*\*\*|___)$/.test(trimmed)) return { type: 'hr', inCodeBlock: false }; 
        return { type: 'paragraph', inCodeBlock: false }; 
    };

    let inCodeBlock = false;
    const normalizedMd = markdown.split('\n').reduce((acc, line, index, arr) => {
        const currentBlock = getBlockType(line, inCodeBlock);
        inCodeBlock = currentBlock.inCodeBlock;
        acc.push(line);
        if (index < arr.length - 1) {
            const nextLine = arr[index + 1];
            const nextBlock = getBlockType(nextLine, inCodeBlock);
            if (line.trim() !== '' && nextLine.trim() !== '') {
                const isSameContinuousBlock = 
                    currentBlock.type === nextBlock.type && 
                    ['table', 'list', 'quote', 'code'].includes(currentBlock.type);
                if (!isSameContinuousBlock) {
                    acc.push(''); 
                }
            }
        }
        return acc;
    }, [] as string[]).join('\n');

    const sectionNameToId: Record<string, number> = {};
    const sectionNameToIsTable: Record<string, boolean> = {};
    for (const sec of sections) {
        sectionNameToId[sec.name] = sec.id;
        sectionNameToIsTable[sec.name] = sec.is_table;
    }

    let matchCount = 0;
    const processedMd = normalizedMd.replace(
        /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
        (match, identifier: string) => {
            matchCount++;
            const property = properties.find(p => p.identifier === identifier);
            if (property) {
                const sectionId = property.section
                    ? (sectionNameToId[property.section] ?? '')
                    : '';
                const isTableCol = property.is_table ? 'true' : 'false';
                const uuid = `tok_${Math.random().toString(36).substr(2, 9)}`;
                
                const tableSuffix = property.is_table ? t('templateImport.prepare.isTableColumn') : '';
                onLog(
                    t('templateImport.prepare.insertProperty', { 
                        count: matchCount, 
                        identifier, 
                        tableSuffix 
                    })
                );

                const safeValue = property.default_value ? escapeHtml(property.default_value) : '\u200B';
                const htmlTag = `<span data-token-uuid="${escapeHtml(uuid)}" data-token-source-id="${property.id}" data-token-identifier="${escapeHtml(identifier)}" data-token-type="property" data-token-label="${escapeHtml(property.name)}" data-token-value="${safeValue}" data-token-display="compact">\u200B</span>`;
                return htmlTag;
            }

            const variant = variants.find(v => v.identifier === identifier);
            if (variant) {
                onLog(
                    t('templateImport.prepare.insertVariant', { count: matchCount, identifier })
                );
                const slotTag = `<span data-slot-identifier="${escapeHtml(identifier)}">\u200B</span>`;
                return slotTag;
            }

            onLog(
                t('templateImport.prepare.entityNotFound', { count: matchCount, identifier })
            );
            return match;
        }
    );

    onLog(t('templateImport.prepare.totalProcessed', { count: matchCount }));
    return processedMd;
}

// ============================================================================
// ПОСТ-ОБРАБОТКА JSON: ПОМЕТКА ДИНАМИЧЕСКИХ ТАБЛИЦ
// ============================================================================
function markDynamicTables(
    json: any,
    properties: PropertyOut[],
    sections: SectionOut[],
    onLog: LogFunction
): void {
    if (!json) return;
    const t = getT(); // Получаем функцию перевода

    const sectionNameToId: Record<string, number> = {};
    for (const sec of sections) sectionNameToId[sec.name] = sec.id;

    const identifierToSectionId: Record<string, number | null> = {};
    for (const prop of properties) {
        identifierToSectionId[prop.identifier] = prop.section ? (sectionNameToId[prop.section] ?? null) : null;
    }

    const cellTypes = ['tableCell', 'tableHeader', 'customTableCell', 'customTableHeader'];
    
    const walk = (node: any) => {
        if (!node) return;
        if (node.type === 'table' || node.type === 'customTable') {
            let tableHasTemplateRow = false;
            if (node.content && Array.isArray(node.content)) {
                for (const row of node.content) {
                    if (row.type !== 'tableRow' && row.type !== 'customTableRow') continue;
                    let allCellsHaveToken = true;
                    let hasAnyCell = false;
                    const rowSectionIds = new Set<number>();
                    if (row.content && Array.isArray(row.content)) {
                        for (const cell of row.content) {
                            if (!cellTypes.includes(cell.type)) continue;
                            hasAnyCell = true;
                            let cellHasToken = false;
                            const checkTokenInCell = (child: any) => {
                                if (!child) return;
                                if (child.type === 'token') {
                                    cellHasToken = true;
                                    const secId = identifierToSectionId[child.attrs?.identifier];
                                    if (secId !== undefined && secId !== null) {
                                        rowSectionIds.add(secId);
                                    }
                                }
                                if (child.content && Array.isArray(child.content)) {
                                    child.content.forEach(checkTokenInCell);
                                }
                            };
                            if (cell.content && Array.isArray(cell.content)) {
                                cell.content.forEach(checkTokenInCell);
                            }
                            if (!cellHasToken) {
                                allCellsHaveToken = false;
                                break; 
                            }
                        }
                    }
                    if (hasAnyCell && allCellsHaveToken) {
                        row.attrs = {
                            ...(row.attrs || {}),
                            isTemplate: true,
                            isInjected: false,
                        };
                        if (rowSectionIds.size === 1) {
                            row.attrs.sectionId = [...rowSectionIds][0];
                        }
                        tableHasTemplateRow = true;
                        onLog(t('templateImport.tables.rowMarkedTemplate', { sectionId: row.attrs.sectionId || 'none' }));
                    }
                }
            }
            if (tableHasTemplateRow) {
                node.attrs = { ...(node.attrs || {}), isDynamic: true };
                onLog(t('templateImport.tables.dynamicTableFound'));
            }
        }
        if (node.content && Array.isArray(node.content)) {
            node.content.forEach((child: any) => walk(child));
        }
    };
    walk(json);
}

// ============================================================================
// ОСНОВНАЯ ФУНКЦИЯ ИМПОРТА
// ============================================================================
export async function processAndSaveTemplateFromYaml(
    yamlContent: string,
    markdownBody: string,
    onLog: LogFunction
): Promise<void> {
    let editor: Editor | null = null;
    const t = getT(); // Получаем функцию перевода

    try {
        onLog(t('templateImport.import.start'));
        onLog(t('templateImport.import.sendingToBackend'));
        
        const importResult = await templateImportApi.importFromYaml(yamlContent, markdownBody);
        console.log('[DEBUG FRONT]', t('templateImport.import.debugRawResponse'), importResult);
        
        const { document_id, properties, variants, sections } = importResult;
        
        onLog(t('templateImport.import.backendSuccess', { documentId: document_id }));
        onLog(t('templateImport.import.statsSections', { count: sections?.length ?? 0 }));
        onLog(t('templateImport.import.statsProperties', { count: properties?.length ?? 0 }));
        onLog(t('templateImport.import.statsVariants', { count: variants?.length ?? 0 }));

        if (importResult.warnings && importResult.warnings.length > 0) {
            for (const w of importResult.warnings) {
                onLog(t('templateImport.import.backendWarning', { message: w }));
            }
        }

        onLog(t('templateImport.import.preparingMarkdown'));
        const processedMarkdown = prepareMarkdownForTiptap(
            markdownBody,
            properties ?? [],
            variants ?? [],
            sections ?? [],
            onLog
        );
        
        onLog(t('templateImport.import.debugProcessedMd'));
        onLog(
            processedMarkdown.substring(0, 800) +
            (processedMarkdown.length > 800 ? '...' : '')
        );
        onLog('-');

        onLog(t('templateImport.import.initEditor'));
        editor = new Editor({
            extensions: [
                StarterKit.configure({ orderedList: false }),
                Markdown.configure({
                    html: true,
                    transformCopiedText: true,
                    transformPastedText: true,
                }),
                Underline,
                Highlight,
                TextStyle,
                Color.configure({ types: [TextStyle.name, 'heading'] }),
                Link.configure({ openOnClick: false }),
                Image.configure({ inline: true, allowBase64: true }),
                TextAlign.configure({ types: ['heading', 'paragraph'] }),
                CustomTable.configure({ resizable: true }),
                CustomTableRow,
                CustomTableHeader,
                CustomTableCell,
                BlockAttributes,
                AnchorMark,
                TokenNode,
                FormulationSlot,
                PageBreak,
                LegalPoint,
                ClauseRef,
                LegalNumberingPlugin,
                ListToLegalPointPlugin,
                TextNumberToLegalPointPlugin,
            ],
            content: processedMarkdown,
        });

        onLog(t('templateImport.import.extractJsonHtml'));
        const tiptapJson = editor.getJSON();
        const tiptapHtml = editor.getHTML();
        
        onLog(t('templateImport.import.debugEditorHtml'));
        onLog(
            tiptapHtml.substring(0, 800) +
            (tiptapHtml.length > 800 ? '...' : '')
        );
        onLog('-');

        onLog(t('templateImport.import.postProcessingTables'));
        markDynamicTables(tiptapJson, properties ?? [], sections ?? [], onLog);

        validateParsedTemplate(
            tiptapJson, 
            markdownBody, 
            properties ?? [], 
            variants ?? [], 
            sections ?? [], 
            onLog
        );

        onLog(t('templateImport.import.savingToDb'));
        await documentsApi.updateContent(document_id, tiptapJson, tiptapHtml);
        onLog(t('templateImport.import.success'));
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Неизвестная ошибка';
        onLog(t('templateImport.import.criticalError', { message: errorMsg }));
        throw error;
    } finally {
        if (editor) {
            editor.destroy();
            onLog(t('templateImport.import.editorDestroyed'));
        }
    }
}

export function parseMarkdownToTiptap(markdown: string): { json: any; html: string } {
    const editor = new Editor({
        extensions: [
            StarterKit.configure({ orderedList: false }),
            Markdown.configure({
                html: true,
                transformCopiedText: true,
                transformPastedText: true,
            }),
            Underline, Highlight, TextStyle,
            Color.configure({ types: [TextStyle.name, 'heading'] }),
            Link.configure({ openOnClick: false }),
            Image.configure({ inline: true, allowBase64: true }),
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            CustomTable.configure({ resizable: true }),
            CustomTableRow, CustomTableHeader, CustomTableCell,
            BlockAttributes, AnchorMark, TokenNode, FormulationSlot, PageBreak,
            LegalPoint, ClauseRef, LegalNumberingPlugin,
            ListToLegalPointPlugin, TextNumberToLegalPointPlugin,
        ],
        content: markdown,
    });

    const json = editor.getJSON();
    const html = editor.getHTML();
    
    editor.destroy(); 
    return { json, html };
}