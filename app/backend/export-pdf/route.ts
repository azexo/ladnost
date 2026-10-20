// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import fs from 'fs';

export async function POST(req: NextRequest) {
  let browser;
  try {
    const body = await req.json();
    const { html, fileName } = body;

    if (!html) {
      return NextResponse.json({ error: 'HTML content is required' }, { status: 400 });
    }

    const $ = cheerio.load(html);

    // ==========================================
    // 1. ОЧИСТКА АТРИБУТОВ И КЛАССОВ
    // ==========================================
    $('[data-]').each((_, el) => {
      const $el = $(el);
      Object.keys($el.attr() || {}).forEach(attr => {
        if (attr.startsWith('data-')) $el.removeAttr(attr);
      });
    });

    $('[class*="ProseMirror"]').each((_, el) => {
      const $el = $(el);
      const classes = ($el.attr('class') || '').split(' ').filter(c => !c.startsWith('ProseMirror'));
      if (classes.length > 0) {
        $el.attr('class', classes.join(' '));
      } else {
        $el.removeAttr('class');
      }
    });

    // ==========================================
    // 2. ОБРАБОТКА ИЗОБРАЖЕНИЙ
    // ==========================================
    $('img').each((_, el) => {
      const $el = $(el);
      const src = $el.attr('src');
      if (!src || !src.startsWith('data:image/')) {
        $el.remove(); 
      }
    });

    // ==========================================
    // 3. РАЗРЫВЫ СТРАНИЦ
    // ==========================================
    $('hr.page-break, hr[data-type="page-break"]').each((_, el) => {
      $(el).replaceWith('<div style="page-break-after: always;"></div>');
    });

    // ==========================================
    // 4. ОЧИСТКА ПУСТЫХ ТЕГОВ
    // ==========================================
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
      
      if ($el.text().trim() === '' && $el.children().length === 0 && !$el.is('.page-break')) {
        $el.remove();
      }
    });

    // ==========================================
    // 5. СЕМАНТИКА ТАБЛИЦ
    // ==========================================
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

    // ==========================================
    // 6. HTML ШАБЛОН С CSS ДЛЯ PDF
    // ==========================================
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.5; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; }
        </style>
      </head>
      <body>
        ${cleanHtml}
      </body>
      </html>
    `;

    // ==========================================
    // 7. ГЕНЕРАЦИЯ PDF (УНИВЕРСАЛЬНЫЙ ЗАПУСК)
    // ==========================================

    // Определяем, находимся ли мы в Docker
    // В Docker всегда существует файл /.dockerenv или переменная IS_DOCKER
    const isDocker = fs.existsSync('/.dockerenv') || process.env.IS_DOCKER === 'true';

    const launchOptions: any = {
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
    };

    if (isDocker) {
      // Если мы в Docker: используем системный Chromium и временную папку для read_only
      launchOptions.executablePath = '/usr/bin/chromium';
      launchOptions.userDataDir = '/tmp/puppeteer-profile';
    } 

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    
    await page.setContent(fullHtml, { 
      waitUntil: 'load',
      timeout: 30000 
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true, 
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      displayHeaderFooter: false,
      preferCSSPageSize: false,
    });

    // ==========================================
    // 8. ОТДАЕМ ФАЙЛ
    // ==========================================
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName || 'document')}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('❌ Ошибка при конвертации в PDF:', error);
    return NextResponse.json(
      { error: 'Failed to convert HTML to PDF', details: (error as Error).message },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}