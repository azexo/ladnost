// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/diffUtils.ts
// ==========================================
// 🆕 УТИЛИТЫ ДЛЯ DIFF (СРАВНЕНИЯ JSON)
// ==========================================

/**
 * Вспомогательная функция: извлекает все символы из блока и их marks
 */
function flattenTextNodes(content: any[]) {
    const chars: { char: string, marks: any[] }[] = [];
    function traverse(nodes: any[]) {
        if (!nodes) return;
        for (const node of nodes) {
            if (node.type === 'text') {
                const marks = node.marks || [];
                for (const c of node.text) {
                    chars.push({ char: c, marks: [...marks] });
                }
            } else if (node.content) {
                traverse(node.content);
            }
        }
    }
    traverse(content);
    return chars;
}

/**
 * Вычисляет посимвольный LCS и объединяет непрерывные операции
 */
function getCharDiff(oldStr: string, newStr: string) {
    const m = oldStr.length;
    const n = newStr.length;
    
    // ⚠️ Защита от зависания браузера на очень длинных текстах
    if (m * n > 10000000) {
        return [
            { type: 'delete', text: oldStr },
            { type: 'insert', text: newStr }
        ];
    }

    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldStr[i - 1] === newStr[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    
    const result: { type: 'equal' | 'delete' | 'insert', char: string }[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (oldStr[i - 1] === newStr[j - 1]) {
            result.unshift({ type: 'equal', char: oldStr[i - 1] });
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            result.unshift({ type: 'delete', char: oldStr[i - 1] });
            i--;
        } else {
            result.unshift({ type: 'insert', char: newStr[j - 1] });
            j--;
        }
    }
    while (i > 0) result.unshift({ type: 'delete', char: oldStr[i - 1] }), i--;
    while (j > 0) result.unshift({ type: 'insert', char: newStr[j - 1] }), j--;
    
    // Объединяем непрерывные символы с одинаковым статусом
    const merged: { type: 'equal' | 'delete' | 'insert', text: string }[] = [];
    for (const op of result) {
        const last = merged[merged.length - 1];
        if (last && last.type === op.type) {
            last.text += op.char;
        } else {
            merged.push({ type: op.type, text: op.char });
        }
    }
    return merged;
}

/**
 * Добавляет mark, если его еще нет
 */
function addMark(marks: any[], markType: string) {
    if (!marks.some((m: any) => m.type === markType)) {
        marks.push({ type: markType, attrs: { author: 'system', date: new Date().toISOString() } });
    }
}

/**
🆕 Главный инлайн-diff: сравнивает текст внутри двух блоков,
сохраняя оригинальные marks (жирный, курсив и т.д.)
*/
function computeInlineDiff(oldBlock: any, newBlock: any) {
    const oldChars = flattenTextNodes(oldBlock.content || []);
    const newChars = flattenTextNodes(newBlock.content || []);
    
    const oldText = oldChars.map(c => c.char).join('');
    const newText = newChars.map(c => c.char).join('');
    const textDiff = getCharDiff(oldText, newText);
    
    const resultNodes: any[] = [];
    let oldIdx = 0;
    let newIdx = 0;
    
    for (const segment of textDiff) {
        const charsToProcess = [];
        
        // 🔥 ИСПРАВЛЕНИЕ: Корректная синхронизация индексов
        for (const char of segment.text) {
            if (segment.type === 'equal') {
                // Текст не изменился: берем символ из old (сохраняем старые marks) 
                // и ОБЯЗАТЕЛЬНО двигаем оба индекса
                if (oldIdx < oldChars.length) charsToProcess.push(oldChars[oldIdx++]);
                newIdx++; 
            } else if (segment.type === 'delete') {
                // Текст удален: берем из old и двигаем только oldIdx
                if (oldIdx < oldChars.length) charsToProcess.push(oldChars[oldIdx++]);
            } else if (segment.type === 'insert') {
                // Текст добавлен: берем из new и двигаем только newIdx
                if (newIdx < newChars.length) charsToProcess.push(newChars[newIdx++]);
            }
        }

        if (charsToProcess.length === 0) continue;
        
        let chunkText = '';
        let chunkMarks = charsToProcess[0]?.marks ? [...charsToProcess[0].marks] : [];
        
        // Собираем куски текста с одинаковыми marks
        for (let k = 0; k < charsToProcess.length; k++) {
            const c = charsToProcess[k];
            const cMarks = c.marks || [];
            const marksMatch = JSON.stringify(cMarks) === JSON.stringify(chunkMarks);
            
            if (marksMatch) {
                chunkText += c.char;
            } else {
                if (chunkText) {
                    const finalMarks = [...chunkMarks];
                    if (segment.type === 'delete') addMark(finalMarks, 'trackDelete');
                    if (segment.type === 'insert') addMark(finalMarks, 'trackAdd');
                    resultNodes.push({ type: 'text', text: chunkText, marks: finalMarks });
                }
                chunkText = c.char;
                chunkMarks = [...cMarks];
            }
        }
        
        // Добавляем последний накопленный кусок
        if (chunkText) {
            const finalMarks = [...chunkMarks];
            if (segment.type === 'delete') addMark(finalMarks, 'trackDelete');
            if (segment.type === 'insert') addMark(finalMarks, 'trackAdd');
            resultNodes.push({ type: 'text', text: chunkText, marks: finalMarks });
        }
    }
    
    // Возвращаем новый блок, сохраняя его attrs (например, id, выравнивание)
    return {
        ...newBlock,
        content: resultNodes
    };
}

/**
 * Алгоритм LCS для поиска различий в массивах блоков (Блочный уровень)
 */
export function lcsDiff(arr1: any[], arr2: any[]) {
    const m = arr1.length;
    const n = arr2.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (JSON.stringify(arr1[i - 1]) === JSON.stringify(arr2[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    const result: { type: 'equal' | 'delete' | 'insert', item: any }[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (JSON.stringify(arr1[i - 1]) === JSON.stringify(arr2[j - 1])) {
            result.unshift({ type: 'equal', item: arr1[i - 1] });
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            result.unshift({ type: 'delete', item: arr1[i - 1] });
            i--;
        } else {
            result.unshift({ type: 'insert', item: arr2[j - 1] });
            j--;
        }
    }
    while (i > 0) {
        result.unshift({ type: 'delete', item: arr1[i - 1] });
        i--;
    }
    while (j > 0) {
        result.unshift({ type: 'insert', item: arr2[j - 1] });
        j--;
    }
    return result;
}

/**
 * Рекурсивно применяет маркер ко всем текстовым нодам внутри блока (Для целых блоков)
 */
export function applyMarkToBlock(block: any, markType: string) {
    const clone = JSON.parse(JSON.stringify(block));
    function traverse(node: any) {
        if (node.type === 'text') {
            if (!node.marks) node.marks = [];
            if (!node.marks.some((m: any) => m.type === markType)) {
                node.marks.push({ type: markType, attrs: { author: 'system', date: new Date().toISOString() } });
            }
        }
        if (node.content) {
            node.content.forEach(traverse);
        }
    }
    traverse(clone);
    return clone;
}

/**
 * 🆕 Вычисляет diff: Блочный LCS + Постобработка для поиска изменений + Инлайн-diff
 */
export function computeDiff(baseJson: any, targetJson: any) {
    if (!baseJson) baseJson = { type: 'doc', content: [] };
    const baseContent = baseJson.content || [];
    const targetContent = targetJson?.content || [];
    
    // 1. Блочный LCS
    const rawOps = lcsDiff(baseContent, targetContent);
    
    // 2. Постобработка: Ищем соседние delete + insert одного типа (это означает редактирование)
    const finalOps: any[] = [];
    let i = 0;
    while (i < rawOps.length) {
        const op = rawOps[i];
        const nextOp = rawOps[i + 1];
        
        // Если блок удален, а следом вставлен блок ТАКОГО ЖЕ ТИПА (и это не сложная таблица)
        if (
            op.type === 'delete' && 
            nextOp && 
            nextOp.type === 'insert' &&
            op.item.type === nextOp.item.type &&
            op.item.type !== 'table' // Таблицы сравниваем только поблочно, чтобы не сломать сетку
        ) {
            finalOps.push({ 
                type: 'modify', 
                oldBlock: op.item, 
                newBlock: nextOp.item 
            });
            i += 2; // Пропускаем оба
        } else {
            finalOps.push(op);
            i++;
        }
    }
    
    // 3. Сборка итогового JSON
    const newContent = [];
    for (const op of finalOps) {
        if (op.type === 'equal') {
            newContent.push(op.item);
        } else if (op.type === 'delete') {
            // Блок полностью удален
            newContent.push(applyMarkToBlock(op.item, 'trackDelete'));
        } else if (op.type === 'insert') {
            // Блок полностью добавлен
            newContent.push(applyMarkToBlock(op.item, 'trackAdd'));
        } else if (op.type === 'modify') {
            // 🆕 Блок изменен: делаем посимвольное сравнение внутри
            newContent.push(computeInlineDiff(op.oldBlock, op.newBlock));
        }
    }
    
    return {
        ...baseJson,
        content: newContent
    };
}