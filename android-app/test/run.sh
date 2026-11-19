#!/usr/bin/env bash
# Прогоняет тесты сетевого клиента приложения на обычной JVM (без эмулятора).
set -eu
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

javac -d "$OUT" src/com/example/telegramsender/TelegramClient.java test/TelegramClientTest.java
java -cp "$OUT" TelegramClientTest
