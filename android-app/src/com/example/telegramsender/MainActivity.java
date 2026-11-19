package com.example.telegramsender;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Отправляет сообщение на наш сервер, который пересылает его в Telegram.
 * Адрес сервера сохраняется в настройках, чтобы его можно было сменить
 * после переезда сервера на другой домен.
 */
public class MainActivity extends Activity implements TextWatcher {

    private static final String PREFS = "settings";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL =
            "https://work-1-ynewfpoqwqjmmtze.prod-runtime.all-hands.dev/api/messages";
    private static final int MAX_LEN = 4096;

    private final TelegramClient client = new TelegramClient();

    private EditText serverInput;
    private EditText inputText;
    private Button sendButton;
    private ProgressBar progress;
    private TextView resultText;
    private TextView countText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        serverInput = findViewById(R.id.serverUrl);
        inputText = findViewById(R.id.inputText);
        sendButton = findViewById(R.id.sendButton);
        progress = findViewById(R.id.progress);
        resultText = findViewById(R.id.resultText);
        countText = findViewById(R.id.countText);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        serverInput.setText(prefs.getString(KEY_URL, DEFAULT_URL));

        inputText.addTextChangedListener(this);
        updateCounter();

        sendButton.setOnClickListener(v -> sendMessage());
    }

    @Override
    public void beforeTextChanged(CharSequence s, int start, int count, int after) {
    }

    @Override
    public void onTextChanged(CharSequence s, int start, int before, int count) {
        updateCounter();
    }

    @Override
    public void afterTextChanged(Editable s) {
    }

    private void updateCounter() {
        int len = inputText.getText() == null ? 0 : inputText.getText().length();
        countText.setText(len + " / " + MAX_LEN);
    }

    private String serverUrl() {
        String url = serverInput.getText() == null ? "" : serverInput.getText().toString().trim();
        if (url.isEmpty()) {
            url = DEFAULT_URL;
        }
        if (!url.startsWith("http")) {
            url = "https://" + url;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
        return url;
    }

    private void sendMessage() {
        String text = inputText.getText() == null ? "" : inputText.getText().toString().trim();
        if (text.isEmpty()) {
            showToast("Напишите сообщение");
            return;
        }
        if (text.length() > MAX_LEN) {
            showToast("Слишком длинное сообщение (макс. " + MAX_LEN + ")");
            return;
        }

        final String url = serverUrl();

        sendButton.setEnabled(false);
        progress.setVisibility(ProgressBar.VISIBLE);
        resultText.setVisibility(TextView.GONE);

        new Thread(() -> {
            TelegramClient.Result result = client.send(url, text);

            String message;
            if (result.ok) {
                message = "✓ Сообщение доставлено в Telegram";
            } else if (result.code == -1) {
                message = "Нет связи с сервером. Проверьте адрес и интернет.";
            } else {
                message = result.detail.isEmpty()
                        ? "Ошибка сервера (" + result.code + ")"
                        : result.detail;
            }

            final boolean ok = result.ok;
            final String finalMessage = message;
            runOnUiThread(() -> {
                sendButton.setEnabled(true);
                progress.setVisibility(ProgressBar.GONE);
                showResult(finalMessage, ok ? "#37D67A" : "#FF5C6C");
                if (ok) {
                    inputText.setText("");
                    updateCounter();
                }
            });
        }).start();
    }

    private void showResult(String text, String colorHex) {
        resultText.setText(text);
        resultText.setTextColor(Color.parseColor(colorHex));
        resultText.setVisibility(TextView.VISIBLE);
        resultText.setBackgroundColor(Color.parseColor("#1F1F2E"));
        resultText.setPadding(28, 28, 28, 28);
        resultText.setGravity(Gravity.CENTER);
        resultText.setTypeface(Typeface.DEFAULT_BOLD);
    }

    private void showToast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_SHORT).show());
    }
}