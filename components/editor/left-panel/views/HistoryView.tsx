// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// HistoryView.tsx
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { documentsApi } from '@/lib/realApi';

export const HistoryView = () => {
  const t = useTranslations('HistoryView');
  
  const [versions, setVersions] = useState<any[]>([]);
  const activeDocId = useStore((s: any) => s.documentPackage.activeId);
  const selectedVersionId = useStore((s: any) => s.history.selectedVersionId);
  const currentUserAccess = useStore((s: any) => s.documentPackage.currentUserAccess);
  const canMakeCurrent = currentUserAccess === 'full' || currentUserAccess === 'owner';
  
  // Получаем карту пользователей и функцию загрузки из стора
  const usersMap = useStore((s: any) => s.users.map);
  const fetchUsers = useStore((s: any) => s.users.fetchUsers);
  
  // Если пользователи еще не загружены в стор, загружаем их через API
  useEffect(() => {
    if (Object.keys(usersMap).length === 0) {
      fetchUsers();
    }
  }, [usersMap, fetchUsers]);
  
  // Хелпер для получения данных автора (с заглушкой на случай, если юзер не найден)
  const getAuthor = (authorId: number) => {
    return usersMap[authorId] || {
      first_name: t('unknownAuthor.firstName'),
      last_name: t('unknownAuthor.lastName'),
      email: t('unknownAuthor.email'),
      avatar_url: '/default-avatar.svg'
    };
  };
  
  useEffect(() => {
    if (activeDocId) {
      documentsApi.listVersions(activeDocId).then(v => {
        setVersions(v.sort((a, b) => b.version_number - a.version_number));
      });
    }
  }, [activeDocId]);
  
  const handleSelect = (version: any) => {
    useStore.getState().history.selectVersion(version);
  };
  
  const handleMakeCurrent = async (versionId: number) => {
    await useStore.getState().history.makeCurrent(versionId);
    if (activeDocId) {
      const updated = await documentsApi.listVersions(activeDocId);
      setVersions(updated.sort((a, b) => b.version_number - a.version_number));
    }
  };
  
  return (
    <div id="history-view" className="flex flex-col h-full w-full bg-white border-l border-slate-200">
      <div className="p-3 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800">{t('title')}</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {versions.length === 0 && (
          <div className="text-center text-xs text-slate-400 mt-4">{t('noVersions')}</div>
        )}
        {versions.map((v) => {
          const isCurrent = v.is_current;
          const isSelected = selectedVersionId === v.id;
          const author = getAuthor(v.author_id);
          const fullName = `${author.first_name} ${author.last_name}`.trim();
          
          return (
            <div
              key={v.id}
              onClick={() => handleSelect(v)}
              className={`border rounded-lg p-3 transition-colors ${
                isCurrent
                  ? 'bg-primary-50 border-primary-200 cursor-pointer hover:bg-primary-100'
                  : isSelected
                  ? 'bg-blue-50 border-blue-200 cursor-pointer'
                  : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-500">
                  {new Date(v.created_at).toLocaleString(process.env.NEXT_FORMAT_LOCALE, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    isCurrent ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  v{v.version_number}
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <img
                  src={author.avatar_url || '/default-avatar.svg'}
                  className="w-6 h-6 rounded-full object-cover shrink-0"
                  alt="avatar"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span
                    className={`text-[11px] font-semibold leading-tight truncate ${
                      isCurrent || isSelected ? 'text-primary-700' : 'text-slate-700'
                    }`}
                  >
                    {fullName}
                  </span>
                  <span className="text-[9px] text-slate-400 leading-tight truncate">
                    {author.email}
                  </span>
                </div>
                {isCurrent && (
                  <span className="text-[10px] text-primary-600 font-semibold shrink-0">
                    {t('current')}
                  </span>
                )}
                {!isCurrent && isSelected && canMakeCurrent && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMakeCurrent(v.id);
                    }}
                    className="text-[10px] bg-primary-600 text-white px-2 py-0.5 rounded font-semibold hover:bg-primary-700 transition-colors shrink-0"
                  >
                    {t('makeCurrent')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};