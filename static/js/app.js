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
    const API = String(cfg.apiBase || "").replace(/\/+$/, "");

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
            showResult(false, "Нет связи с сервером. Попробуйте ещё раз.");
        } finally {
            btn.disabled = false;
            btn.classList.remove("loading");
        }
    });

    checkConfig();
})();