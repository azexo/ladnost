# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import os
import json
import importlib
import sys
import logging
from fastapi import FastAPI
from pathlib import Path

# Настраиваем логгер для этого модуля
logger = logging.getLogger(__name__)

# Путь к папке плагинов (на уровень выше fastapi)
# Если структура папок другая, этот путь нужно будет скорректировать
PLUGINS_DIR = Path(__file__).resolve().parent.parent.parent / "plugins"

def load_plugins(app: FastAPI):
    logger.info(f"[Plugin Loader] 🔍 Ожидаемый путь к папке плагинов: {PLUGINS_DIR}")
    
    if not PLUGINS_DIR.exists():
        logger.warning(f"[Plugin Loader] ⚠️ Папка плагинов НЕ найдена по указанному пути. Загрузка пропущена.")
        return
    
    logger.info(f"[Plugin Loader] ✅ Папка плагинов найдена. Начинаем сканирование...")
    
    # Добавляем папку плагинов в sys.path, чтобы Python мог импортировать их как модули
    sys.path.append(str(PLUGINS_DIR))
    
    plugins_found = 0
    
    for plugin_dir in PLUGINS_DIR.iterdir():
        if not plugin_dir.is_dir():
            continue
            
        manifest_path = plugin_dir / "plugin.json"
        if not manifest_path.exists():
            logger.debug(f"[Plugin Loader] Пропуск {plugin_dir.name}: отсутствует файл plugin.json")
            continue
            
        plugins_found += 1
        
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
            
        # .strip() автоматически удалит случайные пробелы в начале/конце строк из JSON
        plugin_name = str(manifest.get("name", plugin_dir.name)).strip()
        
        # ==========================================
        # 1. ПРОВЕРКА ГЛОБАЛЬНОГО ФЛАГА (Фронтенд + Бэкенд)
        # ==========================================
        if manifest.get("enabled") is False or manifest.get("disabled") is True:
            logger.info(f"[Plugin Loader] ⏭️ Плагин '{plugin_name}' полностью отключен в манифесте. Пропускаем.")
            continue
            
        # ==========================================
        # 2. ПРОВЕРКА НАЛИЧИЯ И ВКЛЮЧЕННОСТИ БЭКЕНДА
        # ==========================================
        backend_config = manifest.get("backend")
        
        # Если секции "backend" нет ВОВСЕ, или она явно отключена — пропускаем загрузку роутера
        if not backend_config or not backend_config.get("enabled", True):
            logger.info(f"[Plugin Loader] ⏭️ Бэкенд для '{plugin_name}' не настроен или отключен. Пропуск загрузки роутера.")
            continue
            
        # Извлекаем параметры конфигурации и сразу очищаем их от пробелов (.strip())
        module_path = str(backend_config.get("module", f"{plugin_name}.backend.main")).strip()
        router_attr = str(backend_config.get("router_attr", "router")).strip()
        prefix = str(backend_config.get("prefix", f"/api/plugins/{plugin_name}")).strip()
        
        logger.info(f"[Plugin Loader] 🔄 Попытка загрузки '{plugin_name}': module='{module_path}', prefix='{prefix}'")
        
        try:
            # Динамический импорт модуля плагина
            module = importlib.import_module(module_path)
            
            # Получаем объект роутера из модуля
            router = getattr(module, router_attr)
            
            # Подключаем роутер к основному приложению FastAPI
            app.include_router(router, prefix=prefix, tags=[f"Plugin: {plugin_name}"])
            
            logger.info(f"[Plugin Loader] ✅ Успешно загружен backend для: {plugin_name}")
            
        except ModuleNotFoundError as e:
            logger.error(f"[Plugin Loader] ❌ Ошибка импорта модуля '{module_path}' для плагина '{plugin_name}': {e}")
        except AttributeError as e:
            logger.error(f"[Plugin Loader] ❌ Не найден атрибут '{router_attr}' в модуле '{plugin_name}': {e}")
        except Exception as e:
            logger.error(f"[Plugin Loader] ❌ Критическая ошибка загрузки плагина '{plugin_name}': {e}", exc_info=True)
            
    # Итоговая сводка
    if plugins_found == 0:
        logger.warning("[Plugin Loader] ⚠️ В папке plugins не найдено ни одного валидного плагина.")
    else:
        logger.info(f"[Plugin Loader] 🏁 Сканирование завершено. Всего обработано плагинов: {plugins_found}")