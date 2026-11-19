# Telegram Sender

Приложение для отправки сообщений в Telegram: веб-версия + Android APK, оба пишут
в один FastAPI-бэкенд, а он пересылает текст в Telegram Bot API.

## Структура

- `backend/` — FastAPI + Jinja2. `main.py`, `templates/`, `.env` (токен бота, chat_id, admin-ключ).
- `static/` — CSS и шаблоны страниц (`templates/index.html`, `setup.html`, `setup_denied.html`).
- `android-app/` — сборка APK без Gradle (aapt2 + javac + d8 + apksigner).
- `tests/test_flow.py` — pytest для бэкенда.
- `downloads/` — отдаётся отдельным `http.server` на порту 12001 как публичная ссылка на APK.

## Запуск

```bash
pkill -f "uvicorn main:app"  # если нужно перезапустить
cd backend && python3 -m uvicorn main:app --host 0.0.0.0 --port 12000
cd downloads && python3 -m http.server 12001 --bind 0.0.0.0
```

## Тесты

```bash
python3 -m pytest tests/ -q                 # бэкенд, 11 тестов
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
cd android-app && javac -d /tmp/jvmtest \
  src/com/example/telegramsender/TelegramClient.java test/TelegramClientTest.java \
  && java -cp /tmp/jvmtest TelegramClientTest   # клиент приложения, 17 проверок
```

## Особенности, на которые легко наступить

- Telegram шлёт 400 на неэкранированный текст, поэтому `send_to_telegram()` использует
  `parse_mode=HTML` и `html.escape(text, quote=False)`. Markdown не подходит: `_` и `*`
  в обычном тексте ломают разметку.
- `build.sh` держит keystore в `android-app/keystore.jks`, **не** в `build/`.
  Если ключ пересоздать, обновление APK не установится поверх старой версии
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
- d8 из build-tools 34 падает с `NullPointerException` на анонимных классах, собранных
  JDK 21. Поэтому `MainActivity` реализует `TextWatcher` сам, без анонимного класса.
- Сетевой код приложения вынесен в `TelegramClient` (чистая Java, без Android API),
  чтобы его можно было тестировать на JVM.
- Адрес бэкенда в приложении хранится в `SharedPreferences` (`server_url`) и правится
  прямо на экране. Дефолт — `DEFAULT_URL` в `MainActivity.java`; его надо менять при
  переезде на другой домен.
- Публичные ссылки вида `https://work-N-*.prod-runtime.all-hands.dev` живут только
  пока живёт сессия. После перезапуска ссылки в `index.html`, `downloads/README.txt`
  и `DEFAULT_URL` надо обновить.
