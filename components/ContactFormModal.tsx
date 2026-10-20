// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { contactApi } from '@/lib/realApi'; // Убедитесь, что contactApi добавлен в realApi.ts

interface ContactFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactFormModal({ isOpen, onClose }: ContactFormModalProps) {
  const t = useTranslations('ContactFormModal');
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Сброс формы при открытии
  useEffect(() => {
    if (isOpen) {
      setName('');
      setEmail('');
      setPhone('');
      setMessage('');
      setIsSuccess(false);
    }
  }, [isOpen]);

  // Обработка Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !message.trim()) {
      alert(t('errors.required'));
      return;
    }

    // Простая проверка email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert(t('errors.invalidEmail'));
      return;
    }

    if (typeof window !== 'undefined' && (window as any).ym) {
      (window as any).ym(111041629, 'reachGoal', 'click_send_contact');
    }

    setIsSubmitting(true);
    try {
      await contactApi.submit({ 
        name, 
        email, 
        phone: phone.trim() || undefined, 
        message 
      });
      setIsSuccess(true);
      
      if (typeof window !== 'undefined' && (window as any).ym) {
        (window as any).ym(111041629, 'reachGoal', 'contact_form_success');
      }
      
      // Автоматическое закрытие через 3 секунды после успеха
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (error: any) {
      alert(error.message || t('errors.submitError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`modal-overlay fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] items-center justify-center p-4 flex`}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t('title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSuccess ? t('successSubtitle') : t('subtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isSuccess ? (
            // Экран успеха
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-3xl mb-2">
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <h3 className="text-lg font-bold text-slate-800">{t('success.title')}</h3>
              <p className="text-sm text-slate-500 max-w-xs">
                {t('success.description')}
              </p>
            </div>
          ) : (
            // Форма
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t('labels.name')} <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder={t('placeholders.name')} 
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t('labels.email')} <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    placeholder={t('placeholders.email')} 
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {t('labels.phone')} <span className="text-slate-400 font-normal">{t('labels.phoneOptional')}</span>
                </label>
                <input 
                  type="tel" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  placeholder={t('placeholders.phone')} 
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow" 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {t('labels.message')} <span className="text-red-500">*</span>
                </label>
                <textarea 
                  rows={4} 
                  value={message} 
                  onChange={(e) => setMessage(e.target.value)} 
                  placeholder={t('placeholders.message')} 
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow resize-none"
                ></textarea>
              </div>
            </>
          )}
        </div>

        {/* FOOTER */}
        {!isSuccess && (
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 shrink-0 bg-slate-50">
            <button 
              onClick={onClose} 
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {t('buttons.cancel')}
            </button>
            <button 
              onClick={handleSubmit} 
              disabled={isSubmitting} 
              className="px-5 py-2 text-xs font-semibold bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white rounded-lg transition-colors shadow-sm flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <><i className="fa-solid fa-spinner fa-spin text-[11px]"></i> {t('buttons.submitting')}</>
              ) : (
                <><i className="fa-solid fa-paper-plane text-[11px]"></i> {t('buttons.submit')}</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}