#!/usr/bin/env bash
# start.sh で起動したサーバを止める。
set -euo pipefail

STATE_DIR="${UI_CONTEXT_STATE_DIR:-$HOME/.local/state/ui-context}"
PID_FILE="$STATE_DIR/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "not running (no pid file)"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped (pid $PID)"
else
  echo "not running (stale pid file)"
fi
rm -f "$PID_FILE"
