#!/bin/bash
# Auto-restart wrapper for customs bot

LOG_FILE="/tmp/bot_autorestart.log"
PROJECT_DIR="/Users/alikhan/Desktop/AI Projects/Customs Declaration"

echo "$(date): Starting auto-restart monitor..." >> $LOG_FILE

cd "$PROJECT_DIR"

while true; do
    echo "$(date): Starting bot..." >> $LOG_FILE
    
    # Run the bot and capture output
    node bot.restored.js 2>&1 | tee -a /tmp/bot.log &
    BOT_PID=$!
    
    echo "$(date): Bot PID: $BOT_PID" >> $LOG_FILE
    
    # Wait for bot to finish (crash or exit)
    wait $BOT_PID
    EXIT_CODE=$?
    
    echo "$(date): Bot exited with code: $EXIT_CODE. Restarting in 5 seconds..." >> $LOG_FILE
    
    # Small delay before restart
    sleep 5
done
