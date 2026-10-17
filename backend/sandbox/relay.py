"""Outbound CDP relay. Runs in the Chalk sandbox next to Chromium.

Dials the Landline backend over WebSocket and multiplexes CDP connections over it.
Frames are JSON text:
  relay -> backend: {"t":"hello","chromium":{...}}  {"t":"msg","ch":N,"d":"<cdp json>"}  {"t":"close","ch":N}  {"t":"ping"}  {"t":"pong"}
  backend -> relay: {"t":"open","ch":N}  {"t":"msg","ch":N,"d":"..."}  {"t":"close","ch":N}  {"t":"ping"}  {"t":"pong"}
"""
import asyncio
import json
import os
import sys
import urllib.request

import websockets

WS_URL = os.environ["LANDLINE_WS_URL"]
TOKEN = os.environ["LANDLINE_TOKEN"]
VERSION_URL = "http://127.0.0.1:9222/json/version"
PING_EVERY = 20


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def fetch_version():
    with urllib.request.urlopen(VERSION_URL, timeout=5) as r:
        return json.loads(r.read())


async def session():
    version = await asyncio.to_thread(fetch_version)
    async with websockets.connect(
        WS_URL,
        additional_headers={"x-landline-token": TOKEN},
        max_size=None,
        ping_interval=None,
    ) as ws:
        log("connected to backend")
        await ws.send(json.dumps({"t": "hello", "chromium": version}))
        channels = {}  # ch -> (local websocket, pump task)

        async def send(obj):
            await ws.send(json.dumps(obj))

        async def pump(ch, local):
            try:
                async for data in local:
                    if isinstance(data, bytes):
                        data = data.decode()
                    await send({"t": "msg", "ch": ch, "d": data})
            except Exception as err:
                log("channel", ch, "pump error", err)
            finally:
                if channels.pop(ch, None) is not None:
                    try:
                        await send({"t": "close", "ch": ch})
                    except Exception:
                        pass

        async def open_channel(ch):
            try:
                v = await asyncio.to_thread(fetch_version)
                local = await websockets.connect(v["webSocketDebuggerUrl"], max_size=None, ping_interval=None)
            except Exception as err:
                log("channel", ch, "open failed", err)
                await send({"t": "close", "ch": ch})
                return
            task = asyncio.create_task(pump(ch, local))
            channels[ch] = (local, task)

        async def heartbeat():
            while True:
                await asyncio.sleep(PING_EVERY)
                await send({"t": "ping"})

        hb = asyncio.create_task(heartbeat())
        opening = {}  # ch -> task, so a msg right after open waits for the local socket
        try:
            async for raw in ws:
                m = json.loads(raw)
                t = m.get("t")
                ch = m.get("ch")
                if t == "ping":
                    await send({"t": "pong"})
                elif t == "open":
                    opening[ch] = asyncio.create_task(open_channel(ch))
                elif t == "msg":
                    async def forward(ch=ch, d=m["d"]):
                        pending = opening.get(ch)
                        if pending:
                            await pending
                        entry = channels.get(ch)
                        if entry:
                            await entry[0].send(d)
                    asyncio.create_task(forward())
                elif t == "close":
                    pending = opening.pop(ch, None)
                    async def shut(ch=ch, pending=pending):
                        if pending:
                            await pending
                        entry = channels.pop(ch, None)
                        if entry:
                            await entry[0].close()
                    asyncio.create_task(shut())
        finally:
            hb.cancel()
            for local, task in list(channels.values()):
                task.cancel()
                await local.close()
            channels.clear()


async def main():
    delay = 1
    while True:
        try:
            await session()
            delay = 1
        except Exception as err:
            log("relay error:", err)
        await asyncio.sleep(delay)
        delay = min(delay * 2, 15)


asyncio.run(main())
