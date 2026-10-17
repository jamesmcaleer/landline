#!/bin/sh
# Runs inside the Chalk sandbox: start headless Chromium, then hand over to the relay.
mkdir -p /tmp/profile
chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --remote-debugging-port=9222 --user-data-dir=/tmp/profile --window-size=1280,800 \
  about:blank > /tmp/chromium.log 2>&1 &

i=0
until curl -sf -m 2 http://127.0.0.1:9222/json/version > /dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    echo "Chromium did not start" >&2
    cat /tmp/chromium.log >&2
    exit 1
  fi
  sleep 0.5
done

exec python /app/relay.py
