# Сервер в Cloudflare Workers

Этот вариант даёт постоянный HTTPS-адрес вида
`https://telegram-sender.<аккаунт>.workers.dev`, который не зависит ни от чьей
песочницы. Бесплатного тарифа хватает с запасом (100 000 запросов в сутки), карта
не нужна. Токен бота хранится в секретах Cloudflare, а не в коде.

## Разовая настройка (3 шага)

1. Зарегистрироваться на https://dash.cloudflare.com/sign-up (обычная почта, карта не нужна).
2. Создать API-токен: https://dash.cloudflare.com/profile/api-tokens →
   **Create Token** → шаблон **Edit Cloudflare Workers** → Create.
   Записать сам токен и **Account ID** (он на главной странице дашборда, справа).
3. Задеплоить — любой из двух способов ниже.

## Способ А: из GitHub Actions (деплой при каждом пуше)

В репозитории → Settings → Secrets and variables → Actions добавить:

| Секрет | Значение |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | токен из шага 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `TELEGRAM_CHAT_ID` | твой chat_id |

Дальше Actions → **Deploy Worker** → Run workflow. Workflow сам зальёт код и
секреты бота.

## Способ Б: с компьютера

```bash
cd worker
npx wrangler@3 login
npx wrangler@3 secret put TELEGRAM_BOT_TOKEN   # вставить токен
npx wrangler@3 secret put TELEGRAM_CHAT_ID     # вставить chat_id
npx wrangler@3 deploy
```

В конце wrangler печатает адрес. В приложении и на сайте указывать:

```
https://telegram-sender.<аккаунт>.workers.dev/api/messages
```

## Что умеет

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/api/health` | `{"status":"ok","telegram_configured":true}` |
| `POST` | `/api/messages` | тело `{"text":"..."}`, ответ `{"status":"sent"}` |

Дополнительно можно задать `ADMIN_KEY` (переменная окружения): тогда клиент обязан
присылать заголовок `X-Admin-Key`. Приложение этот заголовок пока не отправляет,
поэтому ключ включать только для сайта.

## Проверка

```bash
node worker/test/run.mjs     # 16 проверок, последняя отправляет реальное сообщение
curl https://<адрес>/api/health
curl -X POST https://<адрес>/api/messages \
  -H "Content-Type: application/json" -d '{"text":"проверка"}'
```
