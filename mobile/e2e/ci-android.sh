#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner (emulator already booted).
# Installs the APK and runs the Maestro suite; screenshots/logs/junit land in
# mobile/e2e/results for the workflow to upload even when flows fail.
set -uo pipefail
cd "$(dirname "$0")"

out="$PWD/results"
mkdir -p "$out"

# The CI emulator is slow enough that the launcher trips an ANR ("Pixel Launcher
# isn't responding"), and that dialog covers the app and fails every flow.
adb shell settings put global hide_error_dialogs 1

adb install -r ../../dist/zenflow-android.apk

status=0
E2E_OUTPUT="$out" MAILPIT_URL="http://localhost:8025" ./run.sh || status=$?

adb logcat -d > "$out/logcat.txt" 2>/dev/null || true
exit "$status"
