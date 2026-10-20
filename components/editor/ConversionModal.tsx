// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/ConversionModal.tsx
import { forwardRef, useImperativeHandle, useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';

type ConversionPhase = 'idle' | 'uploading' | 'converting' | 'finishing' | 'error';

interface ConversionState {
  phase: ConversionPhase;
  fileName: string;
  elapsed: number;
  progress: number;
  errorMessage: string;
}

export interface ConversionModalHandle {
  start: (fileName: string) => void;
  updateProgress: (progress: number) => void;
  finish: (error?: string) => void;
}

const ConversionModal = forwardRef<ConversionModalHandle>((props, ref) => {
  // Подключаем переводы для неймспейса ConversionModal
  const t = useTranslations('ConversionModal');

  const [conversion, setConversion] = useState<ConversionState>({
    phase: 'idle', fileName: '', elapsed: 0, progress: 0, errorMessage: '',
  });
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useImperativeHandle(ref, () => ({
    start: (fileName: string) => {
      stopTimer();
      setConversion({ phase: 'uploading', fileName, elapsed: 0, progress: 0, errorMessage: '' });
      timerRef.current = setInterval(() => {
        setConversion(prev => {
          const next = prev.elapsed + 1;
          if (prev.phase === 'uploading' && prev.progress >= 100) {
            return { ...prev, phase: 'converting', elapsed: next };
          }
          return { ...prev, elapsed: next };
        });
      }, 1000);
    },
    updateProgress: (progress: number) => {
      setConversion(prev => ({ ...prev, progress }));
    },
    finish: (error?: string) => {
      stopTimer();
      if (error) {
        setConversion(prev => ({ ...prev, phase: 'error', errorMessage: error }));
      } else {
        setConversion(prev => ({ ...prev, phase: 'finishing' }));
        setTimeout(() => {
          setConversion({ phase: 'idle', fileName: '', elapsed: 0, progress: 0, errorMessage: '' });
        }, 1200);
      }
    }
  }));

  useEffect(() => {
    return () => stopTimer();
  }, []);

  if (conversion.phase === 'idle') return null;

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              conversion.phase === 'error' ? 'bg-red-100' : 
              conversion.phase === 'finishing' ? 'bg-green-100' : 'bg-primary-100'
            }`}>
              {conversion.phase === 'error' ? (
                <i className="fa-solid fa-triangle-exclamation text-red-500 text-lg"></i>
              ) : conversion.phase === 'finishing' ? (
                <i className="fa-solid fa-check text-green-500 text-lg"></i>
              ) : (
                <i className="fa-solid fa-file-arrow-up text-primary-500 text-lg"></i>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-800">
                {conversion.phase === 'error' ? t('errorTitle') :
                 conversion.phase === 'finishing' ? t('successTitle') : t('defaultTitle')}
              </h3>
              <p className="text-[11px] text-slate-400 truncate">{conversion.fileName}</p>
            </div>
          </div>

          {(conversion.phase === 'uploading' || conversion.phase === 'converting') && (
            <div className="space-y-2">
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: conversion.phase === 'uploading' ? `${conversion.progress}%` : '100%' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <i className={`fa-solid ${conversion.phase === 'uploading' ? 'fa-cloud-arrow-up' : 'fa-spinner fa-spin'} text-primary-400 text-[10px]`}></i>
                  {conversion.phase === 'uploading' 
                    ? t('uploadingStatus', { progress: conversion.progress }) 
                    : t('convertingStatus')}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {t('elapsedTime', { elapsed: conversion.elapsed })}
                </span>
              </div>
              {conversion.phase === 'converting' && conversion.elapsed > 15 && (
                <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <i className="fa-solid fa-clock text-amber-500 text-[10px] mt-0.5"></i>
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    {t('slowConversionWarning')}
                  </p>
                </div>
              )}
            </div>
          )}

          {conversion.phase === 'finishing' && (
            <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
              <i className="fa-solid fa-circle-check text-green-500"></i>
              <p className="text-[11px] text-green-700 font-medium">{t('successMessage')}</p>
            </div>
          )}

          {conversion.phase === 'error' && (
            <div className="space-y-3">
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-[11px] text-red-700 leading-relaxed">{conversion.errorMessage}</p>
              </div>
              <button
                onClick={() => ref && 'current' in ref && (ref.current as any)?.finish()}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
              >
                {t('closeButton')}
              </button>
            </div>
          )}
        </div>
        <div className="h-2"></div>
      </div>
    </div>
  );
});

ConversionModal.displayName = 'ConversionModal';
export default ConversionModal;