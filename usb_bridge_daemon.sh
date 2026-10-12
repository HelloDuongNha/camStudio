#!/usr/bin/env bash
set -u

studio_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port=4173
adb_bin="${CAM_STUDIO_ADB:-/opt/homebrew/bin/adb}"
bundled_python="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
python_bin="${CAM_STUDIO_PYTHON:-$bundled_python}"
relay_pid=""

if [[ ! -x "$python_bin" ]]; then
  echo "Không tìm thấy Python tại $python_bin" >&2
  exit 1
fi
if [[ ! -x "$adb_bin" ]]; then
  echo "Không tìm thấy adb tại $adb_bin" >&2
  exit 1
fi

cleanup() {
  if [[ "$relay_pid" =~ ^[0-9]+$ ]]; then
    kill "$relay_pid" 2>/dev/null || true
    wait "$relay_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_relay() {
  if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:${port}/api/info" 2>/dev/null |
      /usr/bin/grep -q 'lan-jpeg-v1'; then
    relay_pid=""
    return
  fi
  echo "Khởi động CamPOC USB relay trên 127.0.0.1:${port}"
  (
    cd "$studio_dir" || exit 1
    CAM_STUDIO_BIND=127.0.0.1 exec "$python_bin" server.py
  ) &
  relay_pid="$!"
}

start_relay
while true; do
  if [[ "$relay_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$relay_pid" 2>/dev/null; then
    wait "$relay_pid" 2>/dev/null || true
    relay_pid=""
    /bin/sleep 1
    start_relay
  elif [[ -z "$relay_pid" ]] && ! /usr/bin/curl -fsS --max-time 1 \
      "http://127.0.0.1:${port}/api/info" >/dev/null 2>&1; then
    start_relay
  fi

  while read -r serial state; do
    [[ "$state" == "device" ]] || continue
    mapping="$($adb_bin -s "$serial" reverse --list 2>/dev/null || true)"
    if [[ "$mapping" != *"tcp:${port} tcp:${port}"* ]]; then
      if "$adb_bin" -s "$serial" reverse "tcp:${port}" "tcp:${port}" >/dev/null 2>&1; then
        echo "Đã nối USB cho thiết bị $serial"
      fi
    fi
  done < <("$adb_bin" devices 2>/dev/null | /usr/bin/awk 'NR > 1 && NF >= 2 { print $1, $2 }')

  /bin/sleep 2
done
