#!/bin/bash
# CustomsAI Launcher
# Простой запуск без Electron — двойной клик в Finder

DIR="/Users/alikhan/Customs Declaration"
cd "$DIR"

# Проверяем node
if ! command -v node &> /dev/null; then
    osascript -e 'display alert "Node.js не найден" message "Установите Node.js с nodejs.org" buttons {"OK"}'
    exit 1
fi

# Проверяем bot.js
if [ ! -f "$DIR/bot.js" ]; then
    osascript -e 'display alert "bot.js не найден" message "Положите bot.js в ту же папку что и этот файл" buttons {"OK"}'
    exit 1
fi

# Запускаем в новом окне терминала
osascript <<EOF
tell application "Terminal"
    activate
    set newTab to do script "cd '$DIR' && echo '🚀 CustomsAI запускается...' && node bot.js"
    set custom title of newTab to "CustomsAI — WhatsApp Бот"
end tell
EOF
