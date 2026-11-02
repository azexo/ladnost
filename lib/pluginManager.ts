// lib/pluginManager.ts
type Callback = (payload: any) => void;
type FilterCallback = (data: any) => any;

interface HookItem<T> {
  callback: T;
  weight: number;
}

class PluginManager {
  private events: Record<string, HookItem<Callback>[]> = {};
  private filters: Record<string, HookItem<FilterCallback>[]> = {};
  private pluginLogics: Record<string, any> = {};

  // --- ACTIONS ---
  on(event: string, callback: Callback, weight: number = 10) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push({ callback, weight });
    this.events[event].sort((a, b) => b.weight - a.weight);
  }

  // 🆕 Отписка по конкретной функции
  off(event: string, callback: Callback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(
      (item) => item.callback !== callback,
    );
    if (this.events[event].length === 0) {
      delete this.events[event];
    }
  }

  // 🆕 (опционально) отписка всех слушателей события — полезно для тестов и очистки
  offAll(event: string) {
    delete this.events[event];
  }

  emit(event: string, payload?: any) {
    if (!this.events[event]) return;
    // 🆕 Копируем массив, чтобы callback'и могли безопасно отписываться во время emit
    const listeners = [...this.events[event]];
    listeners.forEach((item) => item.callback(payload));
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