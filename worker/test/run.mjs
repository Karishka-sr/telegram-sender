// Проверка обработчика Worker без Cloudflare: обычный node, реальные Request/Response.
// Последний тест шлёт настоящее сообщение в Telegram тем же токеном, что и бэкенд.
//   node worker/test/run.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import worker from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, "..", "..", "backend", ".env");

function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

const env = readEnv(envFile);
// ADMIN_KEY из .env проверяется отдельными тестами, иначе он закрывает все запросы
delete env.ADMIN_KEY;
const results = [];

function check(name, condition, extra = "") {
  results.push({ name, ok: Boolean(condition), extra });
  if (!condition) console.error(`FAIL: ${name} ${extra}`);
}

function call(path, init = {}, overrideEnv = env) {
  return worker.fetch(new Request("https://example.workers.dev" + path, init), overrideEnv);
}

// --- health ---
let resp = await call("/api/health");
let body = await resp.json();
check("health 200", resp.status === 200, String(resp.status));
check("health telegram_configured", body.telegram_configured === true, JSON.stringify(body));
check("health CORS", resp.headers.get("Access-Control-Allow-Origin") === "*");

resp = await call("/api/health", {}, {});
body = await resp.json();
check("health без секретов -> configured false", body.telegram_configured === false, JSON.stringify(body));

// --- preflight ---
resp = await call("/api/messages", { method: "OPTIONS" });
check("preflight 204", resp.status === 204, String(resp.status));
check("preflight allow-headers", (resp.headers.get("Access-Control-Allow-Headers") || "").includes("Content-Type"));

// --- валидация ---
const post = (payload, headers = {}) =>
  call("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

resp = await post("не json");
check("битый JSON -> 400", resp.status === 400, String(resp.status));

resp = await post({ text: "   " });
check("пустой текст -> 400", resp.status === 400, String(resp.status));

resp = await post({ text: "x".repeat(4097) });
check("длинный текст -> 400", resp.status === 400, String(resp.status));

resp = await call("/api/messages", { method: "GET" });
check("GET /api/messages -> 405", resp.status === 405, String(resp.status));

resp = await call("/unknown");
check("неизвестный путь -> 404", resp.status === 404, String(resp.status));

// --- ADMIN_KEY ---
const withKey = { ...env, ADMIN_KEY: "secret" };
const postKey = (payload, headers = {}) =>
  call(
    "/api/messages",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    },
    withKey
  );

resp = await postKey({ text: "привет" }, { "X-Admin-Key": "wrong" });
check("ADMIN_KEY задан, ключ неверный -> 401", resp.status === 401, String(resp.status));

resp = await postKey({ text: "привет" });
check("ADMIN_KEY задан, ключ не передан -> 401", resp.status === 401, String(resp.status));

resp = await postKey({ text: "ключ верный, сообщение уходит" }, { "X-Admin-Key": "secret" });
check("ADMIN_KEY задан, ключ верный -> отправлено", resp.status === 200, String(resp.status));

// --- настоящая отправка ---
resp = await post({ text: "Worker проверен ✅ <test> & готов" });
body = await resp.json();
check("живая отправка -> 200 sent", resp.status === 200 && body.status === "sent", `${resp.status} ${JSON.stringify(body)}`);

resp = await call("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x" }) }, { ...env, TELEGRAM_BOT_TOKEN: "123:bad" });
body = await resp.json();
check("неверный токен -> 502 с причиной", resp.status === 502 && typeof body.detail === "string", `${resp.status} ${JSON.stringify(body)}`);

const failed = results.filter((r) => !r.ok);
console.log(`\nПройдено: ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
