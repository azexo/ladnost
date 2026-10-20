// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// lib/markdown.ts
import fs from 'fs';
import path from 'path';
import { getTranslations } from 'next-intl/server';

const contentDirectory = path.join(process.cwd(), 'content');

/**
 * Читает Markdown файл для указанной локали и слага.
 * @param locale - Текущая локаль (например, 'ru' или 'en')
 * @param slug - Имя файла без расширения (например, 'auth-article')
 */
export async function getMarkdownContent(locale: string, slug: string): Promise<string> {
  // Получаем функцию перевода для серверного окружения
  // Используем namespace 'markdown', чтобы не засорять глобальное пространство имен
  const t = await getTranslations({ locale, namespace: 'markdown' });

  const targetPath = path.join(contentDirectory, locale, `${slug}.md`);
  const fallbackPath = path.join(contentDirectory, 'ru', `${slug}.md`);

  try {
    // Пытаемся прочитать файл для текущей локали
    if (fs.existsSync(targetPath)) {
      return fs.readFileSync(targetPath, 'utf-8');
    }
    
    // Если не нашли, читаем фоллбэк (русский)
    if (fs.existsSync(fallbackPath)) {
      console.warn(`Markdown file not found for ${locale}/${slug}. Using fallback (ru).`);
      return fs.readFileSync(fallbackPath, 'utf-8');
    }
  } catch (error) {
    console.error(`Error reading markdown file ${slug} for locale ${locale}:`, error);
  }

  // Возвращаем переведенный фоллбэк вместо захардкоженной русской строки
  return `<!-- ${t('notFound', { slug })} -->`;
}