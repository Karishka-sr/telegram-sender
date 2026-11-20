import html
import os
import re
import secrets
import urllib.parse

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# в контейнере конфиг выносят на volume, чтобы он переживал пересоздание
CONFIG_PATH = os.environ.get("CONFIG_PATH") or os.path.join(BASE_DIR, ".env")
MAX_MESSAGE_LEN = 4096
MAX_FILE_BYTES = 20 * 1024 * 1024

CONFIG = {}


def load_config() -> dict:
    data = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    data[key.strip()] = value.strip()
    return data


def save_config(values: dict) -> None:
    data = dict(CONFIG)
    data.update(values)
    lines = ["# настройки бота (файл создаётся автоматически)"]
    lines += [f"{key}={value}" for key, value in data.items()]
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    os.chmod(CONFIG_PATH, 0o600)


CONFIG = load_config()
if "ADMIN_KEY" not in CONFIG:
    CONFIG["ADMIN_KEY"] = secrets.token_urlsafe(24)
    save_config({})
    CONFIG = load_config()


def bot_token() -> str:
    return os.environ.get("TELEGRAM_BOT_TOKEN") or CONFIG.get("TELEGRAM_BOT_TOKEN", "")


def chat_id() -> str:
    return os.environ.get("TELEGRAM_CHAT_ID") or CONFIG.get("TELEGRAM_CHAT_ID", "")


def telegram_api() -> str:
    return os.environ.get("TELEGRAM_API", "https://api.telegram.org")


def telegram_configured() -> bool:
    return bool(bot_token()) and bool(chat_id())


app = FastAPI(title="Telegram Messenger")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "..", "static", "templates"))


ALLOWED_TAGS = {"b", "i", "u", "s", "code", "pre", "tg-spoiler", "a"}
BB_PAIRS = [
    ("[b]", "<b>"), ("[/b]", "</b>"),
    ("[i]", "<i>"), ("[/i]", "</i>"),
    ("[u]", "<u>"), ("[/u]", "</u>"),
    ("[s]", "<s>"), ("[/s]", "</s>"),
    ("[code]", "<code>"), ("[/code]", "</code>"),
    ("[pre]", "<pre>"), ("[/pre]", "</pre>"),
    ("[spoiler]", "<tg-spoiler>"), ("[/spoiler]", "</tg-spoiler>"),
]


def render_text(text: str, fmt: str = "bb") -> tuple[str, str]:
    """Конвертирует текст в безопасный HTML для parse_mode=HTML.

    Возвращает (html, ошибка). Форматы: bb ([b]…[/b], [i]…, [spoiler]…,
    [link=url]…[/link]), auto (похоже на BB-разметку) и html (заведомо чистый).
    """
    fmt = fmt or "bb"
    if fmt not in ("bb", "auto", "html"):
        return "", "Неизвестный формат: %s" % fmt
    if fmt == "html":
        return sanitize_html(text), ""
    converted = text
    for bb, tag in BB_PAIRS:
        converted = converted.replace(bb, tag)
    converted = re.sub(
        r"\[link=([^\]]+)\]",
        lambda m: '<a href="%s">' % urllib.parse.quote(m.group(1), safe="/:?&=+@%"),
        converted,
    )
    converted = converted.replace("[link]", '<a href="">').replace("[/link]", "</a>")
    return sanitize_html(converted), ""


def sanitize_html(text: str) -> str:
    """Оставляет только разрешённые теги, остальное экранирует.

    Неразрешённый тег (например, [nope]) не отбрасывается вместе с текстом:
    угловые скобки экранируются, а содержимое сохраняется.
    """
    out: list[str] = []
    pos = 0
    for match in re.finditer(r"</?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>", text):
        tag = match.group(1).lower()
        raw = match.group(0)
        # не важно, разрешён тег или нет: открывающая скобка всегда сохраняется
        out.append(html.escape(text[pos:match.start()], quote=False))
        if tag in ALLOWED_TAGS:
            if tag == "a":
                href = re.search(r'href="([^"]*)"', match.group(2))
                addr = ""
                if href:
                    target = href.group(1)
                    if target.startswith(("http://", "https://", "tg://")):
                        addr = target
                out.append('<a href="%s">' % addr if addr else "<a>")
            else:
                out.append(raw)
        else:
            out.append(html.escape(raw, quote=False))
        pos = match.end()
    out.append(html.escape(text[pos:], quote=False))
    return "".join(out)


def wrapped_text(text: str) -> str:
    """Заголовок + текст пользователя (для обычных сообщений)."""
    return f"<b>📩 Сообщение из приложения:</b>\n{text}"


def send_to_telegram(text: str, fmt: str = "bb") -> tuple[bool, str]:
    html_text, err = render_text(text, fmt)
    if err:
        return False, err
    payload = {
        "chat_id": chat_id(),
        "text": wrapped_text(html_text),
        "parse_mode": "HTML",
    }
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                f"{telegram_api()}/bot{bot_token()}/sendMessage",
                json=payload,
            )
    except httpx.HTTPError:
        return False, "нет связи с Telegram"

    if resp.status_code == 200:
        return True, ""
    try:
        description = resp.json().get("description", "")
    except ValueError:
        description = ""
    return False, description or f"Telegram ответил ошибкой {resp.status_code}"


def send_document_to_telegram(
    filename: str,
    binary: bytes,
    size: int,
    content_type: str,
    caption: str = "",
) -> tuple[bool, str]:
    """Отправляет файл в Telegram через multipart (httpx это умеет сам)."""
    if size > MAX_FILE_BYTES:
        return False, f"Файл больше 20 МБ"
    caption_html, err = render_text(caption)
    if err:
        return False, err
    data = {"chat_id": chat_id()}
    if caption_html.strip():
        data.update({"caption": caption_html, "parse_mode": "HTML"})
    files = {"document": (filename, binary, content_type or "application/octet-stream")}
    try:
        with httpx.Client(timeout=120) as client:
            resp = client.post(
                f"{telegram_api()}/bot{bot_token()}/sendDocument",
                data=data,
                files=files,
            )
    except httpx.HTTPError:
        return False, "нет связи с Telegram"

    if resp.status_code == 200:
        return True, ""
    try:
        description = resp.json().get("description", "")
    except ValueError:
        description = ""
    return False, description or f"Telegram ответил ошибкой {resp.status_code}"


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"configured": telegram_configured()},
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "telegram_configured": telegram_configured()}


def bot_username() -> str:
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(f"{telegram_api()}/bot{bot_token()}/getMe")
        return resp.json().get("result", {}).get("username", "")
    except (httpx.HTTPError, ValueError):
        return ""


@app.get("/api/setup/bot")
def setup_bot_info():
    """Имя бота — чтобы показать пользователю, кому писать."""
    if not bot_token():
        raise HTTPException(status_code=400, detail="Сначала сохраните токен бота")
    username = bot_username()
    if not username:
        raise HTTPException(status_code=502, detail="Токен не принят Telegram. Проверьте его.")
    return {"username": username}


@app.post("/api/setup/detect-chat")
def setup_detect_chat():
    """Берёт chat_id из последнего сообщения, отправленного боту."""
    if not bot_token():
        raise HTTPException(status_code=400, detail="Сначала сохраните токен бота")

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"{telegram_api()}/bot{bot_token()}/getUpdates",
                params={"limit": 100, "timeout": 0},
            )
        updates = resp.json().get("result", [])
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail="Не удалось получить сообщения от Telegram")

    for update in reversed(updates):
        message = update.get("message") or update.get("channel_post") or {}
        chat = message.get("chat") or {}
        if chat.get("id"):
            found = str(chat["id"])
            save_config({"TELEGRAM_CHAT_ID": found})
            CONFIG["TELEGRAM_CHAT_ID"] = found
            return {
                "chat_id": found,
                "name": chat.get("first_name") or chat.get("title") or found,
            }

    raise HTTPException(
        status_code=404,
        detail="Сообщений боту пока нет. Откройте Telegram, найдите своего бота и нажмите «Start».",
    )


@app.post("/api/messages", response_model=None)
async def send_message(
    request: Request,
    text: str | None = Form(None, alias="text"),
    format: str | None = Form("bb", alias="format"),
    file: UploadFile | None = File(None),
):
    """Принимает JSON {text, format} или multipart (text, format, file)."""
    fmt = format or "bb"
    if file is None and text is None:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Ожидается JSON с полем text")
        text = body.get("text", "") if isinstance(body, dict) else ""
        fmt = body.get("format", "bb") if isinstance(body, dict) else "bb"

    text = text.strip() if isinstance(text, str) else ""

    if not telegram_configured():
        raise HTTPException(
            status_code=503,
            detail="Бот не настроен: укажите токен и chat_id на странице /setup",
        )

    if file is not None:
        binary = await file.read()
        if len(binary) > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail="Файл больше 20 МБ")
        if not text and not binary:
            raise HTTPException(status_code=400, detail="Сообщение пустое")
        ok, error = send_document_to_telegram(
            file.filename or "файл", binary, len(binary), file.content_type or "", text
        )
        if not ok:
            raise HTTPException(status_code=502, detail=f"Telegram не принял файл: {error}")
        return {"status": "sent", "type": "document", "filename": file.filename}

    if not text:
        raise HTTPException(status_code=400, detail="Сообщение пустое")
    if len(text) > MAX_MESSAGE_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Сообщение слишком длинное (макс. {MAX_MESSAGE_LEN} символов)",
        )

    ok, error = send_to_telegram(text, fmt)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Telegram не принял сообщение: {error}")

    return {"status": "sent", "length": len(text)}


def setup_allowed(key: str) -> bool:
    # пока бот не настроен — страница открыта, после настройки нужен ключ
    if not telegram_configured():
        return True
    return bool(key) and secrets.compare_digest(key, CONFIG.get("ADMIN_KEY", ""))


def setup_context(key: str, **extra) -> dict:
    return {
        # форма всегда несёт настоящий ключ, иначе повторное сохранение упрётся в 403
        "key": CONFIG.get("ADMIN_KEY", ""),
        "entered_key": key,
        "configured": telegram_configured(),
        "has_token": bool(bot_token()),
        "chat_id": chat_id(),
        "saved": False,
        "token_saved": False,
        "probe_ok": None,
        "probe_error": "",
        "error": "",
        **extra,
    }


@app.get("/setup")
def setup_page(request: Request, key: str = ""):
    if not setup_allowed(key):
        return templates.TemplateResponse(
            request=request,
            name="setup_denied.html",
            context={"admin_key": CONFIG.get("ADMIN_KEY", "")},
            status_code=403,
        )
    return templates.TemplateResponse(
        request=request, name="setup.html", context=setup_context(key)
    )


@app.post("/setup")
def setup_save(
    request: Request,
    key: str = Form(""),
    token: str = Form(""),
    chat: str = Form(""),
):
    if not setup_allowed(key):
        return templates.TemplateResponse(
            request=request,
            name="setup_denied.html",
            context={"admin_key": CONFIG.get("ADMIN_KEY", "")},
            status_code=403,
        )

    token, chat = token.strip(), chat.strip()
    if ":" not in token and token != "********":
        return templates.TemplateResponse(
            request=request,
            name="setup.html",
            context=setup_context(
                key, error="Токен должен выглядеть так: 123456789:AAH...", chat_id=chat
            ),
            status_code=400,
        )

    if token != "********":
        save_config({"TELEGRAM_BOT_TOKEN": token})
        CONFIG["TELEGRAM_BOT_TOKEN"] = token

    if not chat:
        username = bot_username()
        if not username:
            return templates.TemplateResponse(
                request=request,
                name="setup.html",
                context=setup_context(
                    key, error="Telegram не принял токен. Проверьте, что скопировали его целиком."
                ),
                status_code=400,
            )
        return templates.TemplateResponse(
            request=request,
            name="setup.html",
            context=setup_context(
                key, saved=True, probe_ok=False, token_saved=True, bot_username=username,
                probe_error=f"Токен сохранён, бот @{username}. Остался шаг 2 — найдите chat_id.",
            ),
        )

    save_config({"TELEGRAM_CHAT_ID": chat})
    CONFIG["TELEGRAM_CHAT_ID"] = chat

    ok, error = send_to_telegram("✅ Проверка связи: бот подключён")
    return templates.TemplateResponse(
        request=request,
        name="setup.html",
        context=setup_context(key, saved=True, probe_ok=ok, probe_error=error),
    )


app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "..", "static")),
    name="static",
)
app.mount(
    "/downloads",
    StaticFiles(directory=os.path.join(BASE_DIR, "..", "downloads")),
    name="downloads",
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 12000)),
        reload=False,
    )