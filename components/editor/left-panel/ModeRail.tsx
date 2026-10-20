// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/ModeRail.tsx
import React from 'react';
import { useStore } from '@/store/useStore';
import { useTranslations } from 'next-intl';

interface ModeRailProps {
  mode: string;
  setMode: (mode: string) => void;
}

export const ModeRail: React.FC<ModeRailProps> = ({ mode, setMode }) => {
  // Подключаем переводы для неймспейса ModeRail
  const t = useTranslations('ModeRail');
  
  const docSetMode = useStore((s: any) => s.documentPackage.documentSetMode);
  const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess); // 🆕
  
  const isFull = currentUserAccess === 'full' || currentUserAccess === 'owner';
  const isReview = currentUserAccess === 'review';
  const isComment = currentUserAccess === 'comment';

  const getRailBtnClass = (btnMode: string) =>
    mode === btnMode
      ? "mode-btn w-9 h-9 rounded-lg flex items-center justify-center text-primary-600 bg-primary-50 transition-all"
      : "mode-btn w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-all";

  return (
    <div id="mode-rail" className="w-12 bg-white border-r border-slate-200 flex flex-col items-center py-2 gap-1 shrink-0 z-20">
      {/* Разметка доступна только при полном доступе и для шаблонов */}
      {docSetMode === 'template' && isFull && (
        <button className={getRailBtnClass('markup')} onClick={() => setMode('markup')} id="rail-markup">
          <i className="fa-solid fa-layer-group text-sm"></i> <span className="tooltip">{t('markup')}</span>
        </button>
      )}
      
      {/* Редактирование только для full */}
      {isFull && (
        <button className={getRailBtnClass('edit')} onClick={() => setMode('edit')} id="rail-edit">
          <i className="fa-regular fa-pen-to-square text-sm"></i> <span className="tooltip">{t('edit')}</span>
        </button>
      )}
      
      {/* Рецензирование для full и review */}
      {(isFull || isReview) && (
        <button className={getRailBtnClass('review')} onClick={() => setMode('review')} id="rail-review">
          <i className="fa-solid fa-spell-check text-sm"></i> <span className="tooltip">{t('review')}</span>
        </button>
      )}
      
      {/* Комментирование для full и comment */}
      {(isFull || isComment) && (
        <button className={getRailBtnClass('comment')} onClick={() => setMode('comment')} id="rail-comment">
          <i className="fa-regular fa-comment-dots text-sm"></i> <span className="tooltip">{t('comment')}</span>
        </button>
      )}
      
      {/* История версий доступна всем, кроме view (но view скрывает всю панель целиком) */}
      {(isFull || isReview || isComment) && (
        <button className={getRailBtnClass('history')} onClick={() => setMode('history')} id="rail-history">
          <i className="fa-solid fa-clock-rotate-left text-sm"></i> <span className="tooltip">{t('history')}</span>
        </button>
      )}
    </div>
  );
};