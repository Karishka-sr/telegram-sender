package com.example.telegramsender;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Отправка сообщения на сервер. Только стандартная Java — без Android API,
 * поэтому логику можно проверять обычным JVM-тестом.
 */
public final class TelegramClient {

    public static final class Result {
        public final boolean ok;
        public final int code;
        public final String detail;

        private Result(boolean ok, int code, String detail) {
            this.ok = ok;
            this.code = code;
            this.detail = detail;
        }
    }

    public static String buildPayload(String text) {
        return "{\"text\":\"" + escapeJson(text) + "\"}";
    }

    public static String escapeJson(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\':
                    sb.append("\\\\");
                    break;
                case '"':
                    sb.append("\\\"");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    public Result send(String url, String text) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(20000);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setDoOutput(true);

            byte[] body = buildPayload(text).getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
            }

            int code = conn.getResponseCode();
            if (code == 200) {
                return new Result(true, code, "");
            }
            return new Result(false, code, extractDetail(readAll(conn.getErrorStream())));
        } catch (Exception e) {
            return new Result(false, -1, e.getClass().getSimpleName());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    /** Достаёт поле "detail" из тела ошибки, не подключая org.json. */
    static String extractDetail(String body) {
        if (body == null) {
            return "";
        }
        String key = "\"detail\"";
        int at = body.indexOf(key);
        if (at < 0) {
            return "";
        }
        int colon = body.indexOf(':', at + key.length());
        int start = body.indexOf('"', colon + 1);
        if (colon < 0 || start < 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = start + 1; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '\\' && i + 1 < body.length()) {
                sb.append(body.charAt(++i));
            } else if (c == '"') {
                break;
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static String readAll(InputStream stream) {
        if (stream == null) {
            return "";
        }
        try (InputStream in = stream) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[1024];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buf.write(chunk, 0, read);
            }
            return buf.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}