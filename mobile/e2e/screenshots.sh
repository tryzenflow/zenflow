#!/usr/bin/env bash
# Captures the landing-page screenshots into backend/src/landing/assets/ from a
# booted emulator or simulator with the app installed (E2E build, see
# docs/mobile/testing.md). Needs the dev stack, the fake DLU server and API up
# (see backend/scripts/fixtures/dlu/README.md).
#   pnpm --filter mobile e2e:screenshots           # capture only
#   SEED=1 pnpm --filter mobile e2e:screenshots    # seed the fixture student first
# Needs `cwebp` (brew install webp) for WebP; without it the PNGs are kept as is.
set -euo pipefail
cd "$(dirname "$0")"

command -v maestro >/dev/null || { echo "Install Maestro: https://docs.maestro.dev/getting-started/installing-maestro" >&2; exit 1; }

root="$(cd ../.. && pwd)"
fixtures="$root/backend/scripts/fixtures/dlu"
dest="$root/backend/src/landing/assets"
# The first fixture student, as seed-and-sync.js names accounts.
student="$(node -e 'console.log(require(process.argv[1])[0].StudentID.toLowerCase())' "$fixtures/students.json")"
email="${EMAIL:-$student@fixtures.test}"

if [ "${SEED:-0}" = "1" ]; then
  (cd "$fixtures" && node seed-and-sync.js --limit 1)
fi

# A clean status bar (09:41, full battery, no notifications) when the tool is around.
if command -v adb >/dev/null && adb get-state >/dev/null 2>&1; then
  adb shell settings put global sysui_demo_allowed 1 || true
  adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null || true
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null || true
  adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null || true
  adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null || true
  trap 'adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null || true' EXIT
elif command -v xcrun >/dev/null && xcrun simctl list devices booted 2>/dev/null | grep -q Booted; then
  xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true
  trap 'xcrun simctl status_bar booted clear || true' EXIT
fi

# Maestro writes `takeScreenshot: name` as ./name.png, so run from a scratch dir.
work="$(mktemp -d)"
mkdir "$work/e2e"
cp -r flows subflows scripts screenshots "$work/e2e/"
(cd "$work" && maestro test \
  -e EMAIL="$email" \
  -e MAILPIT_URL="${MAILPIT_URL:-http://localhost:8025}" \
  "$work/e2e/screenshots/capture.yaml")

mkdir -p "$dest"
# PNG_DIR=<dir> also keeps the full-size PNGs, numbered for ios.json (screenshot-1.png ...).
landing=" week month new-task settings "
n=0
for name in day week month list new-task settings marks; do
  n=$((n + 1))
  png="$work/$name.png"
  [ -f "$png" ] || { echo "Missing $name.png: the flow did not reach that screen" >&2; exit 1; }
  if [ -n "${PNG_DIR:-}" ]; then
    mkdir -p "$PNG_DIR"
    cp "$png" "$PNG_DIR/screenshot-$n.png"
  fi
  case "$landing" in *" $name "*) ;; *) continue ;; esac
  if command -v cwebp >/dev/null; then
    cwebp -quiet -q 82 -resize 480 0 "$png" -o "$dest/$name.webp"
  else
    cp "$png" "$dest/$name.png"
    echo "cwebp not found: kept $name.png (update the file names in landing.content.ts or install webp)" >&2
  fi
done
echo "Wrote screenshots to $dest"
