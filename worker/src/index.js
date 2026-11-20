const MAX_LEN = 4096;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

// Telegram отвечает 400, если в HTML-разметке встретится < или &, поэтому экранируем
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function configured(env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN) && Boolean(env.TELEGRAM_CHAT_ID);
}

async function sendToTelegram(env, text) {
  const api = env.TELEGRAM_API || "https://api.telegram.org";
  const resp = await fetch(`${api}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: escapeHtml(text),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (e) {
    /* Telegram вернул не JSON */
  }

  if (resp.ok && data && data.ok) return { ok: true };
  const reason = data && data.description ? data.description : `Telegram HTTP ${resp.status}`;
  return { ok: false, reason };
}

async function handleSend(request, env) {
  if (env.ADMIN_KEY && request.headers.get("X-Admin-Key") !== env.ADMIN_KEY) {
    return json({ detail: "Неверный ключ доступа" }, 401);
  }
  if (!configured(env)) {
    return json({ detail: "Бот не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID" }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ detail: "Ожидается JSON с полем text" }, 400);
  }

  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) return json({ detail: "Пустое сообщение" }, 400);
  if (text.length > MAX_LEN) {
    return json({ detail: `Слишком длинное сообщение: максимум ${MAX_LEN} символов` }, 400);
  }

  const result = await sendToTelegram(env, text);
  if (!result.ok) return json({ detail: result.reason }, 502);
  return json({ status: "sent", length: text.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/health") {
      return json({ status: "ok", telegram_configured: configured(env) });
    }

    if (url.pathname === "/api/messages") {
      if (request.method !== "POST") return json({ detail: "Метод не поддерживается" }, 405);
      return handleSend(request, env);
    }

    if (url.pathname === "/" || url.pathname === "") {
      return json({
        service: "telegram-sender",
        endpoints: ["POST /api/messages", "GET /api/health"],
      });
    }

    return json({ detail: "Не найдено" }, 404);
  },
};
