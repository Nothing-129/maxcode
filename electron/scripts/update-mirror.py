#!/usr/bin/env python3
"""LAN mirror of MaxCode GitHub Releases, fetched through the 222 Mihomo proxy."""

from __future__ import annotations

import os
import re
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OWNER_REPO = "Nothing-129/maxcode"
FILE_RE = re.compile(
    r"^(?:latest-[A-Za-z0-9.-]+\.yml|"
    r"MaxCode-[A-Za-z0-9._-]+\.(?:zip|dmg|exe|AppImage|deb)(?:\.blockmap)?)$"
)
TAG_RE = re.compile(r"^v[0-9]+(?:\.[0-9A-Za-z-]+)*$")
PASS_HEADERS = (
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
)


def env(name: str, default: str) -> str:
    value = os.environ.get(name, default).strip()
    return value or default


BIND = env("MAXCODE_MIRROR_BIND", "192.168.10.222")
PORT = int(env("MAXCODE_MIRROR_PORT", "17896"))
PROXY = env("MAXCODE_MIRROR_PROXY", "http://172.17.0.1:17897")
UPSTREAM = f"https://github.com/{OWNER_REPO}/releases"


def resolve(path: str) -> str | None:
    route = path.split("?", 1)[0].lstrip("/")
    if route in {"", "health"}:
        return ""
    if route.startswith("download/"):
        parts = route.split("/")
        if len(parts) != 3 or not TAG_RE.fullmatch(parts[1]) or not FILE_RE.fullmatch(parts[2]):
            return None
        return f"{UPSTREAM}/download/{parts[1]}/{parts[2]}"
    if "/" in route or not FILE_RE.fullmatch(route):
        return None
    return f"{UPSTREAM}/latest/download/{route}"


def opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "MaxCodeUpdateMirror/1"

    def do_GET(self) -> None:
        self.proxy("GET")

    def do_HEAD(self) -> None:
        self.proxy("HEAD")

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def proxy(self, method: str) -> None:
        target = resolve(self.path)
        if target is None:
            self.send_error(404, "Not a MaxCode update asset")
            return
        if target == "":
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if method != "HEAD":
                self.wfile.write(body)
            return
        request = urllib.request.Request(target, method=method)
        range_header = self.headers.get("Range")
        if range_header:
            request.add_header("Range", range_header)
        try:
            with opener().open(request, timeout=600) as response:
                self.send_response(response.status)
                for name in PASS_HEADERS:
                    value = response.headers.get(name)
                    if value:
                        self.send_header(name, value)
                self.end_headers()
                if method == "HEAD":
                    return
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as error:
            self.send_error(error.code, "Upstream rejected the update asset")
        except Exception:
            self.send_error(502, "Update mirror could not reach GitHub")


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--resolve":
        print(resolve(sys.argv[2]) or "")
        return 0
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"maxcode update mirror on http://{BIND}:{PORT} via {PROXY}", flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
