#!/usr/bin/env bash
set -euo pipefail

studio_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port=4173
url="https://campoc.onrender.com/"
python_bin="${CAM_STUDIO_PYTHON:-python3}"

if [[ "${1:-}" == "--watch" ]]; then
  while true; do
    if [[ -n "${ANDROID_SERIAL:-}" ]]; then
      devices="$ANDROID_SERIAL"
    else
      devices="$(adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { print $1 }' || true)"
    fi
    count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"
    if [[ "$count" == 1 ]] && adb -s "$devices" get-state >/dev/null 2>&1; then
      mapping="$(adb -s "$devices" reverse --list 2>/dev/null || true)"
      if [[ "$mapping" != *"tcp:${port} tcp:${port}"* ]]; then
        adb -s "$devices" reverse "tcp:${port}" "tcp:${port}" >/dev/null 2>&1 || true
      fi
    fi
    sleep 2
  done
fi

if ! "$python_bin" --version >/dev/null 2>&1; then
  bundled_python="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
  if [[ -x "$bundled_python" ]] && "$bundled_python" --version >/dev/null 2>&1; then
    python_bin="$bundled_python"
  else
    echo 'Python không chạy được. Hãy cài Python 3 hoặc đặt CAM_STUDIO_PYTHON tới Python 3 hợp lệ (trên macOS có thể cần chấp nhận Xcode license).' >&2
    exit 1
  fi
fi
command -v adb >/dev/null || { echo 'Thiếu adb (Android SDK platform-tools).' >&2; exit 1; }
command -v curl >/dev/null || { echo 'Thiếu curl.' >&2; exit 1; }

if ! curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:${port}/api/info" 2>/dev/null | grep -q 'lan-jpeg-v1'; then
  if curl --silent --max-time 2 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
    echo "Cổng $port đã có server khác; không ghi đè. Hãy giải phóng cổng rồi chạy lại." >&2
    exit 1
  fi
  log_file="$(mktemp "${TMPDIR:-/tmp}/camstudio-usb.XXXXXX")"
  (cd "$studio_dir" && nohup "$python_bin" server.py >"$log_file" 2>&1 < /dev/null &)
  for _ in $(seq 1 30); do
    if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:${port}/api/info" 2>/dev/null | grep -q 'lan-jpeg-v1'; then
      break
    fi
    sleep 0.2
  done
  if ! curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:${port}/api/info" 2>/dev/null | grep -q 'lan-jpeg-v1'; then
    echo "Không khởi động được server.py; xem log: $log_file" >&2
    exit 1
  fi
  echo "Relay cục bộ đã chạy; log: $log_file"
fi

watch_pid_file="${TMPDIR:-/tmp}/camstudio-usb-watch.pid"
watch_pid="$(sed -n '1p' "$watch_pid_file" 2>/dev/null || true)"
if [[ ! "$watch_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$watch_pid" 2>/dev/null ||
  [[ "$(ps -p "$watch_pid" -o command= 2>/dev/null || true)" != *"start_usb_mode.sh --watch"* ]]; then
  watch_log="$(mktemp "${TMPDIR:-/tmp}/camstudio-usb-watch.XXXXXX")"
  nohup bash "$studio_dir/start_usb_mode.sh" --watch >"$watch_log" 2>&1 < /dev/null &
  printf '%s\n' "$!" > "$watch_pid_file"
  echo "Đang theo dõi cáp USB; khi điện thoại được ADB nhận, tcp:$port sẽ tự nối. Log: $watch_log"
else
  echo "Bộ theo dõi cáp USB đã chạy (PID $watch_pid)."
fi
echo "Mở $url, chọn Kết nối gần, Bật camera/OBS, tạo QR rồi quét bằng CamPOC hoặc Cam Browser."
if command -v open >/dev/null; then
  open "$url"
elif command -v xdg-open >/dev/null; then
  xdg-open "$url" >/dev/null 2>&1 || true
fi
