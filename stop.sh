#!/bin/bash
APP_NAME="clm"
PORT=3001

echo "🛑 === Остановка проекта '$APP_NAME' ==="

# Шаг 1: Останавливаем через PM2
echo "📦 [1/2] Остановка PM2 процесса '$APP_NAME'..."
pm2 stop $APP_NAME > /dev/null 2>&1
pm2 delete $APP_NAME > /dev/null 2>&1
echo "✅ PM2 процесс остановлен."

# Шаг 2: Жестко освобождаем порт через fuser
echo "🔍 [2/2] Освобождение порта $PORT..."

# fuser -k убивает ВСЕ процессы, которые держат этот порт (и слушают, и соединяются)
if fuser -k ${PORT}/tcp > /dev/null 2>&1; then
    sleep 1
    # Проверяем, что порт действительно свободен
    if ss -tlnp | grep -q ":${PORT} "; then
        echo "❌ ОШИБКА: Порт $PORT всё ещё занят!"
        exit 1
    else
        echo "✅ Порт $PORT успешно освобожден."
    fi
else
    echo "✅ Порт $PORT уже был свободен."
fi

echo "🎉 === Готово! ==="