// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { useStore } from '@/store/useStore';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export const ReviewView = () => {
  // Подключаем переводы для неймспейса ReviewView
  const t = useTranslations('ReviewView');

  const reviews = useStore((s: any) => s.reviews.items);
  // activeEditUuid теперь будет хранить batch_id активной правки (имя переменной в сторе пока не меняем для совместимости)
  const activeEditUuid = useStore((s: any) => s.reviews.activeEditUuid);
  const setActiveEdit = useStore((s: any) => s.reviews.setActiveEdit);
  const acceptEdit = useStore((s: any) => s.reviews.acceptEdit);
  const rejectEdit = useStore((s: any) => s.reviews.rejectEdit);
  const usersMap = useStore((s: any) => s.users.map);
  const fetchUsers = useStore((s: any) => s.users.fetchUsers);
  const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess);
  
  const canManageReviews = currentUserAccess === 'owner' || currentUserAccess === 'full';

  useEffect(() => {
    if (Object.keys(usersMap).length === 0) {
      fetchUsers();
    }
  }, [usersMap, fetchUsers]);

  const getAuthor = (authorId: number) => {
    return usersMap[authorId] || {
      first_name: t('unknown'),
      last_name: t('author'),
      email: t('emailNotSpecified'),
      avatar_url: '/default-avatar.svg'
    };
  };

  return (
    <div id="review-view" className="flex flex-col absolute inset-0 bg-surface">
      <div className="p-3 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800">{t('title')}</span>
        <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
          {t('editsCount', { count: reviews.length })}
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {reviews.length === 0 && (
          <div className="text-center text-slate-400 text-xs mt-10">{t('noActiveEdits')}</div>
        )}
        
        {reviews.map((edit: any) => {
          // 🆕 1. Используем batch_id как главный идентификатор группы (с фоллбэком на edit_uuid для старых данных)
          const editId = edit.batch_id || edit.edit_uuid;
          // 🆕 2. Сравниваем активный ID с batch_id группы
          const isActive = activeEditUuid === editId;
          const author = getAuthor(edit.author_id);
          const fullName = `${author.first_name} ${author.last_name}`.trim();
          
          return (
            <div
              key={editId}
              onClick={() => setActiveEdit(editId)}
              className={`bg-white border rounded-lg p-3 cursor-pointer transition-all ${
                isActive
                  ? 'border-primary-500 shadow-md ring-2 ring-primary-100'
                  : 'border-amber-200 hover:border-amber-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <img
                  src={author.avatar_url || '/default-avatar.svg'}
                  className="w-6 h-6 rounded-full object-cover"
                  alt="avatar"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-slate-800 truncate">{fullName}</div>
                  <div className="text-[10px] text-slate-500 truncate">{author.email}</div>
                </div>
              </div>
              
              {edit.edit_type === 'REPLACEMENT' && (
                <>
                  <div className="text-[11px] text-red-500 line-through mb-1 bg-red-50 p-1 rounded break-words">
                    «{edit.old_text}»
                  </div>
                  <div className="text-[11px] text-green-600 mb-2 bg-green-50 p-1 rounded break-words">
                    «{edit.new_text}»
                  </div>
                </>
              )}
              
              {edit.edit_type === 'ADD' && (
                <div className="text-[11px] text-green-600 mb-2 bg-green-50 p-1 rounded break-words">
                  + «{edit.new_text}»
                </div>
              )}
              
              {edit.edit_type === 'DELETE' && (
                <div className="text-[11px] text-red-500 line-through mb-1 bg-red-50 p-1 rounded break-words">
                  - «{edit.old_text}»
                </div>
              )}
              
              {canManageReviews && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // 🆕 3. Передаем batch_id (editId) для принятия ВСЕЙ группы правок
                      acceptEdit(editId);
                    }}
                    className="flex-1 py-1 bg-green-50 border border-green-200 text-green-700 text-[11px] font-semibold rounded hover:bg-green-100"
                  >
                    {t('accept')}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // 🆕 4. Передаем batch_id (editId) для отклонения ВСЕЙ группы правок
                      rejectEdit(editId);
                    }}
                    className="flex-1 py-1 bg-red-50 border border-red-200 text-red-600 text-[11px] font-semibold rounded hover:bg-red-100"
                  >
                    {t('reject')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};