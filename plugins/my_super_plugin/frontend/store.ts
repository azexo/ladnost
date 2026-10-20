// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: LicenseRef-Commercial

// plugins/my_super_plugin/frontend/store.ts
import { create } from 'zustand';

interface DiscountState {
  promoCode: string;
  discountPercent: number;
  setPromoCode: (code: string) => void;
  reset: () => void;
}

export const useDiscountStore = create<DiscountState>((set) => ({
  promoCode: '',
  discountPercent: 0,
  
  setPromoCode: (code) => {
    // Простая логика валидации промокода
    const percent = code === 'SUPER10' ? 10 : code === 'MEGA20' ? 20 : 0;
    set({ promoCode: code, discountPercent: percent });
  },
  
  reset: () => set({ promoCode: '', discountPercent: 0 }),
}));