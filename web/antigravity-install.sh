#!/bin/sh
# Manual, user-reviewed setup in the app's Ubuntu guest; never called by chat.
# Official source: https://www.antigravity.google/docs/cli/install/
set -eu
export HOME=/root
export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
for tool in bash curl mktemp; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'Dependency missing: %s. Install it in Ubuntu first.\n' "$tool" >&2
    exit 1
  }
done
# A file is not proof of a working installation. Do not overwrite it blindly.
if [ -e "$HOME/.local/bin/agy" ]; then
  printf 'Existing agy found. Checking version without reinstalling…\n'
  "$HOME/.local/bin/agy" --version
  exit $?
fi
installer="$(mktemp /tmp/aiteam-agy-install.XXXXXX)"
trap 'rm -f "$installer"' EXIT
trap 'exit 130' HUP INT TERM
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 120 \
  https://antigravity.google/cli/install.sh -o "$installer"
# Download must succeed before executing anything. Do not rewrite shell profiles.
bash "$installer" --skip-aliases --skip-path
"$HOME/.local/bin/agy" --version
printf 'Version check passed. Account login and agent integration are not enabled.\n'
