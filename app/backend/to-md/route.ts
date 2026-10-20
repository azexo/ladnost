// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { appendFileSync } from 'fs'; // <--- ДОБАВЛЕНО: для гарантированной записи логов
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

// ==================== НАСТРОЙКИ ИИ (из init_rag_db.py) ====================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '???'; 
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || '???').replace(/\/$/, '');
const LLM_MODEL = '~deepseek/deepseek-v4-flash-latest';

/**
 * Пост-обработка Markdown через LLM с механизмом повторных попыток (Retry)
 */
async function postProcessWithAI(rawMarkdown: string): Promise<string> {
    const systemPrompt = "Ты — эксперт по форматированию юридических и нормативных документов. Твоя задача — исправить и улучшить структуру текста.";
    const userPrompt = `конвертируй в markdown. используй десятичную многоуровневую нумерацию пунктов вида "1.1.1." где необходимо
Исходный текст:
${rawMarkdown}`;

    let attempts = 0;
    const maxAttempts = 3; 
    
    while (attempts < maxAttempts) {
        try {
            const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: LLM_MODEL,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.3, 
                    stream: false,
                    enable_thinking: false, 
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`[AI Retry] HTTP ошибка: ${response.status}. Попытка ${attempts + 1}/${maxAttempts}. Текст: ${errorText}`);
                attempts++;
                if (attempts >= maxAttempts) throw new Error(`AI API failed after ${maxAttempts} attempts`);
                
                // Экспоненциальная задержка (аналог wait_exponential)
                const delay = Math.min(10000, 2000 * Math.pow(2, attempts)); 
                await new Promise(res => setTimeout(res, delay));
                continue;
            }

            const data = await response.json();
            const aiResult = data.choices?.[0]?.message?.content;
            
            if (aiResult) {
                return aiResult.trim();
            } else {
                throw new Error('Invalid AI response format');
            }
        } catch (error) {
            console.error(`[AI Retry] Ошибка вызова LLM: ${error}. Попытка ${attempts + 1}/${maxAttempts}`);
            attempts++;
            if (attempts >= maxAttempts) {
                console.error("[AI Fallback] Критическая ошибка ИИ после всех попыток. Возвращаем исходный Markdown.");
                return rawMarkdown; // Fallback: возвращаем сырой текст, чтобы не упасть с ошибкой 500
            }
            const delay = Math.min(10000, 2000 * Math.pow(2, attempts));
            await new Promise(res => setTimeout(res, delay));
        }
    }
    return rawMarkdown;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        const originalName = file.name || 'document';
        const ext = path.extname(originalName).toLowerCase();

        if (ext !== '.docx' && ext !== '.pdf' && ext !== '.rtf') {
            return NextResponse.json(
                { error: 'Unsupported file format. Only DOCX, PDF, and RTF are supported.' }, 
                { status: 400 }
            );
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-import-'));
        const inputPath = path.join(tempDir, `input${ext}`);
        const outputPath = path.join(tempDir, 'output.md');

        const arrayBuffer = await file.arrayBuffer();
        await fs.writeFile(inputPath, Buffer.from(arrayBuffer));

        if (ext === '.docx') {
            const pyScriptPath = path.join(__dirname, 'convert_docx.py');
            await execFileAsync(PYTHON_BIN, [pyScriptPath, inputPath, outputPath], { timeout: 360000 });
        } else if (ext === '.pdf') {
            const pyScriptPath = path.join(__dirname, 'convert_pdf.py');
            await execFileAsync(PYTHON_BIN, [pyScriptPath, inputPath, outputPath], { timeout: 360000 }); 
        } else if (ext === '.rtf') {
            const pyScriptPath = path.join(__dirname, 'convert_rtf.py');
            await execFileAsync(PYTHON_BIN, [pyScriptPath, inputPath, outputPath], { timeout: 360000 });
        }

        // 1. Читаем сырой Markdown после конвертации Python-скриптами
        const rawMdContent = await fs.readFile(outputPath, 'utf-8');

        // 2. Пост-обработка форматирования через ИИ
        console.log(`[AI] Запуск пост-обработки Markdown для файла: ${originalName}...`);
        const finalMdContent = await postProcessWithAI(rawMdContent);
        console.log(`[AI] Пост-обработка завершена.`);

        // Очистка временных файлов
        await fs.rm(tempDir, { recursive: true, force: true });

        return NextResponse.json({ 
            markdown: finalMdContent, 
            warnings: [] 
        }, { status: 200 });

    } catch (error: unknown) {
        // ==========================================================
        // ЖЕСТКОЕ ЛОГИРОВАНИЕ В ФАЙЛ (в обход буферизации Next.js/PM2)
        // ==========================================================
        const debugLogPath = '/tmp/clm-debug-error.log';
        const errMsg = error instanceof Error ? (error.stack || error.message) : String(error);
        const stderrMsg = (typeof error === 'object' && error !== null && 'stderr' in error) 
                          ? (error as any).stderr 
                          : 'stderr отсутствует (возможно, ошибка ENOENT, таймаут или системная ошибка)';
        
        try {
            appendFileSync(
                debugLogPath, 
                `[${new Date().toISOString()}] ОШИБКА: ${errMsg}\nSTDERR: ${stderrMsg}\n================================\n`
            );
        } catch (logErr) {
            console.error('Не удалось записать в лог-файл:', logErr);
        }
        // ==========================================================

        // Стандартные логи (на случай, если они всё же пробьются)
        console.error('Import error:', error);
        if (typeof error === 'object' && error !== null && 'stderr' in error) {
            console.error('Python stderr:', (error as any).stderr);
        } else if (error instanceof Error) {
            console.error('Error message:', error.message);
        }
        
        return NextResponse.json(
            { 
                error: 'Failed to parse document to Markdown', 
                details: errMsg // Возвращаем текст ошибки клиенту для мгновенной отладки
            },
            { status: 500 }
        );
    }
}