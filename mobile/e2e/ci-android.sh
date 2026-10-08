#!/usr/bin/env bash
# Runs inside reactivecircus/android-emulator-runner (emulator already booted).
# Installs the APK, records the screen in 3-minute segments (screenrecord's
# hard limit) and runs the Maestro suite; screenshots/logs/junit land in
# mobile/e2e/results for the workflow to upload even when flows fail.
set -uo pipefail
cd "$(dirname "$0")"

out="$PWD/results"
mkdir -p "$out"

adb install -r ../../dist/zenflow-android.apk

# Background recorder: one mp4 per segment until the flows finish.
(
  i=0
  while [ ! -f "$out/.done" ]; do
    adb shell screenrecord --time-limit 180 "/sdcard/run-$i.mp4" || break
    i=$((i + 1))
  done
) &
recorder=$!

status=0
E2E_OUTPUT="$out" MAILPIT_URL="http://localhost:8025" ./run.sh || status=$?

touch "$out/.done"
wait "$recorder" 2>/dev/null || true
adb pull /sdcard/ "$out/video" >/dev/null 2>&1 || true
adb logcat -d > "$out/logcat.txt" 2>/dev/null || true
exit "$status"
