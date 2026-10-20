// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getLocale, getTranslations } from 'next-intl/server';
import { I18nInitializer } from '@/components/I18nInitializer';
import { AuthInitializer } from '@/components/AuthInitializer';
import { SubscriptionGuard } from '@/components/SubscriptionGuard'; 
import { ClientPluginInitializer } from '@/components/ClientPluginInitializer'; 
import localFont from 'next/font/local';
import './globals.css';
import '@fortawesome/fontawesome-free/css/all.css';

const inter = localFont({
  src: [
    { path: './fonts/Inter-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Inter-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Inter-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Inter-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Inter-Black.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-inter', // Создаем CSS-переменную
  display: 'swap',
});


export async function generateMetadata() {
  const t = await getTranslations('layout');
  
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  const messages = await getMessages();
  const locale = await getLocale();

  return (
    <html lang={locale} className={inter.variable}>
      <body className="m-0 p-0 bg-white text-slate-800 flex flex-col font-sans overflow-hidden" style={{ height: '100dvh' }}>
        <ClientPluginInitializer />
        <NextIntlClientProvider messages={messages}>
          <I18nInitializer />
          <AuthInitializer>
            <SubscriptionGuard>
              {children}
            </SubscriptionGuard>
          </AuthInitializer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}