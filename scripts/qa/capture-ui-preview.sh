#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT="${1:-$ROOT/ui-preview-evidence}"
mkdir -p "$OUTPUT"
if ! command -v npx >/dev/null 2>&1; then
  echo "UI_PREVIEW_BLOCKED: npx unavailable" >&2
  exit 41
fi
# Local static preview only: no production credentials or private chat data.
for spec in "390,844:portrait" "844,390:landscape" "1280,800:desktop"; do
  dims="${spec%%:*}"
  label="${spec#*:}"
  npx --yes playwright screenshot --viewport-size="$dims" --wait-for-timeout=500 \
    "file://$ROOT/web/index.html" "$OUTPUT/$label.png" || {
    echo "UI_PREVIEW_BLOCKED: browser dependencies or launch failed ($label)" >&2
    exit 42
  }
  test -s "$OUTPUT/$label.png"
done
echo "UI_PREVIEW_CAPTURE_PASS"
