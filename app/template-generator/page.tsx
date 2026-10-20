// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// app/template-import/page.tsx
"use client";

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { processAndSaveTemplateFromYaml } from '@/lib/templateImport';

export default function TemplateImportPage() {
  const t = useTranslations('templateImport');

  const [yamlContent, setYamlContent] = useState('');
  const [markdownContent, setMarkdownContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Ref для автоматической прокрутки логов в самый низ
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${message}`]);
  };

  // Автоматическая прокрутка контейнера логов вниз при добавлении новой записи
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleGenerate = async () => {
    if (!yamlContent.trim()) {
      setNotification({ type: 'error', message: t('notifications.yamlRequired') });
      return;
    }
    if (!markdownContent.trim()) {
      setNotification({ type: 'error', message: t('notifications.markdownRequired') });
      return;
    }

    setIsLoading(true);
    setNotification(null);
    setLogs([]); // Очищаем старые логи

    try {
      addLog(t('logs.starting'));
      await processAndSaveTemplateFromYaml(yamlContent, markdownContent, addLog);
      setNotification({
        type: 'success',
        message: t('notifications.success'),
      });
    } catch (error) {
      console.error('Ошибка импорта:', error);
      const errorMessage = error instanceof Error ? error.message : t('notifications.unknownError');
      setNotification({
        type: 'error',
        message: t('notifications.error', { message: errorMessage }),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 p-8 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full flex flex-col gap-6 pb-8">
        {/* Заголовок */}
        <div className="shrink-0">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {t('title')}
          </h1>
          <p className="text-slate-600">
            {t('subtitle')}
          </p>
        </div>

        {/* Уведомление */}
        {notification && (
          <div
            className={`p-4 rounded-lg border shrink-0 ${
              notification.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-start gap-3">
              <i
                className={`fa-solid ${
                  notification.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'
                } text-lg mt-0.5`}
              ></i>
              <div className="flex-1">
                <p className="font-semibold">{notification.message}</p>
              </div>
              <button
                onClick={() => setNotification(null)}
                className="text-slate-500 hover:text-slate-700 transition-colors"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
          </div>
        )}

        {/* Сетка с текстовыми полями */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* YAML Input */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <i className="fa-solid fa-file-code text-blue-500"></i>
              <h2 className="text-lg font-semibold text-slate-900">
                {t('yamlSection.title')}
              </h2>
            </div>
            <textarea
              value={yamlContent}
              onChange={(e) => setYamlContent(e.target.value)}
              placeholder={t('yamlSection.placeholder')}
              className="w-full min-h-[300px] p-4 border border-slate-200 rounded-lg font-mono text-sm text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isLoading}
            />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 shrink-0">
              <span>{t('yamlSection.chars', { count: yamlContent.length })}</span>
              <button
                onClick={() => setYamlContent('')}
                className="text-slate-500 hover:text-slate-700 transition-colors"
                disabled={isLoading}
              >
                <i className="fa-solid fa-trash text-xs mr-1"></i> {t('yamlSection.clear')}
              </button>
            </div>
          </div>

          {/* Markdown Input */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <i className="fa-brands fa-markdown text-blue-500"></i>
              <h2 className="text-lg font-semibold text-slate-900">
                {t('markdownSection.title')}
              </h2>
            </div>
            <textarea
              value={markdownContent}
              onChange={(e) => setMarkdownContent(e.target.value)}
              placeholder={t('markdownSection.placeholder')}
              className="w-full min-h-[300px] p-4 border border-slate-200 rounded-lg font-mono text-sm text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isLoading}
            />
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 shrink-0">
              <span>{t('markdownSection.chars', { count: markdownContent.length })}</span>
              <button
                onClick={() => setMarkdownContent('')}
                className="text-slate-500 hover:text-slate-700 transition-colors"
                disabled={isLoading}
              >
                <i className="fa-solid fa-trash text-xs mr-1"></i> {t('markdownSection.clear')}
              </button>
            </div>
          </div>
        </div>

        {/* Кнопка генерации */}
        <div className="flex items-center justify-center gap-4 shrink-0">
          <button
            onClick={handleGenerate}
            disabled={isLoading || !yamlContent.trim() || !markdownContent.trim()}
            className={`px-8 py-3 rounded-lg font-semibold text-white transition-all shadow-md ${
              isLoading || !yamlContent.trim() || !markdownContent.trim()
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 hover:shadow-lg'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-spinner fa-spin"></i> {t('button.generating')}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-magic"></i> {t('button.generate')}
              </span>
            )}
          </button>
        </div>

        {/* БЛОК ОТЛАДОЧНОЙ ИНФОРМАЦИИ (ЛОГИ) */}
        {logs.length > 0 && (
          <div className="bg-slate-900 text-green-400 rounded-xl shadow-lg border border-slate-700 flex flex-col max-h-[50vh]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-800 rounded-t-xl shrink-0">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-terminal text-yellow-400"></i>
                <h3 className="text-white font-bold text-sm">{t('logs.title')}</h3>
              </div>
              <button
                onClick={() => setLogs([])}
                className="text-slate-400 hover:text-white text-xs flex items-center gap-1"
              >
                <i className="fa-solid fa-broom"></i> {t('logs.clear')}
              </button>
            </div>
            {/* Контейнер логов с внутренней прокруткой */}
            <div className="p-4 font-mono text-xs overflow-y-auto flex-1">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className="py-0.5 border-b border-slate-800 last:border-0 hover:bg-slate-800/50 transition-colors whitespace-pre-wrap break-words"
                >
                  {log}
                </div>
              ))}
              {/* Невидимый якорь для автопрокрутки */}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}