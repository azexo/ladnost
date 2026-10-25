#!/bin/bash
# === Настройки ===
APP_DIR="/var/www/clm"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
RELEASE_NAME=$(date +%Y%m%d_%H%M%S)
RELEASE_PATH="$RELEASES_DIR/$RELEASE_NAME"
# Сколько последних релизов хранить на диске
KEEP_RELEASES=1

echo "=== Начало атомарного деплоя $(date) ==="

# --- Шаг 0: Инициализация (БЕЗ УДАЛЕНИЙ!) ---
echo "Проверяем и создаем структуру папок..."
mkdir -p "$RELEASES_DIR"

# Убеждаемся, что APP_DIR - это git репозиторий
if [ ! -d "$APP_DIR/.git" ]; then
    echo "ОШИБКА: $APP_DIR не является git репозиторий!"
    echo "Скрипт ожидает, что /var/www/clm будет рабочей копией репозитория."
    exit 1
fi

# Создаем симлинк current, если его еще нет (указываем на самый свежий релиз, если он есть)
if [ ! -L "$CURRENT_LINK" ]; then
    LATEST_RELEASE=$(ls -dt "$RELEASES_DIR"/*/ 2>/dev/null | head -1)
    if [ -n "$LATEST_RELEASE" ]; then
        ln -sfn "$LATEST_RELEASE" "$CURRENT_LINK"
        echo "Симлинк 'current' создан на $LATEST_RELEASE"
    else
        echo "Предупреждение: релизов пока нет, симлинк current будет создан в конце деплоя."
    fi
fi

# --- Шаг 1: Обновление исходников в базовой папке (копии репозитория) ---
echo "Переходим в базовую папку $APP_DIR и получаем обновления из git..."
cd "$APP_DIR"
git pull origin main
if [ $? -ne 0 ]; then
    echo "Ошибка при получении изменений из git!"
    exit 1
fi

# --- Шаг 2: Подготовка нового релиза ---
echo "Создаем папку для нового релиза: $RELEASE_PATH"
mkdir -p "$RELEASE_PATH"

# Копируем файлы из базовой папки (копии репо) в новый релиз.
# Используем --delete, чтобы в релизе не осталось мусора от прошлых версий.
# Исключаем: releases, current, node_modules, артефакты сборки и fastapi.
echo "Копируем исходный код в новую папку..."
rsync -a --delete \
    --exclude='releases' \
    --exclude='current' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.next' \
    --exclude='build' \
    --exclude='tmp' \
    --exclude='specifications' \
    --exclude='design' \
    --exclude='outreach' \
    --exclude='fastapi' \
    "$APP_DIR/" "$RELEASE_PATH/"

if [ $? -ne 0 ]; then
    echo "Ошибка при копировании файлов!"
    rm -rf "$RELEASE_PATH"
    exit 1
fi

cd "$RELEASE_PATH"

# --- Шаг 3: Устанавливаем зависимости и собираем В НОВОЙ ПАПКЕ ---
echo "Устанавливаем зависимости..."
npm install # Если есть package-lock.json, лучше заменить на npm ci
if [ $? -ne 0 ]; then
    echo "Ошибка при установке зависимостей!"
    rm -rf "$RELEASE_PATH"
    exit 1
fi

echo "Собираем проект..."
npm run build
if [ $? -ne 0 ]; then
    echo "Ошибка при сборке проекта!"
    rm -rf "$RELEASE_PATH"
    exit 1
fi

# --- Шаг 4: Атомарное переключение симлинка ---
echo "Переключаем симлинк 'current' на новый релиз..."
ln -sfn "$RELEASE_PATH" "$CURRENT_LINK"

# --- Шаг 5: Перезапуск PM2 ---
echo "Перезапускаем приложение через PM2..."
if pm2 describe clm > /dev/null 2>&1; then
    pm2 reload clm --update-env
else
    # Запускаем с явным указанием рабочей директории (симлинка)
    pm2 start npm --name "clm" -i 1 --cwd "$CURRENT_LINK" -- run start
fi

if [ $? -ne 0 ]; then
    echo "Ошибка при запуске/перезапуске PM2!"
    exit 1
fi
pm2 save

# --- Шаг 6: Очистка старых релизов ---
echo "Очищаем старые релизы (оставляем последние $KEEP_RELEASES)..."
cd "$RELEASES_DIR"
ls -dt */ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf

echo "=== Деплой успешно завершен $(date) ==="