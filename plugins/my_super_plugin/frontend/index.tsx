// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: LicenseRef-Commercial

// plugins/my_super_plugin/frontend/index.tsx
"use client";
import React, { useState } from 'react';
import { useDiscountStore } from './store';
import { pluginManager } from '../../../lib/pluginManager';

const CartPromoWidget: React.FC = () => {
  const { promoCode, discountPercent, setPromoCode, reset } = useDiscountStore();
  const [inputValue, setInputValue] = useState(promoCode);

  const handleApply = () => {
    setPromoCode(inputValue);
    
    // Уведомляем ядро и другие плагины о том, что промокод применен
    pluginManager.emit('discount.promo_applied', { 
      code: inputValue, 
      percent: discountPercent 
    });
  };

  const handleClear = () => {
    reset();
    setInputValue('');
  };

  return (
    <div style={{ border: '1px solid #ddd', padding: '16px', borderRadius: '8px', marginTop: '16px', background: '#f9f9f9' }}>
      <h3 style={{ margin: '0 0 12px 0' }}>🎁 Промокод</h3>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.toUpperCase())}
          placeholder="Введите код (например, SUPER10)"
          style={{ padding: '8px', flex: 1, border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <button onClick={handleApply} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Применить
        </button>
        {promoCode && (
          <button onClick={handleClear} style={{ padding: '8px', cursor: 'pointer' }}>
            ✖
          </button>
        )}
      </div>
      
      {discountPercent > 0 && (
        <p style={{ color: 'green', margin: '8px 0 0 0' }}>
          ✅ Промокод применен! Скидка {discountPercent}%.
        </p>
      )}
      {promoCode && discountPercent === 0 && (
        <p style={{ color: 'red', margin: '8px 0 0 0' }}>
          ❌ Неверный промокод.
        </p>
      )}
    </div>
  );
};

export default CartPromoWidget; 