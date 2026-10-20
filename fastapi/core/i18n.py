# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

# core/i18n.py
import json
from pathlib import Path
from typing import Any
import os

class I18n:
    def __init__(self, locales_dir_name: str = "messages", default_locale: str = "ru"):
        self.default_locale = default_locale
        self.translations: dict[str, dict] = {}
        
        # 1. Определяем абсолютные пути для поиска
        current_file_path = Path(__file__).resolve()
        backend_dir = current_file_path.parent.parent       # Директория корня бакенда
        repo_dir = backend_dir.parent                       # Директория корня репозитария
        
        # 2. Формируем список возможных путей к папке locales
        possible_paths = [
            backend_dir / locales_dir_name,  
            repo_dir / locales_dir_name    
        ]
        
        # 3. Ищем первую существующую папку
        locales_path = None
        for path in possible_paths:
            if path.is_dir():
                locales_path = path
                break
                
        if locales_path is None:
            raise FileNotFoundError(
                f"Папка '{locales_dir_name}' не найдена. "
                f"Проверены пути: {backend_dir} и {repo_dir}"
            )

        # 4. Загружаем переводы
        self._load_translations(locales_path)

    def _load_translations(self, locales_path: Path):
        """Загружает все JSON файлы из найденной папки в память"""
        for file_path in locales_path.glob("*.json"):
            locale = file_path.stem.split('-')[0]
            with open(file_path, "r", encoding="utf-8") as f:
                self.translations[locale] = json.load(f)

    def t(self, key: str, locale: str | None = None, **kwargs) -> str:
        """
        Переводит ключ. 
        Поддерживает вложенные ключи через точку (например, 'errors.not_found').
        """
        locale = locale or self.default_locale
        keys = key.split(".")
        
        # Получаем словарь для нужной локали (или фоллбэк на дефолтный)
        data = self.translations.get(locale, self.translations.get(self.default_locale, {}))
        
        # Идем по вложенным ключам
        for k in keys:
            if isinstance(data, dict):
                data = data.get(k)
            else:
                return key  # Если структура сломана, возвращаем сам ключ
                
        if data is None:
            return key  # Фоллбэк, если конкретного ключа нет
            
        # Подстановка переменных (например, "Привет, {name}")
        if kwargs and isinstance(data, str):
            for k_arg, v_arg in kwargs.items():
                data = data.replace(f"{{{k_arg}}}", str(v_arg))
                
        return data

i18n = I18n(default_locale=os.getenv("LOCALE", "ru"))

def t(key: str, **kwargs) -> str:
    return i18n.t(key, **kwargs)