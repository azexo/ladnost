// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// app/trial-expired/page.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PluginSlot } from '@/components/PluginSlot';
import SubscriptionModal from '@/components/SubscriptionModal';

export default function TrialExpiredPage() {
  // Инициализируем переводы для неймспейса TrialExpired
  const t = useTranslations('TrialExpired');
  
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 'ladnost.ru';
  
  // Состояние только для модалки
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="h-screen overflow-y-auto bg-gray-50">
      <div className="flex min-h-full flex-col items-center justify-start p-6 py-12">
        <div className="w-full max-w-4xl rounded-2xl bg-white p-8 shadow-lg text-center">
          {/* Иконка и заголовок */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 mb-6">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {t('title')}
          </h1>
          
          <p className="text-gray-600 mb-8">
            {t('description')}
          </p>
          
          {/* ВЫНОСИМ ТАБЛИЦУ В ПЛАГИН */}
          <PluginSlot 
            name="partners-table" 
            fallback={
              <div className="py-8 text-gray-500 text-center">
                {t('partnersLoading')}
              </div>
            } 
          />
          
          {/* Кнопки действий */}
          <div className="flex flex-col gap-3">
            <a 
              href={`https://${domain}/workspace`}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
            >
              {t('refreshButton')}
            </a>
            <button 
              onClick={() => setIsModalOpen(true)}
              className="w-full rounded-lg bg-blue-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
            >
              {t('subscribeButton')}
            </button>
          </div>
        </div>
      </div>
      
      {/* Модалка с тарифами */}
      <SubscriptionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}