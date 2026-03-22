#!/usr/bin/env bash

set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
make_bin="${CLAUDE_HOOK_MAKE_BIN:-make}"

payload="$(cat)"
if [ -z "$payload" ]; then
  exit 0
fi

file_path="$(
  printf '%s' "$payload" | python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = data.get("tool_input") or {}
file_path = tool_input.get("file_path") or ""
sys.stdout.write(file_path)
'
)"

if [ -z "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  "$project_dir"/*)
    rel_path="${file_path#"$project_dir"/}"
    ;;
  *)
    rel_path="$file_path"
    ;;
esac

if [ -z "$rel_path" ]; then
  exit 0
fi

case "$rel_path" in
  ../*|*/../*|..)
    exit 0
    ;;
esac

"$make_bin" -C "$project_dir" --no-print-directory claude-post-tool-use FILE_PATH="$rel_path" >/dev/null 2>&1 || true
