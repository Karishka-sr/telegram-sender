#!/usr/bin/env bash
# Держит бэкенд запущенным: перезапускает упавший процесс и пишет логи в backend.log.
# Использование: ./deploy/serve.sh [порт]
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-12000}"
LOG="$ROOT/backend.log"
PIDFILE="$ROOT/backend.pid"

cd "$ROOT/backend" || exit 1

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"; exit 0' INT TERM

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] старт uvicorn на порту $PORT" >> "$LOG"
    python3 -m uvicorn main:app --host 0.0.0.0 --port "$PORT" >> "$LOG" 2>&1
    code=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] процесс завершился с кодом $code, перезапуск через 3с" >> "$LOG"
    sleep 3
done
