"""Local HTTP proxy forwarder for the Chalk sandbox: listens on 127.0.0.1:3128 without auth and
forwards to the authenticated upstream in PROXY_UPSTREAM (http://user:pass@host:port), adding
Proxy-Authorization. Chrome's --proxy-server cannot answer the upstream 407 challenge itself.
Never logs the upstream URL or credentials."""
import asyncio
import base64
import os
import sys


def parse_upstream(url: str):
    rest = url.split("://", 1)[-1]
    creds, hostport = rest.rsplit("@", 1)
    user, password = creds.split(":", 1)
    host, port = hostport.rsplit(":", 1)
    return host, int(port), base64.b64encode(f"{user}:{password}".encode()).decode()


HOST, PORT, AUTH = parse_upstream(os.environ["PROXY_UPSTREAM"])


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:  # noqa: BLE001
        pass
    finally:
        try:
            if writer.can_write_eof():
                writer.write_eof()
            else:
                writer.close()
        except Exception:  # noqa: BLE001
            pass


async def handle(creader, cwriter):
    uwriter = None
    try:
        head = await asyncio.wait_for(creader.readuntil(b"\r\n\r\n"), 30)
        lines = head.decode("latin-1").split("\r\n")
        method, target = lines[0].split(" ")[:2]
        ureader, uwriter = await asyncio.wait_for(asyncio.open_connection(HOST, PORT), 20)
        if method.upper() == "CONNECT":
            uwriter.write(
                (f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n"
                 f"Proxy-Authorization: Basic {AUTH}\r\nProxy-Connection: keep-alive\r\n\r\n").encode()
            )
            await uwriter.drain()
            resp = await asyncio.wait_for(ureader.readuntil(b"\r\n\r\n"), 30)
            if not (resp.startswith(b"HTTP/1.1 200") or resp.startswith(b"HTTP/1.0 200")):
                cwriter.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                await cwriter.drain()
                return
            cwriter.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await cwriter.drain()
        else:
            kept = [l for l in lines[1:] if l and not l.lower().startswith("proxy-authorization:")]
            out = "\r\n".join([lines[0]] + kept + [f"Proxy-Authorization: Basic {AUTH}"]) + "\r\n\r\n"
            uwriter.write(out.encode("latin-1"))
            await uwriter.drain()
        await asyncio.gather(pipe(creader, uwriter), pipe(ureader, cwriter))
    except Exception:  # noqa: BLE001
        try:
            cwriter.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
        except Exception:  # noqa: BLE001
            pass
    finally:
        for w in (cwriter, uwriter):
            try:
                if w:
                    w.close()
            except Exception:  # noqa: BLE001
                pass


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", 3128, backlog=512)
    print("proxyfwd listening", file=sys.stderr, flush=True)
    async with server:
        await server.serve_forever()


asyncio.run(main())
