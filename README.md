# Telegram Sender

Приложение, которое отправляет текст в Telegram через бота: веб-версия, Android-приложение
и один общий бэкенд на FastAPI. Токен бота живёт только на сервере — в браузер и в APK
он не попадает.

- **Сайт:** https://karishka-sr.github.io/telegram-sender/
- **APK:** [Releases](https://github.com/Karishka-sr/telegram-sender/releases/latest)

## Как это работает

```
браузер / Android  ──POST /api/messages──▶  FastAPI  ──sendMessage──▶  Telegram Bot API
```

Бэкенд подставляет токен бота и chat_id и пересылает текст. Поэтому приложение можно
раздавать кому угодно: доступа к боту у него нет.

## Своя копия за 5 минут

### 1. Бот

Напишите [@BotFather](https://t.me/BotFather) → `/newbot` → получите токен.
Затем напишите своему боту `/start` и узнайте свой chat_id через
[@userinfobot](https://t.me/userinfobot).

### 2. Сервер

Docker (рекомендуется):

```bash
git clone https://github.com/Karishka-sr/telegram-sender.git
cd telegram-sender
mkdir -p data
printf 'TELEGRAM_BOT_TOKEN=123456:AAA\nTELEGRAM_CHAT_ID=123456789\n' > .env
docker compose up -d
```

Сервис поднимется на `http://localhost:8080`. В `docker-compose.yml` стоит
`restart: unless-stopped` — контейнер сам поднимается после падения и перезагрузки
машины.

Без Docker:

```bash
pip install -r backend/requirements.txt
./deploy/serve.sh 8080        # цикл с автоперезапуском, лог в backend.log
```

На своём VPS надёжнее systemd — готовый юнит лежит в `deploy/telegram-sender.service`:

```bash
sudo cp deploy/telegram-sender.service /etc/systemd/system/
sudo systemctl enable --now telegram-sender
```

Готовый образ также собирается в GHCR: `ghcr.io/karishka-sr/telegram-sender:latest`.
Его можно запустить где угодно — на VPS, в Render, Fly.io, Railway:

```bash
docker run -d --restart unless-stopped -p 8080:8080 \
  -e TELEGRAM_BOT_TOKEN=... -e TELEGRAM_CHAT_ID=... \
  -v telegram-sender-data:/data -e CONFIG_PATH=/data/.env \
  ghcr.io/karishka-sr/telegram-sender:latest
```

### 3. Сервер без своего железа (Cloudflare Workers)

Постоянный адрес без VPS и без карты: `https://<имя>.<аккаунт>.workers.dev`.
Код в `worker/`, инструкция — `worker/README.md`. Кратко:

```bash
cd worker
npx wrangler@3 login
npx wrangler@3 secret put TELEGRAM_BOT_TOKEN
npx wrangler@3 secret put TELEGRAM_CHAT_ID
npx wrangler@3 deploy
```

Либо через GitHub Actions: добавить секреты `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` и запустить
workflow «Deploy Worker». Адрес для приложения —
`https://<имя>.<аккаунт>.workers.dev/api/messages`.

### 4. Сайт
Сайт — статика в `docs/`, её отдаёт GitHub Pages. Бэкенд и Pages живут раздельно,
поэтому адрес сервера прописан в `docs/static/js/config.js`:

```js
window.APP_CONFIG = {
    apiBase: "https://ваш-домен",
    apkUrl: "...",
};
```

После переезда сервера на новый домен пересоберите страницу:

```bash
python3 scripts/build_site.py --api-base https://ваш-домен --apk-url downloads/TelegramSender.apk
```

Сборка кладёт APK в `docs/downloads/`, поэтому кнопка скачивания работает прямо
с сайта и не зависит от доступности Releases.

#### Сайт без своего сервера

Страница умеет отправлять сообщения сама, без бэкенда: в блоке
«Отправлять без своего сервера» введите токен бота и свой `chat_id`. Браузер
ходит напрямую в `api.telegram.org` (Telegram отдаёт CORS-заголовки), токен
хранится только в `localStorage` этого браузера. Режим удобен, когда сервер
недоступен: домен `*.prod-runtime.all-hands.dev` живёт только пока открыта сессия.

### 5. APK

```bash
cd android-app && ./build.sh
```

Результат — `TelegramSender.apk`. Приложение собрано без Gradle (aapt2 + javac + d8 +
apksigner), нужен JDK 21 и Android SDK с build-tools 34. Адрес сервера по умолчанию
задаётся в `DEFAULT_URL` внутри `MainActivity.java`, а на устройстве его можно поменять
прямо на экране — значение сохраняется в `SharedPreferences`.

## Настройки

Хранятся в `backend/.env` (права 600) или в переменных окружения:

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `TELEGRAM_CHAT_ID` | кому пересылать сообщения |
| `ADMIN_KEY` | ключ доступа к странице `/setup` (генерируется сам) |
| `CONFIG_PATH` | где лежит файл настроек, по умолчанию `backend/.env` |
| `PORT` | порт сервера, по умолчанию 12000 |

Сменить бота или получателя можно и без правки файлов: откройте `/setup?key=<ADMIN_KEY>`,
вставьте токен, напишите боту `/start` — chat_id подхватится сам.

## API

```
GET  /api/health     → {"status": "ok", "telegram_configured": true}

POST /api/messages   → {"text": "привет", "format": "bb"}
                     → {"status": "sent", "length": 6}

POST /api/messages   (multipart/form-data)
       text=подпись, file=@документ.pdf
                     → {"status": "sent", "type": "document", "filename": "документ.pdf"}
```

`format` — `bb` (по умолчанию), `auto` или `html`. В `bb` поддерживаются
`[b]`, `[i]`, `[u]`, `[s]`, `[code]`, `[pre]`, `[spoiler]`, `[link=url]…[/link]`.
Любой другой текст, включая `<script>`, экранируется — сообщение не ломается.

Файлы уходят в Telegram как документы (до 20 МБ), текст становится подписью.

CORS открыт: страница на GitHub Pages обращается к бэкенду с другого origin.

## Тесты

```bash
python3 -m pytest tests/ -q            # бэкенд
cd android-app && ./test/run.sh        # сетевой клиент приложения на JVM
```

## Структура

```
backend/      FastAPI: отправка в Telegram, настройка через /setup
static/       шаблон страницы, CSS, JS
docs/         собранная статика для GitHub Pages (генерируется)
android-app/  исходники и сборка APK без Gradle
deploy/       serve.sh (автоперезапуск), systemd-юнит
scripts/      build_site.py — сборка docs/ под нужный домен
tests/        pytest
```
