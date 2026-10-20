// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/SubscriptionGuard.tsx
'use client';
import { useEffect, useMemo } from 'react'; // 🆕 Добавили useMemo
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useNavbarStore } from '@/store/useNavbarStore';
import { SubscriptionStatus } from '@/lib/types';
import { pluginManager } from '@/lib/pluginManager';

// 🔒 Пути, которые блокируются при истёкшей подписке
const DEFAULT_BLOCKED_PATHS = ['/workspace', '/formulations', '/tasks'];
const DEFAULT_BYPASS_PATHS: string[] = [];

export function SubscriptionGuard({ children }: { children: React.ReactNode }) {
  // Инициализируем переводы для неймспейса SubscriptionGuard
  const t = useTranslations('SubscriptionGuard');
  const router = useRouter();
  const pathname = usePathname();

  // 🆕 1. Получаем список путей, которые полностью игнорируют проверку подписки через хук плагина
  const bypassSubscriptionPaths = pluginManager.applyFilters(
    'subscription.bypassPaths',
    DEFAULT_BYPASS_PATHS
  );

  // 🆕 2. Проверяем, находится ли текущий путь в списке игнорируемых
  const isBypassPath = useMemo(() => {
    return bypassSubscriptionPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
  }, [bypassSubscriptionPaths, pathname]);

  // 🆕 3. Заменяем хардкод if (pathname.startsWith('/partner'))
  if (isBypassPath) {
    return <>{children}</>;
  }

  const { currentWorkspace, currentSubscription, fetchMyWorkspaces, isInitializing } = useWorkspaceStore();
  const user = useNavbarStore((state) => state.user);

  // 1. Загрузка воркспейсов
  useEffect(() => {
    console.log('[SubscriptionGuard] Effect 1 (Fetch): User:', !!user, 'Workspace:', !!currentWorkspace, 'Initializing:', isInitializing);
    if (user && !currentWorkspace) {
      console.log('[SubscriptionGuard] Effect 1 (Fetch):', t('fetchingWorkspaces'));
      fetchMyWorkspaces();
    }
  }, [user, currentWorkspace, fetchMyWorkspaces, t]);

  // 2. Проверка подписки и редирект
  useEffect(() => {
    console.log('[SubscriptionGuard] Effect 2 (Check): Initializing:', isInitializing, 'HasWorkspace:', !!currentWorkspace, 'Path:', pathname);
    
    // Ждём окончания инициализации
    if (isInitializing) {
      console.log('[SubscriptionGuard] Effect 2 (Check):', t('initializingSkip'));
      return;
    }

    if (!currentWorkspace) {
      console.log('[SubscriptionGuard] Effect 2 (Check):', t('workspaceNotLoadedSkip'));
      return;
    }

    // --- Определяем, истекла ли подписка ---
    let isExpired = false;
    let expireReason = t('subscriptionActive');
    const now = new Date();

    if (!currentSubscription) {
      isExpired = true;
      expireReason = t('noSubscriptionObject');
    } else {
      console.log('[SubscriptionGuard] Effect 2 (Check): Статус:', currentSubscription.status, ', Expires:', currentSubscription.expires_at);
      if (
        currentSubscription.status === SubscriptionStatus.EXPIRED ||
        currentSubscription.status === SubscriptionStatus.PAST_DUE ||
        currentSubscription.status === SubscriptionStatus.CANCELED
      ) {
        isExpired = true;
        expireReason = t('subscriptionStatus', { status: currentSubscription.status });
      } else if (currentSubscription.expires_at && new Date(currentSubscription.expires_at) < now) {
        isExpired = true;
        expireReason = t('expirationDatePassed', { date: currentSubscription.expires_at });
      }
    }

    console.log('[SubscriptionGuard] Effect 2 (Check): isExpired:', isExpired, '| Причина:', expireReason);

    // --- Проверка: попадает ли текущий путь в заблокированные ---
    const blockedPaths = pluginManager.applyFilters(
      'subscription.blockedPaths',
      [...DEFAULT_BLOCKED_PATHS]
    );

    const isBlockedPath = blockedPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );

    console.log('[SubscriptionGuard] Effect 2 (Check): isBlockedPath:', isBlockedPath, '| Path:', pathname);

    // ✅ Если подписка активна, а юзер сидит на /trial-expired — возвращаем на главную
    if (!isExpired && pathname === '/trial-expired') {
      console.log('[SubscriptionGuard] Effect 2 (Check): Подписка активна → редирект с /trial-expired на /');
      router.replace('/');
      return;
    }

    // ✅ Если подписка истекла И путь в списке заблокированных — редиректим на /trial-expired
    if (isExpired && isBlockedPath) {
      if (pathname !== '/trial-expired') {
        console.log('[SubscriptionGuard]:', t('expiredAndBlockedRedirect'));
        router.replace('/trial-expired');
      }
      return;
    }

    // ✅ Во всех остальных случаях — пропускаем (рисуем children)
    console.log('[SubscriptionGuard] Effect 2 (Check):', t('renderingChildren'));
  }, [currentWorkspace, currentSubscription, pathname, router, isInitializing, t]);

  return <>{children}</>;
}