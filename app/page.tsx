// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// app/page.tsx
import { Suspense } from 'react';
import { getMarkdownContent } from '@/lib/markdown';
import AuthPageClient from './AuthPageClient';
import { getTranslations } from 'next-intl/server'; 

export default async function Home() {
  const locale = process.env.NEXT_LOCALE || 'ru';
  
  const t = await getTranslations({ locale, namespace: 'common' }); 

  // Загружаем все три Markdown-файла
  const articleContent = await getMarkdownContent(locale, 'auth-article');
  const termsContent = await getMarkdownContent(locale, 'terms-of-use');
  const privacyContent = await getMarkdownContent(locale, 'privacy-policy');

  return (
    <Suspense fallback={
      <div className="flex w-full items-center justify-center bg-white" style={{ height: "100dvh" }}>
        <div className="flex flex-col items-center gap-3">
          <i className="fa-solid fa-circle-notch fa-spin text-primary-600 text-3xl"></i>
          <span className="text-slate-500 text-sm font-medium">
            {t('loadingPage')} 
          </span>
        </div>
      </div>
    }>
      <AuthPageClient
        articleContent={articleContent}
        termsContent={termsContent} 
        privacyContent={privacyContent}
      />
    </Suspense>
  );
}