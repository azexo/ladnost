// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
// SPDX-License-Identifier: AGPL-3.0-or-later

// components/AuthInitializer.tsx
'use client';
import { useEffect, useMemo, useState, useRef } from 'react'; // 🆕 Добавили useState и useRef
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useNavbarStore } from '@/store/useNavbarStore';
import { pluginManager } from '@/lib/pluginManager';
import { tokenUtils } from '@/lib/types'; // 🆕 Убедитесь, что импортирован
import { authApi } from '@/lib/realApi'; // 🆕 Импортируем authApi

const DEFAULT_ALLOWED_PATHS = ['/', '/viewer', '/trial-expired'];
const DEFAULT_BYPASS_PATHS: string[] = [];

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AuthInitializer');

  const initializeAuth = useNavbarStore((state) => state.initializeAuth);
  const isAuthLoading = useNavbarStore((state) => state.isAuthLoading);
  const isAuthInitialized = useNavbarStore((state) => state.isAuthInitialized);
  const user = useNavbarStore((state) => state.user);
  const setSkipGlobalLogout = useNavbarStore((state) => state.setSkipGlobalLogout);


  // 🆕 Состояния для контроля процесса обмена OTT
  const [isProcessingOtt, setIsProcessingOtt] = useState(false);
  const ottProcessedRef = useRef(false); // Защита от двойного вызова (Strict Mode / быстрые клики)

  const bypassAuthPaths = pluginManager.applyFilters('auth.bypassPaths', [...DEFAULT_BYPASS_PATHS]);
  const isBypassPath = useMemo(() => {
    return bypassAuthPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
  }, [bypassAuthPaths, pathname]);

  // 🆕 Единый эффект для обработки OTT и инициализации
  const initProcessedRef = useRef(false);

  useEffect(() => {
    const handleOttAndInit = async () => {
      const params = new URLSearchParams(window.location.search);
      const ott = params.get('ott');

      setSkipGlobalLogout(true);
      try {
        if (ott && !tokenUtils.getToken() && !ottProcessedRef.current) {
          ottProcessedRef.current = true;
          setIsProcessingOtt(true);
          try {
            await authApi.exchangeOtt(ott);
            params.delete('ott');
            const cleanUrl = params.toString()
              ? `${window.location.pathname}?${params.toString()}`
              : window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
          } catch (e) {
            console.error('Ошибка обмена OTT:', e);
          } finally {
            setIsProcessingOtt(false);
          }
        }
        if (!isAuthInitialized && !initProcessedRef.current) {
          initProcessedRef.current = true;
          await initializeAuth();
        }
      } finally {
        setSkipGlobalLogout(false);
      }
    };
    handleOttAndInit();
  }, [initializeAuth, isAuthInitialized]);

  // 🆕 ГАРД: Не редиректить, пока идет обработка OTT!
  useEffect(() => {
    if (isBypassPath) return;
    if (!isAuthInitialized) return;
    if (isProcessingOtt) return; // 🔥 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: ждем завершения обмена токена

    const allowedPaths = pluginManager.applyFilters('auth.allowedPaths', [...DEFAULT_ALLOWED_PATHS]);
    const isAllowedPath = allowedPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
    if (isAllowedPath) return;

    if (!isAuthLoading && !user) {
      const nextPath = encodeURIComponent(pathname);
      console.log(`[AuthInitializer] ${t('userNotFoundRedirect')}`);
      router.push(`/?next=${nextPath}`);
    }
  }, [user, isAuthLoading, isAuthInitialized, isProcessingOtt, router, pathname, t, isBypassPath]);

  if (isBypassPath) return <>{children}</>;

  // Показываем загрузку, если идет инициализация ИЛИ обработка OTT
  if (!isAuthInitialized || isProcessingOtt) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return <>{children}</>;
}