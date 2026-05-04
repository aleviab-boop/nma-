"""Minimal static-file dev server for the Maison project.

Bypasses `python3 -m http.server`'s argparse path which crashes under macOS
TCC restrictions on Downloads (it calls os.getcwd() as an argparse default).
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', '8000'))

os.chdir(PROJECT_DIR)


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Disable caching so refreshes always pull the latest index.html."""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    server = ThreadingHTTPServer(('', PORT), NoCacheHandler)
    print(f'Maison · serving {PROJECT_DIR} on http://localhost:{PORT}')
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
