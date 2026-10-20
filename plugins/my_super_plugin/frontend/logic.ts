// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: LicenseRef-Commercial

// plugins/my_super_plugin/frontend/logic.ts
import { pluginManager } from '../../../lib/pluginManager';
import { useDiscountStore } from './store';

// 1. Функция инициализации (вызывается ядром при старте)
export function init() {
  console.log('[Discount Plugin] Initializing logic and hooks...');

  // --- FILTERS (Перехват и модификация данных ядра) ---
  
  // Перехватываем расчет итоговой суммы корзины
  pluginManager.addFilter('cart.calculate_total', (total: number) => {
    const { discountPercent } = useDiscountStore.getState();
    if (discountPercent > 0) {
      console.log(`[Discount Plugin] Applying ${discountPercent}% discount to total.`);
      return total * (1 - discountPercent / 100);
    }
    return total;
  });

  // --- ACTIONS (События / Побочные эффекты) ---
  
  // Слушаем событие ядра о начале чекаута (например, для аналитики)
  pluginManager.on('cart.checkout_started', (payload) => {
    const { promoCode } = useDiscountStore.getState();
    console.log(`[Discount Plugin] Analytics: Checkout started with promo "${promoCode}"`, payload);
  });
}

// 2. Экспорт API плагина (чтобы ядро или другие плагины могли управлять им)
export const pluginApi = {
  applyPromo: (code: string) => useDiscountStore.getState().setPromoCode(code),
  getDiscountInfo: () => {
    const state = useDiscountStore.getState();
    return { code: state.promoCode, percent: state.discountPercent };
  },
  clearPromo: () => useDiscountStore.getState().reset()
};