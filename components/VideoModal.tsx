// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  src: string;
  poster?: string;
  title?: string;
}

export default function VideoModal({ isOpen, onClose, src, poster, title }: VideoModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  
  // Подключаем переводы для неймспейса VideoModal
  const t = useTranslations('VideoModal');

  // Если title передан пропсом, используем его, иначе берем из переводов
  const modalTitle = title || t('title');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      onClick={handleBackdropClick}
      className="m-auto backdrop:bg-black/80 backdrop:backdrop-blur-sm p-0 rounded-xl overflow-hidden max-w-4xl w-full shadow-2xl"
      aria-label={modalTitle}
    >
      {isOpen && (
        <div className="relative bg-black group flex items-center justify-center">
          {/* Кнопка закрытия */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 bg-black/60 hover:bg-red-600 text-white rounded-full p-2 transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={t('closeAriaLabel')}
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="20" 
              height="20" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          {/* ✅ Используем стандартный тег video */}
          <video
            src={src}
            poster={poster}
            autoPlay
            controls
            playsInline
            className="w-full h-auto max-h-[80vh] object-contain bg-black"
          />
        </div>
      )}
    </dialog>
  );
}