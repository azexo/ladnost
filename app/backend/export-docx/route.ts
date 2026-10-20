// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const LUA_FILTER_PATH = path.join(process.cwd(), 'pandoc-filter.lua');

function convertWithPandoc(html: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pandoc = spawn('pandoc', [
      '-f', 'html',
      '-t', 'docx',
      `--lua-filter=${LUA_FILTER_PATH}`
    ]);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: string[] = [];
    pandoc.stdout.on('data', (data) => stdoutChunks.push(data));
    pandoc.stderr.on('data', (data) => stderrChunks.push(data.toString()));
    pandoc.on('close', (code) => {
      const stderrOutput = stderrChunks.join('');
      
      // 🚨 ОТЛАДКА: Сохраняем вывод Lua-фильтра (stderr) в отдельный файл
      if (stderrOutput) {
        fs.writeFileSync('debug_pandoc.log', stderrOutput, 'utf-8');
        console.log('✅ [Pandoc Debug] Логи Lua-фильтра сохранены в debug_pandoc.log');
      }

      if (code !== 0) {
        reject(new Error(`Pandoc failed with code ${code}: ${stderrOutput}`));
      } else {
        resolve(Buffer.concat(stdoutChunks));
      }
    });
    pandoc.on('error', (err) => reject(new Error(`Failed to start Pandoc: ${err.message}`)));
    pandoc.stdin.write(html);
    pandoc.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const { html, fileName } = await req.json();
    if (!html) {
      return NextResponse.json({ error: 'HTML is required' }, { status: 400 });
    }

    const $ = cheerio.load(html);

    // 1. Очистка от мусорных атрибутов (ProseMirror и т.д.)
    $('[contenteditable]').removeAttr('contenteditable');
    $('[data-token-uuid], [data-token-source-id], [data-token-identifier], [data-token-type], [data-token-label], [data-token-value], [data-anchor-uuid], [data-anchor-type]').each((_, el) => {
      const $el = $(el);
      Object.keys($el.attr() || {}).forEach(attr => {
        if (attr.startsWith('data-')) $el.removeAttr(attr);
      });
    });

    // 2. ПРЕОБРАЗОВАНИЕ INLINE-СТИЛЕЙ В КЛАССЫ
    $('*').each((_, el) => {
      const $el = $(el);
      if ($el.is('mark')) {
        $el.replaceWith(`<span class="mark">${$el.html()}</span>`);
        return;
      }
      const style = $el.attr('style');
      if (!style) return;
      const styles: Record<string, string> = {};
      style.split(';').forEach(rule => {
        const [key, val] = rule.split(':').map(s => s.trim());
        if (key && val) styles[key.toLowerCase()] = val;
      });
      const classes = ($el.attr('class') || '').split(' ').filter(c => c && !c.startsWith('ProseMirror'));
      let hasChanges = false;
      if (styles['text-align']) {
        const align = styles['text-align'].toLowerCase();
        if (['left', 'center', 'right', 'justify'].includes(align)) {
          classes.push(`text-${align}`);
          delete styles['text-align'];
          hasChanges = true;
        }
      }
      if (styles['background-color'] || styles['background']) {
        classes.push('mark');
        delete styles['background-color'];
        delete styles['background'];
        hasChanges = true;
      }
      if (hasChanges) {
        if (classes.length > 0) {
          $el.attr('class', classes.join(' '));
        } else {
          $el.removeAttr('class');
        }
        const remainingStyles = Object.entries(styles)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        if (remainingStyles) {
          $el.attr('style', remainingStyles);
        } else {
          $el.removeAttr('style');
        }
      }
    });

    // 3. Pandoc теряет class на <p>, поэтому:
    //   - внутри <td>/<th>: переносим text-* на ячейку
    //   - вне таблицы: оборачиваем <p> в <div class="text-...">
    $('p, h1, h2, h3, h4, h5, h6').each((_, el) => {
      const $el = $(el);
      
      if ($el.closest('li').length > 0) return;

      const classes = ($el.attr('class') || '').split(' ').filter(c => c);
      const alignClass = classes.find(c => /^(text-left|text-center|text-right|text-justify)$/.test(c));
      if (!alignClass) return;

      const parentCell = $el.closest('td, th');
      if (parentCell.length > 0) {
        // Внутри ячейки таблицы → переносим класс на <td>/<th>
        const cellClasses = (parentCell.attr('class') || '').split(' ').filter(c => c);
        if (!cellClasses.find(c => c.startsWith('text-'))) {
          cellClasses.push(alignClass);
          parentCell.attr('class', cellClasses.join(' '));
        }
        // Убираем класс с <p>
        const remaining = classes.filter(c => c !== alignClass);
        if (remaining.length > 0) {
          $el.attr('class', remaining.join(' '));
        } else {
          $el.removeAttr('class');
        }
      } else {
        // Вне таблицы → оборачиваем в <div>, т.к. Pandoc сохраняет class на Div
        $el.wrap(`<div class="${alignClass}"></div>`);
        const remaining = classes.filter(c => c !== alignClass);
        if (remaining.length > 0) {
          $el.attr('class', remaining.join(' '));
        } else {
          $el.removeAttr('class');
        }
      }
    });

    // 4. Обработка изображений
    $('img').each((_, el) => {
      const $el = $(el);
      const src = $el.attr('src');
      if (!src || !src.startsWith('data:image/')) {
        $el.remove();
      } else {
        $el.removeAttr('data-src class');
      }
    });

    // 5. ИЗВЛЕЧЕНИЕ ШИРИН КОЛОНОК И ВЫСОТ СТРОК → спец-классы на ячейках
    $('table').each((_, table) => {
      const $table = $(table as any);

      // 5c. СНАЧАЛА собираем ширины из <colgroup><col> (fallback, если colwidth нет в td)
      const colWidths: (number | null)[] = [];
      $table.find('colgroup col').each((_, col) => {
        const $col = $(col);
        const style = $col.attr('style') || '';
        let width: number | null = null;
        const widthMatch = style.match(/(?:^|[\s;])width:\s*(\d+)/);
        const minWidthMatch = style.match(/min-width:\s*(\d+)/);
        if (widthMatch) width = parseInt(widthMatch[1], 10);
        // ИСПРАВЛЕНО: было width = 500, теперь берем реальное значение из min-width
        else if (minWidthMatch) width = parseInt(minWidthMatch[1], 10); 
        colWidths.push(width);
      });

      // 5a. Считаем общую ширину таблицы в px, учитывая И colwidth, И colgroup
      let total_px = 0;
      let colIdx = 0;
      $table.find('tr').first().find('th, td').each((_, cell) => {
        const $cell = $(cell);
        const colwidth = $cell.attr('colwidth');
        let width = 0;
        
        if (colwidth) {
          width = parseInt(colwidth, 10);
        } else if (colIdx < colWidths.length && colWidths[colIdx] !== null) {
          width = colWidths[colIdx] as number;
        }
        
        total_px += width;
        const colspan = parseInt($cell.attr('colspan') || '1', 10);
        colIdx += colspan;
      });

      // 5b. Расчет масштаба (Scale)
      const EDITOR_CONTENT_PX = 714; 
      const WORD_CONTENT_DXA = 10466; 
      let scale = 15; 
      if (total_px > EDITOR_CONTENT_PX) {
        scale = WORD_CONTENT_DXA / total_px;
      }
      const final_total_dxa = total_px > 0 ? Math.round(total_px * scale) : 0;

      // 5d. Проходим по строкам, навешиваем готовые dxa-классы
      $table.find('tr').each((_, tr) => {
        const $tr = $(tr);
        const trStyle = $tr.attr('style') || '';
        const heightMatch = trStyle.match(/height:\s*(\d+)/);
        const rowHeight = heightMatch ? parseInt(heightMatch[1], 10) : null;
        let currentColIdx = 0;
        
        $tr.children('th, td').each((_, cell) => {
          const $cell = $(cell);
          const classes = ($cell.attr('class') || '').split(' ').filter(c => c && !c.startsWith('ProseMirror'));
          
          const colwidth = $cell.attr('colwidth');
          let width: number | null = null;
          
          if (colwidth) {
            width = parseInt(colwidth, 10);
          } else if (currentColIdx < colWidths.length) {
            width = colWidths[currentColIdx];
          }
          
          if (width) {
            const dxa = Math.round(width * scale);
            classes.push(`col-dxa-${dxa}`);
          }
          if (rowHeight) classes.push(`row-h-${rowHeight}`);
          if (classes.length > 0) $cell.attr('class', classes.join(' '));
          
          const colspan = parseInt($cell.attr('colspan') || '1', 10);
          currentColIdx += colspan;
        });
      });

      // 5e. Сохраняем итоговую ширину таблицы в data-атрибут для Lua
      if (final_total_dxa > 0) {
        $table.attr('data-total-dxa', String(final_total_dxa));
      }

      // 5f. Удаляем colgroup после извлечения данных (внутри цикла для каждой таблицы)
      $table.find('colgroup, col').remove();
    });
    

    // 5c. Удаляем colgroup после извлечения данных
    $('colgroup, col').remove();

    // 6. Очистка пустых строк и разрывов
    $('p, h1, h2, h3, h4, h5, h6, td, li, div').each((_, el) => {
      const $el = $(el);
      let contents = $el.contents();
      while (contents.length && contents.first().is('br')) {
        contents.first().remove();
        contents = $el.contents();
      }
      while (contents.length && contents.last().is('br')) {
        contents.last().remove();
        contents = $el.contents();
      }
      if ($el.text().trim() === '' && $el.children().length === 0) {
        $el.remove();
      }
    });

    // 6.5. Обработка разрывов страниц
    // Заменяем <hr> на <div>, так как Pandoc теряет классы у <hr> (HorizontalRule)
    $('hr.page-break, hr[data-type="page-break"]').each((_, el) => {
      $(el).replaceWith('<div class="page-break"></div>');
    });

    // 7. ОБРАБОТКА ТАБЛИЦ: Перенос первой строки с <th> из <tbody> в <thead>
    $('table').each((_, table) => {
      const $table = $(table as any);
      let $tbody = $table.children('tbody');
      if ($tbody.length === 0 && $table.children('tr').length > 0) {
        $table.wrapInner('<tbody></tbody>');
        $tbody = $table.children('tbody');
      }
      if ($tbody.length > 0) {
        const $firstRow = $tbody.children('tr').first();
        if ($firstRow.length > 0 && $firstRow.children('th').length > 0) {
          let $thead: any = $table.children('thead');
          if ($thead.length === 0) {
            $thead = $('<thead></thead>');
            $table.prepend($thead);
          }
          $thead.append($firstRow as any);
        }
      }
    });

    const cleanHtml = $.html();
    fs.writeFileSync('debug_pandoc_input.html', cleanHtml, 'utf-8');

    // 8. Конвертируем в DOCX через Pandoc с Lua-фильтром
    const docxBuffer = await convertWithPandoc(cleanHtml);

    return new NextResponse(new Uint8Array(docxBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName || 'document')}.docx"`,
      },
    });
  } catch (error) {
    console.error('Ошибка при конвертации в DOCX:', error);
    return NextResponse.json(
      { error: 'Failed to convert HTML to DOCX', details: (error as Error).message },
      { status: 500 }
    );
  }
}