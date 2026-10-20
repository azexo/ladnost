// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// lib/pluginManager.ts

type Callback = (payload: any) => void;
type FilterCallback = (data: any) => any;

// Новый интерфейс для хранения хука с весом
interface HookItem<T> {
    callback: T;
    weight: number;
}

class PluginManager {
    // Изменяем типы на массивы объектов HookItem
    private events: Record<string, HookItem<Callback>[]> = {};
    private filters: Record<string, HookItem<FilterCallback>[]> = {};
    
    private pluginLogics: Record<string, any> = {};

    // --- ACTIONS ---
    on(event: string, callback: Callback, weight: number = 10) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push({ callback, weight });
        // Сортировка по убыванию: больший вес выполняется первым
        this.events[event].sort((a, b) => b.weight - a.weight);
    }

    emit(event: string, payload?: any) {
        if (!this.events[event]) return;
        this.events[event].forEach(item => item.callback(payload));
    }

    // --- FILTERS ---
    addFilter(filterName: string, callback: FilterCallback, weight: number = 10) {
        if (!this.filters[filterName]) this.filters[filterName] = [];
        this.filters[filterName].push({ callback, weight });
        this.filters[filterName].sort((a, b) => b.weight - a.weight);
    }

    applyFilters<T>(filterName: string, data: T): T {
        if (!this.filters[filterName]) return data;
        return this.filters[filterName].reduce((currentData, item) => {
            return item.callback(currentData);
        }, data);
    }

    // --- LOGIC REGISTRY ---
    registerLogic(pluginName: string, logicModule: any) {
        this.pluginLogics[pluginName] = logicModule;
    }

    getPluginLogic<T = any>(pluginName: string): T | undefined {
        return this.pluginLogics[pluginName];
    }
}

export const pluginManager = new PluginManager();