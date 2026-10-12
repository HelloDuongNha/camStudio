#!/usr/bin/env bash
set -euo pipefail

studio_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
label="com.camvirtual.usb-bridge"
agent_dir="${HOME}/Library/LaunchAgents"
log_dir="${HOME}/Library/Logs/CamVirtual"
plist_path="${agent_dir}/${label}.plist"
uid="$(id -u)"

mkdir -p "$agent_dir" "$log_dir"
cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${studio_dir}/usb_bridge_daemon.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${log_dir}/usb-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${log_dir}/usb-bridge-error.log</string>
</dict>
</plist>
EOF

chmod 600 "$plist_path"
chmod +x "$studio_dir/usb_bridge_daemon.sh"
plutil -lint "$plist_path"
launchctl bootout "gui/${uid}/${label}" 2>/dev/null || true
launchctl bootstrap "gui/${uid}" "$plist_path"
launchctl enable "gui/${uid}/${label}"
launchctl kickstart -k "gui/${uid}/${label}"
echo "Đã cài CamPOC USB bridge tự khởi động: $plist_path"
