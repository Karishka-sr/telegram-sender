import com.example.telegramsender.TelegramClient;
import com.sun.net.httpserver.HttpServer;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** JVM-тест сетевого кода Android-приложения (класс TelegramClient). */
public class TelegramClientTest {

    private static int failed = 0;
    private static int passed = 0;
    private static final List<String> requests = new ArrayList<>();
    private static volatile int replyCode = 200;
    private static volatile String replyBody = "{\"status\":\"sent\"}";

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/messages", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            requests.add(new String(body, StandardCharsets.UTF_8));

            byte[] out = replyBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(replyCode, out.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(out);
            }
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/messages";

        try {
            testPayloadEscaping();
            testSuccessfulSend(url);
            testPayloadSurvivesServer(url);
            testErrorDetailIsShown(url);
            testNetworkFailureIsReported();
        } finally {
            server.stop(0);
        }

        System.out.println();
        System.out.println("passed=" + passed + " failed=" + failed);
        if (failed > 0) {
            System.exit(1);
        }
    }

    private static void testPayloadEscaping() {
        check("кавычки", TelegramClient.buildPayload("он сказал \"да\"")
                .equals("{\"text\":\"он сказал \\\"да\\\"\"}"));
        check("перевод строки", TelegramClient.buildPayload("a\nb")
                .equals("{\"text\":\"a\\nb\"}"));
        check("обратный слэш", TelegramClient.buildPayload("C:\\tmp")
                .equals("{\"text\":\"C:\\\\tmp\"}"));
        check("табуляция", TelegramClient.buildPayload("a\tb")
                .equals("{\"text\":\"a\\tb\"}"));
        check("управляющий символ", TelegramClient.buildPayload("\u0001")
                .equals("{\"text\":\"\\u0001\"}"));
        check("кириллица не ломается", TelegramClient.buildPayload("Привет")
                .equals("{\"text\":\"Привет\"}"));
    }

    private static void testSuccessfulSend(String url) {
        requests.clear();
        replyCode = 200;
        TelegramClient.Result result = new TelegramClient().send(url, "Тест отправки");
        check("успешная отправка ok", result.ok);
        check("успешная отправка code 200", result.code == 200);
        check("успешная отправка дошла одна", requests.size() == 1);
        check("текст в теле запроса", requests.get(0).contains("Тест отправки"));
    }

    private static void testPayloadSurvivesServer(String url) {
        requests.clear();
        replyCode = 200;
        String tricky = "цена_товара 100 * 5 \\ \"кавычки\" <b>тег</b>";
        new TelegramClient().send(url, tricky);

        String received = requests.get(0);
        check("сложный текст не искажён",
                received.equals("{\"text\":\"цена_товара 100 * 5 \\\\ \\\"кавычки\\\" <b>тег</b>\"}"));
    }

    private static void testErrorDetailIsShown(String url) {
        requests.clear();
        replyCode = 503;
        replyBody = "{\"detail\":\"Бот не настроен: укажите токен\"}";

        TelegramClient.Result result = new TelegramClient().send(url, "тест");
        check("ошибка не считается успехом", !result.ok);
        check("код ошибки сохранён", result.code == 503);
        check("текст ошибки с сервера показан",
                result.detail.equals("Бот не настроен: укажите токен"));

        replyCode = 500;
        replyBody = "{\"detail\":\"\"}";
        TelegramClient.Result empty = new TelegramClient().send(url, "тест");
        check("пустой detail не ломает", empty.detail.isEmpty());
        replyCode = 200;
        replyBody = "{\"status\":\"sent\"}";
    }

    private static void testNetworkFailureIsReported() {
        TelegramClient.Result result =
                new TelegramClient().send("http://127.0.0.1:1/api/messages", "тест");
        check("нет сети -> не ok", !result.ok);
        check("нет сети -> code -1", result.code == -1);
    }

    private static void check(String name, boolean condition) {
        if (condition) {
            passed++;
            System.out.println("PASS  " + name);
        } else {
            failed++;
            System.out.println("FAIL  " + name);
        }
    }
}