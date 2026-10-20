// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';

// components/CommentView.tsx
import { useStore } from '@/store/useStore';
import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';

/** Фолбэк, если пользователь не найден. Имя берётся из переводов. */
const FALLBACK_USER = {
  id: 0,
  first_name: '',
  last_name: '',
  email: '',
  avatar_url: '',
};

export const CommentView = () => {
  const t = useTranslations('CommentView');

  // ── Данные из стора ──────────────────────────────
  const comments = useStore((s) => s.comments.items);
  const activeAnchorUuid = useStore((s) => s.comments.activeAnchorUuid);
  const activeBlockUuid = useStore((s) => s.comments.activeBlockUuid);
  const isAddingComment = useStore((s) => s.ui.isAddingComment);
  const addComment = useStore((s) => s.comments.addComment);
  const currentVersionId = useStore((s) => s.documentPackage.currentVersionId);
  const setActiveAnchor = useStore((s) => s.comments.setActiveAnchor);

  // Подгруженные пользователи
  const usersMap = useStore((s) => s.users.map);
  const fetchUsers = useStore((s) => s.users.fetchUsers);
  const usersLoading = useStore((s) => s.users.isLoading);

  // Загружаем пользователей при первом рендере
  useEffect(() => {
    if (Object.keys(usersMap).length === 0) {
      fetchUsers();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Локальные состояния ──────────────────────────
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [replyText, setReplyText] = useState('');

  // ── Форматирование времени ───────────────────────
  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return t('time.justNow');
    if (mins < 60) return t('time.minutes', { count: mins });

    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('time.hours', { count: hours });

    return t('time.days', { count: Math.floor(hours / 24) });
  };

  // ── Группировка комментариев ─────────────────────
  const rootComments = useMemo(
    () => comments.filter((c: any) => !c.parent_comment_id),
    [comments]
  );

  const getReplies = (parentId: number) =>
    comments.filter((c: any) => c.parent_comment_id === parentId);

  // Хелпер: получить автора из usersMap
  const getAuthor = (authorId: number) => {
    const user = usersMap[authorId];

    if (!user) {
      const name = t('fallbackUser');
      return {
        ...FALLBACK_USER,
        first_name: name,
        name,
        avatar: '/default-avatar.svg',
      };
    }

    return {
      ...user,
      name: `${user.first_name} ${user.last_name}`.trim(),
      avatar: user.avatar_url || '/default-avatar.svg',
    };
  };

  // ── Добавление главного комментария ──────────────
  const handleAddMainComment = async () => {
    if (!newCommentText.trim() || !currentVersionId) return;

    await addComment(currentVersionId, {
      text_content: newCommentText,
      anchor_uuid: activeAnchorUuid || 'general',
      block_uuid: activeBlockUuid || 'general',
      parent_comment_id: null,
    });

    setNewCommentText('');
    setActiveAnchor(null, null);

    // Явно закрываем режим добавления и сбрасываем флаг выделения
    useStore.setState((s: any) => ({
      ui: { ...s.ui, isAddingComment: false, isSelectingAnchor: false },
    }));
  };

  // ── Добавление ответа ────────────────────────────
  const handleReply = async (parentId: number) => {
    if (!replyText.trim() || !currentVersionId) return;

    const parent = comments.find((c: any) => c.id === parentId);

    await addComment(currentVersionId, {
      text_content: replyText,
      anchor_uuid: parent?.anchor_uuid || 'general',
      block_uuid: parent?.block_uuid || 'general',
      parent_comment_id: parentId,
    });

    setReplyText('');
    setReplyingTo(null);
  };

  const cancelAddingMode = () => {
    const state = useStore.getState();
    const currentActiveAnchor = state.comments.activeAnchorUuid;

    // 1. Удаляем маркер якоря (подсветку) из редактора, если он был создан
    if (currentActiveAnchor) {
      state.editor.commands.removeAnchorByUuid?.(currentActiveAnchor);
    }

    // 2. Жестко сбрасываем UI состояния, чтобы избежать бага с инверсией (toggle)
    useStore.setState((s: any) => ({
      ui: {
        ...s.ui,
        isAddingComment: false,
        isSelectingAnchor: false,
      },
    }));

    // 3. Сбрасываем активный якорь в сторе
    setActiveAnchor(null, null);
  };

  const totalComments = comments.length;

  // ── Рендер ───────────────────────────────────────
  return (
    <div id="comment-view" className="flex flex-col absolute inset-0 bg-surface">
      {/* ШАПКА */}
      <div className="p-3 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800">{t('title')}</span>

        <div className="flex items-center gap-2">
          {/* КНОПКА ПРИКРЕПЛЕНИЯ */}
          <button
            onClick={() => {
              if (isAddingComment) cancelAddingMode();
              else {
                useStore.setState((s: any) => ({
                  ui: { ...s.ui, isAddingComment: true, isSelectingAnchor: true },
                }));
              }
            }}
            className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
              isAddingComment
                ? 'bg-red-100 text-red-600 hover:bg-red-200'
                : 'bg-primary-600 text-white'
            }`}
            title={
              isAddingComment ? t('attach.cancelTitle') : t('attach.add')
            }
          >
            <i
              className={`fa-regular ${
                isAddingComment ? 'fa-xmark' : 'fa-comment-dots'
              }`}
            ></i>
            {isAddingComment ? t('cancel') : t('attach.add')}
          </button>
        </div>
      </div>

      {/* ТЕЛО */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Форма нового комментария */}
        {isAddingComment && (
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-3">
            <div className="text-[11px] font-semibold text-primary-700 mb-1.5">
              {t('newComment.title')}
            </div>

            <textarea
              id="new-comment-textarea"
              autoFocus
              placeholder={t('newComment.placeholder')}
              rows={2}
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              className="w-full text-xs bg-white border border-slate-200 rounded p-2 focus:outline-none focus:border-primary-400 text-slate-700 placeholder-slate-400 resize-none"
            />

            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={cancelAddingMode}
                className="px-3 py-1 text-slate-500 text-[11px] font-semibold hover:text-slate-700"
              >
                {t('cancel')}
              </button>

              <button
                onClick={handleAddMainComment}
                disabled={!newCommentText.trim()}
                className="px-3 py-1 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[11px] font-semibold rounded-md transition-colors"
              >
                {t('newComment.submit')}
              </button>
            </div>
          </div>
        )}

        {/* Лоадер пока грузятся пользователи */}
        {usersLoading && (
          <div className="text-center text-slate-400 text-xs py-4">
            {t('usersLoading')}
          </div>
        )}

        {/* Рендер корневых комментариев */}
        {rootComments.map((comment: any) => {
          const author = getAuthor(comment.author_id);
          const replies = getReplies(comment.id);
          const isActive = activeAnchorUuid === comment.anchor_uuid;

          return (
            <div
              key={comment.id}
              // Уникальный ID для прокрутки
              id={`comment-card-${comment.id}`}
              onClick={() => {
                setActiveAnchor(comment.anchor_uuid);

                // Прокрутка редактора к подсвеченному тексту
                setTimeout(() => {
                  const anchorEl = document.querySelector(
                    `[data-anchor-uuid="${comment.anchor_uuid}"]`
                  );
                  if (anchorEl) {
                    anchorEl.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }
                }, 150);
              }}
              className={`bg-white border rounded-lg p-3 comment-item pl-3 cursor-pointer transition-all ${
                isActive
                  ? 'border-primary-500 ring-2 ring-primary-100 shadow-md'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Шапка комментария */}
              <div className="flex items-center gap-2 mb-1.5">
                <img
                  src={author.avatar}
                  className="w-6 h-6 rounded-full object-cover"
                  alt={t('avatar')}
                />

                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-slate-800">
                    {author.name || author.first_name}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {author.email}
                  </div>
                </div>

                <span className="text-[10px] text-slate-400 shrink-0">
                  {formatTime(comment.created_at)}
                </span>
              </div>

              {/* Текст комментария */}
              <p className="text-xs text-slate-700 leading-relaxed mb-2">
                {comment.text_content}
              </p>

              {/* Вложенные ответы */}
              {replies.length > 0 && (
                <div className="ml-3 border-l-2 border-primary-200 pl-3 space-y-2">
                  {replies.map((reply: any) => {
                    const replyAuthor = getAuthor(reply.author_id);

                    return (
                      <div key={reply.id} className="pt-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <img
                            src={replyAuthor.avatar}
                            className="w-5 h-5 rounded-full object-cover"
                            alt={t('avatar')}
                          />

                          <span className="text-[11px] font-bold text-slate-700">
                            {replyAuthor.name || replyAuthor.first_name}
                          </span>

                          <span className="text-[10px] text-slate-400 ml-auto">
                            {formatTime(reply.created_at)}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-600">
                          {reply.text_content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Кнопка "Ответить" и форма ответа */}
              {replyingTo === comment.id ? (
                <div className="mt-2 pl-3 border-l-2 border-slate-100">
                  <textarea
                    autoFocus
                    placeholder={t('reply.placeholder')}
                    rows={2}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none focus:border-primary-400 text-slate-700 placeholder-slate-400 resize-none"
                  />

                  <div className="flex justify-end gap-2 mt-1">
                    <button
                      onClick={() => setReplyingTo(null)}
                      className="px-3 py-1 text-slate-500 text-[11px] font-semibold hover:text-slate-700"
                    >
                      {t('cancel')}
                    </button>

                    <button
                      onClick={() => handleReply(comment.id)}
                      disabled={!replyText.trim()}
                      className="px-3 py-1 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[11px] font-semibold rounded-md transition-colors"
                    >
                      {t('reply.action')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReplyingTo(comment.id);
                  }}
                  className="mt-2 text-[11px] text-primary-600 font-semibold hover:underline"
                >
                  {t('reply.action')}
                </button>
              )}
            </div>
          );
        })}

        {/* Пустое состояние */}
        {!isAddingComment && rootComments.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-8 flex flex-col items-center gap-2">
            <i className="fa-regular fa-comment-dots text-2xl text-slate-300"></i>
            <span>{t('empty.title')}</span>
            <span>{t('empty.hint', { action: t('attach.add') })}</span>
          </div>
        )}
      </div>
    </div>
  );
};