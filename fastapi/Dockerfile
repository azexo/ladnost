# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

FROM python:3.12-slim AS base

# Создание непривилегированного пользователя (аналог www-data)
RUN useradd -m -u 1001 -s /bin/bash fastapiuser

WORKDIR /app

# Копируем зависимости
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt gunicorn uvicorn

# Копируем код
COPY . .

# Создаем папку для загрузок и назначаем права
RUN mkdir -p /app/uploads && chown -R fastapiuser:fastapiuser /app

USER fastapiuser
EXPOSE 8000

# ИСПРАВЛЕННАЯ КОМАНДА: убраны лишние пробелы внутри строк массива
CMD ["gunicorn", "main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000"]