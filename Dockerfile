# ==========================================
# ЭТАП 0: БАЗОВЫЙ (Системные зависимости)
# ==========================================
FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y \
    python3 python3-venv python3-pip wget unzip && \
    rm -rf /var/lib/apt/lists/*

COPY ./pandoc-debs/ /tmp/
RUN ARCH=$(dpkg --print-architecture) && \
    dpkg -i /tmp/pandoc-3.2.1-1-${ARCH}.deb && \
    apt-get install -f -y && \
    rm -rf /tmp/pandoc*.deb

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir 'markitdown[all]'

# ==========================================
# ЭТАП 1: СБОРКА (устанавливаем ВСЁ)
# ==========================================
FROM base AS builder
WORKDIR /app

COPY package*.json ./
# На этапе сборки браузер не нужен, ускоряем npm ci
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

COPY . .
RUN npm run build

# ==========================================
# ЭТАП 2: ЗАПУСК (Production + Hardening)
# ==========================================
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Устанавливаем ТОЛЬКО chromium и шрифты. 
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Создаем непривилегированного пользователя
RUN useradd -m -u 1001 -s /bin/bash nextjsuser

# Копируем результаты сборки
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY package*.json ./

RUN npm ci --omit=dev

# Отдаем права
RUN chown -R nextjsuser:nextjsuser /app /tmp

# Скрипт инициализации
RUN printf '#!/bin/sh\nset -e\nexec node server.js\n' > /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh && \
    chown nextjsuser:nextjsuser /app/entrypoint.sh

USER nextjsuser
EXPOSE 3000
CMD ["/app/entrypoint.sh"]