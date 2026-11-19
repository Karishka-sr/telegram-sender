(() => {
    "use strict";

    const form = document.getElementById("sendForm");
    const input = document.getElementById("text");
    const btn = document.getElementById("sendBtn");
    const count = document.getElementById("count");
    const result = document.getElementById("result");
    const status = document.getElementById("status");
    const MAX = 4096;
    const cfg = window.APP_CONFIG || {};

    // Адрес бэкенда можно переопределить без пересборки страницы: ?api=https://...
    // Значение запоминается, поэтому хватает один раз открыть ссылку с параметром.
    function resolveApiBase() {
        const params = new URLSearchParams(location.search);
        const fromUrl = params.get("api");
        if (fromUrl) {
            try {
                localStorage.setItem("apiBase", fromUrl);
            } catch (e) { /* приватный режим */ }
            return fromUrl;
        }
        try {
            return localStorage.getItem("apiBase") || cfg.apiBase || "";
        } catch (e) {
            return cfg.apiBase || "";
        }
    }

    const API = String(resolveApiBase()).replace(/\/+$/, "");

    // Прямой режим: браузер сам обращается к Bot API. Telegram отдаёт CORS-заголовки,
    // поэтому сайту на GitHub Pages сервер не обязателен — токен остаётся в браузере.
    const DIRECT_KEY = "tgDirect";
    const tokenInput = document.getElementById("tokenInput");
    const chatInput = document.getElementById("chatInput");
    const directState = document.getElementById("directState");

    function getDirect() {
        try {
            const raw = localStorage.getItem(DIRECT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function setDirect(value) {
        try {
            if (value) localStorage.setItem(DIRECT_KEY, JSON.stringify(value));
            else localStorage.removeItem(DIRECT_KEY);
        } catch (e) { /* приватный режим */ }
        renderDirect();
    }

    function renderDirect() {
        const direct = getDirect();
        if (!directState) return;
        if (direct) {
            directState.textContent = "Включено: отправка идёт напрямую в Telegram.";
            setStatus("Прямое подключение", "ok");
        } else {
            directState.textContent = "";
        }
    }

    if (tokenInput && chatInput) {
        const direct = getDirect();
        if (direct) {
            tokenInput.value = direct.token || "";
            chatInput.value = direct.chat || "";
        }
        document.getElementById("saveDirect").addEventListener("click", () => {
            const token = tokenInput.value.trim();
            const chat = chatInput.value.trim();
            if (!token || !chat) {
                showResult(false, "Заполните токен и chat_id");
                return;
            }
            setDirect({ token, chat });
            showResult(true, "Сохранено в этом браузере");
        });
        document.getElementById("clearDirect").addEventListener("click", () => {
            setDirect(null);
            tokenInput.value = "";
            chatInput.value = "";
            showResult(true, "Настройки удалены");
            checkConfig();
        });
    }

    const apkLink = document.getElementById("apkLink");
    if (apkLink && cfg.apkUrl) {
        apkLink.href = cfg.apkUrl;
    }

    input.addEventListener("input", () => {
        count.textContent = input.value.length;
    });
    count.textContent = input.value.length;

    function showResult(ok, text) {
        result.textContent = text;
        result.className = "result show " + (ok ? "ok" : "err");
        setTimeout(() => {
            result.classList.remove("show");
        }, 6000);
    }

    function setStatus(text, cls) {
        status.textContent = text;
        status.className = "status" + (cls ? " " + cls : "");
    }

    async function checkConfig() {
        if (getDirect()) {
            setStatus("Прямое подключение", "ok");
            return;
        }
        if (!API) {
            setStatus("Сервер не указан", "bad");
            return;
        }
        try {
            const resp = await fetch(API + "/api/health");
            const data = await resp.json();
            if (data.telegram_configured) {
                setStatus("Бот готов", "ok");
            } else {
                setStatus("Бот не настроен", "bad");
            }
        } catch (e) {
            setStatus("Нет связи с сервером", "bad");
        }
    }

    async function sendDirect(text, direct) {
        const resp = await fetch(
            "https://api.telegram.org/bot" + direct.token + "/sendMessage",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: direct.chat, text }),
            }
        );
        let data = null;
        try {
            data = await resp.json();
        } catch (e) { /* ignore */ }
        if (resp.ok && data && data.ok) return { ok: true };
        const reason = data && data.description ? data.description : "Telegram отклонил запрос";
        return { ok: false, reason };
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) {
            showResult(false, "Напишите сообщение");
            input.focus();
            return;
        }

        btn.disabled = true;
        btn.classList.add("loading");
        result.className = "result";

        const direct = getDirect();
        if (direct) {
            try {
                const out = await sendDirect(text, direct);
                if (out.ok) {
                    showResult(true, "✓ Сообщение доставлено в Telegram");
                    input.value = "";
                    count.textContent = 0;
                    input.focus();
                    setStatus("Прямое подключение", "ok");
                } else {
                    showResult(false, out.reason);
                    setStatus("Ошибка отправки", "bad");
                }
            } catch (e) {
                showResult(false, "Не удалось связаться с Telegram");
            } finally {
                btn.disabled = false;
                btn.classList.remove("loading");
            }
            return;
        }

        try {
            const resp = await fetch(API + "/api/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            });

            if (resp.ok) {
                showResult(true, "✓ Сообщение доставлено в Telegram");
                input.value = "";
                count.textContent = 0;
                input.focus();
                setStatus("Бот готов", "ok");
            } else {
                let detail = "Ошибка отправки";
                try {
                    const data = await resp.json();
                    if (data.detail) detail = data.detail;
                } catch (e) { /* ignore */ }
                showResult(false, detail);
                setStatus("Ошибка отправки", "bad");
            }
        } catch (e) {
            showResult(false, "Нет связи с сервером. Откройте «Отправлять без своего сервера» ниже.");
        } finally {
            btn.disabled = false;
            btn.classList.remove("loading");
        }
    });

    renderDirect();
    checkConfig();
})();