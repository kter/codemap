#!/usr/bin/env bash

set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
make_bin="${CLAUDE_HOOK_MAKE_BIN:-make}"

payload="$(cat)"
if [ -z "$payload" ]; then
  exit 0
fi

command="$(
  printf '%s' "$payload" | python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = data.get("tool_input") or {}
command = tool_input.get("command") or ""
sys.stdout.write(command)
'
)"

if [ -z "$command" ]; then
  exit 0
fi

CLAUDE_HOOK_COMMAND="$command" \
  "$make_bin" -C "$project_dir" --no-print-directory claude-pre-tool-use
