#!/usr/bin/env bash
# Публикует проект: пуш в GitHub, релиз с APK, включение GitHub Pages.
# Нужен токен с правом создавать релизы и настраивать Pages.
#   ./scripts/publish.sh [owner/repo] [версия]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-Karishka-sr/telegram-sender}"
TAG="${2:-v1.0.0}"
TOKEN="${GITHUB_TOKEN:?нужен GITHUB_TOKEN}"
API="https://api.github.com/repos/$REPO"

cd "$ROOT"

echo "==> пуш в $REPO"
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$TOKEN@github.com/$REPO.git"
git push -u origin main --force

echo "==> релиз $TAG"
release_id=$(
    curl -s -X POST "$API/releases" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -d "{\"tag_name\":\"$TAG\",\"name\":\"Telegram Sender $TAG\",\"body\":\"Веб-версия и Android-приложение для отправки сообщений в Telegram.\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))'
)
[ -n "$release_id" ] || { echo "не удалось создать релиз"; exit 1; }

curl -s -X POST "https://uploads.github.com/repos/$REPO/releases/$release_id/assets?name=TelegramSender.apk" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/vnd.android.package-archive" \
    --data-binary @"downloads/TelegramSender.apk" > /dev/null

echo "==> GitHub Pages из ветки main, каталог /docs"
curl -s -X POST "$API/pages" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d '{"source":{"branch":"main","path":"/docs"}}' > /dev/null || true

owner="${REPO%%/*}"; name="${REPO##*/}"
echo
echo "Готово:"
echo "  сайт:  https://${owner,,}.github.io/$name/"
echo "  apk:   https://github.com/$REPO/releases/latest/download/TelegramSender.apk"
