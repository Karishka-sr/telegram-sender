#!/usr/bin/env bash
# Сборка APK без Gradle (aapt2 + javac + d8 + apksigner)
# Зависимости: JDK 17+, Android SDK build-tools (android-34, build-tools;34.0.0)
set -euo pipefail

cd "$(dirname "$0")"

SDK="${ANDROID_SDK_ROOT:-/tmp/android-sdk}"
BUILD_TOOLS="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"

OUT="$(pwd)/build"
GEN="$OUT/gen"
CLASSES="$OUT/classes"
APK="$OUT/unsigned.apk"
APK_ALIGNED="$OUT/aligned.apk"
APK_FINAL="TelegramSender.apk"
KEYSTORE="$(pwd)/keystore.jks"  # вне build/, иначе ключ теряется и обновления не ставятся

rm -rf "$OUT"
mkdir -p "$GEN" "$CLASSES"

echo "[1/6] aapt2 compile ресурсов..."
r="$BUILD_TOOLS/aapt2"
"$r" compile --dir res -o "$OUT/res.zip"
"$r" link -o "$APK" \
    -I "$PLATFORM" \
    --manifest AndroidManifest.xml \
    --java "$GEN" \
    --min-sdk-version 21 \
    --target-sdk-version 34 \
    "$OUT/res.zip"

echo "[2/6] javac..."
{ find src -name '*.java'; find "$GEN" -name '*.java'; } > "$OUT/sources.txt"
javac -source 17 -target 17 \
    -classpath "$PLATFORM:$OUT/classes" \
    -d "$CLASSES" @"$OUT/sources.txt"

echo "[3/6] d8..."
"$BUILD_TOOLS/d8" --release --lib "$PLATFORM" \
    --output "$OUT" $(find "$CLASSES" -name '*.class')

echo "[4/6] упаковка classes.dex в APK..."
cd "$OUT"
"$BUILD_TOOLS/aapt" add "$APK" classes.dex
cd ..

echo "[5/6] выравнивание zipalign..."
"$BUILD_TOOLS/zipalign" -f 4 "$APK" "$APK_ALIGNED"

echo "[6/6] подпись..."
if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair -v \
        -keystore "$KEYSTORE" \
        -alias sender \
        -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass android -keypass android \
        -dname "CN=Telegram Sender, OU=App, O=Self, C=RU" >/dev/null 2>&1
fi
"$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
    --out "$APK_FINAL" "$APK_ALIGNED"

echo
echo "Готово: $(pwd)/$APK_FINAL"
ls -lh "$APK_FINAL"