#!/usr/bin/env bash
# Деплой сервера в Cloudflare Workers одной командой.
# Нужны: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (из дашборда),
#        TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (берутся из backend/.env, если не заданы).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/worker" || exit 1

if [ -f "$ROOT/backend/.env" ]; then
    # значения из файла не перебивают уже заданные переменные окружения
    while IFS='=' read -r key value; do
        case "$key" in ''|\#*) continue ;; esac
        [ -z "${!key:-}" ] && export "$key=$value"
    done < "$ROOT/backend/.env"
fi

missing=""
for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
    [ -z "${!name:-}" ] && missing="$missing $name"
done
if [ -n "$missing" ]; then
    echo "Не заданы:$missing"
    echo "Токен и Account ID: https://dash.cloudflare.com/profile/api-tokens (шаблон Edit Cloudflare Workers)"
    exit 1
fi

echo "== деплой =="
npx --yes wrangler@3 deploy --config wrangler.toml || exit 1

echo "== секреты бота =="
echo "$TELEGRAM_BOT_TOKEN" | npx --yes wrangler@3 secret put TELEGRAM_BOT_TOKEN --config wrangler.toml || exit 1
echo "$TELEGRAM_CHAT_ID" | npx --yes wrangler@3 secret put TELEGRAM_CHAT_ID --config wrangler.toml || exit 1

URL="$(npx --yes wrangler@3 deploy --config wrangler.toml 2>&1 | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)"
echo
echo "Готово. Проверка:"
curl -s "${URL}/api/health" && echo
echo "Адрес для приложения: ${URL}/api/messages"
