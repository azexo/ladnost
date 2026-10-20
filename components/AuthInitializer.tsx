// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/AuthInitializer.tsx
'use client';
import { useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useNavbarStore } from '@/store/useNavbarStore';
import { pluginManager } from '@/lib/pluginManager';

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

  // 🆕 1. Получаем список путей, которые полностью пропускают авторизацию через хук плагина
  const bypassAuthPaths = pluginManager.applyFilters(
    'auth.bypassPaths',
    [...DEFAULT_BYPASS_PATHS]
  );

  // 🆕 2. Проверяем, находится ли текущий путь в списке игнорируемых
  const isBypassPath = useMemo(() => {
    return bypassAuthPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
  }, [bypassAuthPaths, pathname]);

  // 3. Запускаем инициализацию только один раз
  useEffect(() => {
    if (!isAuthInitialized) {
      initializeAuth();
    }
  }, [initializeAuth, isAuthInitialized]);

  // 4. Проверяем авторизацию ТОЛЬКО после того, как инициализация началась
  useEffect(() => {
    // 🆕 Заменяем хардкод if (pathname.startsWith('/partner'))
    if (isBypassPath) {
      return;
    }

    if (!isAuthInitialized) {
      return;
    }

    const allowedPaths = pluginManager.applyFilters(
      'auth.allowedPaths',
      [...DEFAULT_ALLOWED_PATHS]
    );
    
    const isAllowedPath = allowedPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );

    if (isAllowedPath) {
      return;
    }

    if (!isAuthLoading && !user) {
      console.log(`[AuthInitializer] ${t('userNotFoundRedirect')}`);
      router.push('/');
      return;
    }
  }, [user, isAuthLoading, isAuthInitialized, router, pathname, t, isBypassPath]);

  // 🆕 5. Пропускаем спиннер для bypass путей (замена второго хардкода /partner)
  if (isBypassPath) {
    return <>{children}</>;
  }

  // 6. Показываем спиннер, пока не инициализировано
  if (!isAuthInitialized) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      </div>
    );
  }

  return <>{children}</>;
}