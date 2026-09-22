#!/usr/bin/env bash
# ui-context のキャプチャ受け側サーバを手動で起動する。
# 既に起動済みなら何もしない。ログとPIDは ~/.local/state/ui-context/ に置く。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${UI_CONTEXT_STATE_DIR:-$HOME/.local/state/ui-context}"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"

mkdir -p "$STATE_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running (pid $(cat "$PID_FILE"))"
  exit 0
fi

nohup python3 "$HERE/capture_server.py" >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# 起動直後に落ちていないかだけ確認する
sleep 1
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "failed to start. see $LOG_FILE" >&2
  tail -n 20 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "started (pid $(cat "$PID_FILE"))"
echo "log: $LOG_FILE"
