// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';
import './viewer.css';
import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { rendererApi } from '@/lib/realApi';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export const downloadFileFromHtml = async (
  endpoint: string,
  html: string,
  fileName: string,
  extension: 'pdf' | 'docx',
  translations: {
    exportError: string;
    conversionError: string;
    generateError: string;
  }
) => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, fileName }),
    });
    if (!response.ok) throw new Error(translations.exportError);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error(translations.conversionError, error);
    alert(translations.generateError);
  }
};

export default function ViewerPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('viewer');
  
  const setId = Number(params.setId);
  const isLoadingPackage = useStore((s) => s.documentPackage.isLoading);
  const loadPackage = useStore((s) => s.documentPackage.loadPackage);
  const fetchInitialData = useStore((s) => s.data.fetchInitialData);
  const properties = useStore((s) => s.data.properties);
  const sections = useStore((s) => s.data.sections);
  const currentAnswers = useStore((s) => s.data.currentAnswers);
  const currentTableAnswers = useStore((s) => s.data.currentTableAnswers);
  const updateAnswer = useStore((s) => s.data.updateAnswer);
  const currentConditions = useStore((s) => s.data.currentConditions);
  const collapsedSections = useStore((s) => s.data.collapsedSections);
  const toggleSectionCollapse = useStore((s) => s.data.toggleSectionCollapse);

  const [renderedHtml, setRenderedHtml] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) return 50;
    return 100;
  });
  
  const handleZoomIn = () => setZoomLevel((p) => Math.min(p + 10, 200));
  const handleZoomOut = () => setZoomLevel((p) => Math.max(p - 10, 50));
  
  // 🆕 Состояние открытой шторки на мобильном
  const [isMobileFormOpen, setIsMobileFormOpen] = useState(false);

  const documentSet = useStore((s) => s.documentPackage.documentSet);
  const activeDoc = useStore((s) => s.documentPackage.items.find((d: any) => d.id === s.documentPackage.activeId));
  const docTitle = documentSet?.name || activeDoc?.name || 'Документ';

  useEffect(() => {
    if (isNaN(setId)) {
      router.replace('/workspace');
      return;
    }
    loadPackage(setId);
    fetchInitialData(setId);
  }, [setId, loadPackage, fetchInitialData, router]);

  const prepareAnswersForBackend = (
    flatAnswers: Record<number, any>,
    tableAnswers: Record<number, Record<number, any>>
  ) => {
    const prepared: Record<string, any> = {};
    if (flatAnswers) {
      Object.entries(flatAnswers).forEach(([propId, value]) => {
        if (value !== undefined && value !== null) prepared[propId] = value;
      });
    }
    if (tableAnswers) {
      Object.entries(tableAnswers).forEach(([propId, rows]) => {
        if (rows && typeof rows === 'object') {
          const tableData: Record<string, any> = {};
          let hasData = false;
          Object.entries(rows).forEach(([rowIdx, value]) => {
            if (value !== undefined && value !== null && value !== '') {
              tableData[rowIdx] = value;
              hasData = true;
            }
          });
          if (hasData) prepared[propId] = tableData;
        }
      });
    }
    return prepared;
  };

  const combinedAnswers = useMemo(() => ({ flat: currentAnswers, table: currentTableAnswers }), [currentAnswers, currentTableAnswers]);
  const debouncedAnswers = useDebouncedValue(combinedAnswers, 800);

  useEffect(() => {
    if (!setId || isLoadingPackage) return;
    const preparedAnswers = prepareAnswersForBackend(debouncedAnswers.flat, debouncedAnswers.table);
    let isMounted = true;
    setIsRendering(true);
    rendererApi
      .renderHtml({ document_set_id: setId, answers: preparedAnswers })
      .then((res) => {
        if (isMounted) setRenderedHtml(res.html);
      })
      .catch((err) => {
        if (isMounted) console.error('Ошибка рендеринга документа:', err);
      })
      .finally(() => {
        if (isMounted) setIsRendering(false);
      });
    return () => {
      isMounted = false;
    };
  }, [setId, debouncedAnswers, isLoadingPackage]);

  const visibleProperties = useMemo(() => {
    const tableSectionIds = new Set(sections.filter((s: any) => s.is_table).map((s: any) => s.id));
    return properties.filter((p: any) => {
      if (p.hide_in_form) return false;
      if (p.section_id && tableSectionIds.has(p.section_id)) return false;
      if (p.display_condition_id) return currentConditions[p.display_condition_id] === true;
      return true;
    });
  }, [properties, sections, currentConditions]);

  const groupedProperties = useMemo(() => {
    const groups: Record<string, any[]> = { '0': [] };
    sections.forEach((sec: any) => {
      if (!sec.is_table) groups[String(sec.id)] = [];
    });
    visibleProperties.forEach((prop: any) => {
      const secId = prop.section_id ? String(prop.section_id) : '0';
      if (!groups[secId]) groups[secId] = [];
      groups[secId].push(prop);
    });
    Object.keys(groups).forEach(key => {
      groups[key].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    });
    return groups;
  }, [visibleProperties, sections]);

  const sortedSections = useMemo(() => {
    return [...sections].filter((s) => !s.is_table).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [sections]);

  const renderField = (prop: any) => {
    const value = currentAnswers[prop.id] ?? prop.default_value ?? '';
    const baseInputClass =
      'w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary focus:border-primary transition-all text-gray-900 bg-white shadow-sm placeholder-gray-400 text-base';
    const inputType = String(prop.text_input_type || 'SHORT').toUpperCase();
    const handleChange = (newValue: any) => updateAnswer(prop.id, newValue);

    if (inputType === 'LIST' && prop.options && Array.isArray(prop.options)) {
      return (
        <div className="flex flex-col gap-2 py-1">
          {prop.options.map((opt: any, idx: number) => {
            const optValue = typeof opt === 'object' ? (opt.value ?? opt.id) : opt;
            const optLabel = typeof opt === 'object' ? (opt.label ?? opt.name) : opt;
            return (
              <label key={idx} className="flex items-center space-x-2 cursor-pointer group">
                <input
                  type="radio"
                  name={`radio-group-${prop.id}`}
                  value={optValue}
                  checked={String(value) === String(optValue)}
                  onChange={(e) => handleChange(e.target.value)}
                  className="w-4 h-4 text-primary bg-gray-100 border-gray-300 focus:ring-primary focus:ring-2"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{optLabel}</span>
              </label>
            );
          })}
        </div>
      );
    }
    if (prop.data_type === 'date' || prop.data_type === 'DATE') {
      return <input type="date" value={value} onChange={(e) => handleChange(e.target.value)} className={baseInputClass} />;
    }
    if (prop.data_type === 'boolean' || prop.data_type === 'BOOLEAN') {
      return (
        <label className="flex items-center space-x-2 cursor-pointer pt-2">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleChange(e.target.checked)}
            className="w-5 h-5 text-primary rounded border-gray-300 focus:ring-primary"
          />
          <span className="text-gray-700">{t('yes')}</span>
        </label>
      );
    }
    if (inputType === 'LONG' || inputType === 'TEXTAREA' || inputType === 'PARAGRAPH') {
      return (
        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={prop.placeholder || ''}
          rows={3}
          className={`${baseInputClass} resize-y`}
        />
      );
    }
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={prop.placeholder || ''}
        className={baseInputClass}
      />
    );
  };

  if (isLoadingPackage) {
    return <div className="flex h-screen items-center justify-center text-gray-500">{t('loadingPackage')}</div>;
  }

  const handleDownloadPdf = async () => {
    if (!renderedHtml) {
      alert(t('documentNotGenerated'));
      return;
    }
    const safeFileName = docTitle.replace(/[^\w\sа-яёА-ЯЁ.-]/g, '_').trim();
    await downloadFileFromHtml('/backend/export-pdf', renderedHtml, safeFileName, 'pdf', {
      exportError: t('exportError'),
      conversionError: t('conversionError', { extension: 'PDF' }),
      generateError: t('generateError', { extension: 'PDF' }),
    });
  };

  return (
    <>
      <header
        id="trust-header"
        className="h-16 flex-shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 z-20 sticky top-0 w-full"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-bold text-xl text-gray-900 tracking-tight">
            <i className="fa-solid fa-file-contract text-primary"></i>
          </div>
          <div className="sm:block h-6 w-px bg-gray-300"></div>
          <div className="sm:flex flex-col">
            <h1 className="text-sm font-semibold text-gray-900 leading-tight">{docTitle}</h1>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <i className="fa-solid fa-shield-halved text-green-500 text-[10px]"></i> {t('protectedDocument')}
            </span>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-sm">
          <div className="flex items-center gap-2 text-primary font-medium">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">1</span>
            {t('stepFilling')}
          </div>
          <i className="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
          <div className="flex items-center gap-2 text-gray-400">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-400 text-xs font-bold">2</span>
            {t('stepSigning')}
          </div>
          <i className="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
          <div className="flex items-center gap-2 text-gray-400">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-400 text-xs font-bold">
              <i className="fa-solid fa-check"></i>
            </span>
            {t('stepDone')}
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="flex-1 flex flex-col lg:flex-row overflow-hidden relative w-full h-[calc(100vh-4rem)]"
      >
        <section
          id="document-canvas"
          className="flex-1 bg-canvas_bg canvas-scroll overflow-y-auto relative w-full h-full pt-8 px-4 sm:px-8"
        >
          <div className="sticky top-0 z-20 flex justify-center mb-6 pointer-events-none">
            <div className="bg-white/90 backdrop-blur border border-gray-200 rounded-full shadow-sm px-4 py-2 flex items-center gap-4 pointer-events-auto">
              <button
                onClick={handleZoomOut}
                disabled={zoomLevel <= 50}
                className="text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('zoomOut')}
              >
                <i className="fa-solid fa-magnifying-glass-minus"></i>
              </button>
              <span className="text-sm font-medium text-gray-600 min-w-[45px] text-center">{zoomLevel}%</span>
              <button
                onClick={handleZoomIn}
                disabled={zoomLevel >= 200}
                className="text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('zoomIn')}
              >
                <i className="fa-solid fa-magnifying-glass-plus"></i>
              </button>
              <div className="h-4 w-px bg-gray-300"></div>
              <button
                onClick={handleDownloadPdf}
                disabled={isRendering || !renderedHtml}
                className="text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('downloadPdf')}
              >
                <i className="fa-solid fa-download"></i>
              </button>
            </div>
          </div>
          <div
            className="max-w-[850px] mx-auto bg-white doc-page relative min-h-[1100px] mb-8 p-12 sm:p-16 text-sm leading-relaxed text-gray-800 font-serif shadow-lg"
            style={{ zoom: `${zoomLevel}%` }}
          >
            {isRendering && !renderedHtml && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10 rounded-lg">
                <div className="text-gray-500 flex items-center gap-2">
                  <i className="fa-solid fa-spinner fa-spin"></i> {t('generatingDocument')}
                </div>
              </div>
            )}
            {renderedHtml ? (
              <div
                className="doc-content-render prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : (
              !isRendering && (
                <div className="text-center text-gray-400 mt-20">
                  <i className="fa-solid fa-file-circle-question text-4xl mb-4"></i>
                  <p>{t('documentEmpty')}</p>
                </div>
              )
            )}
          </div>
        </section>

        <aside
          id="action-sidebar"
          className={[
            'bg-sidebar_bg border-l border-t border-gray-200 flex flex-col z-30',
            'transition-all duration-300 ease-in-out',
            isMobileFormOpen
              ? 'fixed inset-x-0 top-16 bottom-0 max-h-none rounded-t-2xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.15)]'
              : 'relative flex-shrink-0',
            'lg:relative lg:inset-auto lg:top-auto lg:bottom-auto lg:h-full lg:max-h-full lg:w-[420px] lg:rounded-none lg:shadow-none',
          ].join(' ')}
        >
          {/* Mobile handle & toggle header */}
          <div
            className="lg:hidden flex flex-col items-center pt-3 pb-2 px-4 cursor-pointer border-b border-gray-100"
            onClick={() => setIsMobileFormOpen((prev) => !prev)}
          >
            <div className="w-full flex justify-between items-center mb-1">
              <button
                type="button"
                className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium"
              >
                {isMobileFormOpen ? t('collapse') : t('form')}
                <i
                  className={`fa-solid fa-chevron-${isMobileFormOpen ? 'down' : 'up'} ml-1 text-xs`}
                ></i>
              </button>
            </div>
          </div>

          {/* Scrollable Content Area (Анкета) */}
          <div
            id="mobile-form-content"
            className={`flex-1 min-h-0 overflow-y-auto overscroll-contain pb-4 lg:pb-0 ${
              isMobileFormOpen ? 'block' : 'hidden'
            } lg:block`}
          >
            <div className="p-6">
              {/* 🆕 Проверка: если нет видимых свойств, показываем заглушку */}
              {visibleProperties.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                    <i className="fa-solid fa-file-circle-xmark text-3xl text-gray-400"></i>
                  </div>
                  <p className="text-gray-800 text-xl font-semibold">{t('noDataRequired')}</p>
                  <p className="text-gray-500 text-sm mt-2 max-w-xs">
                    {t('noDataRequiredDesc')}
                  </p>
                </div>
              ) : (
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-3">{t('fillData')}</h3>
                  <div className="space-y-6">
                    {sortedSections.map((sec: any) => {
                      const props = groupedProperties[String(sec.id)];
                      if (!props || props.length === 0) return null;
                      const collapseId = String(sec.id) === '0' ? 0 : Number(sec.id);
                      const isCollapsed = !!collapsedSections[collapseId];
                      return (
                        <div key={sec.id} className="space-y-4">
                          <button
                            type="button"
                            onClick={() => toggleSectionCollapse(collapseId)}
                            className="w-full flex items-center justify-between text-left group"
                          >
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-2 flex-1">
                              {sec.name}
                            </h4>
                            <svg
                              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                                isCollapsed ? '' : 'rotate-180'
                              } ml-2`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {!isCollapsed && (
                            <div className="space-y-4">
                              {props.map((prop: any) => (
                                <div key={prop.id}>
                                  <label
                                    className="block text-sm font-medium text-gray-700 mb-1.5"
                                    htmlFor={`prop-${prop.id}`}
                                  >
                                    {prop.name} {prop.is_required && <span className="text-red-500">*</span>}
                                  </label>
                                  {renderField(prop)}
                                  {prop.hint && <p className="mt-1 text-xs text-gray-500">{prop.hint}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {groupedProperties['0'] && groupedProperties['0'].length > 0 && (
                      <div className="space-y-4">
                        <button
                          type="button"
                          onClick={() => toggleSectionCollapse(0)}
                          className="w-full flex items-center justify-between text-left group"
                        >
                          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-1 flex-1">
                            {t('noSection')}
                          </h4>
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                              !!collapsedSections[0] ? '' : 'rotate-180'
                            } ml-2`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {!collapsedSections[0] && (
                          <div className="space-y-4">
                            {groupedProperties['0'].map((prop: any) => (
                              <div key={prop.id}>
                                <label
                                  className="block text-sm font-medium text-gray-700 mb-1.5"
                                  htmlFor={`prop-${prop.id}`}
                                >
                                  {prop.name} {prop.is_required && <span className="text-red-500">*</span>}
                                </label>
                                {renderField(prop)}
                                {prop.hint && <p className="mt-1 text-xs text-gray-500">{prop.hint}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Payment Bottom Block */}
          <div className="p-4 bg-white border-t border-gray-200 lg:mt-auto relative z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] lg:shadow-none">
            <div className="mb-2 flex items-start gap-2">
              <input
                type="checkbox"
                id="consent"
                className="mt-1 w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary cursor-pointer"
              />
              <label htmlFor="consent" className="text-xs text-gray-500 cursor-pointer">
                {t.rich('consent', {
                  offer: (chunks) => <a href="#" className="text-primary hover:underline">{chunks}</a>,
                  privacy: (chunks) => <a href="#" className="text-primary hover:underline">{chunks}</a>
                })}
              </label>
            </div>
            <button
              id="sing-btn"
              type="button"
              onClick={() => alert(t('testingAlert'))}
              className="w-full bg-primary hover:bg-primary_hover text-white font-bold py-2 px-6 rounded-xl text-md shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 flex justify-center items-center gap-2"
            >
              <i className="fa-solid fa-lock text-sm"></i>
              {t('sign')}
            </button>
          </div>
        </aside>
      </main>
    </>
  );
}