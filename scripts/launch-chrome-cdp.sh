#!/usr/bin/env bash
# launch-chrome-cdp.sh
# Launches Google Chrome on Linux with Chrome DevTools Protocol (CDP) enabled on port 9222.
# This gives browser-use and AI agents full hardware-level access to the active browser
# while preserving all existing user sessions, cookies, logins, and extensions.

PORT=${PORT:-9222}

# Check if Chrome is already listening on port 9222
if curl -s "http://localhost:${PORT}/json/version" >/dev/null 2>&1; then
  echo "[AutoApply AI] Chrome is already running with CDP on http://localhost:${PORT}"
  exit 0
fi

echo "[AutoApply AI] Launching Google Chrome with CDP on port ${PORT}..."

# If Chrome is running without CDP, prompt or restart
CHROME_PID=$(pgrep -f "/opt/google/chrome/chrome" | head -n 1)
if [ -n "$CHROME_PID" ]; then
  echo "[AutoApply AI] Notice: Chrome is currently running without remote debugging port."
  echo "[AutoApply AI] Please close Chrome or let this script restart it with --remote-debugging-port=${PORT}."
fi

# Detect Wayland or X11
OZONE_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
  OZONE_FLAGS=(
    "--ozone-platform=wayland"
    "--ozone-platform-hint=wayland"
  )
fi

exec /opt/google/chrome/chrome \
  --remote-debugging-port="${PORT}" \
  "${OZONE_FLAGS[@]}" \
  --enable-features=TouchpadOverscrollHistoryNavigation \
  --password-store=gnome-libsecret \
  "$@" >/dev/null 2>&1 &

sleep 2

if curl -s "http://localhost:${PORT}/json/version" >/dev/null 2>&1; then
  echo "[AutoApply AI] Successfully connected to Chrome CDP on http://localhost:${PORT}!"
else
  echo "[AutoApply AI] Chrome started. If existing Chrome windows were open, please close them and re-run this script to bind port ${PORT}."
fi
