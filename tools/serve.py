#!/usr/bin/env python3
"""Local static server for development.

`python3 -m http.server` evaluates os.getcwd() at import time, which the
sandbox here refuses. Pinning the directory to this repo avoids that entirely.
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777


class Handler(http.server.SimpleHTTPRequestHandler):
    # Left at HTTP/1.0: keep-alive on this stdlib server proved flaky here
    # (hung, then reset connections). This is a dev convenience only — the
    # real deployment is static hosting.
    def end_headers(self):
        # Never serve a stale shell while iterating; the service worker does
        # the real caching in production.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    os.chdir(ROOT)
    # Threaded, because HTTP/1.1 keep-alive on a single-threaded server lets one
    # held connection block every other request — the page then loads its HTML
    # and hangs waiting for its own scripts.
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print("serving %s on http://127.0.0.1:%d/" % (ROOT, PORT), flush=True)
        httpd.serve_forever()
