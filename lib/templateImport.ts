// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later
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
        .replace(/'/g, '&#39;');
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

    const mdPlaceholders = originalMd.match(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g) || [];
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

/**
 * Удаляет общий ведущий отступ (Common Indent).
 * Это спасает от ситуации, когда весь текст сдвинут вправо на N пробелов,
 * из-за чего Markdown-парсер превращает абзацы в блоки кода (<pre><code>).
 */
const normalizeMarkdownIndents = (markdown: string): string => {
    const lines = markdown.split('\n');
    let minIndent = Infinity;

    // Находим минимальный отступ среди непустых строк
    for (const line of lines) {
        if (line.trim().length > 0) {
            const match = line.match(/^[ \t]*/);
            if (match && match[0].length < minIndent) {
                minIndent = match[0].length;
            }
        }
    }

    // Если отступа нет или он минимален, возвращаем как есть
    if (minIndent === Infinity || minIndent === 0) return markdown;

    // Убираем найденный общий отступ у всех строк
    return lines.map(line => {
        if (line.trim().length === 0) return ''; // Пустые строки оставляем пустыми
        return line.substring(minIndent);
    }).join('\n');
};

/**
 * Убирает лишние пустые строки (схлопывает 3+ переноса в 2).
 */
const removeExtraBlankLines = (markdown: string): string => {
    return markdown.replace(/\n{3,}/g, '\n\n').trim();
};

// ============================================================================
// ЗАМЕНА ПЛЕЙСХОЛДЕРОВ НА НАТИВНЫЕ НОДЫ В JSON
// ============================================================================

function replacePlaceholdersWithNativeNodes(
    json: any,
    properties: PropertyOut[],
    variants: VariantOut[],
    sections: SectionOut[],
    onLog: LogFunction
): void {
    if (!json) return;
    const t = getT();

    const sectionNameToId: Record<string, number> = {};
    for (const sec of sections) sectionNameToId[sec.name] = sec.id;

    const placeholderRegex = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
    let matchCount = 0;

    // Рекурсивная обработка. Возвращает либо одну ноду, либо массив нод
    // (когда текстовая нода разбивается на части).
    const processNode = (node: any): any | any[] => {
        if (!node) return node;

        // === Базовый случай: текстовая нода ===
        if (node.type === 'text' && typeof node.text === 'string') {
            const text = node.text;
            placeholderRegex.lastIndex = 0;
            if (!placeholderRegex.test(text)) return node;
            placeholderRegex.lastIndex = 0;

            const parts: any[] = [];
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = placeholderRegex.exec(text)) !== null) {
                const identifier = match[1];
                const fullMatch = match[0];
                const startIndex = match.index;

                // 1) Текст ДО плейсхолдера (наследует marks исходной ноды)
                if (startIndex > lastIndex) {
                    const textBefore = text.substring(lastIndex, startIndex);
                    parts.push({
                        type: 'text',
                        text: textBefore,
                        ...(node.marks ? { marks: [...node.marks] } : {}),
                    });
                }

                // 2) Сам плейсхолдер → токен или слот
                const property = properties.find(p => p.identifier === identifier);
                if (property) {
                    matchCount++;
                    const uuid = `tok_${Math.random().toString(36).substr(2, 9)}`;
                    const tableSuffix = property.is_table
                        ? t('templateImport.prepare.isTableColumn')
                        : '';
                    onLog(
                        t('templateImport.prepare.insertProperty', {
                            count: matchCount,
                            identifier,
                            tableSuffix,
                        })
                    );

                    parts.push({
                        type: 'token',
                        attrs: {
                            uuid,
                            sourceId: property.id,
                            identifier,
                            type: 'property',
                            label: property.name,
                            value: property.default_value || '',
                            displayMode: 'compact',
                        },
                    });
                } else {
                    const variant = variants.find(v => v.identifier === identifier);
                    if (variant) {
                        matchCount++;
                        onLog(
                            t('templateImport.prepare.insertVariant', {
                                count: matchCount,
                                identifier,
                            })
                        );
                        parts.push({
                            type: 'formulationSlot',
                            attrs: { identifier },
                        });
                    } else {
                        matchCount++;
                        onLog(
                            t('templateImport.prepare.entityNotFound', {
                                count: matchCount,
                                identifier,
                            })
                        );
                        // Неизвестный плейсхолдер — оставляем как обычный текст
                        parts.push({
                            type: 'text',
                            text: fullMatch,
                            ...(node.marks ? { marks: [...node.marks] } : {}),
                        });
                    }
                }

                lastIndex = startIndex + fullMatch.length;
            }

            // 3) Текст ПОСЛЕ последнего плейсхолдера
            if (lastIndex < text.length) {
                parts.push({
                    type: 'text',
                    text: text.substring(lastIndex),
                    ...(node.marks ? { marks: [...node.marks] } : {}),
                });
            }

            return parts;
        }

        // === Рекурсия по содержимому ===
        if (node.content && Array.isArray(node.content)) {
            const newContent: any[] = [];
            for (const child of node.content) {
                const processed = processNode(child);
                if (Array.isArray(processed)) {
                    newContent.push(...processed);
                } else if (processed) {
                    newContent.push(processed);
                }
            }
            node.content = newContent;
        }

        return node;
    };

    processNode(json);
    onLog(t('templateImport.prepare.totalProcessed', { count: matchCount }));
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
    const t = getT();

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

                    const rowSectionIds = new Set<number>();
                    let hasTokens = false;

                    // Рекурсивно собираем ID секций всех токенов внутри ячейки
                    const collectTokenSections = (child: any) => {
                        if (!child) return;
                        if (child.type === 'token') {
                            hasTokens = true;
                            const secId = identifierToSectionId[child.attrs?.identifier];
                            if (secId !== undefined && secId !== null) {
                                rowSectionIds.add(secId);
                            } else {
                                // Если у токена нет секции, добавляем -1, 
                                // чтобы гарантированно сломать условие "все в одной секции"
                                rowSectionIds.add(-1); 
                            }
                        }
                        if (child.content && Array.isArray(child.content)) {
                            child.content.forEach(collectTokenSections);
                        }
                    };

                    // Обходим ячейки строки
                    if (row.content && Array.isArray(row.content)) {
                        for (const cell of row.content) {
                            if (!cellTypes.includes(cell.type)) continue;
                            
                            // ИСПРАВЛЕНО: теперь проверяем cell.content, а не node.content
                            if (cell.content && Array.isArray(cell.content)) {
                                cell.content.forEach(collectTokenSections);
                            }
                        }
                    }

                    // ====================================================================
                    // ПРОВЕРКА УСЛОВИЙ ДЛЯ ШАБЛОННОЙ СТРОКИ:
                    // 1. В строке есть хотя бы один токен (hasTokens)
                    // 2. Все токены принадлежат РОВНО ОДНОЙ секции (rowSectionIds.size === 1)
                    // ====================================================================
                    if (hasTokens && rowSectionIds.size === 1) {
                        const sectionId = [...rowSectionIds][0];
                        const targetSection = sections.find(s => s.id === sectionId);

                        // 3. Секция должна иметь флаг "табличная" 
                        // (Предполагаем, что флаг называется is_table, как у PropertyOut. 
                        // Если у вас в SectionOut он называется иначе, например isTable - замените)
                        if (targetSection && (targetSection as any).is_table) { 
                            row.attrs = {
                                ...(row.attrs || {}),
                                isTemplate: true,
                                isInjected: false,
                                sectionIdentifier: targetSection.name,
                            };
                            tableHasTemplateRow = true;
                            onLog(t('templateImport.tables.rowMarkedTemplate', { sectionId: targetSection.name }));
                        }
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

        // === ШАГ 0: Предварительная очистка Markdown ===
        onLog('Очистка лишних отступов и пустых строк...');
        const cleanMarkdown = normalizeMarkdownIndents(markdownBody);
        const finalMarkdown = removeExtraBlankLines(cleanMarkdown);

        onLog(t('templateImport.import.sendingToBackend'));

        const importResult = await templateImportApi.importFromYaml(yamlContent, finalMarkdown);
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

        // === ШАГ 1. Парсим markdown в чистый Tiptap JSON ===
        onLog(t('templateImport.import.parsingMarkdown'));
        const { json: tiptapJson } = parseMarkdownToTiptap(finalMarkdown);

        onLog(t('templateImport.import.debugParsedJson'));
        onLog(JSON.stringify(tiptapJson).substring(0, 800) + (JSON.stringify(tiptapJson).length > 800 ? '...' : ''));
        onLog('-');

        // === ШАГ 2. Заменяем плейсхолдеры на НАТИВНЫЕ ноды ===
        onLog(t('templateImport.import.replacingPlaceholders'));
        replacePlaceholdersWithNativeNodes(
            tiptapJson,
            properties ?? [],
            variants ?? [],
            sections ?? [],
            onLog
        );

        // === ШАГ 3. Пост-обработка таблиц ===
        onLog(t('templateImport.import.postProcessingTables'));
        markDynamicTables(tiptapJson, properties ?? [], sections ?? [], onLog);

        // === ШАГ 4. Валидация ===
        validateParsedTemplate(
            tiptapJson,
            markdownBody,
            properties ?? [],
            variants ?? [],
            sections ?? [],
            onLog
        );

        // === ШАГ 5. Получаем HTML из обогащённого JSON через Editor ===
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
            content: tiptapJson, // ← передаём уже готовый JSON, а не markdown
        });

        onLog(t('templateImport.import.extractJsonHtml'));
        const tiptapHtml = editor.getHTML();

        onLog(t('templateImport.import.debugEditorHtml'));
        onLog(tiptapHtml.substring(0, 800) + (tiptapHtml.length > 800 ? '...' : ''));
        onLog('-');

        // === ШАГ 6. Сохраняем ===
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