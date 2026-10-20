# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import asyncio
from typing import Callable, Any, Dict, List
from collections import defaultdict

class HookSystem:
    def __init__(self):
        # Теперь храним не просто функции, а объекты с функцией и её весом
        self._actions: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._filters: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    # ==========================================
    # ACTIONS (События)
    # ==========================================
    async def action(self, event_name: str, payload: Any = None):
        """Асинхронный вызов. Использовать в `async def` роутах."""
        for item in self._actions.get(event_name, []):
            callback = item["callback"]
            if asyncio.iscoroutinefunction(callback):
                await callback(payload)
            else:
                callback(payload)

    def action_sync(self, event_name: str, payload: Any = None):
        """Синхронный вызов. Использовать в обычных `def` роутах или скриптах."""
        for item in self._actions.get(event_name, []):
            callback = item["callback"]
            if asyncio.iscoroutinefunction(callback):
                self._run_async_in_sync(callback(payload))
            else:
                callback(payload)

    # ==========================================
    # FILTERS (Фильтры данных)
    # ==========================================
    async def apply_filters(self, filter_name: str, data: Any) -> Any:
        """Асинхронное применение фильтров."""
        for item in self._filters.get(filter_name, []):
            callback = item["callback"]
            if asyncio.iscoroutinefunction(callback):
                data = await callback(data)
            else:
                data = callback(data)
        return data

    def apply_filters_sync(self, filter_name: str, data: Any) -> Any:
        """Синхронное применение фильтров. (Внимание: см. комментарий ниже)"""
        for item in self._filters.get(filter_name, []):
            callback = item["callback"]
            if asyncio.iscoroutinefunction(callback):
                # Для фильтров нам ОБЯЗАТЕЛЬНО нужно дождаться результата
                data = self._run_async_in_sync(callback(data), wait_result=True)
            else:
                data = callback(data)
        return data

    # ==========================================
    # РЕГИСТРАЦИЯ С УЧЕТОМ ВЕСА (WEIGHT)
    # ==========================================
    def on(self, event_name: str, weight: int = 10):
        """
        Декоратор для подписки на события (Actions).
        :param weight: Приоритет выполнения. Чем больше число, тем раньше выполнится хук.
        """
        def decorator(callback: Callable):
            self._actions[event_name].append({"callback": callback, "weight": weight})
            # Сортируем по убыванию веса (больший вес = выше приоритет)
            self._actions[event_name].sort(key=lambda x: x["weight"], reverse=True)
            return callback
        return decorator

    def filter(self, filter_name: str, weight: int = 10):
        """
        Декоратор для подписки на фильтры (Filters).
        :param weight: Приоритет выполнения. Чем больше число, тем раньше выполнится хук.
        """
        def decorator(callback: Callable):
            self._filters[filter_name].append({"callback": callback, "weight": weight})
            # Сортируем по убыванию веса
            self._filters[filter_name].sort(key=lambda x: x["weight"], reverse=True)
            return callback
        return decorator

    # ==========================================
    # ВСПОМОГАТЕЛЬНЫЙ МЕТОД (Магия переключения контекстов)
    # ==========================================
    def _run_async_in_sync(self, coro, wait_result: bool = False):
        """
        Безопасно запускает асинхронную задачу из синхронного кода.
        """
        try:
            # Пытаемся получить текущий цикл событий
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
            
        if loop and loop.is_running():
            # Случай 1: Мы внутри FastAPI, но в синхронном `def` роуте.
            # Цикл уже запущен в главном потоке, а мы в потоке пула (threadpool).
            # Планируем задачу в главном цикле.
            future = asyncio.run_coroutine_threadsafe(coro, loop)
            if wait_result:
                # Для фильтров: блокируем текущий поток и ждем результат
                return future.result()
            # Для экшенов: просто отправили и забыли (Fire-and-Forget)
            return None
        else:
            # Случай 2: Мы в обычном скрипте, цикла нет. Создаем новый.
            if wait_result:
                return asyncio.run(coro)
            else:
                asyncio.run(coro)
                return None

# Глобальный экземпляр
hooks = HookSystem()