// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

'use client';
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { usersApi } from '@/lib/realApi';
import { User } from '@/lib/types';
import { useNavbarStore } from '@/store/useNavbarStore';

interface UserEmailInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function UserEmailInput({
  value,
  onChange,
  placeholder,
  className = ""
}: UserEmailInputProps) {
  // 🆕 Подключаем переводы для неймспейса UserEmailInput
  const t = useTranslations('UserEmailInput');
  
  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);
  
  const { user } = useNavbarStore();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setIsLoading(true);
    usersApi.listRelated().then((data) => {
      setUsers(data);
      setIsLoading(false);
    });
  }, []);

  const updatePosition = () => {
    if (wrapperRef.current && isOpen) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setPortalStyle({
        position: 'fixed',
        top: rect.bottom + 4, 
        left: rect.left,
        width: rect.width,
        zIndex: 9999, 
      });
    }
  };

  useLayoutEffect(() => {
    updatePosition();
    if (isOpen) {
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const portalElement = document.getElementById('user-email-dropdown-portal');
      if (
        wrapperRef.current && !wrapperRef.current.contains(event.target as Node) &&
        portalElement && !portalElement.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredUsers = users.filter(u => {
    if (user && u.id === user.id) {
      return false;
    }
    return (
      u.email.toLowerCase().includes(value.toLowerCase()) ||
      `${u.last_name} ${u.first_name}`.toLowerCase().includes(value.toLowerCase())
    );
  });

  const handleSelectUser = (user: User) => {
    onChange(user.email);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setIsOpen(true);
  };

  const dropdownContent = isOpen ? (
    <div
      id="user-email-dropdown-portal"
      style={portalStyle}
      className="bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
    >
      {isLoading ? (
        <div className="p-3 text-center text-xs text-slate-400">
          <i className="fa-solid fa-spinner fa-spin mr-2"></i> {t('loading')}
        </div>
      ) : filteredUsers.length > 0 ? (
        <ul>
          {filteredUsers.map(user => (
            <li
              key={user.id}
              onClick={() => handleSelectUser(user)}
              className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0"
            >
              <img
                src={user.avatar_url || '/default-avatar.svg'}
                className="w-6 h-6 rounded-full object-cover"
                alt="Avatar"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-800 truncate">
                  {user.last_name} {user.first_name}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {user.email}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : value.trim() ? (
        <div
          onClick={() => { setIsOpen(false); }}
          className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs text-slate-600"
        >
          <i className="fa-solid fa-envelope text-slate-400"></i>
          <span>
            {/* 🆕 Используем t.rich для безопасного рендера тега <b> */}
            {t.rich('useEmail', {
              value,
              b: (chunks) => <b>{chunks}</b>
            })}
          </span>
        </div>
      ) : (
        <div className="p-3 text-center text-xs text-slate-400">
          {t('noRelatedUsers')}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <div className="relative">
        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          // 🆕 Если пропс не передан, берем из переводов
          placeholder={placeholder || t('placeholder')}
          className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow"
        />
      </div>
      {mounted && dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
}