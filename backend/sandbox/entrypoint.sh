#!/bin/sh
# Runs inside the Chalk sandbox: start Xvfb + headful real Google Chrome, then hand over to the relay.
Xvfb :99 -screen 0 1280x800x24 > /tmp/xvfb.log 2>&1 &
export DISPLAY=:99
sleep 1
mkdir -p /tmp/profile
google-chrome-stable --no-sandbox --disable-dev-shm-usage --disable-gpu \
  --remote-debugging-port=9222 --user-data-dir=/tmp/profile --window-size=1280,800 \
  --no-first-run --no-default-browser-check about:blank > /tmp/chrome.log 2>&1 &

i=0
until curl -sf -m 2 http://127.0.0.1:9222/json/version > /dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    echo "Chrome did not start" >&2
    cat /tmp/chrome.log >&2
    exit 1
  fi
  sleep 0.5
done

exec python /app/relay.py
