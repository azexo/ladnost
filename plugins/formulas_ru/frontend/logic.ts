// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// lib/logic.ts
import { pluginManager } from '@/lib/pluginManager';
import { clmFormulaService } from './formula-service';

export function init() {
    pluginManager.addFilter('evaluateFormula', (payload: any) => {
        const { formula, context } = payload;
        
        const rawResult = clmFormulaService.evaluate(formula, context);
        payload.result = rawResult;

        return payload;
    });
}