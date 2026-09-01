import http.server
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", 8934))


class Handler(http.server.BaseHTTPRequestHandler):
    def _api(self):
        return self.path.split("?")[0] == "/api/timesheet"

    def do_GET(self):
        if self._api():
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"found": False}).encode())
            return
        path = self.path.split("?")[0]
        if path == "/":
            path = "/DH_timesheet.html"
        file_path = os.path.join(ROOT, path.lstrip("/"))
        if not os.path.isfile(file_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        ctype = "text/html" if file_path.endswith(".html") else "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())

    def do_PUT(self):
        if self._api():
            length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(length)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"stub server on {PORT}")
    server.serve_forever()
