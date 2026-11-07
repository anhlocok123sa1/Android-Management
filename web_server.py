import http.server
import json
import os
import socketserver
import threading
import webbrowser
from sgl_manager.config import DEFAULT_ANYDESK_PASS, open_anydesk_session

PORT = 8080
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class SGLWebHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_POST(self):
        if self.path == "/api/open_anydesk":
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8", errors="ignore")
            try:
                data = json.loads(raw_body)
                ad_id = data.get("anydesk_id", "")
                password = data.get("password", DEFAULT_ANYDESK_PASS)
                ok, msg = open_anydesk_session(ad_id, password=password)
                resp = {"status": "ok" if ok else "error", "message": msg}
            except Exception as e:
                resp = {"status": "error", "message": str(e)}

            body_bytes = json.dumps(resp, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            self.wfile.write(body_bytes)
            return

        self.send_error(404, "Endpoint not found")

    def log_message(self, format, *args):
        pass


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), SGLWebHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print("============================================================")
        print("  SGL SMART BROADCAST CLOUD — WEB SERVER QUAN TRI ANDROID")
        print(f"  Dang chay tai: {url}")
        print("  Bam Ctrl+C de dung server.")
        print("============================================================")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDa dung Web Server.")


if __name__ == "__main__":
    main()
