package com.example.telegramsender;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;

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
    private static final int MAX_FILE = 20 * 1024 * 1024;
    private static final int REQ_PICK_FILE = 1001;

    private final TelegramClient client = new TelegramClient();

    private EditText serverInput;
    private EditText inputText;
    private Button sendButton;
    private ProgressBar progress;
    private TextView resultText;
    private TextView countText;
    private TextView fileInfo;

    private Uri pickedUri;
    private String pickedName;
    private boolean fileReadFailed;

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
        fileInfo = findViewById(R.id.fileInfo);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        serverInput.setText(prefs.getString(KEY_URL, DEFAULT_URL));

        inputText.addTextChangedListener(this);
        updateCounter();

        sendButton.setOnClickListener(v -> sendMessage());

        setupToolbar();
    }

    private void setupToolbar() {
        LinearLayout toolbar = findViewById(R.id.toolbar);
        if (toolbar == null) {
            return;
        }
        addTool(toolbar, R.id.btnBold, "[b]", "[/b]");
        addTool(toolbar, R.id.btnItalic, "[i]", "[/i]");
        addTool(toolbar, R.id.btnUnderline, "[u]", "[/u]");
        addTool(toolbar, R.id.btnStrike, "[s]", "[/s]");
        addTool(toolbar, R.id.btnCode, "[code]", "[/code]");
        addTool(toolbar, R.id.btnSpoiler, "[spoiler]", "[/spoiler]");
        findViewById(R.id.btnFile).setOnClickListener(v -> pickFile());
    }

    private void addTool(LinearLayout toolbar, int id, String open, String close) {
        Button b = toolbar.findViewById(id);
        if (b != null) {
            b.setOnClickListener(v -> wrapSelection(open, close));
        }
    }

    /** Оборачивает выделенный текст в BB-теги. */
    private void wrapSelection(String open, String close) {
        int start = inputText.getSelectionStart();
        int end = inputText.getSelectionEnd();
        Editable editable = inputText.getText();
        if (editable == null) {
            return;
        }
        // перестраховка: если курсор не на месте, выделяем всё
        if (start < 0 || end < start) {
            start = 0;
            end = editable.length();
        }
        String selected = start == end ? "текст" : editable.subSequence(start, end).toString();
        editable.replace(start, end, open + selected + close);
        inputText.setSelection(start + open.length(), start + open.length() + selected.length());
        updateCounter();
    }

    private void pickFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        try {
            startActivityForResult(intent, REQ_PICK_FILE);
        } catch (Exception e) {
            showToast("Не удалось открыть окно выбора файла");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PICK_FILE && resultCode == RESULT_OK && data != null) {
            pickedUri = data.getData();
            pickedName = resolveFileName(pickedUri);
            fileReadFailed = false;
            fileInfo.setText("Файл: " + pickedName);
            fileInfo.setVisibility(TextView.VISIBLE);
        }
    }

    private String resolveFileName(Uri uri) {
        try (android.database.Cursor c = getContentResolver().query(
                uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = c.getString(idx);
                    if (name != null && !name.isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        String name = uri.getLastPathSegment();
        return name == null ? "файл" : name;
    }

    private byte[] readPickedFile() {
        if (pickedUri == null) {
            return null;
        }
        InputStream in;
        try {
            in = new BufferedInputStream(getContentResolver().openInputStream(pickedUri));
        } catch (Exception e) {
            return null;
        }
        try (InputStream stream = in) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int read;
            long total = 0;
            while ((read = stream.read(buf)) != -1) {
                total += read;
                if (total > MAX_FILE) {
                    return null;
                }
                out.write(buf, 0, read);
            }
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        }
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
        final String text = inputText.getText() == null ? "" : inputText.getText().toString().trim();

        if (text.isEmpty() && pickedUri == null) {
            showToast("Напишите сообщение или выберите файл");
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
            TelegramClient.Result result;
            if (pickedUri != null) {
                byte[] data = readPickedFile();
                if (data == null) {
                    runOnUiThread(() -> {
                        sendButton.setEnabled(true);
                        progress.setVisibility(ProgressBar.GONE);
                        showResult("Не удалось прочитать файл (макс. 20 МБ)", "#FF5C6C");
                    });
                    return;
                }
                result = client.sendDocument(url, pickedName, data, text);
            } else {
                result = client.send(url, text);
            }

            final TelegramClient.Result fResult = result;
            runOnUiThread(() -> {
                sendButton.setEnabled(true);
                progress.setVisibility(ProgressBar.GONE);
                if (fResult.ok) {
                    showResult(pickedUri != null
                            ? "✓ Файл доставлен в Telegram"
                            : "✓ Сообщение доставлено в Telegram", "#37D67A");
                    inputText.setText("");
                    updateCounter();
                    clearFile();
                } else {
                    String message;
                    if (fResult.code == -1) {
                        message = "Нет связи с сервером. Проверьте адрес и интернет.";
                    } else {
                        message = fResult.detail.isEmpty()
                                ? "Ошибка сервера (" + fResult.code + ")"
                                : fResult.detail;
                    }
                    showResult(message, "#FF5C6C");
                    fileReadFailed = true;
                }
            });
        }).start();
    }

    private void clearFile() {
        pickedUri = null;
        pickedName = null;
        fileReadFailed = false;
        fileInfo.setVisibility(View.GONE);
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