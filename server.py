#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request
import urllib.error
import json
import os
import ssl

# Fix SSL on Mac
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

class ProxyHandler(SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/chat':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)
                data = json.loads(body)

                api_key = data.get('api_key', '')
                payload = json.dumps({
                    'model': data.get('model', 'meta/llama-3.3-70b-instruct'),
                    'max_tokens': 1000,
                    'messages': data.get('messages', [])
                }).encode('utf-8')

                req = urllib.request.Request(
                    'https://integrate.api.nvidia.com/v1/chat/completions',
                    data=payload,
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {api_key}',
                        'Content-Length': str(len(payload))
                    }
                )

                try:
                    with urllib.request.urlopen(req, timeout=30, context=ssl_context) as resp:
                        result = resp.read()
                    self._respond(200, result)
                except urllib.error.HTTPError as e:
                    result = e.read()
                    self._respond(e.code, result)

            except Exception as e:
                msg = json.dumps({'error': {'message': str(e)}}).encode()
                self._respond(500, msg)
        else:
            self._respond(404, b'{"error":"not found"}')

    def _respond(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def log_message(self, format, *args):
        print(f'[server] {args[0]} — {args[1]}')

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = 8080
    server = HTTPServer(('localhost', port), ProxyHandler)
    print(f'✅ Сервер запущен: http://localhost:{port}')
    print(f'   Открой в браузере: http://localhost:{port}/customs-declaration.html')
    print(f'   Остановить: Ctrl+C')
    server.serve_forever()
