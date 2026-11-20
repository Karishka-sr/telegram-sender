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

    // Панель оформления: оборачивает выделенный текст в BB-теги
    const fileBtn = document.getElementById("fileBtn");
    const fileInput = document.getElementById("file");
    const fileInfo = document.getElementById("fileInfo");
    let attachedFile = null;

    document.querySelectorAll(".tool[data-pair]").forEach((button) => {
        button.addEventListener("click", () => {
            const tag = button.dataset.pair;
            const open = "[" + tag + "]";
            const close = "[/" + tag + "]";
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const selected = input.value.slice(start, end) || "текст";
            const replacement = open + selected + close;
            input.value =
                input.value.slice(0, start) + replacement + input.value.slice(end);
            input.focus();
            input.selectionStart = start + open.length;
            input.selectionEnd = start + open.length + selected.length;
            count.textContent = input.value.length;
        });
    });

    if (fileBtn) {
        fileBtn.addEventListener("click", () => fileInput && fileInput.click());
    }
    if (fileInput) {
        fileInput.addEventListener("change", () => {
            attachedFile = fileInput.files[0] || null;
            if (attachedFile) {
                fileInfo.textContent = "Файл: " + attachedFile.name + " (" + formatSize(attachedFile.size) + ")";
                fileInfo.hidden = false;
            } else {
                fileInfo.hidden = true;
            }
        });
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + " Б";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
        return (bytes / (1024 * 1024)).toFixed(1) + " МБ";
    }

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

    // BB-теги -> HTML. Безопасно: внутри тегов вставляется экранированный текст.
    function bbToHtml(text) {
        const pairs = {
            "[b]": "<b>", "[/b]": "</b>",
            "[i]": "<i>", "[/i]": "</i>",
            "[u]": "<u>", "[/u]": "</u>",
            "[s]": "<s>", "[/s]": "</s>",
            "[code]": "<code>", "[/code]": "</code>",
            "[pre]": "<pre>", "[/pre]": "</pre>",
            "[spoiler]": "<tg-spoiler>", "[/spoiler]": "</tg-spoiler>",
        };
        let out = "";
        let i = 0;
        while (i < text.length) {
            let matched = false;
            for (const [bb, tag] of Object.entries(pairs)) {
                if (text.startsWith(bb, i)) {
                    out += tag;
                    i += bb.length;
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                out += text[i] === "&" ? "&amp;" : text[i] === "<" ? "&lt;" : text[i];
                i++;
            }
        }
        return out;
    }

    async function sendDirect(text, direct) {
        const payload = {
            chat_id: direct.chat,
            text: bbToHtml(text),
            parse_mode: "HTML",
            disable_web_page_preview: true,
        };
        const resp = await fetch(
            "https://api.telegram.org/bot" + direct.token + "/sendMessage",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
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
        const file = attachedFile;
        if (!text && !file) {
            showResult(false, "Напишите сообщение или выберите файл");
            input.focus();
            return;
        }

        btn.disabled = true;
        btn.classList.add("loading");
        result.className = "result";

        const direct = getDirect();

        // Файл и серверный режим: шлём multipart на свой сервер
        if (!direct) {
            try {
                const fd = new FormData();
                if (text) fd.append("text", text);
                if (file) fd.append("file", file, file.name);
                const resp = await fetch(API + "/api/messages", {
                    method: "POST",
                    body: fd,
                });

                if (resp.ok) {
                    showResult(true, file ? "✓ Файл доставлен в Telegram" : "✓ Сообщение доставлено в Telegram");
                    input.value = "";
                    count.textContent = 0;
                    clearFile();
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
            return;
        }

        // Прямой режим
        try {
            const out = direct && !file
                ? await sendDirect(text, direct)
                : await sendDirectFile(text, file, direct);
            if (out.ok) {
                showResult(true, file ? "✓ Файл доставлен в Telegram" : "✓ Сообщение доставлено в Telegram");
                input.value = "";
                count.textContent = 0;
                clearFile();
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
    });

    // Прямой режим + файл: браузер шлёт документ на api.telegram.org напрямую.
    async function sendDirectFile(text, file, direct) {
        const fd = new FormData();
        fd.append("chat_id", direct.chat);
        if (text) {
            fd.append("caption", bbToHtml(text));
            fd.append("parse_mode", "HTML");
        }
        fd.append("document", file, file.name);
        const resp = await fetch(
            "https://api.telegram.org/bot" + direct.token + "/sendDocument",
            { method: "POST", body: fd }
        );
        let data = null;
        try { data = await resp.json(); } catch (e) { /* ignore */ }
        if (resp.ok && data && data.ok) return { ok: true };
        const reason = data && data.description ? data.description : "Telegram отклонил запрос";
        return { ok: false, reason };
    }

    function clearFile() {
        attachedFile = null;
        if (fileInput) {
            fileInput.value = "";
            fileInfo.hidden = true;
        }
    }

    renderDirect();
    checkConfig();
})();