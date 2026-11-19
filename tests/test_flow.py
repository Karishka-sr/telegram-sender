"""Сквозной тест: приложение -> сервер -> Telegram Bot API.

Telegram подменяется локальным HTTP-сервером (TELEGRAM_API), поэтому тест
проверяет реальный код отправки: путь, JSON-payload и обработку ответов.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

import backend.main as app_module

RECEIVED = []
TELEGRAM_STATUS = 200


class FakeTelegram(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        RECEIVED.append({"path": self.path, "body": body})

        payload = {"ok": TELEGRAM_STATUS == 200}
        if TELEGRAM_STATUS != 200:
            payload["description"] = "Bad Request: chat not found"

        data = json.dumps(payload).encode()
        self.send_response(TELEGRAM_STATUS)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module", autouse=True)
def isolate_config():
    """Тесты не должны трогать настоящий backend/.env."""
    app_module.CONFIG_PATH = "/tmp/test_backend_env"
    app_module.CONFIG = {
        "ADMIN_KEY": "testkey",
        "TELEGRAM_BOT_TOKEN": "123456:TESTTOKEN",
        "TELEGRAM_CHAT_ID": "42",
    }
    yield


@pytest.fixture(scope="module")
def fake_telegram():
    server = HTTPServer(("127.0.0.1", 0), FakeTelegram)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture
def client(fake_telegram, monkeypatch):
    RECEIVED.clear()
    monkeypatch.setenv("TELEGRAM_API", fake_telegram)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:TESTTOKEN")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")
    return TestClient(app_module.app)


def test_message_reaches_telegram(client):
    resp = client.post("/api/messages", json={"text": "Привет из приложения"})

    assert resp.status_code == 200
    assert resp.json()["status"] == "sent"
    assert len(RECEIVED) == 1

    sent = RECEIVED[0]
    assert sent["path"] == "/bot123456:TESTTOKEN/sendMessage"
    assert sent["body"]["chat_id"] == "42"
    assert "Привет из приложения" in sent["body"]["text"]
    assert sent["body"]["parse_mode"] == "HTML"


def test_multiline_and_quotes_are_kept(client):
    text = 'Строка 1\n"Строка 2" и \\ слэш'
    resp = client.post("/api/messages", json={"text": text})

    assert resp.status_code == 200
    assert "Строка 1" in RECEIVED[0]["body"]["text"]
    assert '"Строка 2"' in RECEIVED[0]["body"]["text"]


def test_empty_message_rejected(client):
    assert client.post("/api/messages", json={"text": "   "}).status_code == 400
    assert RECEIVED == []


def test_too_long_message_rejected(client):
    resp = client.post("/api/messages", json={"text": "a" * 4097})
    assert resp.status_code == 400
    assert RECEIVED == []


def test_telegram_error_is_reported(client):
    global TELEGRAM_STATUS
    TELEGRAM_STATUS = 400
    try:
        resp = client.post("/api/messages", json={"text": "тест"})
        assert resp.status_code == 502
        assert "chat not found" in resp.json()["detail"]
    finally:
        TELEGRAM_STATUS = 200


def test_not_configured_returns_503(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "")
    monkeypatch.setitem(app_module.CONFIG, "TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setitem(app_module.CONFIG, "TELEGRAM_CHAT_ID", "")

    resp = client.post("/api/messages", json={"text": "тест"})
    assert resp.status_code == 503
    assert client.get("/api/health").json()["telegram_configured"] is False


def test_pages_render(client):
    assert "Сообщение в Telegram" in client.get("/").text
    assert client.get("/static/css/style.css").status_code == 200


def test_setup_locked_when_configured(client):
    assert client.get("/setup").status_code == 403
    assert client.get("/setup?key=wrong").status_code == 403
    assert client.get("/setup?key=testkey").status_code == 200


def test_setup_saves_token_when_not_configured(client, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    monkeypatch.setitem(app_module.CONFIG, "TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setitem(app_module.CONFIG, "TELEGRAM_CHAT_ID", "")

    assert client.get("/setup").status_code == 200

    bad = client.post("/setup", data={"token": "не-токен", "chat": "42"})
    assert bad.status_code == 400
    assert "Токен должен выглядеть" in bad.text

    ok = client.post("/setup", data={"token": "999:NEWTOKEN", "chat": "777"})
    assert ok.status_code == 200
    assert "Проверочное сообщение отправлено" in ok.text
    assert app_module.CONFIG["TELEGRAM_BOT_TOKEN"] == "999:NEWTOKEN"
    assert app_module.CONFIG["TELEGRAM_CHAT_ID"] == "777"
    assert RECEIVED[-1]["body"]["chat_id"] == "777"

    monkeypatch.setitem(app_module.CONFIG, "TELEGRAM_BOT_TOKEN", "123456:TESTTOKEN")
    monkeypatch.setitem(app_module.CONFIG, "TELEGRAM_CHAT_ID", "42")

def test_user_text_is_escaped_for_html(client):
    """Символы < > & не должны ломать разметку сообщения."""
    resp = client.post("/api/messages", json={"text": "a < b & c > d"})

    assert resp.status_code == 200
    body = RECEIVED[0]["body"]["text"]
    assert "a &lt; b &amp; c &gt; d" in body
    assert body.count("<b>") == 1


def test_special_chars_like_markdown_are_safe(client):
    """Раньше текст с _ и * ронял отправку (Markdown parse error)."""
    text = "цена_товара 100 * 5 [ссылка] `код`"
    resp = client.post("/api/messages", json={"text": text})

    assert resp.status_code == 200
    assert text in RECEIVED[0]["body"]["text"]
